// Hasil test grid dalam bentuk region: model (dilatih dari kalibrasi) menebak
// setiap frame test, lalu dinilai per titik dan per frame.

import type { LogRow, SessionInfo } from "@/lib/eyetracking/types";

import { frameFeatures } from "./features";
import { predictRidge, type RidgeModel } from "./ridge";
import {
  angularErrorDeg,
  hitCentered,
  medianPoint,
  regionOf,
  type PhysicalSetup,
  type Region,
  type RegionGrid,
} from "./region";
import { isTrainingRow } from "./training";

export type PointRegionResult = {
  pointId: number;
  target: [number, number];
  // Median tebakan selama titik ini (null jika tidak ada frame valid)
  pred: [number, number] | null;
  predRegion: Region | null;
  nFrames: number;
  hit: boolean | null;
  frameHitPct: number;
  errorDeg: number;
};

export type FrameGazePrediction = {
  frameIndex: number;
  timestampMs: number;
  pointId: number;
  targetX: number;
  targetY: number;
  predictedX: number;
  predictedY: number;
  predictedRegion: Region | null;
  hit: boolean;
  errorDeg: number;
};

export type TestRegionResult = {
  grid: RegionGrid;
  points: PointRegionResult[];
  framePredictions: FrameGazePrediction[];
  pointHitPct: number;
  frameHitPct: number;
  meanErrorDeg: number;
  nFrames: number;
  nTrain: number;
};

export function physicalSetupOf(session: SessionInfo): PhysicalSetup {
  return {
    widthCm: session.screenWidthCm,
    heightCm: (session.screenWidthCm * session.screenH) / session.screenW,
    distanceCm: session.viewingDistanceCm,
  };
}

export function computeTestRegionResult(
  rows: LogRow[],
  model: RidgeModel,
  grid: RegionGrid,
  setup: PhysicalSetup
): TestRegionResult {
  // Frame yang dinilai: fase fixation + face_valid (sama dengan data latih).
  const byPoint = new Map<number, { target: [number, number]; preds: [number, number][] }>();
  const framePredictions: FrameGazePrediction[] = [];
  for (const row of rows) {
    const entry = byPoint.get(row.point.pointId) ?? {
      target: [row.point.x, row.point.y] as [number, number],
      preds: [],
    };
    byPoint.set(row.point.pointId, entry);
    if (!isTrainingRow(row)) continue;
    const f = frameFeatures(row.frame);
    if (f) {
      const prediction = predictRidge(model, f);
      entry.preds.push(prediction);
      framePredictions.push({
        frameIndex: row.frame.frameIndex,
        timestampMs: row.frame.timestamp,
        pointId: row.point.pointId,
        targetX: row.point.x,
        targetY: row.point.y,
        predictedX: prediction[0],
        predictedY: prediction[1],
        predictedRegion: regionOf(prediction[0], prediction[1], grid),
        hit: hitCentered(entry.target, prediction, grid),
        errorDeg: angularErrorDeg(target, prediction, setup),
      });
    }
  }

  let frameHits = 0;
  let nFrames = 0;
  let errSum = 0;
  const points: PointRegionResult[] = [...byPoint.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pointId, { target, preds }]) => {
      let hits = 0;
      for (const p of preds) {
        if (hitCentered(target, p, grid)) hits++;
        errSum += angularErrorDeg(target, p, setup);
      }
      frameHits += hits;
      nFrames += preds.length;
      const pred = preds.length ? medianPoint(preds) : null;
      return {
        pointId,
        target,
        pred,
        predRegion: pred ? regionOf(pred[0], pred[1], grid) : null,
        nFrames: preds.length,
        hit: pred ? hitCentered(target, pred, grid) : null,
        frameHitPct: preds.length ? (100 * hits) / preds.length : NaN,
        errorDeg: pred ? angularErrorDeg(target, pred, setup) : NaN,
      };
    });

  const judged = points.filter((p) => p.hit !== null);
  return {
    grid,
    points,
    framePredictions,
    pointHitPct: judged.length ? (100 * judged.filter((p) => p.hit).length) / judged.length : NaN,
    frameHitPct: nFrames ? (100 * frameHits) / nFrames : NaN,
    meanErrorDeg: nFrames ? errSum / nFrames : NaN,
    nFrames,
    nTrain: model.nTrain,
  };
}
