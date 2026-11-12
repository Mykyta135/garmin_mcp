import { SiteNav } from "@/components/site-nav";

import { MatrixView } from "@/components/matrix-view";
import {
  METRICS,
  correlateAll,
  isTautology,
  loadSeries,
} from "@/lib/correlate";

export const dynamic = "force-dynamic";

export default function MatrixPage() {
  let series;
  try {
    series = loadSeries(365);
  } catch {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <SiteNav active="/matrix" />
        <p className="text-muted-foreground text-sm">
          No snapshot yet — run the sync first.
        </p>
      </main>
    );
  }

  const all = correlateAll(series, [0, 1, 2]);
  // Same-measurement pairs (steps vs. distance) are arithmetic, not insight.
  const results = all.filter((r) => !isTautology(r.x, r.y));
  const maxPairs = Math.max(0, ...Object.values(series).map((s) => s.size));

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <header className="mb-6">
        <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
            Correlation matrix
          </h1>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {METRICS.length} metrics · lags 0–2 days · longest series {maxPairs} days
        </p>
      </header>

      <MatrixView
        results={results}
        totalTests={all.length}
        metricCount={METRICS.length}
        maxPairs={maxPairs}
      />
    </main>
  );
}
