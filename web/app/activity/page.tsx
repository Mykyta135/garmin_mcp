import Link from "next/link";

import { SiteNav } from "@/components/site-nav";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { getActivities, getActivitiesWithSamples } from "@/lib/db";
import { duration, km, shortDate, titleize } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function ActivityIndexPage() {
  const activities = getActivities(365);
  const withSamples = new Map(
    getActivitiesWithSamples().map((a) => [a.activity_id, a.sample_count]),
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <SiteNav active="/activity" />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Activities</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {activities.length} activities · {withSamples.size} with sample streams
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>All activities</CardTitle>
          <CardDescription>Select one for laps, zones and streams</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                  <TableHead className="text-right">Distance</TableHead>
                  <TableHead className="text-right">Load</TableHead>
                  <TableHead className="text-right">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activities.map((a) => (
                  <TableRow key={a.activity_id}>
                    <TableCell className="whitespace-nowrap">{shortDate(a.date)}</TableCell>
                    <TableCell className="font-medium">
                      <Link
                        href={`/activity/${a.activity_id}`}
                        className="hover:underline underline-offset-4"
                      >
                        {a.name ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{titleize(a.type_key)}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {duration(a.duration_s)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.distance_m && a.distance_m > 100 ? km(a.distance_m) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.training_load ? Math.round(a.training_load) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                      {withSamples.get(a.activity_id)
                        ? `${withSamples.get(a.activity_id)} pts`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
