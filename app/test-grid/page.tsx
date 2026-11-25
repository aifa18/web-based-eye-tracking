// Test grid 12 titik (TEST12): data UJI, tidak dipakai untuk melatih model.
// Dibuka lewat tombol "Lanjut ke Test Grid" setelah kalibrasi, sehingga
// ID partisipan, setup fisik, dan ID sesi kalibrasi terbawa lewat URL:
//   /test-grid?pid=P01&cal=<session_id kalibrasi>&w=31&d=50
import CalibrationSession from "@/components/CalibrationSession";
import { CALIBRATION_LAYOUTS } from "@/lib/eyetracking/config";

type TestGridPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (v: string | string[] | undefined) =>
  typeof v === "string" ? v : undefined;

export default async function TestGridPage({ searchParams }: TestGridPageProps) {
  const sp = await searchParams;
  return (
    <CalibrationSession
      layout={CALIBRATION_LAYOUTS.TEST12}
      prefill={{
        participantId: first(sp.pid),
        pairedSessionId: first(sp.cal),
        screenWidthCm: first(sp.w),
        viewingDistanceCm: first(sp.d),
        actualViewingDistanceCm: first(sp.da),
      }}
    />
  );
}
