import { SiteNav } from "@/components/site-nav";
import { ExperimentsView } from "@/components/experiments-view";
import {
  getImpactLoad,
  getPerformanceRuns,
  getSportEfficiency,
  getStrokeSummaries,
  getSwimLengths,
} from "@/lib/experiments";

export const dynamic = "force-dynamic";

export default function ExperimentsPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <SiteNav active="/experiments" />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Experiments</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Cross-sport efficiency, swimming SWOLF, performance condition, impact load
        </p>
      </header>

      <ExperimentsView
        sports={getSportEfficiency()}
        performance={getPerformanceRuns()}
        impact={getImpactLoad()}
        strokes={getStrokeSummaries()}
        lengths={getSwimLengths()}
      />
    </main>
  );
}
