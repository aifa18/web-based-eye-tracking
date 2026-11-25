"use client";

// Satu target kalibrasi dipakai bersama; stream, FaceLandmarker, fixation
// detector, dan log setiap kamera tetap independen.
import { useCallback, useEffect, useRef, useState } from "react";

import WebcamFaceLandmarker, { enumerateCameras, type CameraOption } from "@/components/WebcamFaceLandmarker";
import CalibrationDot from "@/components/CalibrationDot";
import SessionSummaryCard from "@/components/SessionSummaryCard";
import TestRegionResultView from "@/components/TestRegionResultView";

import { usePointSequence } from "@/hooks/usePointSequence";
import { exitFullscreen, useFullscreenGuard } from "@/hooks/useFullscreenGuard";

import {
  FIXATION,
  GAZE_REGION,
  PHYSICAL_SETUP,
  POINT_DURATION_MS,
  PRE_START_DELAY_MS,
  RANDOMIZE_ORDER,
  REQUIRE_FULLSCREEN,
  TRANSITION_MS,
  viewingDistanceRangeOf,
  isViewingDistanceWithinRange,
} from "@/lib/eyetracking/config";
import { buildCalibrationCsv, buildTestEvaluationCsv, downloadCsv } from "@/lib/eyetracking/csv";
import { FixationDetector } from "@/lib/eyetracking/fixation";
import { computeSummary } from "@/lib/eyetracking/summary";
import { formatSessionTime, shuffle } from "@/lib/eyetracking/utils";
import {
  buildTrainingSet,
  parseTrainingSet,
  readTrainingRaw,
  saveTrainingSet,
  trainGazeModel,
} from "@/lib/gaze/training";
import {
  computeTestRegionResult,
  physicalSetupOf,
  type TestRegionResult,
} from "@/lib/gaze/testResult";
import type {
  CalibrationLayout,
  EyeTrackingFrame,
  LogRow,
  Phase,
  SessionInfo,
  SessionSummary,
  SetupPrefill,
  Stage,
} from "@/lib/eyetracking/types";

type CalibrationSessionProps = {
  layout: CalibrationLayout;
  prefill?: SetupPrefill;
};

const CAMERA_COUNT = 4;
const CAMERA_IDS = ["camera-1", "camera-2", "camera-3", "camera-4"] as const;

type CameraCaptureSettings = { width?: number; height?: number; frameRate?: number };

type CameraLog = {
  cameraId: string;
  deviceId: string;
  label: string;
  captureSettings: CameraCaptureSettings;
  rows: LogRow[];
};

function csvFileName(prefix: string, layoutId: string, sessionId: string, cameraId: string) {
  return `${prefix}_${layoutId}_${sessionId}_${cameraId}.csv`;
}

