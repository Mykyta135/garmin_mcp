import { SiteNav } from "@/components/site-nav";

import { AchievementsView } from "@/components/achievements-view";
import { getBadges, getPersonalRecords } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function AchievementsPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <SiteNav active="/achievements" />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Achievements</h1>
        <p className="text-muted-foreground mt-1 text-sm">Personal records and badges</p>
      </header>

      <AchievementsView badges={getBadges()} records={getPersonalRecords()} />
    </main>
  );
}
