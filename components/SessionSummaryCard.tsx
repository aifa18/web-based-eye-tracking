"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { MIN_VALID_FIXATION_SAMPLES } from "@/lib/eyetracking/config";
import type { SessionSummary } from "@/lib/eyetracking/types";

type SessionSummaryCardProps = {
  title: string;
  summary: SessionSummary;
  summaryLabel?: string;
  sessionId: string | undefined;
  onDownload: () => void;
  onReset: () => void;
  resetLabel: string;
  downloaded: boolean;
  // Tautan lanjutan (mis. ke test grid). Baru aktif setelah CSV diunduh,
  // karena data sesi hilang saat pindah halaman.
  nextHref?: string;
  nextLabel?: string;
  // Konten tambahan di atas tombol (mis. hasil tebakan region pada test grid).
  children?: ReactNode;
};

// Tampilan "... Selesai" beserta ringkasan per titik.
export default function SessionSummaryCard({
  title,
  summary,
  summaryLabel,
  sessionId,
  onDownload,
  onReset,
  resetLabel,
  downloaded,
  nextHref,
  nextLabel,
  children,
}: SessionSummaryCardProps) {
  // Peringatan memakai hitungan I-DT (lebih ketat dari hitungan berbasis waktu).
  const lowPoints = summary.points.filter(
    (p) => p.idtFixation < MIN_VALID_FIXATION_SAMPLES
  );

  const fmtMs = (v: number) => (Number.isFinite(v) ? `${v.toFixed(0)} ms` : "-");

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-2xl rounded-xl bg-white p-8 shadow-lg">
        <h1 className="mb-1 text-center text-2xl font-bold text-green-600">
          {title}
        </h1>
        <p className="mb-1 text-center text-sm text-gray-500">Sesi {sessionId}</p>
        <p className="mb-6 text-center text-xs text-gray-500">
          Ringkasan utama berasal dari {summaryLabel ?? "kamera pertama"}; metrik dan data tiap kamera ditampilkan di bawah.
        </p>

        <div className="mb-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-gray-500">Frame valid</p>
            <p className="font-semibold text-black">
              {summary.validFrames} / {summary.totalFrames}
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-gray-500">Effective FPS</p>
            <p className="font-semibold text-black">
              {Number.isFinite(summary.effectiveFps)
                ? summary.effectiveFps.toFixed(1)
                : "-"}
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-gray-500">Rata-rata deteksi</p>
            <p className="font-semibold text-black">
              {Number.isFinite(summary.meanDetectionMs)
                ? `${summary.meanDetectionMs.toFixed(1)} ms`
                : "-"}
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-gray-500">Timestamp capture</p>
            <p className="font-semibold text-black">
              {(summary.captureTimeRatio * 100).toFixed(0)}%
            </p>
          </div>
        </div>

        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-2">Titik</th>
              <th>Posisi (%)</th>
              <th className="text-right">Total</th>
              <th className="text-right">Valid</th>
              <th className="text-right">Fiksasi valid</th>
              <th className="text-right">Fixation I-DT</th>
              <th className="text-right">Latensi stabil</th>
            </tr>
          </thead>
          <tbody>
            {summary.points.map((p) => {
              const low = p.idtFixation < MIN_VALID_FIXATION_SAMPLES;
              return (
                <tr key={p.pointId} className="border-b last:border-0">
                  <td className="py-1.5 text-black">{p.pointId}</td>
                  <td className="text-black">
                    ({p.x}, {p.y})
                  </td>
                  <td className="text-right text-black">{p.total}</td>
                  <td className="text-right text-black">{p.valid}</td>
                  <td className="text-right text-black">{p.validFixation}</td>
                  <td
                    className={`text-right font-medium ${
                      low ? "text-red-500" : "text-black"
                    }`}
                  >
                    {p.idtFixation}
                  </td>
                  <td className="text-right text-black">
                    {fmtMs(p.fixationLatencyMs)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="mb-4 text-xs text-gray-500">
          Rata-rata latensi mata stabil setelah titik muncul:{" "}
          <span className="font-medium text-black">
            {fmtMs(summary.meanFixationLatencyMs)}
          </span>
          . Angka ini bisa dipakai sebagai acuan TRANSITION_MS.
        </p>

        {lowPoints.length > 0 && (
          <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
            Titik {lowPoints.map((p) => p.pointId).join(", ")} memiliki
            kurang dari {MIN_VALID_FIXATION_SAMPLES} sampel fixation (I-DT) valid.
            Pertimbangkan untuk mengulang sesi.
          </p>
        )}

        {children}

        <div className="flex flex-wrap justify-center gap-3">
          <button
            onClick={onDownload}
            className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
          >
            {downloaded ? "✓ CSV Terunduh (unduh lagi)" : "Download Dataset CSV"}
          </button>
          <button
            onClick={onReset}
            className="rounded-lg bg-gray-700 px-6 py-3 font-medium text-white hover:bg-gray-800"
          >
            {resetLabel}
          </button>
          {nextHref &&
            (downloaded ? (
              <Link
                href={nextHref}
                className="rounded-lg bg-green-600 px-6 py-3 font-medium text-white hover:bg-green-700"
              >
                {nextLabel} →
              </Link>
            ) : (
              <span
                title="Download CSV dulu agar data sesi ini tidak hilang"
                className="cursor-not-allowed rounded-lg bg-gray-300 px-6 py-3 font-medium text-gray-500"
              >
                {nextLabel} →
              </span>
            ))}
        </div>

        {nextHref && !downloaded && (
          <p className="mt-3 text-center text-xs text-gray-500">
            Download CSV dulu sebelum lanjut, karena data sesi ini hilang saat
            pindah halaman.
          </p>
        )}
      </div>
    </div>
  );
}
