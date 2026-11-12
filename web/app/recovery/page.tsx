import { SiteNav } from "@/components/site-nav";
import { RecoveryView } from "@/components/recovery-view";
import {
  getRecoveryDays,
  getSleepInsights,
  getTrainingAdvice,
} from "@/lib/recovery";

export const dynamic = "force-dynamic";

export default function RecoveryPage() {
  const days = getRecoveryDays(45);
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <SiteNav active="/recovery" />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Recovery &amp; today</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What today should look like, read from Body Battery at wake
        </p>
      </header>

      <RecoveryView
        days={days}
        advice={getTrainingAdvice(days)}
        insights={getSleepInsights(days)}
      />
    </main>
  );
}
