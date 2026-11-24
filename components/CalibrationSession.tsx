"use client";

// Satu target kalibrasi dipakai bersama; stream, FaceLandmarker, fixation
// detector, dan log setiap kamera tetap independen.
import { useCallback, useEffect, useRef, useState } from "react";

import WebcamFaceLandmarker, {
  enumerateCameras,
  type CameraOption,
} from "@/components/WebcamFaceLandmarker";
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
} from "@/lib/eyetracking/config";
import { buildCalibrationCsv, downloadCsv } from "@/lib/eyetracking/csv";
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

const CAMERA_COUNT = 3;
const CAMERA_IDS = ["camera-1", "camera-2", "camera-3"] as const;

type CameraLog = {
  cameraId: string;
  label: string;
  rows: LogRow[];
};

function makeCameraLogs(options: CameraOption[]): CameraLog[] {
  return options.slice(0, CAMERA_COUNT).map((camera, index) => ({
    cameraId: CAMERA_IDS[index],
    label: camera.label,
    rows: [],
  }));
}

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
  const [cameraValid, setCameraValid] = useState<Record<string, boolean>>({});
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [screenWidthCm, setScreenWidthCm] = useState(
    prefill?.screenWidthCm ?? PHYSICAL_SETUP.defaultScreenWidthCm?.toString() ?? ""
  );
  const [viewingDistanceCm, setViewingDistanceCm] = useState(
    prefill?.viewingDistanceCm ?? PHYSICAL_SETUP.defaultViewingDistanceCm.toString()
  );

  const recDist = PHYSICAL_SETUP.recommendedViewingDistanceCm;
  const typedDistance = Number(viewingDistanceCm.replace(",", "."));
  const distanceOutsideProtocol =
    viewingDistanceCm.trim() !== "" &&
    Number.isFinite(typedDistance) &&
    (typedDistance < recDist.min || typedDistance > recDist.max);

  const [downloaded, setDownloaded] = useState(false);
  const [testGridHref, setTestGridHref] = useState<string | null>(null);
  const [gazeNote, setGazeNote] = useState<string | null>(null);
  const [regionResult, setRegionResult] = useState<{
    result: TestRegionResult;
    screenW: number;
    screenH: number;
  } | null>(null);
  const [demoHref, setDemoHref] = useState<string | null>(null);

  const activePointRefHolder = useRef<import("@/lib/eyetracking/types").ActivePoint | null>(null);
  const activePointRefSource = useRef<import("@/lib/eyetracking/types").ActivePoint | null>(null);
  const stageRef = useRef<Stage>("setup");
  const cameraLogsRef = useRef<CameraLog[]>([]);
  const sessionRef = useRef<SessionInfo | null>(null);
  const fixationDetectorsRef = useRef<Map<string, FixationDetector>>(new Map());
  const cameraValidRef = useRef<Record<string, boolean>>({});

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
        const defaults = available.slice(0, CAMERA_COUNT).map((camera) => camera.deviceId);
        setSelectedCameraIds(defaults);
        if (available.length < CAMERA_COUNT) {
          setCameraError(`Ditemukan ${available.length} kamera. Tiga kamera diperlukan; hubungkan kamera tambahan.`);
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
  }, []);

  const selectedOptions = selectedCameraIds.map((deviceId) =>
    cameraOptions.find((camera) => camera.deviceId === deviceId)
  );
  const selectedUnique = selectedCameraIds.length === CAMERA_COUNT &&
    selectedCameraIds.every(Boolean) &&
    new Set(selectedCameraIds).size === CAMERA_COUNT;
  const allCamerasValid = selectedUnique &&
    selectedCameraIds.every((id) => cameraValid[id] === true);

  const handleFaceValid = useCallback((cameraId: string, isValid: boolean) => {
    cameraValidRef.current = { ...cameraValidRef.current, [cameraId]: isValid };
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
        d: String(session.viewingDistanceCm),
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
      const legacySaved = saveTrainingSet(firstSet);
      setGazeNote(setsSaved.every(Boolean) && legacySaved ? null : "Sebagian data latih kamera tidak dapat disimpan di browser.");
      return;
    }

    const firstCameraId = CAMERA_IDS[0];
    const set = parseTrainingSet(readTrainingRaw(`${session.pairedSessionId}:${firstCameraId}`)) ?? parseTrainingSet(readTrainingRaw(session.pairedSessionId));
    const model = set ? trainGazeModel(set) : null;
    if (!model) {
      setGazeNote(
        set
          ? "Frame kalibrasi valid terlalu sedikit untuk melatih model region."
          : "Hasil region tidak tersedia: data kalibrasi pasangan tidak ditemukan di tab ini. Jalankan kalibrasi lalu test grid di tab yang sama."
      );
      return;
    }
    const rows = cameraLogsRef.current[0]?.rows ?? [];
    setRegionResult({
      result: computeTestRegionResult(rows, model, GAZE_REGION, physicalSetupOf(session)),
      screenW: session.screenW,
      screenH: session.screenH,
    });
    const q = new URLSearchParams({ cal: session.pairedSessionId, pid: session.participantId });
    setDemoHref(`/gaze-demo?${q.toString()}`);
  };

  const sequence = usePointSequence({
    pointDurationMs: POINT_DURATION_MS,
    preStartDelayMs: PRE_START_DELAY_MS,
    onFinish: finishCalibration,
  });
  const { activeDot, activePointRef } = sequence;
  activePointRefSource.current = activePointRef.current;
  useEffect(() => {
    const sync = () => { activePointRefHolder.current = activePointRefSource.current; };
    sync();
    const id = window.setInterval(sync, 10);
    return () => window.clearInterval(id);
  }, []);

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

    const distanceCm = Number(viewingDistanceCm.replace(",", "."));
    const vd = PHYSICAL_SETUP.viewingDistanceCm;
    if (!Number.isFinite(distanceCm) || distanceCm < vd.min || distanceCm > vd.max) {
      setMessage(`Isi jarak mata ke layar dalam cm (${vd.min}–${vd.max} cm).`);
      return;
    }

    if (!allCamerasValid) {
      setMessage("Pastikan ketiga kamera aktif dan posisi wajah valid pada masing-masing kamera.");
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
      label: option?.label ?? `Kamera ${index + 1}`,
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
      screenWidthCm: widthCm,
      viewingDistanceCm: distanceCm,
    };
    setSessionId(sessionRef.current.sessionId);
    setSummary(null);
    setDownloaded(false);
    setTestGridHref(null);
    setGazeNote(null);
    setRegionResult(null);
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
    setRegionResult(null);
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
        buildCalibrationCsv(camera.rows, session),
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
        <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 md:grid-cols-3">
          {selectedCameraIds.map((deviceId, index) => {
            const option = selectedOptions[index];
            if (!option) return null;
            return (
              <WebcamFaceLandmarker
                key={deviceId}
                cameraId={deviceId}
                cameraLabel={`Kamera ${index + 1}: ${option.label}`}
                showPreview={stage === "setup"}
                onFaceValidChange={handleFaceValid}
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
              Hubungkan tiga kamera yang berbeda. Ketiga kamera merekam peserta secara bersamaan saat peserta menatap target yang sama. Pertahankan posisi kepala dan duduk selama sesi.
            </p>

            {cameraError && (
              <p className="mb-3 rounded-lg bg-amber-50 p-3 text-left text-sm text-amber-900">{cameraError}</p>
            )}
            <div className="mb-4 grid gap-3 text-left md:grid-cols-3">
              {Array.from({ length: CAMERA_COUNT }, (_, index) => (
                <label key={index} className="block text-sm font-medium text-gray-700">
                  Kamera {index + 1}
                  <select
                    value={selectedCameraIds[index] ?? ""}
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
              <p className="mb-3 text-left text-xs text-red-600">Pilih tiga perangkat kamera yang berbeda.</p>
            )}
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              {selectedOptions.map((option, index) => option ? (
                <div key={option.deviceId} className="rounded-lg bg-gray-50 p-2 text-left text-xs">
                  <span className="font-semibold">Kamera {index + 1}:</span>{" "}
                  {cameraValid[option.deviceId] ? <span className="text-green-700">wajah valid</span> : <span className="text-amber-700">menunggu validasi wajah</span>}
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
              <input type="text" value={participantId} onChange={(e) => setParticipantId(e.target.value)} placeholder="contoh: P01" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal" />
            </label>

            <div className="mb-4 grid grid-cols-2 gap-3 text-left">
              <label className="block text-sm font-medium text-gray-700">
                Lebar layar (cm)
                <input type="number" inputMode="decimal" step="0.1" value={screenWidthCm} onChange={(e) => setScreenWidthCm(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal" />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Jarak mata–layar (cm)
                <input type="number" inputMode="decimal" step="1" value={viewingDistanceCm} onChange={(e) => setViewingDistanceCm(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal" />
              </label>
            </div>

            {distanceOutsideProtocol && (
              <p className="mb-4 rounded-lg bg-amber-50 p-2 text-left text-xs text-amber-900">
                Jarak {viewingDistanceCm} cm di luar protokol ({recDist.min}–{recDist.max} cm). Sesi tetap bisa dimulai, tetapi sebaiknya atur ulang posisi duduk.
              </p>
            )}
            <div className="mb-4 rounded-lg bg-blue-50 p-3 text-left text-xs text-blue-900">
              <p className="mb-1 font-semibold">Protokol pengukuran</p>
              <ol className="list-decimal space-y-0.5 pl-4">
                <li>Lebar layar: ukur area tampilan (tanpa bingkai) dari kiri ke kanan.</li>
                <li>Ukur jarak mata ke layar ({recDist.min}–{recDist.max} cm) dan isi nilai sebenarnya.</li>
                <li>Pertahankan posisi duduk dan kepala selama seluruh sesi.</li>
              </ol>
            </div>

            {cameraValidRef.current && allCamerasValid ? (
              <p className="mb-3 font-medium text-green-600">✓ Ketiga kamera mendeteksi wajah dengan valid</p>
            ) : (
              <p className="mb-3 font-medium text-amber-700">Pastikan wajah valid pada ketiga preview kamera</p>
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
          sessionId={sessionId ?? undefined}
          onDownload={downloadCSV}
          onReset={resetCalibration}
          resetLabel={`Ulangi ${sessionLabel}`}
          downloaded={downloaded}
          nextHref={(isTest ? demoHref : testGridHref) ?? undefined}
          nextLabel={isTest ? "Coba Demo Region" : "Lanjut ke Test Grid"}
        >
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            {cameraLogsRef.current.map((camera) => (
              <div key={camera.cameraId} className="rounded-lg border border-gray-200 p-3 text-left text-sm">
                <p className="font-semibold">{camera.label}</p>
                <p>Jumlah frame: {camera.rows.length}</p>
                <p>Frame valid: {camera.rows.filter((row) => row.frame.faceValid).length}</p>
                <p>Processed FPS: {summaryByCamera[camera.cameraId]?.processedFps.toFixed(2) ?? "-"}</p>
                <p>Effective FPS: {summaryByCamera[camera.cameraId]?.effectiveFps.toFixed(2) ?? "-"}</p>
                <button
                  type="button"
                  onClick={() => {
                    const session = sessionRef.current;
                    if (!session || camera.rows.length === 0) return;
                    const prefix = isTest ? "test" : "calibration";
                    downloadCsv(
                      buildCalibrationCsv(camera.rows, session),
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
          {regionResult && <TestRegionResultView {...regionResult} />}
          {gazeNote && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{gazeNote}</p>}
        </SessionSummaryCard>
      )}
    </main>
  );
}
