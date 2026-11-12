import { SiteNav } from "@/components/site-nav";
import { SegmentsView } from "@/components/segments-view";
import { getBandTrends, getSegments, summariseBands } from "@/lib/segments";

export const dynamic = "force-dynamic";

export default function SegmentsPage() {
  const segments = getSegments();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <SiteNav active="/segments" />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Cycling segments</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every ride cut into 60-second blocks and grouped by gradient
        </p>
      </header>

      <SegmentsView
        segments={segments}
        bands={summariseBands(segments)}
        trends={getBandTrends(segments)}
      />
    </main>
  );
}
