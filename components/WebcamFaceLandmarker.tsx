"use client";

import { useEffect, useRef, useState } from "react";
import { DrawingUtils, FaceLandmarker } from "@mediapipe/tasks-vision";
import { getFaceLandmarker } from "@/lib/mediapipe/faceLandmarker";
import {
  EYE_INDICES,
  IRIS_INDICES,
  GATEKEEPER,
} from "@/lib/eyetracking/config";
import { evaluateGatekeeper, pickLandmarks } from "@/lib/eyetracking/gatekeeper";
import type { EyeTrackingFrame } from "@/lib/eyetracking/types";

export { EYE_INDICES, IRIS_INDICES, GATEKEEPER };
export type { EyeTrackingFrame, LandmarkPoint } from "@/lib/eyetracking/types";

export type CameraOption = {
  deviceId: string;
  label: string;
};

type WebcamFaceLandmarkerProps = {
  cameraId: string;
  cameraLabel: string;
  requestedWidth: number;
  requestedHeight: number;
  requestedFrameRate: number;
  showPreview?: boolean;
  onFaceValidChange?: (cameraId: string, isValid: boolean) => void;
  onFrame?: (cameraId: string, frame: EyeTrackingFrame) => void;
};

type VideoFrameMeta = { mediaTime: number; captureTime?: number };
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: VideoFrameMeta) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export async function enumerateCameras(): Promise<CameraOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    throw new Error("Browser tidak mendukung akses daftar kamera.");
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "videoinput")
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Kamera ${index + 1}`,
    }));
}

export default function WebcamFaceLandmarker({
  cameraId,
  cameraLabel,
  requestedWidth,
  requestedHeight,
  requestedFrameRate,
  showPreview = true,
  onFaceValidChange,
  onFrame,
}: WebcamFaceLandmarkerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const showPreviewRef = useRef(showPreview);
  const faceValidCallbackRef = useRef(onFaceValidChange);
  const frameCallbackRef = useRef(onFrame);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFaceValid, setIsFaceValid] = useState(false);

  useEffect(() => { showPreviewRef.current = showPreview; }, [showPreview]);
  useEffect(() => { faceValidCallbackRef.current = onFaceValidChange; }, [onFaceValidChange]);
  useEffect(() => { frameCallbackRef.current = onFrame; }, [onFrame]);

  useEffect(() => {
    const video = videoRef.current as VideoWithFrameCallback | null;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let rafId: number | null = null;
    let vfcId: number | null = null;
    let lastVideoTime = -1;
    let lastDetectTs = -1;
    let frameIndex = 0;
    let lastFaceValid: boolean | null = null;
    let drawingUtils: DrawingUtils | null = null;
    let lastMeta: { mediaTime: number; captureTime: number } | null = null;

    const start = async () => {
      try {
        if (!cameraId) throw new Error("Pilih kamera terlebih dahulu.");
        const [faceLandmarker, newStream] = await Promise.all([
          getFaceLandmarker(),
          navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: cameraId },
              width: { ideal: requestedWidth },
              height: { ideal: requestedHeight },
              frameRate: { ideal: requestedFrameRate },
            },
            audio: false,
          }),
        ]);
        if (cancelled) {
          newStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = newStream;
        if (!video) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setIsLoading(false);

        if (typeof video.requestVideoFrameCallback === "function") {
          const onVideoFrame = (_now: number, metadata: VideoFrameMeta) => {
            if (cancelled) return;
            const captureTime = metadata.captureTime;
            lastMeta =
              typeof captureTime === "number" &&
              captureTime > 0 &&
              Math.abs(performance.now() - captureTime) < 1000
                ? { mediaTime: metadata.mediaTime, captureTime }
                : null;
            vfcId = video.requestVideoFrameCallback!(onVideoFrame);
          };
          vfcId = video.requestVideoFrameCallback(onVideoFrame);
        }

        const processFrame = () => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (!w || !h) return;
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          const context = canvas.getContext("2d");
          if (!context) return;
          if (!drawingUtils) drawingUtils = new DrawingUtils(context);

          let timestamp: number;
          let timestampSource: EyeTrackingFrame["timestampSource"];
          if (lastMeta && Math.abs(lastMeta.mediaTime - video.currentTime) < 0.002) {
            timestamp = performance.timeOrigin + lastMeta.captureTime;
            timestampSource = "captureTime";
          } else {
            timestamp = performance.timeOrigin + performance.now();
            timestampSource = "now";
          }

          let detectTs = performance.now();
          if (detectTs <= lastDetectTs) detectTs = lastDetectTs + 1;
          lastDetectTs = detectTs;

          const startedAt = performance.now();
          let results;
          try {
            results = faceLandmarker.detectForVideo(video, detectTs);
          } catch (err) {
            console.error(`Face Landmarker error (${cameraLabel}):`, err);
            return;
          }
          const detectionMs = performance.now() - startedAt;
          const landmarks = results.faceLandmarks[0];
          const faceDetected = !!landmarks?.length;
          const eyeLandmarks = pickLandmarks(landmarks, EYE_INDICES);
          const irisLandmarks = pickLandmarks(landmarks, IRIS_INDICES);
          const matrix = results.facialTransformationMatrixes?.[0];
          const facialTransformationMatrix =
            faceDetected && matrix && matrix.data.length === 16
              ? Array.from(matrix.data)
              : new Array<number>(16).fill(NaN);
          const gate = evaluateGatekeeper(landmarks, faceDetected, eyeLandmarks, irisLandmarks, w, h);

          if (gate.faceValid !== lastFaceValid) {
            lastFaceValid = gate.faceValid;
            setIsFaceValid(gate.faceValid);
            faceValidCallbackRef.current?.(cameraId, gate.faceValid);
          }

          frameCallbackRef.current?.(cameraId, {
            frameIndex: frameIndex++,
            timestamp,
            timestampSource,
            detectionMs,
            videoWidth: w,
            videoHeight: h,
            faceDetected,
            centerValid: gate.centerValid,
            borderValid: gate.borderValid,
            eyesOpen: gate.eyesOpen,
            faceValid: gate.faceValid,
            leftEyeOpenness: gate.leftEyeOpenness,
            rightEyeOpenness: gate.rightEyeOpenness,
            eyeLandmarks,
            irisLandmarks,
            facialTransformationMatrix,
          });

          context.clearRect(0, 0, w, h);
          if (showPreviewRef.current && faceDetected) {
            drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
              color: "#C0C0C070",
              lineWidth: 1,
            });
            context.fillStyle = "#22d3ee";
            for (const p of eyeLandmarks) {
              context.beginPath();
              context.arc(p.x * w, p.y * h, 3, 0, 2 * Math.PI);
              context.fill();
            }
            context.fillStyle = "#f43f5e";
            for (const p of irisLandmarks) {
              context.beginPath();
              context.arc(p.x * w, p.y * h, 4, 0, 2 * Math.PI);
              context.fill();
            }
          }
        };

        const loop = () => {
          if (cancelled) return;
          if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            processFrame();
          }
          rafId = requestAnimationFrame(loop);
        };
        loop();
      } catch (err) {
        console.error(err);
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError") setError("Akses kamera ditolak. Izinkan akses kamera di browser.");
        else if (name === "NotFoundError" || name === "OverconstrainedError") setError("Kamera yang dipilih tidak tersedia atau sedang tidak terhubung.");
        else if (name === "NotReadableError") setError("Kamera sedang dipakai aplikasi lain atau tidak dapat dibuka.");
        else setError(err instanceof Error ? err.message : "Gagal menjalankan kamera atau MediaPipe.");
        setIsLoading(false);
      }
    };

    start();
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (vfcId !== null && video?.cancelVideoFrameCallback) video.cancelVideoFrameCallback(vfcId);
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, [cameraId, cameraLabel, requestedWidth, requestedHeight, requestedFrameRate]);

  return (
    <div className="relative w-full min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-semibold text-gray-700">{cameraLabel}</span>
        <span className={isLoading ? "text-amber-600" : error ? "text-red-600" : isFaceValid ? "text-green-600" : "text-amber-600"}>
          {error ? "Error" : isLoading ? "Memuat..." : isFaceValid ? "Wajah valid" : "Posisikan wajah"}
        </span>
      </div>
      {error && <p className="mb-1 text-xs text-red-600">{error}</p>}
      <div className={`relative overflow-hidden rounded-lg bg-black ${showPreview ? "opacity-100" : "opacity-0"}`}>
        <video ref={videoRef} autoPlay muted playsInline className="w-full -scale-x-100 rounded-lg" />
        <canvas ref={canvasRef} className="pointer-events-none absolute left-0 top-0 h-full w-full -scale-x-100" />
        {showPreview && (
          <div className="pointer-events-none absolute inset-0">
            <div
              className="absolute rounded-[45%] border-2 border-white/80"
              style={{
                left: `${GATEKEEPER.guide.left * 100}%`,
                right: `${(1 - GATEKEEPER.guide.right) * 100}%`,
                top: `${GATEKEEPER.guide.top * 100}%`,
                bottom: `${(1 - GATEKEEPER.guide.bottom) * 100}%`,
              }}
            />
          </div>
        )}
      </div>
      {isLoading && <p className="mt-1 text-xs text-gray-500">Menghubungkan kamera dan MediaPipe...</p>}
    </div>
  );
}
