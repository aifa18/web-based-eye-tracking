// Data latih model gaze di browser.
//
// Setelah kalibrasi selesai, fitur + target frame latih disimpan di
// sessionStorage (khusus tab ini), supaya halaman test grid dan demo region
// bisa melatih model tanpa mengunggah CSV. Data hilang saat tab ditutup.
// CSV penelitian tetap menjadi sumber data utama; ini hanya untuk tampilan.

import { GAZE_MODEL } from "@/lib/eyetracking/config";
import type { LogRow } from "@/lib/eyetracking/types";

import { frameFeatures } from "./features";
import { fitRidge, type RidgeModel } from "./ridge";

const KEY_PREFIX = "gaze-training:";

export type TrainingSet = {
  version: 1;
  sessionId: string;
  layoutId: string;
  X: number[][];
  Y: number[][];
};

export const trainingKey = (sessionId: string) => `${KEY_PREFIX}${sessionId}`;

// Aturan A (sama dengan notebook): fase "fixation" dan lolos Gatekeeper.
export function isTrainingRow(row: LogRow): boolean {
  return row.phase === "fixation" && row.frame.faceValid;
}

export function buildTrainingSet(rows: LogRow[], sessionId: string, layoutId: string): TrainingSet {
  const X: number[][] = [];
  const Y: number[][] = [];
  for (const row of rows) {
    if (!isTrainingRow(row)) continue;
    const f = frameFeatures(row.frame);
    if (!f) continue;
    X.push(f);
    Y.push([row.point.x, row.point.y]);
  }
  return { version: 1, sessionId, layoutId, X, Y };
}

// Simpan satu set tanpa menghapus set kamera lain pada sesi yang sama.
export function saveTrainingSet(set: TrainingSet): boolean {
  try {
    sessionStorage.setItem(trainingKey(set.sessionId), JSON.stringify(set));
    return true;
  } catch (err) {
    console.warn("Data latih gaze tidak bisa disimpan:", err);
    return false;
  }
}

export function readTrainingRaw(sessionId: string): string | null {
  if (!sessionId) return null;
  try {
    return sessionStorage.getItem(trainingKey(sessionId));
  } catch {
    return null;
  }
}

export function parseTrainingSet(raw: string | null): TrainingSet | null {
  if (!raw) return null;
  try {
    const set = JSON.parse(raw) as TrainingSet;
    return set.version === 1 && set.X.length === set.Y.length ? set : null;
  } catch {
    return null;
  }
}

// Minimal frame latih supaya model layak dipakai (sekitar 4 titik x 30 frame).
export const MIN_TRAINING_FRAMES = 120;

export function trainGazeModel(set: TrainingSet): RidgeModel | null {
  if (GAZE_MODEL.degree !== 1) throw new Error("Browser hanya mendukung Ridge linear (degree 1).");
  if (set.X.length < MIN_TRAINING_FRAMES) return null;
  return fitRidge(set.X, set.Y, GAZE_MODEL.alpha);
}
