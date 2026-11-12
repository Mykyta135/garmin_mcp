"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
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
import { StatTile } from "@/components/stat-tile";
import type { DailyStats, Hrv, Readiness, Sleep } from "@/lib/db";
import { shortDate } from "@/lib/format";

const config = {
  score: { label: "Readiness", color: "var(--chart-4)" },
  hrv: { label: "HRV (ms)", color: "var(--chart-1)" },
  hours: { label: "Sleep", color: "var(--chart-3)" },
  deep: { label: "Deep", color: "var(--chart-3)" },
  rem: { label: "REM", color: "var(--chart-1)" },
  light: { label: "Light", color: "var(--chart-5)" },
  awake: { label: "Awake", color: "var(--chart-2)" },
  bb: { label: "Body Battery", color: "var(--chart-4)" },
  stress: { label: "Avg stress", color: "var(--chart-5)" },
} satisfies ChartConfig;

export function ReadinessView({
  stats,
  sleep,
  hrv,
  readiness,
}: {
  stats: DailyStats[];
  sleep: Sleep[];
  hrv: Hrv[];
  readiness: Readiness[];
}) {
  const latest = {
    stats: stats.at(-1) ?? null,
    sleep: sleep.at(-1) ?? null,
    hrv: hrv.at(-1) ?? null,
    readiness: readiness.at(-1) ?? null,
  };

  const readinessSeries = readiness.map((r) => ({
    date: shortDate(r.date),
    score: r.score,
  }));

  const hrvSeries = hrv.map((h) => ({
    date: shortDate(h.date),
    hrv: h.last_night_avg,
  }));

  const sleepSeries = sleep.map((s) => ({
    date: shortDate(s.date),
    deep: round1((s.deep_seconds ?? 0) / 3600),
    rem: round1((s.rem_seconds ?? 0) / 3600),
    light: round1((s.light_seconds ?? 0) / 3600),
    awake: round1((s.awake_seconds ?? 0) / 3600),
  }));

  const batterySeries = stats.map((s) => ({
    date: shortDate(s.date),
    bb: s.body_battery_high,
    stress: s.avg_stress,
  }));

  const sleepHours = latest.sleep?.sleep_seconds
    ? round1(latest.sleep.sleep_seconds / 3600)
    : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Readiness"
          value={latest.readiness?.score}
          hint={latest.readiness?.level?.replace(/_/g, " ").toLowerCase() ?? null}
        />
        <StatTile
          label="HRV last night"
          value={latest.hrv?.last_night_avg}
          unit="ms"
          hint={
            latest.hrv?.weekly_avg ? `7-day avg ${latest.hrv.weekly_avg} ms` : null
          }
        />
        <StatTile
          label="Sleep"
          value={sleepHours}
          unit="h"
          hint={
            latest.sleep?.awake_count != null
              ? `${latest.sleep.awake_count} awakening${latest.sleep.awake_count === 1 ? "" : "s"}`
              : null
          }
        />
        <StatTile
          label="Resting HR"
          value={latest.stats?.resting_heart_rate}
          unit="bpm"
          hint={
            latest.stats?.body_battery_high != null
              ? `Body Battery peak ${latest.stats.body_battery_high}`
              : null
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Training readiness</CardTitle>
            <CardDescription>
              Garmin&rsquo;s composite of sleep, HRV, recovery and load
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[220px] w-full">
              <LineChart data={readinessSeries} margin={{ left: -20, right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  dataKey="score"
                  stroke="var(--color-score)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Overnight HRV</CardTitle>
            <CardDescription>
              {latest.hrv?.status === "NONE" || !latest.hrv?.status
                ? "Baseline not established yet — Garmin needs ~3 weeks of nights"
                : `Status: ${latest.hrv.status.toLowerCase()}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[220px] w-full">
              <AreaChart data={hrvSeries} margin={{ left: -20, right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  dataKey="hrv"
                  stroke="var(--color-hrv)"
                  fill="var(--color-hrv)"
                  fillOpacity={0.15}
                  strokeWidth={2}
                  connectNulls
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sleep stages</CardTitle>
            <CardDescription>Hours per night by stage</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[220px] w-full">
              <BarChart data={sleepSeries} margin={{ left: -20, right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="deep" stackId="s" fill="var(--color-deep)" />
                <Bar dataKey="rem" stackId="s" fill="var(--color-rem)" />
                <Bar dataKey="light" stackId="s" fill="var(--color-light)" />
                <Bar dataKey="awake" stackId="s" fill="var(--color-awake)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Body Battery &amp; stress</CardTitle>
            <CardDescription>Daily peak charge against average stress</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[220px] w-full">
              <LineChart data={batterySeries} margin={{ left: -20, right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line dataKey="bb" stroke="var(--color-bb)" strokeWidth={2} dot={false} connectNulls />
                <Line
                  dataKey="stress"
                  stroke="var(--color-stress)"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
