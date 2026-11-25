// File Berisikan Semua Tipe Data

// FRAME (Hasil WebcamFaceLandmarker)
export type LandmarkPoint = {
  index: number;
  x: number;
  y: number;
  z: number;
};

export type EyeTrackingFrame = {
  frameIndex: number;
  timestamp: number;
  // "captureTime": waktu capture kamera dari requestVideoFrameCallback.
  // "now": waktu saat frame mulai diproses (fallback).
  timestampSource: "captureTime" | "now"; 
  detectionMs: number; // Durasi detectForVideo (ms)

  videoWidth: number;
  videoHeight: number;

  // Hasil Gatekeeper Evaluation
  faceDetected: boolean;
  centerValid: boolean;
  borderValid: boolean;
  eyesOpen: boolean;
  faceValid: boolean;

  leftEyeOpenness: number;
  rightEyeOpenness: number;
  
  // Panjang selalu tetap (sesuai EYE_INDICES / IRIS_INDICES)
  // Jika wajah tidak terdeteksi, maka Nilai NaN
  eyeLandmarks: LandmarkPoint[];
  irisLandmarks: LandmarkPoint[];

  // 16 nilai, column-major (translasi di indeks 12, 13, 14). Jika tidak tersedia bernilai NaN.
  facialTransformationMatrix: number[];
};

// SESI KALIBRASI
export type CalibrationPoint = {
  id: number;
  x: number; // persen lebar layar
  y: number; // persen tinggi layar
};

// Layout titik: nama tipe (HV9/HV13 mengikuti istilah EyeLink) + daftar titik.
// kind "calibration" = data latih model, "test" = data uji (test grid).
export type CalibrationLayout = {
  id: "HV9" | "HV13" | "TEST12";
  kind: "calibration" | "test";
  points: readonly CalibrationPoint[];
};

// Nilai awal form setup (mis. dari sesi kalibrasi sebelumnya via URL).
export type SetupPrefill = {
  participantId?: string;
  screenWidthCm?: string;
  viewingDistanceCm?: string; // distance condition label: 45/55/65
  actualViewingDistanceCm?: string; // measured face-to-screen distance
  pairedSessionId?: string;
};

export type Stage = "setup" | "calibrating" | "finished" | "aborted";
export type Phase = "pre_onset" | "transition" | "fixation";

export type ActivePoint = {
  pointId: number; 
  order: number; // urutan titik ditampilkan
  x: number;
  y: number;
  onset: number; // epoch ms saat titik ditampilkan
};

export type ActiveDot = {
  order: number;
  x: number; // persen
  y: number; // persen
};

export type SessionInfo = {
  participantId: string;
  sessionId: string;
  layoutId: CalibrationLayout["id"];
  // Untuk test grid: session_id kalibrasi pasangannya ("" jika tidak ada).
  pairedSessionId: string;
  screenW: number;
  screenH: number;
  devicePixelRatio: number;
  requestedWidth: number;
  requestedHeight: number;
  requestedFrameRate: number;
  screenWidthCm: number;     // lebar fisik area layar
  viewingDistanceConditionCm: number; // label kondisi: 45/55/65
  viewingDistanceCm: number; // jarak aktual mata ke layar, untuk perhitungan sudut
};

// Hasil detektor fixation (I-DT) untuk satu frame
export type FixationResult = {
  isFixation: boolean;
  dispersion: number; // NaN jika jendela belum penuh atau frame tidak valid
  startMs: number;    // epoch ms awal fixation yang sedang berjalan, NaN jika bukan fixation
};

export type LogRow = {
  frame: EyeTrackingFrame;
  point: ActivePoint;
  tInPoint: number;
  phase: Phase;
  fixation: FixationResult;
  // Fixation yang dimulai SETELAH titik ini muncul
  // (mata sudah berpindah ke titik baru, bukan sisa tatapan titik lama).
  fixationAfterOnset: boolean;
  viewportW: number;
  viewportH: number;
  isFullscreen: boolean;
};

// SUMMARY
export type PointSummary = {
  pointId: number;
  x: number;
  y: number;
  total: number;
  valid: number;
  validFixation: number;
  // Frame valid, fase fixation, DAN lolos I-DT setelah titik muncul
  idtFixation: number;
  // Waktu dari titik muncul sampai mata pertama kali stabil (ms)
  fixationLatencyMs: number;
};

export type SessionSummary = {
  points: PointSummary[];
  totalFrames: number;
  validFrames: number;
  durationS: number;
  processedFps: number;
  effectiveFps: number;
  meanDetectionMs: number;
  captureTimeRatio: number;
  meanFixationLatencyMs: number;
};