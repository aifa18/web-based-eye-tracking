// File untuk susun & download CSV

import { EYE_INDICES, IRIS_INDICES, POSE_CONDITION, viewingDistanceRangeOf } from "./config";
import type { LogRow, SessionInfo } from "./types";
import type { TestRegionResult } from "@/lib/gaze/testResult";

function fmt(v: number | boolean | string) : string {
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
    return v
}

// Informasi perangkat yang dapat berbeda untuk setiap kamera.
export type CameraCsvMetadata = {
  cameraId: string;
  cameraLabel: string;
  actualTrackWidth?: number;
  actualTrackHeight?: number;
  actualTrackFrameRate?: number;
};

// Skema kolom tetap untuk raw log kalibrasi.
export function buildCalibrationCsv(rows: LogRow[], session: SessionInfo, camera: CameraCsvMetadata): string {
  const distanceRange = viewingDistanceRangeOf(session.viewingDistanceConditionCm);
  const measuredFps = rows.length > 1 && rows[rows.length - 1].frame.timestamp > rows[0].frame.timestamp
    ? (rows.length - 1) * 1000 / (rows[rows.length - 1].frame.timestamp - rows[0].frame.timestamp)
    : NaN;
  const headers: string[] = [
    "participant_id",
    "session_id",
    "pose_condition",
    "calibration_layout",
    "paired_session_id",
    "camera_id",
    "camera_label",
    "requested_video_w",
    "requested_video_h",
    "requested_frame_rate_fps",
    "track_settings_video_w",
    "track_settings_video_h",
    "track_settings_frame_rate_fps",
    "measured_delivered_frame_rate_fps",
    "frame_index",
    "timestamp_ms",
    "timestamp_source",
    "detection_ms",
    "point_id",
    "point_order",
    "point_onset_ms",
    "t_in_point_ms",
    "phase",
    "is_fixation",
    "fixation_dispersion",
    "fixation_start_ms",
    "fixation_after_onset",
    "target_x",
    "target_y",
    "target_x_px",
    "target_y_px",
    "viewport_w",
    "viewport_h",
    "screen_w",
    "screen_h",
    "device_pixel_ratio",
    "screen_width_cm",
    "viewing_distance_condition_cm",
    "viewing_distance_range_min_cm",
    "viewing_distance_range_max_cm",
    "viewing_distance_cm",
    "is_fullscreen",
    "video_w",
    "video_h",
    "face_detected",
    "center_valid",
    "border_valid",
    "eyes_open",
    "face_valid",
    "left_eye_openness",
    "right_eye_openness",
  ];

  for (const i of EYE_INDICES) {
    headers.push(`eye_${i}_x`, `eye_${i}_y`, `eye_${i}_z`);
  }
  for (const i of IRIS_INDICES) {
    headers.push(`iris_${i}_x`, `iris_${i}_y`, `iris_${i}_z`);
  }
  for (let i = 0; i < 16; i++) {
    headers.push(`matrix_${i}`);
  }

  const lines = rows.map((r) => {
    const f = r.frame;
    const values: (number | boolean | string)[] = [
      session.participantId,
      session.sessionId,
      POSE_CONDITION,
      session.layoutId,
      session.pairedSessionId,
      camera.cameraId,
      camera.cameraLabel,
      session.requestedWidth,
      session.requestedHeight,
      session.requestedFrameRate,
      camera.actualTrackWidth ?? "",
      camera.actualTrackHeight ?? "",
      camera.actualTrackFrameRate ?? "",
      measuredFps,
      f.frameIndex,
      f.timestamp.toFixed(3),
      f.timestampSource,
      f.detectionMs,
      r.point.pointId,
      r.point.order,
      r.point.onset.toFixed(3),
      r.tInPoint,
      r.phase,
      r.fixation.isFixation,
      r.fixation.dispersion,
      Number.isFinite(r.fixation.startMs) ? r.fixation.startMs.toFixed(3) : "",
      r.fixationAfterOnset,
      r.point.x,
      r.point.y,
      r.point.x * r.viewportW,
      r.point.y * r.viewportH,
      r.viewportW,
      r.viewportH,
      session.screenW,
      session.screenH,
      session.devicePixelRatio,
      session.screenWidthCm,
      session.viewingDistanceConditionCm,
      distanceRange?.min ?? "",
      distanceRange?.max ?? "",
      session.viewingDistanceCm,
      r.isFullscreen,
      f.videoWidth,
      f.videoHeight,
      f.faceDetected,
      f.centerValid,
      f.borderValid,
      f.eyesOpen,
      f.faceValid,
      f.leftEyeOpenness,
      f.rightEyeOpenness,
    ];

    for (const lm of f.eyeLandmarks) values.push(lm.x, lm.y, lm.z);
    for (const lm of f.irisLandmarks) values.push(lm.x, lm.y, lm.z);
    values.push(...f.facialTransformationMatrix);

    return values.map(fmt).join(",");
  });

  return [headers.join(","), ...lines].join("\n");
}

export function buildTestEvaluationCsv(
  result: TestRegionResult,
  session: SessionInfo,
  cameraId: string,
  cameraLabel: string
): string {
  const range = viewingDistanceRangeOf(session.viewingDistanceConditionCm);
  const headers = [
    "record_type", "participant_id", "test_session_id", "paired_calibration_session_id",
    "camera_id", "camera_label", "distance_condition_cm", "distance_range_min_cm",
    "distance_range_max_cm", "actual_viewing_distance_cm", "screen_width_cm",
    "region_cols", "region_rows", "point_hit_pct", "frame_hit_pct", "mean_error_deg",
    "n_valid_test_frames", "n_training_frames", "frame_index", "timestamp_ms", "point_id",
    "target_x", "target_y", "predicted_gaze_x", "predicted_gaze_y",
    "predicted_region_col", "predicted_region_row", "frame_hit", "frame_error_deg",
  ];
  const cell = (value: string | number | boolean | null | undefined) => {
    if (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value))) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const common = [
    session.participantId, session.sessionId, session.pairedSessionId,
    cameraId, cameraLabel, session.viewingDistanceConditionCm,
    range?.min, range?.max, session.viewingDistanceCm, session.screenWidthCm,
    result.grid.cols, result.grid.rows, result.pointHitPct, result.frameHitPct,
    result.meanErrorDeg, result.nFrames, result.nTrain,
  ];
  const summaryRow = ["summary", ...common, ...Array(11).fill("")];
  const frameRows = result.framePredictions.map((frame) => [
    "frame", ...common,
    frame.frameIndex, frame.timestampMs, frame.pointId, frame.targetX, frame.targetY,
    frame.predictedX, frame.predictedY,
    frame.predictedRegion ? frame.predictedRegion.col + 1 : "",
    frame.predictedRegion ? frame.predictedRegion.row + 1 : "",
    frame.hit, frame.errorDeg,
  ]);
  return [headers.map(cell).join(","), summaryRow.map(cell).join(","), ...frameRows.map((row) => row.map(cell).join(","))].join("\n");
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Keep the blob URL alive long enough for the browser to start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
