"use client";

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
import { StatTile } from "@/components/stat-tile";
import type { Badge as BadgeRow, PersonalRecord } from "@/lib/db";
import { duration, km, titleize } from "@/lib/format";

/**
 * Garmin's PR typeIds are not published; these are the observed mappings.
 * `unit` decides formatting: a distance PR's value is metres, a time PR's is
 * seconds, and mixing them up silently renders nonsense.
 */
const PR_TYPES: Record<number, { label: string; unit: "distance" | "time" | "elevation" }> = {
  1: { label: "1 km run", unit: "time" },
  2: { label: "1 mile run", unit: "time" },
  3: { label: "5 km run", unit: "time" },
  4: { label: "10 km run", unit: "time" },
  7: { label: "Longest run", unit: "distance" },
  8: { label: "Longest ride", unit: "distance" },
  9: { label: "Best elevation gain", unit: "elevation" },
  12: { label: "Most steps in a day", unit: "distance" },
};

function formatPr(record: PersonalRecord): string {
  const meta = record.type_id != null ? PR_TYPES[record.type_id] : undefined;
  const value = record.value;
  if (value == null) return "—";
  if (!meta) return value.toFixed(0);
  if (meta.unit === "time") return duration(value);
  if (meta.unit === "elevation") return `${Math.round(value)} m`;
  return km(value);
}

export function AchievementsView({
  badges,
  records,
}: {
  badges: BadgeRow[];
  records: PersonalRecord[];
}) {
  const totalPoints = badges.reduce((sum, b) => sum + (b.points ?? 0), 0);
  const named = records.filter((r) => r.type_id != null && PR_TYPES[r.type_id]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Badges earned" value={badges.length} />
        <StatTile label="Badge points" value={totalPoints} />
        <StatTile label="Personal records" value={records.length} />
        <StatTile
          label="Latest badge"
          value={badges[0]?.badge_name ? titleize(badges[0].badge_name) : null}
          hint={badges[0]?.earned_date?.slice(0, 10) ?? null}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Personal records</CardTitle>
          <CardDescription>
            {named.length} recognised
            {records.length > named.length
              ? ` · ${records.length - named.length} with unmapped types`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Record</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Sport</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead className="text-right">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => {
                  const meta = r.type_id != null ? PR_TYPES[r.type_id] : undefined;
                  return (
                    <TableRow key={r.record_id}>
                      <TableCell className="font-medium">
                        {meta?.label ?? `Type ${r.type_id}`}
                      </TableCell>
                      <TableCell className="tabular-nums">{formatPr(r)}</TableCell>
                      <TableCell>
                        {r.activity_type ? (
                          <Badge variant="secondary">{titleize(r.activity_type)}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-[240px] truncate">
                        {r.activity_id ? (
                          <a
                            href={`/activity/${r.activity_id}`}
                            className="hover:text-foreground hover:underline underline-offset-4"
                          >
                            {r.activity_name ?? "—"}
                          </a>
                        ) : (
                          (r.activity_name ?? "—")
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right whitespace-nowrap">
                        {r.start_time_local?.slice(0, 10) ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Badges</CardTitle>
          <CardDescription>{badges.length} earned, newest first</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {badges.map((b) => (
              <div
                key={`${b.badge_id}-${b.earned_date}`}
                className="bg-muted/40 flex items-start justify-between gap-2 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {titleize(b.badge_name ?? b.badge_key)}
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    {b.earned_date?.slice(0, 10) ?? "—"}
                    {b.target_value
                      ? ` · ${Math.round(b.progress_value ?? 0)}/${Math.round(b.target_value)}`
                      : ""}
                  </div>
                </div>
                {b.points ? (
                  <Badge variant="outline" className="shrink-0 tabular-nums">
                    {b.points}
                  </Badge>
                ) : null}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
