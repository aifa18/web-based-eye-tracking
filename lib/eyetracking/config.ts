// File untuk set semua angka

import {  
  LEFT_EYE_LANDMARKS,
  RIGHT_EYE_LANDMARKS,
  LEFT_IRIS_LANDMARKS,
  RIGHT_IRIS_LANDMARKS,  
} from "@/lib/mediapipe/eyeLandmarks";

import type { CalibrationLayout, CalibrationPoint } from "./types";

// LANDMARK
// Urutan indeks untuk kolom csv yang tetap
export const EYE_INDICES = [...LEFT_EYE_LANDMARKS, ...RIGHT_EYE_LANDMARKS];
export const IRIS_INDICES = [...LEFT_IRIS_LANDMARKS, ...RIGHT_IRIS_LANDMARKS];

// Landmark untuk menghitung bukaan mata (sisi gambar, bukan sisi subjek).
export const LEFT_EYE_OPENNESS = { cornerA: 33, cornerB: 133, top: 159, bottom: 145 };
export const RIGHT_EYE_OPENNESS = { cornerA: 362, cornerB: 263, top: 386, bottom: 374 };

// GATEKEEPER EVALUATION (Akan disetel ulang setelah pilot study)
export const GATEKEEPER = {
  // Pusat bounding box wajah harus berada disini
  guide: { left: 0.3, right: 0.7, top: 0.15, bottom: 0.85 },
  // Semua landmark mata dan iris harus berada di dalam frame
  borderMargin: 0.02,
  // Rasio tinggi/lebar bukaan mata (dihitung dalam piksel), dibawah threshold maka frame dianggap kedipan
  minEyeOpenness: 0.15,
};

// KALIBRASI (disetel ulang berdasarkan hasil pilot study)

// HV9: grid 3x3 (tipe kalibrasi default EyeLink).
export const CALIBRATION_POINTS_HV9: CalibrationPoint[] = [
  { id: 1, x: 10, y: 10 },
  { id: 2, x: 50, y: 10 },
  { id: 3, x: 90, y: 10 },
  { id: 4, x: 10, y: 50 },
  { id: 5, x: 50, y: 50 },
  { id: 6, x: 90, y: 50 },
  { id: 7, x: 10, y: 90 },
  { id: 8, x: 50, y: 90 },
  { id: 9, x: 90, y: 90 },
];

// HV13: pola 13 titik SR Research (Experiment Builder User Manual v2.3.1,
// 2020, hlm. 78-79): grid 3x3 + 4 titik tepat di tengah antara titik pusat
// dan titik pojok. Direkomendasikan untuk mode head-free.
// Titik 1-9 SAMA dengan HV9 (posisi dan id), sehingga di notebook model
// "9 titik" bisa dilatih dari rekaman 13 titik dengan memilih point_id <= 9.
export const CALIBRATION_POINTS_HV13: CalibrationPoint[] = [
  ...CALIBRATION_POINTS_HV9,
  { id: 10, x: 30, y: 30 },
  { id: 11, x: 70, y: 30 },
  { id: 12, x: 30, y: 70 },
  { id: 13, x: 70, y: 70 },
];

// TEST GRID (evaluasi, TIDAK dipakai untuk melatih model): grid 4x3.
// x = 20/40/60/80%, y = 20/50/80%. Semua titik berada di dalam area kalibrasi
// dan tidak sama dengan titik HV9/HV13 mana pun. Layout ini dipilih karena
// jarak rata-rata ke titik kalibrasi terdekat SAMA untuk HV9 dan HV13, sehingga
// perbandingan 9 vs 13 titik tidak bias ke salah satu layout.
// Pada layar 35 cm (16:9): rata-rata 4,9° / 4,4° / 4,0° / 3,7° pada jarak
// 45 / 50 / 55 / 60 cm (minimal 4,5° / 4,0° / 3,6° / 3,3°).
export const TEST_POINTS_12: CalibrationPoint[] = [20, 50, 80].flatMap((y, row) =>
  [20, 40, 60, 80].map((x, col) => ({ id: row * 4 + col + 1, x, y }))
);

export const CALIBRATION_LAYOUTS = {
  HV9: { id: "HV9", kind: "calibration", points: CALIBRATION_POINTS_HV9 },
  HV13: { id: "HV13", kind: "calibration", points: CALIBRATION_POINTS_HV13 },
  TEST12: { id: "TEST12", kind: "test", points: TEST_POINTS_12 },
} as const satisfies Record<string, CalibrationLayout>;

export const POINT_DURATION_MS = 2000;

// Sampel dengan t_in_point < TRANSITION_MS diberi label "transition". Data tidak dibuang dan akan difilter saat training
export const TRANSITION_MS = 500; 

