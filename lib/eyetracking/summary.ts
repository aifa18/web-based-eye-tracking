// File hitung ringkasan sesi

import type {
  CalibrationPoint,
  LogRow,
  PointSummary,
  SessionSummary,
} from "./types";

export function computeSummary(
  rows: LogRow[],
  calibrationPoints: readonly CalibrationPoint[]
): SessionSummary {
  const points: PointSummary[] = calibrationPoints.map((p) => {
    const own = rows.filter((r) => r.point.pointId === p.id);

    // Latensi: dari titik muncul sampai fixation pertama yang dimulai setelahnya.
    const firstFix = own.find((r) => r.fixationAfterOnset);
    const fixationLatencyMs = firstFix
      ? firstFix.fixation.startMs - firstFix.point.onset
      : NaN;

    return {
      pointId: p.id,
      x: p.x,
      y: p.y,
      total: own.length,
      valid: own.filter((r) => r.frame.faceValid).length,
      validFixation: own.filter(
        (r) => r.frame.faceValid && r.phase === "fixation"
      ).length,
      idtFixation: own.filter(
        (r) =>
          r.frame.faceValid && r.phase === "fixation" && r.fixationAfterOnset
      ).length,
      fixationLatencyMs,
    };
  });

  const latencies = points
    .map((p) => p.fixationLatencyMs)
    .filter((v) => Number.isFinite(v));
  const meanFixationLatencyMs =
    latencies.length > 0
      ? latencies.reduce((s, v) => s + v, 0) / latencies.length
      : NaN;

  const totalFrames = rows.length;
  const validFrames = rows.filter((r) => r.frame.faceValid).length;

  const durationS =
    totalFrames > 1
      ? (rows[totalFrames - 1].frame.timestamp - rows[0].frame.timestamp) /
        1000
      : 0;

  const detected = rows.filter((r) => r.frame.faceDetected);
  const meanDetectionMs =
    detected.length > 0
      ? detected.reduce((s, r) => s + r.frame.detectionMs, 0) /
        detected.length
      : NaN;

  const captureTimeRatio =
    totalFrames > 0
      ? rows.filter((r) => r.frame.timestampSource === "captureTime")
          .length / totalFrames
      : 0;

  return {
    points,
    totalFrames,
    validFrames,
    durationS,
    // FPS delivered to this processing pipeline: interval-based (N-1)/elapsed,
    // avoiding the one-frame overcount from N/elapsed.
    processedFps: durationS > 0 && totalFrames > 1 ? (totalFrames - 1) / durationS : NaN,
    effectiveFps: durationS > 0 ? validFrames / durationS : NaN,
    meanDetectionMs,
    captureTimeRatio,
    meanFixationLatencyMs,
  };
}
