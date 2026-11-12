import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityDetailView } from "@/components/activity-detail-view";
import {
  getActivityById,
  getExerciseSets,
  getHrZones,
  getLaps,
  getSamples,
  getWeather,
} from "@/lib/db";
import { titleize } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ActivityPage(props: PageProps<"/activity/[id]">) {
  const { id } = await props.params;
  const activityId = Number(id);
  if (!Number.isFinite(activityId)) notFound();

  const activity = getActivityById(activityId);
  if (!activity) notFound();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <header className="mb-6">
        <Link
          href="/activity"
          className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
        >
          ← All activities
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {activity.name ?? titleize(activity.type_key)}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {titleize(activity.type_key)} · {activity.start_time_local ?? activity.date}
        </p>
      </header>

      <ActivityDetailView
        activity={activity}
        laps={getLaps(activityId)}
        zones={getHrZones(activityId)}
        weather={getWeather(activityId)}
        sets={getExerciseSets(activityId)}
        samples={getSamples(activityId, 400)}
      />
    </main>
  );
}
