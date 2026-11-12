import { SiteNav } from "@/components/site-nav";
import { RunningView } from "@/components/running-view";
import {
  HEIGHT_M,
  cadenceTarget,
  getFormVerdicts,
  getGaitComparison,
  getPaceConfounds,
  getPaceMatchedEconomy,
  getRunMetrics,
} from "@/lib/running";

export const dynamic = "force-dynamic";

export default function RunningPage() {
  const runs = getRunMetrics();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <SiteNav active="/running" />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Running economy</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Measured by the watch — ground contact, oscillation, stride, power. No
          modelled constants.
        </p>
      </header>

      <RunningView
        runs={runs}
        verdicts={getFormVerdicts(runs)}
        confounds={getPaceConfounds(runs)}
        gait={getGaitComparison()}
        cadenceTargetSpm={cadenceTarget()}
        heightCm={Math.round(HEIGHT_M * 100)}
        paceMatched={getPaceMatchedEconomy(runs)}
      />
    </main>
  );
}
