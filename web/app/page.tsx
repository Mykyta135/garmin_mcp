import { SiteNav } from "@/components/site-nav";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReadinessView } from "@/components/readiness-view";
import { LoadView } from "@/components/load-view";
import { CorrelationView } from "@/components/correlation-view";
import {
  getActivities,
  getCorrelation,
  getDailyStats,
  getHrv,
  getLatestDate,
  getReadiness,
  getSleep,
  getTrainingLoad,
  getZoneTotals,
  pearson,
} from "@/lib/db";

// Read fresh on every request: the snapshot changes whenever sync.py runs, and
// this is a local single-user dashboard, so there is nothing to gain by caching.
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  let latest: string | null = null;
  try {
    latest = getLatestDate();
  } catch (err) {
    return <SetupNotice message={(err as Error).message} />;
  }

  if (!latest) return <SetupNotice message="The database is empty." />;

  const stats = getDailyStats(30);
  const sleep = getSleep(30);
  const hrv = getHrv(30);
  const readiness = getReadiness(30);
  const load = getTrainingLoad(30);
  const activities = getActivities(30);
  const correlation = getCorrelation(90);
  const hrvVsLoad = pearson(correlation, "load_7d", "hrv");

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <SiteNav active="/" />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Garmin dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Local snapshot through {latest} · {stats.length} days of daily stats ·{" "}
          {activities.length} activities
        </p>
      </header>

      <Tabs defaultValue="readiness">
        <TabsList>
          <TabsTrigger value="readiness">Readiness</TabsTrigger>
          <TabsTrigger value="load">Training load</TabsTrigger>
          <TabsTrigger value="correlation">Correlations</TabsTrigger>
        </TabsList>

        <TabsContent value="readiness" className="mt-4">
          <ReadinessView stats={stats} sleep={sleep} hrv={hrv} readiness={readiness} />
        </TabsContent>

        <TabsContent value="load" className="mt-4">
          <LoadView load={load} activities={activities} zones={getZoneTotals(30)} />
        </TabsContent>

        <TabsContent value="correlation" className="mt-4">
          <CorrelationView points={correlation} hrvVsLoad={hrvVsLoad} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function SetupNotice({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <h1 className="text-xl font-semibold">No data yet</h1>
      <p className="text-muted-foreground mt-2 text-sm">{message}</p>
      <pre className="bg-muted mt-4 overflow-x-auto rounded-md p-3 text-xs">
        ./.venv/bin/python scripts/sync.py
      </pre>
    </main>
  );
}
