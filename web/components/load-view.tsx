"use client";

import Link from "next/link";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
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
import type { Activity, TrainingLoad } from "@/lib/db";
import { duration, km, shortDate, titleize } from "@/lib/format";

const config = {
  ctl: { label: "Fitness (CTL)", color: "var(--chart-1)" },
  atl: { label: "Fatigue (ATL)", color: "var(--chart-2)" },
  tsb: { label: "Form (TSB)", color: "var(--chart-4)" },
  load: { label: "Training load", color: "var(--chart-2)" },
  minutes: { label: "Minutes", color: "var(--chart-1)" },
} satisfies ChartConfig;

const ZONE_NAMES = ["", "Warm up", "Easy", "Aerobic", "Threshold", "Maximum"];

export function LoadView({
  load,
  activities,
  zones,
}: {
  load: TrainingLoad[];
  activities: Activity[];
  zones: Array<{ zone_number: number; minutes: number; zone_low_boundary: number | null }>;
}) {
  const latest = load.at(-1) ?? null;

  const series = load.map((l) => ({
    date: shortDate(l.date),
    ctl: l.ctl,
    atl: l.atl,
    tsb: l.tsb,
  }));

  // Per-day activity load: several activities can share a day, so sum them.
  const byDay = new Map<string, number>();
  for (const a of activities) {
    if (a.training_load == null) continue;
    byDay.set(a.date, (byDay.get(a.date) ?? 0) + a.training_load);
  }
  const loadSeries = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date: shortDate(date), load: Math.round(total) }));

  const totalLoad = activities.reduce((s, a) => s + (a.training_load ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Fitness (CTL)"
          value={latest?.ctl != null ? Math.round(latest.ctl) : null}
          hint="42-day chronic load"
        />
        <StatTile
          label="Fatigue (ATL)"
          value={latest?.atl != null ? Math.round(latest.atl) : null}
          hint="7-day acute load"
        />
        <StatTile
          label="Form (TSB)"
          value={latest?.tsb != null ? Math.round(latest.tsb) : null}
          hint={latest?.acwr_status ? latest.acwr_status.toLowerCase() : "CTL − ATL"}
        />
        <StatTile
          label="VO₂ max"
          value={latest?.vo2max ?? null}
          unit="ml/kg/min"
          hint={
            latest?.training_status
              ? latest.training_status.replace(/_/g, " ").toLowerCase()
              : null
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Performance management</CardTitle>
          <CardDescription>
            Fitness against fatigue. Form above zero means fresh, below means
            carrying fatigue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="h-[260px] w-full">
            <LineChart data={series} margin={{ left: -20, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={44} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Line dataKey="ctl" stroke="var(--color-ctl)" strokeWidth={2} dot={false} connectNulls />
              <Line dataKey="atl" stroke="var(--color-atl)" strokeWidth={2} dot={false} connectNulls />
              <Line
                dataKey="tsb"
                stroke="var(--color-tsb)"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daily training load</CardTitle>
          <CardDescription>
            Summed across activities — {Math.round(totalLoad)} total over this window
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="h-[200px] w-full">
            <BarChart data={loadSeries} margin={{ left: -20, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={44} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="load" fill="var(--color-load)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {zones.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Time in heart-rate zones</CardTitle>
            <CardDescription>
              Total minutes per zone across every activity in this window
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[200px] w-full">
              <BarChart
                data={zones.map((z) => ({
                  zone: `Z${z.zone_number}`,
                  minutes: z.minutes,
                }))}
                margin={{ left: -20, right: 8 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="zone" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} width={44} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="minutes" fill="var(--color-minutes)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
            <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {zones.map((z) => (
                <span key={z.zone_number}>
                  <strong className="text-foreground">Z{z.zone_number}</strong>{" "}
                  {ZONE_NAMES[z.zone_number] ?? ""}
                  {z.zone_low_boundary ? ` ≥${z.zone_low_boundary}bpm` : ""} ·{" "}
                  {z.minutes}m
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Activities</CardTitle>
          <CardDescription>{activities.length} in this window</CardDescription>
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
                  <TableHead className="text-right">Avg HR</TableHead>
                  <TableHead className="text-right">Load</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activities.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground text-center">
                      No activities recorded
                    </TableCell>
                  </TableRow>
                ) : (
                  activities.map((a) => (
                    <TableRow key={a.activity_id}>
                      <TableCell className="whitespace-nowrap">
                        {shortDate(a.date)}
                      </TableCell>
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
                        {a.avg_hr ? Math.round(a.avg_hr) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.training_load ? Math.round(a.training_load) : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
