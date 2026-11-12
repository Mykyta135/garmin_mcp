"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
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
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/stat-tile";
import type { RecoveryDay, SleepInsight, TrainingAdvice } from "@/lib/recovery";
import { shortDate } from "@/lib/format";

const config = {
  bb_at_wake: { label: "BB at wake", color: "var(--chart-4)" },
  sleep_hours: { label: "Sleep (h)", color: "var(--chart-3)" },
  rem_minutes: { label: "REM (min)", color: "var(--chart-1)" },
  hrv: { label: "HRV (ms)", color: "var(--chart-1)" },
} satisfies ChartConfig;

const LEVEL: Record<TrainingAdvice["level"], { ring: string; text: string; label: string }> = {
  green: { ring: "border-[var(--chart-3)]", text: "text-[var(--chart-3)]", label: "Go hard" },
  amber: { ring: "border-[var(--chart-5)]", text: "text-[var(--chart-5)]", label: "Normal" },
  red: { ring: "border-[var(--chart-2)]", text: "text-[var(--chart-2)]", label: "Easy" },
  unknown: { ring: "border-border", text: "text-muted-foreground", label: "No data" },
};

export function RecoveryView({
  days,
  advice,
  insights,
}: {
  days: RecoveryDay[];
  advice: TrainingAdvice;
  insights: SleepInsight[];
}) {
  const series = days.map((d) => ({
    date: shortDate(d.date),
    bb_at_wake: d.bb_at_wake,
    sleep_hours: d.sleep_hours,
    rem_minutes: d.rem_minutes,
    hrv: d.hrv,
  }));

  const level = LEVEL[advice.level];
  const withBb = days.filter((d) => d.bb_at_wake != null);
  const green = withBb.filter((d) => (d.bb_at_wake ?? 0) >= 60).length;
  const red = withBb.filter((d) => (d.bb_at_wake ?? 0) < 40).length;

  return (
    <div className="space-y-4">
      <Card className={`border-2 ${level.ring}`}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className={`text-xl ${level.text}`}>{advice.headline}</CardTitle>
            {advice.bb_at_wake != null ? (
              <span className="flex items-baseline gap-2">
                <span className={`text-3xl font-semibold tabular-nums ${level.text}`}>
                  {advice.bb_at_wake}
                </span>
                <span className="text-muted-foreground text-xs">
                  Body Battery at wake
                  {advice.date ? ` · ${advice.date}` : ""}
                </span>
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed">{advice.detail}</p>
          <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>
              <strong className="text-[var(--chart-3)]">≥60</strong> intervals or a hard climb
            </span>
            <span>
              <strong className="text-[var(--chart-5)]">40–59</strong> normal commute
            </span>
            <span>
              <strong className="text-[var(--chart-2)]">&lt;40</strong> hold HR near 120–125
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Nights tracked"
          value={days.filter((d) => d.sleep_hours != null).length}
        />
        <StatTile label="Green days" value={green} hint="BB at wake ≥60" />
        <StatTile label="Red days" value={red} hint="BB at wake <40" />
        <StatTile
          label="Mean sleep"
          value={(() => {
            const v = days.map((d) => d.sleep_hours).filter((x): x is number => x != null);
            return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : null;
          })()}
          unit="h"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Body Battery at wake vs sleep</CardTitle>
          <CardDescription>
            The strongest single indicator of how recovered you actually are
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="h-[260px] w-full">
            <ComposedChart data={series} margin={{ left: -20, right: -10 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis yAxisId="bb" domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} width={40} />
              <YAxis yAxisId="h" orientation="right" domain={[0, 12]} tickLine={false} axisLine={false} fontSize={11} width={36} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ReferenceLine yAxisId="bb" y={60} stroke="var(--chart-3)" strokeDasharray="4 3" />
              <ReferenceLine yAxisId="bb" y={40} stroke="var(--chart-2)" strokeDasharray="4 3" />
              <Area
                yAxisId="bb"
                dataKey="bb_at_wake"
                stroke="var(--color-bb_at_wake)"
                fill="var(--color-bb_at_wake)"
                fillOpacity={0.15}
                strokeWidth={2}
                connectNulls
              />
              <Line
                yAxisId="h"
                dataKey="sleep_hours"
                stroke="var(--color-sleep_hours)"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>REM is what short nights cost you</CardTitle>
          <CardDescription>
            Deep sleep is protected first; REM sits in the final cycles
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="h-[220px] w-full">
            <ComposedChart data={series} margin={{ left: -20, right: -10 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis yAxisId="rem" tickLine={false} axisLine={false} fontSize={11} width={40} />
              <YAxis yAxisId="hrv" orientation="right" tickLine={false} axisLine={false} fontSize={11} width={36} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line yAxisId="rem" dataKey="rem_minutes" stroke="var(--color-rem_minutes)" strokeWidth={2} dot={{ r: 2 }} connectNulls />
              <Line yAxisId="hrv" dataKey="hrv" stroke="var(--color-hrv)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
            </ComposedChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {insights.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>What you can actually change</CardTitle>
            <CardDescription>
              Ordered by whether it is within your control in shared accommodation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[...insights]
              .sort((a, b) => Number(b.actionable) - Number(a.actionable))
              .map((i) => (
                <div key={i.key} className="border-b pb-3 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{i.label}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{i.value}</span>
                      <Badge variant={i.actionable ? "default" : "outline"}>
                        {i.actionable ? "actionable" : "context only"}
                      </Badge>
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-xs">{i.comparison}</div>
                  <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">{i.note}</p>
                </div>
              ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
