import { useEffect, useRef, useState } from "react";

import { epochNow } from "@/lib/eyetracking/utils";
import type {
  ActiveDot,
  ActivePoint,
  CalibrationPoint,
} from "@/lib/eyetracking/types";

type UsePointSequenceOptions = {
  pointDurationMs: number;
  preStartDelayMs: number;
  // Dipanggil setelah titik terakhir selesai ditampilkan.
  onFinish: () => void;
  onActivePoint?: (point: ActivePoint | null) => void;
};

// Menampilkan titik satu per satu dengan timer.
// activePointRef dibaca oleh callback per-frame (tanpa render),
// activeDot dipakai untuk tampilan.
export function usePointSequence({
  pointDurationMs,
  preStartDelayMs,
  onFinish,
  onActivePoint,
}: UsePointSequenceOptions) {
  const [activeDot, setActiveDot] = useState<ActiveDot | null>(null);

  const activePointRef = useRef<ActivePoint | null>(null);
  const orderRef = useRef<CalibrationPoint[]>([]);
  const timerRef = useRef<number | null>(null);

  const onFinishRef = useRef(onFinish);
  const onActivePointRef = useRef(onActivePoint);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);
  useEffect(() => {
    onActivePointRef.current = onActivePoint;
  }, [onActivePoint]);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const showPoint = (orderIdx: number) => {
    const order = orderRef.current;

    if (orderIdx >= order.length) {
      onFinishRef.current();
      return;
    }

    const p = order[orderIdx];

    activePointRef.current = {
      pointId: p.id,
      order: orderIdx + 1,
      x: p.x / 100,
      y: p.y / 100,
      onset: epochNow(),
    };
    onActivePointRef.current?.(activePointRef.current);

    setActiveDot({ order: orderIdx + 1, x: p.x, y: p.y });

    timerRef.current = window.setTimeout(
      () => showPoint(orderIdx + 1),
      pointDurationMs
    );
  };

  // Mulai urutan baru setelah jeda awal.
  const start = (order: CalibrationPoint[]) => {
    orderRef.current = order;
    activePointRef.current = null;
    onActivePointRef.current?.(null);
    setActiveDot(null);

    timerRef.current = window.setTimeout(() => showPoint(0), preStartDelayMs);
  };

  // Hentikan timer dan kosongkan titik aktif.
  const stop = () => {
    clearTimer();
    activePointRef.current = null;
    onActivePointRef.current?.(null);
    setActiveDot(null);
  };

  // Bersihkan timer saat halaman ditutup.
  useEffect(() => {
    return () => clearTimer();
  }, []);

  return { activeDot, activePointRef, start, stop };
}
