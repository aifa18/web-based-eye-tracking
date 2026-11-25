"use client";

// Tampilan hasil test grid dalam bentuk region (peta layar mini + ringkasan).

import type { TestRegionResult } from "@/lib/gaze/testResult";

type TestRegionResultViewProps = {
  result: TestRegionResult;
  screenW: number;
  screenH: number;
};

const fmt = (v: number, digits = 0) => (Number.isFinite(v) ? v.toFixed(digits) : "-");

export default function TestRegionResultView({ result, screenW, screenH }: TestRegionResultViewProps) {
  const W = 1000;
  const H = (W * screenH) / screenW;
  const { cols, rows } = result.grid;

  return (
    <section className="mb-6 rounded-lg border border-gray-200 p-4">
      <h2 className="mb-1 text-lg font-semibold text-black">Hasil tebakan dalam bentuk region</h2>
      <p className="mb-4 text-xs text-gray-500">
        Model Ridge (parameter terkunci) dilatih dari kalibrasi sesi ini, lalu menebak arah
        pandangan selama test grid. Layar dibagi {cols}×{rows} region. Tebakan dianggap
        benar jika berada di dalam kotak seukuran 1 region yang berpusat di titik target.
        Metrik ini membandingkan estimasi kamera dengan target grid, bukan langsung dengan Tobii Spark.
        CSV evaluasi per-frame berisi koordinat gaze prediksi dan timestamp untuk dipasangkan dengan data Tobii.
      </p>

      <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-gray-500">Titik benar</p>
          <p className="font-semibold text-black">
            {result.points.filter((p) => p.hit).length} / {result.points.length} (
            {fmt(result.pointHitPct)}%)
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-gray-500">Frame benar</p>
          <p className="font-semibold text-black">{fmt(result.frameHitPct)}%</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-gray-500">Error rata-rata</p>
          <p className="font-semibold text-black">{fmt(result.meanErrorDeg, 2)}°</p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mb-2 w-full rounded-md border border-gray-300 bg-gray-50"
        role="img"
        aria-label="Peta layar: target dan tebakan per titik test"
      >
        {Array.from({ length: cols - 1 }, (_, i) => (
          <line key={`c${i}`} x1={((i + 1) * W) / cols} x2={((i + 1) * W) / cols} y1={0} y2={H}
            stroke="#9ca3af" strokeDasharray="8 8" strokeWidth={2} />
        ))}
        {Array.from({ length: rows - 1 }, (_, i) => (
          <line key={`r${i}`} y1={((i + 1) * H) / rows} y2={((i + 1) * H) / rows} x1={0} x2={W}
            stroke="#9ca3af" strokeDasharray="8 8" strokeWidth={2} />
        ))}
        {result.points.map((p) => {
          const tx = p.target[0] * W;
          const ty = p.target[1] * H;
          const color = p.hit === null ? "#9ca3af" : p.hit ? "#16a34a" : "#dc2626";
          return (
            <g key={p.pointId}>
              {p.pred && (
                <>
                  <line x1={tx} y1={ty} x2={p.pred[0] * W} y2={p.pred[1] * H} stroke="#6b7280" strokeWidth={2} />
                  <circle cx={p.pred[0] * W} cy={p.pred[1] * H} r={11} fill={color} stroke="white" strokeWidth={3} />
                </>
              )}
              <path d={`M${tx - 14} ${ty}H${tx + 14}M${tx} ${ty - 14}V${ty + 14}`} stroke="#111827" strokeWidth={4} />
              <text x={tx + 16} y={ty - 12} fontSize={22} fill="#374151">{p.pointId}</text>
            </g>
          );
        })}
      </svg>
      <p className="mb-3 text-xs text-gray-500">
        + = titik target, lingkaran = median tebakan (hijau benar, merah salah), garis
        putus-putus = batas region.
      </p>

      <details className="text-sm">
        <summary className="cursor-pointer text-gray-600">Detail per titik</summary>
        <table className="mt-2 w-full">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-1.5">Titik</th>
              <th>Target (%)</th>
              <th>Region tebakan</th>
              <th className="text-right">Frame</th>
              <th className="text-right">Frame benar</th>
              <th className="text-right">Error</th>
            </tr>
          </thead>
          <tbody>
            {result.points.map((p) => (
              <tr key={p.pointId} className="border-b last:border-0">
                <td className={`py-1 font-medium ${p.hit ? "text-green-600" : p.hit === false ? "text-red-600" : "text-gray-400"}`}>
                  {p.pointId}
                </td>
                <td className="text-black">
                  ({Math.round(p.target[0] * 100)}, {Math.round(p.target[1] * 100)})
                </td>
                <td className="text-black">
                  {p.predRegion ? `kolom ${p.predRegion.col + 1}, baris ${p.predRegion.row + 1}` : "-"}
                </td>
                <td className="text-right text-black">{p.nFrames}</td>
                <td className="text-right text-black">{fmt(p.frameHitPct)}%</td>
                <td className="text-right text-black">{fmt(p.errorDeg, 1)}°</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
