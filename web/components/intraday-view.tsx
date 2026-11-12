"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
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
import { NotEnoughData } from "@/components/empty-state";
import type { IntradayPoint } from "@/lib/db";

const config = {
  stress: { label: "Stress", color: "var(--chart-5)" },
  battery: { label: "Body Battery", color: "var(--chart-4)" },
} satisfies ChartConfig;

/** Local clock label from an epoch-ms timestamp. */
function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function IntradayView({
  dates,
  selected,
  stress,
  battery,
}: {
  dates: string[];
  selected: string;
  stress: IntradayPoint[];
  battery: IntradayPoint[];
}) {
  const [showAll, setShowAll] = useState(false);

  // Both series share a timeline, so merge on timestamp rather than rendering
  // two charts the reader has to visually align.
  const merged = new Map<number, { t: string; stress?: number | null; battery?: number | null }>();
  for (const p of stress) {
    merged.set(p.timestamp_ms, { t: clock(p.timestamp_ms), stress: p.stress_level });
  }
  for (const p of battery) {
    const existing = merged.get(p.timestamp_ms);
    if (existing) existing.battery = p.level;
    else merged.set(p.timestamp_ms, { t: clock(p.timestamp_ms), battery: p.level });
  }
  const series = [...merged.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);

  if (series.length === 0) {
    return (
      <div className="space-y-4">
        <DatePicker dates={dates} selected={selected} showAll={showAll} setShowAll={setShowAll} />
        <NotEnoughData
          have={0}
          need={1}
          what="An intraday chart"
        />
        <p className="text-muted-foreground text-xs">
          Intraday series are opt-in. Run{" "}
          <code className="bg-muted rounded px-1 py-0.5">
            scripts/sync.py --intraday
          </code>{" "}
          to collect them.
        </p>
      </div>
    );
  }

  const peakStress = series.reduce(
    (best, p) => (p.stress != null && p.stress > (best?.stress ?? -1) ? p : best),
    series[0],
  );
  const lowBattery = series.reduce(
    (worst, p) => (p.battery != null && p.battery < (worst?.battery ?? 101) ? p : worst),
    series[0],
  );

  return (
    <div className="space-y-4">
      <DatePicker dates={dates} selected={selected} showAll={showAll} setShowAll={setShowAll} />

      <Card>
        <CardHeader>
          <CardTitle>Stress &amp; Body Battery through the day</CardTitle>
          <CardDescription>
            {series.length} readings · peak stress {peakStress?.stress ?? "—"} at{" "}
            {peakStress?.t ?? "—"} · battery low {lowBattery?.battery ?? "—"} at{" "}
            {lowBattery?.t ?? "—"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="h-[300px] w-full">
            <ComposedChart data={series} margin={{ left: -20, right: -10 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                interval={Math.max(1, Math.floor(series.length / 8))}
              />
              <YAxis yAxisId="s" domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} width={40} />
              <YAxis yAxisId="b" orientation="right" domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} width={40} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                yAxisId="b"
                dataKey="battery"
                stroke="var(--color-battery)"
                fill="var(--color-battery)"
                fillOpacity={0.15}
                strokeWidth={2}
                connectNulls
              />
              <Line
                yAxisId="s"
                dataKey="stress"
                stroke="var(--color-stress)"
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ChartContainer>
          <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
            Body Battery drains as stress rises and recovers in rest and sleep.
            Gaps are periods the watch recorded nothing — it was off the wrist, or
            the reading was not measurable.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function DatePicker({
  dates,
  selected,
  showAll,
  setShowAll,
}: {
  dates: string[];
  selected: string;
  showAll: boolean;
  setShowAll: (v: boolean) => void;
}) {
  const visible = showAll ? dates : dates.slice(0, 14);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((d) => (
        <a
          key={d}
          href={`/day?date=${d}`}
          className={`rounded-md border px-2 py-1 text-xs tabular-nums transition-colors ${
            d === selected
              ? "bg-primary text-primary-foreground border-transparent"
              : "hover:bg-muted"
          }`}
        >
          {d.slice(5)}
        </a>
      ))}
      {dates.length > 14 ? (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-muted-foreground hover:text-foreground px-2 py-1 text-xs underline underline-offset-4"
        >
          {showAll ? "fewer" : `+${dates.length - 14} more`}
        </button>
      ) : null}
    </div>
  );
}