// Jeda setelah masuk layar penuh sebelum titik pertama muncul.
export const PRE_START_DELAY_MS = 1500;

// Urutan acak mencegah model mempelajari drift pose kepala/waktu
// yang berkorelasi dengan urutan titik.
export const RANDOMIZE_ORDER = true;

// Koordinat target harus sesuai dengan koordinat layar Tobii.
export const REQUIRE_FULLSCREEN = true;

// Batas minimal sampel fiksasi valid per titik (peringatan).
export const MIN_VALID_FIXATION_SAMPLES = 30;

// Kalibrasi selalu pada pose netral
export const POSE_CONDITION = "netral";

// SETUP FISIK (untuk konversi error ke derajat sudut pandang)
export const PHYSICAL_SETUP = {
  // Lebar area tampilan layar (cm), diukur dengan penggaris.
  // Isi di sini jika semua partisipan memakai laptop yang sama.
  // 35 cm = laptop penelitian ASUS Vivobook 16 (V3607VU), 16" 16:9, 1920x1080.
  // Diukur dengan meteran: area layar menyala 35 x 20 cm.
  defaultScreenWidthCm: 35 as number | null,
  // Protokol jarak mata ke layar (cm) sesuai rancangan pengujian.
  recommendedViewingDistanceCm: { min: 40, max: 70 },
  viewingDistanceOptionsCm: [45, 55, 65] as const,
  // Setiap label adalah kondisi jarak dengan toleransi ±5 cm.
  viewingDistanceRanges: {
    45: { min: 40, max: 50 },
    55: { min: 50, max: 60 },
    65: { min: 60, max: 70 },
  },
  // Nilai awal label kondisi jarak.
  defaultViewingDistanceCm: 55,
  // Rentang wajar untuk validasi input (di luar ini input ditolak).
  screenWidthCm: { min: 15, max: 100 },
  viewingDistanceCm: { min: 30, max: 120 },
};

export type ViewingDistanceConditionCm = 45 | 55 | 65;

export function viewingDistanceRangeOf(conditionCm: number): { min: number; max: number } | null {
  if (conditionCm !== 45 && conditionCm !== 55 && conditionCm !== 65) return null;
  return PHYSICAL_SETUP.viewingDistanceRanges[conditionCm];
}

// FIXATION (I-DT online kumulatif, lihat lib/eyetracking/fixation.ts)
// Posisi iris diukur relatif terhadap sudut mata, dalam satuan "panjang mata".
// Dari data pilot (4 sesi, 40 titik):
// - geser 20% lebar layar  -> u berubah ~0,038
// - geser 20% tinggi layar -> v berubah ~0,008 (sinyal vertikal ~5x lebih kecil)
// - noise saat mata diam: u ~0,006, v ~0,003 (persentil 95 rentang 5 frame)
// Ambang dipilih lewat simulasi pada data pilot: 39/40 titik punya >= 30 sampel
// fixation (ambang lama 0,04 hanya 30/40).
export const FIXATION = {
  // Durasi minimal mata stabil agar dianggap fixation.
  minDurationMs: 150,
  // Simpangan maksimal sampel dari pusat fixation, per sumbu.
  maxDeviationU: 0.010,
  maxDeviationV: 0.008,
  // Jeda antarframe lebih dari ini memutus fixation (frame hilang).
  maxGapMs: 100,
};

// MODEL GAZE DI BROWSER (demo region & hasil test grid; TIDAK mengubah data CSV)
// Hiperparameter Ridge DIKUNCI setelah pilot study (15 November 2026), sama
// dengan gaze-model/models/pilot_params.json: degree 1 (linear), alpha 10.
// Hanya Ridge linear yang bisa dilatih langsung di browser (lib/gaze/ridge.ts);
// hasilnya sudah dicek identik dengan scikit-learn.
// Data latih = frame kalibrasi fase "fixation" + face_valid (aturan A).
export const GAZE_MODEL = {
  degree: 1,
  alpha: 10,
};

// REGION: layar dibagi kolom x baris. 4x2 dipilih dari data pilot
// (gaze-model/pilot_study_analysis.ipynb bagian 12): grid dengan kotak
// terbanyak yang tebakannya masih >= 75% benar (4x2 ~76%, 3x3 hanya ~62%,
// karena arah atas-bawah jauh lebih sulit daripada kiri-kanan).
export const GAZE_REGION = {
  cols: 4,
  rows: 2,
  // Median tebakan selama waktu ini (ms) agar region tidak berkedip.
  smoothingMs: 500,
  // Minimal tebakan valid di dalam jendela sebelum region ditampilkan.
  minSamples: 3,
  // Jika tidak ada frame valid selama ini (ms), region dimatikan.
  lostAfterMs: 700,
};
