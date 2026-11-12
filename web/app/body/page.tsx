import { SiteNav } from "@/components/site-nav";

import { BodyView } from "@/components/body-view";
import {
  getBodyComposition,
  getDeviceInfo,
  getFitnessAge,
  getMorningReadiness,
  getRunningTolerance,
  getThresholdMetrics,
  getWeeklySummary,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export default function BodyPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <SiteNav active="/body" />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Body &amp; performance</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Fitness age, morning readiness, impact load, weekly volume
        </p>
      </header>

      <BodyView
        fitnessAge={getFitnessAge(60)}
        morning={getMorningReadiness(60)}
        tolerance={getRunningTolerance()}
        weekly={getWeeklySummary()}
        composition={getBodyComposition()}
        ftp={getThresholdMetrics()}
        device={getDeviceInfo()}
      />
    </main>
  );
}