export default function CalibrationSession({ layout, prefill }: CalibrationSessionProps) {
  const pointCount = layout.points.length;
  const isTest = layout.kind === "test";
  const pairedSessionId = prefill?.pairedSessionId ?? "";
  const sessionLabel = isTest ? "Test grid" : "Kalibrasi";

  const [stage, setStage] = useState<Stage>("setup");
  const [participantId, setParticipantId] = useState(prefill?.participantId ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [summaryByCamera, setSummaryByCamera] = useState<Record<string, SessionSummary>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [cameraOptions, setCameraOptions] = useState<CameraOption[]>([]);
  const [selectedCameraIds, setSelectedCameraIds] = useState<string[]>([]);
  const [pairedCameraIds, setPairedCameraIds] = useState<string[]>([]);
  const [pairedTrackSettings, setPairedTrackSettings] = useState<Record<string, CameraCaptureSettings>>({});
  const [pairedSetupAvailable, setPairedSetupAvailable] = useState(!isTest || !pairedSessionId);
  const [cameraValid, setCameraValid] = useState<Record<string, boolean>>({});
  const [cameraSettings, setCameraSettings] = useState<Record<string, CameraCaptureSettings>>({});
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [screenWidthCm, setScreenWidthCm] = useState(
    prefill?.screenWidthCm ?? PHYSICAL_SETUP.defaultScreenWidthCm?.toString() ?? ""
  );
  const [viewingDistanceCm, setViewingDistanceCm] = useState(
    prefill?.viewingDistanceCm ?? PHYSICAL_SETUP.defaultViewingDistanceCm.toString()
  );
  const [actualViewingDistanceCm, setActualViewingDistanceCm] = useState(
    prefill?.actualViewingDistanceCm ?? ""
  );
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const [frameRate, setFrameRate] = useState<30 | 60>(30);

  const distanceConditionCm = Number(viewingDistanceCm.replace(",", "."));
  const distanceRange = viewingDistanceRangeOf(distanceConditionCm);
  const typedActualDistance = Number(actualViewingDistanceCm.replace(",", "."));
  const distanceOutsideProtocol = actualViewingDistanceCm.trim() !== "" &&
    !isViewingDistanceWithinRange(distanceConditionCm, typedActualDistance);

  const [downloaded, setDownloaded] = useState(false);
  const [testGridHref, setTestGridHref] = useState<string | null>(null);
  const [gazeNote, setGazeNote] = useState<string | null>(null);
  const [regionResults, setRegionResults] = useState<Record<string, {
    result: TestRegionResult;
    screenW: number;
    screenH: number;
    cameraLabel: string;
  }>>({});
  const [demoHref, setDemoHref] = useState<string | null>(null);

  const activePointRefHolder = useRef<import("@/lib/eyetracking/types").ActivePoint | null>(null);
  const stageRef = useRef<Stage>("setup");
  const cameraLogsRef = useRef<CameraLog[]>([]);
  const sessionRef = useRef<SessionInfo | null>(null);
  const fixationDetectorsRef = useRef<Map<string, FixationDetector>>(new Map());
  const cameraSettingsRef = useRef<Record<string, CameraCaptureSettings>>({});

  const changeStage = (next: Stage) => {
    stageRef.current = next;
    setStage(next);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Permission is requested by each stream; labels are populated once
        // permission has been granted by the browser.
        const initial = await navigator.mediaDevices.enumerateDevices();
        const hasVideoInput = initial.some((d) => d.kind === "videoinput");
        if (!hasVideoInput) {
          setCameraError("Tidak ada kamera yang terdeteksi.");
          return;
        }
        const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        permissionStream.getTracks().forEach((track) => track.stop());
        const available = await enumerateCameras();
        if (cancelled) return;
        setCameraOptions(available);
        let defaults = available.slice(0, CAMERA_COUNT).map((camera) => camera.deviceId);
        let pairedSetupError: string | null = null;
        if (isTest && pairedSessionId) {
          try {
            const saved = sessionStorage.getItem(`eye-session-setup:${pairedSessionId}`);
            if (!saved) {
              setPairedSetupAvailable(false);
              setPairedCameraIds([]);
              pairedSetupError = "Pengaturan kalibrasi pasangan tidak ditemukan di tab ini. Ulangi kalibrasi dan buka test grid dari tombol lanjut.";
            } else {
              const setup = JSON.parse(saved) as {
                cameraIds?: string[]; resolution?: "720p" | "1080p"; frameRate?: 30 | 60;
                distanceConditionCm?: number; actualDistanceCm?: number;
                trackSettings?: { deviceId: string; settings: CameraCaptureSettings }[];
              };
              const originalIds = setup.cameraIds ?? [];
              const allOriginalAvailable = originalIds.length === CAMERA_COUNT &&
                new Set(originalIds).size === CAMERA_COUNT &&
                originalIds.every((id) => available.some((camera) => camera.deviceId === id));
              setPairedCameraIds(originalIds);
              const trackSettings = Object.fromEntries(
                (setup.trackSettings ?? []).map((item) => [item.deviceId, item.settings])
              ) as Record<string, CameraCaptureSettings>;
              setPairedTrackSettings(trackSettings);
              const trackSettingsComplete = originalIds.length === CAMERA_COUNT &&
                originalIds.every((id) => typeof trackSettings[id]?.width === "number" &&
                  typeof trackSettings[id]?.height === "number");
              const pairedConfigurationAvailable = allOriginalAvailable && trackSettingsComplete;
              setPairedSetupAvailable(pairedConfigurationAvailable);
              if (allOriginalAvailable) defaults = originalIds;
              if (!allOriginalAvailable) pairedSetupError = "Kamera yang digunakan saat kalibrasi tidak semuanya tersedia. Sambungkan kembali perangkat yang sama dan urutkan sesuai sesi kalibrasi.";
              else if (!trackSettingsComplete) pairedSetupError = "Data pengaturan aktual kamera dari kalibrasi tidak tersedia. Ulangi kalibrasi dengan versi aplikasi terbaru.";
              if (setup.resolution === "720p" || setup.resolution === "1080p") setResolution(setup.resolution);
              if (setup.frameRate === 30 || setup.frameRate === 60) setFrameRate(setup.frameRate);
              if (!prefill?.viewingDistanceCm && (setup.distanceConditionCm === 45 || setup.distanceConditionCm === 55 || setup.distanceConditionCm === 65)) {
                setViewingDistanceCm(String(setup.distanceConditionCm));
              }
              if (!prefill?.actualViewingDistanceCm && Number.isFinite(setup.actualDistanceCm)) {
                setActualViewingDistanceCm(String(setup.actualDistanceCm));
              }
            }
          } catch {
            setPairedSetupAvailable(false);
            setPairedCameraIds([]);
            pairedSetupError = "Pengaturan kamera sesi kalibrasi tidak dapat dipulihkan.";
          }
        }
        setSelectedCameraIds(defaults);
        if (available.length < CAMERA_COUNT) {
          setCameraError(`Ditemukan ${available.length} kamera. Empat kamera diperlukan; hubungkan kamera tambahan.`);
        } else if (pairedSetupError) {
          setCameraError(pairedSetupError);
        } else {
          setCameraError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setCameraError(err instanceof Error ? err.message : "Gagal membaca daftar kamera.");
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [isTest, pairedSessionId]);

  const selectedOptions = selectedCameraIds.map((deviceId) =>
    cameraOptions.find((camera) => camera.deviceId === deviceId)
  );
  const selectedUnique = selectedCameraIds.length === CAMERA_COUNT &&
    selectedCameraIds.every(Boolean) &&
    new Set(selectedCameraIds).size === CAMERA_COUNT;
  const pairedCameraOrderValid = !isTest || !pairedSessionId ||
    (pairedSetupAvailable && pairedCameraIds.length === CAMERA_COUNT &&
      selectedCameraIds.every((id, index) => id === pairedCameraIds[index]));
  const pairedTrackSettingsMatch = !isTest || !pairedSessionId ||
    selectedCameraIds.every((deviceId) => {
      const expected = pairedTrackSettings[deviceId];
      const actual = cameraSettings[deviceId];
      if (!expected || !actual || expected.width == null || expected.height == null ||
        actual.width !== expected.width || actual.height !== expected.height) return false;
      return expected.frameRate == null || actual.frameRate == null ||
        Math.abs(actual.frameRate - expected.frameRate) <= 1;
    });
  const allCamerasValid = selectedUnique && pairedCameraOrderValid && pairedTrackSettingsMatch &&
    selectedCameraIds.every((id) => cameraValid[id] === true);

  const handleCameraSettings = useCallback((deviceId: string, settings: CameraCaptureSettings) => {
    cameraSettingsRef.current[deviceId] = settings;
    setCameraSettings((previous) => ({ ...previous, [deviceId]: settings }));
  }, []);

  const handleFaceValid = useCallback((cameraId: string, isValid: boolean) => {
    setCameraValid((previous) => ({ ...previous, [cameraId]: isValid }));
  }, []);

  const handleFrame = useCallback((cameraId: string, frame: EyeTrackingFrame) => {
    if (stageRef.current !== "calibrating") return;
    const log = cameraLogsRef.current.find((item) => item.cameraId === cameraId);
    const detector = fixationDetectorsRef.current.get(cameraId);
    if (!log || !detector) return;

    // Each camera owns its own I-DT state; no samples cross camera streams.
    const fixation = detector.update(frame);
    const point = activePointRefHolder.current;
    if (!point) return;
    const tInPoint = frame.timestamp - point.onset;
    const phase: Phase =
      tInPoint < 0 ? "pre_onset" : tInPoint < TRANSITION_MS ? "transition" : "fixation";

    log.rows.push({
      frame,
      point,
      tInPoint,
      phase,
      fixation,
      fixationAfterOnset: fixation.isFixation && fixation.startMs >= point.onset,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      isFullscreen: !!document.fullscreenElement,
    });
  }, []);

  const finishCalibration = () => {
    sequence.stop();
    const cameraSummaries: Record<string, SessionSummary> = {};
    for (const camera of cameraLogsRef.current) {
      cameraSummaries[camera.cameraId] = computeSummary(camera.rows, layout.points);
    }
    setSummaryByCamera(cameraSummaries);
    setSummary(cameraSummaries[CAMERA_IDS[0]] ?? null);

    const session = sessionRef.current;
    if (!isTest && session) {
      const q = new URLSearchParams({
        pid: session.participantId,
        cal: session.sessionId,
        w: String(session.screenWidthCm),
        d: String(session.viewingDistanceConditionCm),
        da: String(session.viewingDistanceCm),
      });
      setTestGridHref(`/test-grid?${q.toString()}`);
    }

    if (session) prepareGaze(session);
    changeStage("finished");
    exitFullscreen();
  };

  const prepareGaze = (session: SessionInfo) => {
    if (!isTest) {
      // Preserve independent training sets for all cameras. The existing demo
      // still reads the legacy session key (camera 1) for backward compatibility.
      const setsSaved = cameraLogsRef.current.map((camera) => {
        const set = buildTrainingSet(camera.rows, `${session.sessionId}:${camera.cameraId}`, session.layoutId);
        return saveTrainingSet(set);
      });
        const firstSet = buildTrainingSet(cameraLogsRef.current[0]?.rows ?? [], session.sessionId, session.layoutId);
      let legacySaved = false;
      try {
        sessionStorage.setItem(`gaze-training:${session.sessionId}`, JSON.stringify(firstSet));
        legacySaved = true;
      } catch (error) {
        console.warn("Data latih kamera pertama tidak dapat disimpan untuk demo lama:", error);
      }
      setGazeNote(setsSaved.every(Boolean) && legacySaved ? null : "Sebagian data latih kamera tidak dapat disimpan di browser.");
      return;
    }

    const results: Record<string, {
      result: TestRegionResult;
      screenW: number;
      screenH: number;
      cameraLabel: string;
    }> = {};
    const missing: string[] = [];
    for (const camera of cameraLogsRef.current) {
      const set = parseTrainingSet(
        readTrainingRaw(`${session.pairedSessionId}:${camera.cameraId}`)
      ) ?? (camera.cameraId === CAMERA_IDS[0]
        ? parseTrainingSet(readTrainingRaw(session.pairedSessionId))
        : null);
      const model = set ? trainGazeModel(set) : null;
      if (!model) {
        missing.push(camera.label);
        continue;
      }
      results[camera.cameraId] = {
        result: computeTestRegionResult(camera.rows, model, GAZE_REGION, physicalSetupOf(session)),
        screenW: session.screenW,
        screenH: session.screenH,
        cameraLabel: camera.label,
      };
    }
    setRegionResults(results);
    if (missing.length) {
      setGazeNote(`Evaluasi belum tersedia untuk: ${missing.join(", ")}. Pastikan data kalibrasi dan test grid berasal dari kamera yang sama.`);
    } else {
      setGazeNote(null);
    }
    const q = new URLSearchParams({ cal: session.pairedSessionId, pid: session.participantId });
    setDemoHref(`/gaze-demo?${q.toString()}`);
  };

  const syncActivePoint = useCallback((point: import("@/lib/eyetracking/types").ActivePoint | null) => {
    activePointRefHolder.current = point;
  }, []);
  const sequence = usePointSequence({
    pointDurationMs: POINT_DURATION_MS,
    preStartDelayMs: PRE_START_DELAY_MS,
    onFinish: finishCalibration,
    onActivePoint: syncActivePoint,
  });
  const { activeDot } = sequence;

  const abortCalibration = (reason: string) => {
    if (stageRef.current !== "calibrating") return;
    sequence.stop();
    fixationDetectorsRef.current.forEach((detector) => detector.reset());
    cameraLogsRef.current.forEach((camera) => { camera.rows = []; });
    setMessage(reason);
    changeStage("aborted");
    exitFullscreen();
  };

  useFullscreenGuard({ requireFullscreen: REQUIRE_FULLSCREEN, onAbort: abortCalibration });

  const startCalibration = async () => {
    setMessage(null);
    const pid = participantId.trim().replace(/[^A-Za-z0-9_-]/g, "");
    if (!pid) {
      setMessage("Isi ID partisipan (huruf, angka, - atau _).");
      return;
    }

    const widthCm = Number(screenWidthCm.replace(",", "."));
    const sw = PHYSICAL_SETUP.screenWidthCm;
    if (!Number.isFinite(widthCm) || widthCm < sw.min || widthCm > sw.max) {
      setMessage(`Isi lebar layar dalam cm (${sw.min}–${sw.max} cm).`);
      return;
    }

    const distanceConditionCm = Number(viewingDistanceCm.replace(",", "."));
    const distanceRange = viewingDistanceRangeOf(distanceConditionCm);
    const actualDistanceCm = Number(actualViewingDistanceCm.replace(",", "."));
    if (!distanceRange) {
      setMessage("Pilih kondisi jarak 45, 55, atau 65 cm.");
      return;
    }
    if (!actualViewingDistanceCm.trim() ||
      !isViewingDistanceWithinRange(distanceConditionCm, actualDistanceCm)) {
      setMessage(`Masukkan jarak aktual wajah ke layar dalam rentang ${distanceRange.min}–${distanceRange.max} cm untuk kondisi ${distanceConditionCm} cm.`);
      return;
    }
    if (isTest && pairedSessionId && prefill?.actualViewingDistanceCm &&
      (distanceConditionCm !== Number(prefill.viewingDistanceCm) ||
        actualDistanceCm !== Number(prefill.actualViewingDistanceCm))) {
      setMessage("Untuk evaluasi berpasangan, gunakan kondisi dan jarak aktual yang sama dengan sesi kalibrasi.");
      return;
    }

    if (!allCamerasValid) {
      setMessage("Pastikan keempat kamera aktif dan posisi wajah valid pada masing-masing kamera.");
      return;
    }

    if (REQUIRE_FULLSCREEN) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        setMessage(`Mode layar penuh gagal diaktifkan. ${sessionLabel} memerlukan layar penuh.`);
        return;
      }
    }

    const logs = selectedOptions.map((option, index) => ({
      cameraId: CAMERA_IDS[index],
      deviceId: selectedCameraIds[index],
      label: option?.label ?? `Kamera ${index + 1}`,
      captureSettings: cameraSettingsRef.current[selectedCameraIds[index]] ?? {},
      rows: [] as LogRow[],
    }));
    cameraLogsRef.current = logs;
    fixationDetectorsRef.current = new Map(
      CAMERA_IDS.map((id) => [id, new FixationDetector(FIXATION)])
    );
    sessionRef.current = {
      participantId: pid,
      sessionId: `${pid}_${formatSessionTime(new Date())}`,
      layoutId: layout.id,
      pairedSessionId,
      screenW: window.screen.width,
      screenH: window.screen.height,
      devicePixelRatio: window.devicePixelRatio,
      requestedWidth: resolution === "720p" ? 1280 : 1920,
      requestedHeight: resolution === "720p" ? 720 : 1080,
      requestedFrameRate: frameRate,
      screenWidthCm: widthCm,
      viewingDistanceConditionCm: distanceConditionCm,
      viewingDistanceCm: actualDistanceCm,
    };
    if (!isTest) {
      try {
        sessionStorage.setItem(`eye-session-setup:${sessionRef.current.sessionId}`, JSON.stringify({
          cameraIds: selectedCameraIds,
          resolution,
          frameRate,
          distanceConditionCm,
          actualDistanceCm,
          screenWidthCm: widthCm,
          trackSettings: selectedCameraIds.map((deviceId) => ({
            deviceId,
            settings: cameraSettingsRef.current[deviceId] ?? {},
          })),
        }));
      } catch (error) {
        console.warn("Pengaturan kamera sesi tidak dapat disimpan:", error);
      }
    }
    setSessionId(sessionRef.current.sessionId);
    setSummary(null);
    setDownloaded(false);
    setTestGridHref(null);
    setGazeNote(null);
    setRegionResults({});
    setDemoHref(null);
    changeStage("calibrating");
    sequence.start(RANDOMIZE_ORDER ? shuffle(layout.points) : [...layout.points]);
  };

  const resetCalibration = () => {
    sequence.stop();
    fixationDetectorsRef.current.forEach((detector) => detector.reset());
    cameraLogsRef.current.forEach((camera) => { camera.rows = []; });
    cameraLogsRef.current = [];
    fixationDetectorsRef.current.clear();
    sessionRef.current = null;
    setSessionId(null);
    setSummary(null);
    setSummaryByCamera({});
    setMessage(null);
    setDownloaded(false);
    setTestGridHref(null);
    setGazeNote(null);
    setRegionResults({});
    setDemoHref(null);
    changeStage("setup");
  };

  const downloadCSV = () => {
    const session = sessionRef.current;
    if (!session || cameraLogsRef.current.every((camera) => camera.rows.length === 0)) {
      alert(`Belum ada data ${sessionLabel.toLowerCase()}.`);
      return;
    }
    const prefix = isTest ? "test" : "calibration";
    cameraLogsRef.current.forEach((camera) => {
      if (camera.rows.length === 0) return;
      downloadCsv(
        buildCalibrationCsv(camera.rows, session, {
          cameraId: camera.cameraId,
          cameraLabel: camera.label,
          actualTrackWidth: camera.captureSettings.width,
          actualTrackHeight: camera.captureSettings.height,
          actualTrackFrameRate: camera.captureSettings.frameRate,
        }),
        csvFileName(prefix, session.layoutId, session.sessionId, camera.cameraId)
      );
    });
    setDownloaded(true);
  };

  const isCalibrating = stage === "calibrating";

  return (
    <main className={`relative min-h-screen overflow-hidden bg-gray-100 ${isCalibrating ? "cursor-none" : ""}`}>
      {/* Camera components stay mounted while the calibration target sequence runs. */}
      <div className={stage === "setup" ? "px-6 pt-6" : "pointer-events-none fixed left-0 top-0 h-px w-px overflow-hidden opacity-0"}>
        <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {selectedCameraIds.map((deviceId, index) => {
            const option = selectedOptions[index];
            if (!option) return null;
            return (
              <WebcamFaceLandmarker
                key={deviceId}
                cameraId={deviceId}
                cameraLabel={`Kamera ${index + 1}: ${option.label}`}
                requestedWidth={resolution === "720p" ? 1280 : 1920}
                requestedHeight={resolution === "720p" ? 720 : 1080}
                requestedFrameRate={frameRate}
                showPreview={stage === "setup"}
                onFaceValidChange={handleFaceValid}
                onCameraSettings={handleCameraSettings}
                onFrame={handleFrame}
              />
            );
          })}
        </div>
      </div>

      {stage === "setup" && (
        <div className="flex justify-center px-6 py-6">
          <div className="w-full max-w-xl rounded-xl bg-white px-8 py-6 text-center shadow-lg">
            <h1 className="mb-1 text-2xl font-bold text-black">
              {isTest ? "Test Grid" : "Kalibrasi"} {pointCount} Titik
            </h1>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Layout {layout.id}</p>
            <p className="mb-4 text-sm text-gray-600">
              Hubungkan empat kamera yang berbeda. Keempat kamera merekam peserta secara bersamaan saat peserta menatap target yang sama. Pertahankan posisi kepala dan duduk selama sesi.
            </p>

            {cameraError && (
              <p className="mb-3 rounded-lg bg-amber-50 p-3 text-left text-sm text-amber-900">{cameraError}</p>
            )}
            <div className="mb-4 grid gap-3 text-left md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: CAMERA_COUNT }, (_, index) => (
                <label key={index} className="block text-sm font-medium text-gray-700">
                  Kamera {index + 1}
                  <select
                    value={selectedCameraIds[index] ?? ""}
                    disabled={isTest && !!pairedSessionId}
                    onChange={(event) => {
                      const next = [...selectedCameraIds];
                      next[index] = event.target.value;
                      setSelectedCameraIds(next);
                      setCameraValid({});
                    }}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 font-normal"
                  >
                    <option value="">Pilih kamera</option>
                    {cameraOptions.map((camera) => (
                      <option key={camera.deviceId} value={camera.deviceId}>{camera.label}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {!selectedUnique && (
              <p className="mb-3 text-left text-xs text-red-600">Pilih empat perangkat kamera yang berbeda.</p>
            )}
            {isTest && pairedSessionId && !pairedCameraOrderValid && (
              <p className="mb-3 text-left text-xs text-red-600">Untuk evaluasi berpasangan, pilih kamera yang sama dalam urutan yang sama seperti sesi kalibrasi.</p>
            )}
            {isTest && pairedSessionId && pairedCameraOrderValid && !pairedTrackSettingsMatch && (
              <p className="mb-3 text-left text-xs text-red-600">Pengaturan aktual stream tidak sama dengan kalibrasi. Pastikan kamera menggunakan resolusi dan FPS aktual yang sama.</p>
            )}
            <div className="mb-4 grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
              {selectedOptions.map((option, index) => option ? (
                <div key={option.deviceId} className="rounded-lg bg-gray-50 p-2 text-left text-xs">
                  <span className="font-semibold">Kamera {index + 1}:</span>{" "}
                  {cameraValid[option.deviceId] ? <span className="text-green-700">wajah valid</span> : <span className="text-amber-700">menunggu validasi wajah</span>}
                  <p className="mt-1 text-gray-500">
                    Stream: {cameraSettings[option.deviceId]?.width ?? "-"}×{cameraSettings[option.deviceId]?.height ?? "-"} / {cameraSettings[option.deviceId]?.frameRate?.toFixed(1) ?? "-"} FPS
                  </p>
                </div>
              ) : null)}
            </div>

            {isTest && (
              <div className={`mb-4 rounded-lg p-3 text-left text-xs ${pairedSessionId ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}>
                {pairedSessionId ? <>Data uji untuk sesi kalibrasi <span className="font-semibold">{pairedSessionId}</span>.</> : <>Tidak terhubung dengan sesi kalibrasi. Sebaiknya buka melalui tombol Lanjut ke Test Grid.</>}
              </div>
            )}

            <label className="mb-4 block text-left text-sm font-medium text-gray-700">
              ID Partisipan
              <input type="text" value={participantId} onChange={(e) => setParticipantId(e.target.value)} disabled={isTest && !!pairedSessionId} placeholder="contoh: P01" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal" />
            </label>

            <div className="mb-4 grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
              <label className="block text-sm font-medium text-gray-700">
                Lebar layar (cm)
                <input type="number" inputMode="decimal" step="0.1" value={screenWidthCm} onChange={(e) => setScreenWidthCm(e.target.value)} disabled={isTest && !!pairedSessionId} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal" />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Kondisi jarak
                <select value={viewingDistanceCm} onChange={(e) => setViewingDistanceCm(e.target.value)} disabled={isTest && !!pairedSessionId} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal">
                  {PHYSICAL_SETUP.viewingDistanceOptionsCm.map((distance) => {
                    const range = viewingDistanceRangeOf(distance);
                    return <option key={distance} value={distance}>{distance} cm (rentang {range?.min}–{range?.max} cm)</option>;
                  })}
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Jarak aktual wajah–layar (cm)
                <input type="number" inputMode="decimal" step="0.1" value={actualViewingDistanceCm} onChange={(e) => setActualViewingDistanceCm(e.target.value)} disabled={isTest && !!pairedSessionId} placeholder={distanceRange ? `${distanceRange.min}–${distanceRange.max}` : "ukur dalam cm"} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal" />
              </label>
            </div>

            {distanceOutsideProtocol && (
              <p className="mb-4 rounded-lg bg-amber-50 p-2 text-left text-xs text-amber-900">
                Jarak aktual {actualViewingDistanceCm} cm tidak sesuai rentang kondisi {viewingDistanceCm} cm ({distanceRange?.min}–{distanceRange?.max} cm).
              </p>
            )}
            <div className="mb-4 grid grid-cols-2 gap-3 text-left">
              <label className="block text-sm font-medium text-gray-700">Resolusi kamera
                <select value={resolution} onChange={(e) => { setResolution(e.target.value as "720p" | "1080p"); setCameraValid({}); }} disabled={isTest && !!pairedSessionId} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal">
                  <option value="720p">720p (1280×720)</option><option value="1080p">1080p (1920×1080)</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700">Frame rate
                <select value={frameRate} onChange={(e) => { setFrameRate(Number(e.target.value) as 30 | 60); setCameraValid({}); }} disabled={isTest && !!pairedSessionId} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal">
                  <option value={30}>30 FPS</option><option value={60}>60 FPS</option>
                </select>
              </label>
            </div>
            <p className="mb-4 text-left text-xs text-amber-800">Resolusi dan FPS yang benar-benar didapatkan kamera akan diverifikasi dari pengaturan stream. Jika perangkat tidak mendukung kombinasi pilihan, browser dapat menggunakan konfigurasi aktual yang berbeda.</p>
            <div className="mb-4 rounded-lg bg-blue-50 p-3 text-left text-xs text-blue-900">
              <p className="mb-1 font-semibold">Protokol pengukuran</p>
              <ol className="list-decimal space-y-0.5 pl-4">
                <li>Lebar layar: ukur area tampilan (tanpa bingkai) dari kiri ke kanan.</li>
                <li>Pilih kondisi jarak 45, 55, atau 65 cm, lalu ukur jarak aktual wajah ke layar dan masukkan nilainya dalam rentang ±5 cm.</li>
                <li>Atur resolusi dan FPS sesuai kombinasi pengujian.</li>
                <li>Pertahankan posisi duduk dan kepala selama seluruh sesi.</li>
              </ol>
            </div>

            {allCamerasValid ? (
              <p className="mb-3 font-medium text-green-600">✓ Keempat kamera mendeteksi wajah dengan valid</p>
            ) : (
              <p className="mb-3 font-medium text-amber-700">Pastikan wajah valid pada keempat preview kamera</p>
            )}
            {message && <p className="mb-4 text-sm text-red-500">{message}</p>}
            <button onClick={startCalibration} disabled={!allCamerasValid} className={`rounded-lg px-6 py-3 font-medium text-white ${allCamerasValid ? "bg-blue-600 hover:bg-blue-700" : "cursor-not-allowed bg-gray-400"}`}>
              Mulai {sessionLabel}
            </button>
          </div>
        </div>
      )}

      {isCalibrating && (
        <div className="fixed inset-0 z-20 bg-gray-100">
          {activeDot ? (
            <CalibrationDot key={activeDot.order} x={activeDot.x} y={activeDot.y} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-lg text-gray-500">Bersiap... tatap titik merah yang akan muncul.</p>
            </div>
          )}
          {activeDot && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-gray-400">{activeDot.order} / {pointCount}</div>}
        </div>
      )}

      {stage === "aborted" && (
        <div className="flex min-h-screen items-center justify-center p-8">
          <div className="max-w-md rounded-xl bg-white p-8 text-center shadow-lg">
            <h1 className="mb-3 text-2xl font-bold text-red-500">{sessionLabel} Dibatalkan</h1>
            <p className="mb-6 text-gray-600">{message}</p>
            <button onClick={resetCalibration} className="rounded-lg bg-gray-700 px-6 py-3 font-medium text-white hover:bg-gray-800">Kembali</button>
          </div>
        </div>
      )}

      {stage === "finished" && summary && (
        <SessionSummaryCard
          title={`${sessionLabel} Selesai`}
          summary={summary}
          summaryLabel={cameraLogsRef.current[0]?.label ?? "Kamera 1"}
          sessionId={sessionId ?? undefined}
          onDownload={downloadCSV}
          onReset={resetCalibration}
          resetLabel={`Ulangi ${sessionLabel}`}
          downloaded={downloaded}
          nextHref={(isTest ? demoHref : testGridHref) ?? undefined}
          nextLabel={isTest ? "Coba Demo Region" : "Lanjut ke Test Grid"}
        >
          <div className="mb-4 grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
            {cameraLogsRef.current.map((camera) => (
              <div key={camera.cameraId} className="rounded-lg border border-gray-200 p-3 text-left text-sm">
                <p className="font-semibold">{camera.label}</p>
                <p>Frame: {camera.rows.length}</p>
                <p>Frame wajah valid: {camera.rows.filter((row) => row.frame.faceValid).length} ({camera.rows.length ? (100 * camera.rows.filter((row) => row.frame.faceValid).length / camera.rows.length).toFixed(1) : "0"}%)</p>
                <p>Diminta: {resolution} / {frameRate} FPS</p>
                <p>Track aktual: {camera.captureSettings.width ?? "-"}×{camera.captureSettings.height ?? "-"} / {camera.captureSettings.frameRate?.toFixed(1) ?? "-"} FPS</p>
                <p>Delivered FPS (timestamp): {summaryByCamera[camera.cameraId]?.processedFps.toFixed(2) ?? "-"}</p>
                <p>FPS frame valid: {summaryByCamera[camera.cameraId]?.effectiveFps.toFixed(2) ?? "-"}</p>
                <p>Rata-rata deteksi: {summaryByCamera[camera.cameraId]?.meanDetectionMs.toFixed(2) ?? "-"} ms</p>
                <p>Timestamp capture: {((summaryByCamera[camera.cameraId]?.captureTimeRatio ?? 0) * 100).toFixed(1)}%</p>
                <p>Rata-rata latensi fiksasi: {summaryByCamera[camera.cameraId]?.meanFixationLatencyMs.toFixed(0) ?? "-"} ms</p>
                <button
                  type="button"
                  onClick={() => {
                    const session = sessionRef.current;
                    if (!session || camera.rows.length === 0) return;
                    const prefix = isTest ? "test" : "calibration";
                    downloadCsv(
                      buildCalibrationCsv(camera.rows, session, {
                        cameraId: camera.cameraId,
                        cameraLabel: camera.label,
                        actualTrackWidth: camera.captureSettings.width,
                        actualTrackHeight: camera.captureSettings.height,
                        actualTrackFrameRate: camera.captureSettings.frameRate,
                      }),
                      csvFileName(prefix, session.layoutId, session.sessionId, camera.cameraId)
                    );
                  }}
                  className="mt-2 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Unduh CSV kamera ini
                </button>
              </div>
            ))}
          </div>
          {Object.entries(regionResults).map(([cameraId, item]) => (
            <section key={cameraId} className="mb-6 rounded-lg border border-gray-200 p-4">
              <h3 className="mb-3 text-lg font-semibold">{item.cameraLabel}</h3>
              <TestRegionResultView result={item.result} screenW={item.screenW} screenH={item.screenH} />
              <button
                type="button"
                onClick={() => {
                  const session = sessionRef.current;
                  if (!session) return;
                  downloadCsv(
                    buildTestEvaluationCsv(item.result, session, cameraId, item.cameraLabel),
                    `test-evaluation_${session.layoutId}_${session.sessionId}_${cameraId}.csv`
                  );
                }}
                className="mt-3 rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
              >
                Unduh evaluasi gaze per frame (CSV)
              </button>
            </section>
          ))}
          {gazeNote && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{gazeNote}</p>}
        </SessionSummaryCard>
      )}
    </main>
  );
}
