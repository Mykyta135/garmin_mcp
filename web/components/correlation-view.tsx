"use client";

import {
  CartesianGrid,
  Line,
  ComposedChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
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
import type { CorrelationPoint } from "@/lib/db";
import { shortDate } from "@/lib/format";

const config = {
  hrv: { label: "HRV (ms)", color: "var(--chart-1)" },
  load_7d: { label: "7-day load", color: "var(--chart-2)" },
  readiness: { label: "Readiness", color: "var(--chart-4)" },
  sleep_hours: { label: "Sleep (h)", color: "var(--chart-3)" },
} satisfies ChartConfig;

/** Correlations need enough paired days before they mean anything. */
const MIN_PAIRS = 14;

export function CorrelationView({
  points,
  hrvVsLoad,
}: {
  points: CorrelationPoint[];
  hrvVsLoad: { r: number; n: number } | null;
}) {
  const series = points.map((p) => ({
    ...p,
    label: shortDate(p.date),
  }));

  const scatter = points
    .filter((p) => p.hrv != null && p.load_7d != null)
    .map((p) => ({ load: p.load_7d, hrv: p.hrv, date: shortDate(p.date) }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>HRV against training load</CardTitle>
          <CardDescription>
            The question Garmin Connect can&rsquo;t answer — it shows these on
            separate pages. Overnight HRV plotted against rolling 7-day load.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="h-[280px] w-full">
            <ComposedChart data={series} margin={{ left: -20, right: -10 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis
                yAxisId="hrv"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={44}
              />
              <YAxis
                yAxisId="load"
                orientation="right"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={44}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                yAxisId="hrv"
                dataKey="hrv"
                stroke="var(--color-hrv)"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
              <Line
                yAxisId="load"
                dataKey="load_7d"
                stroke="var(--color-load_7d)"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Correlation</CardTitle>
            <CardDescription>
              Each point is one day: 7-day load against that night&rsquo;s HRV
            </CardDescription>
          </CardHeader>
          <CardContent>
            {scatter.length < MIN_PAIRS ? (
              <NotEnoughData
                have={scatter.length}
                need={MIN_PAIRS}
                what="A load-versus-HRV correlation"
              />
            ) : (
              <>
                <ChartContainer config={config} className="h-[240px] w-full">
                  <ScatterChart margin={{ left: -20, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      dataKey="load"
                      name="7-day load"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                    />
                    <YAxis
                      type="number"
                      dataKey="hrv"
                      name="HRV"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      width={44}
                    />
                    <ZAxis range={[60, 60]} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Scatter data={scatter} fill="var(--color-hrv)" />
                  </ScatterChart>
                </ChartContainer>
                {hrvVsLoad ? (
                  <p className="text-muted-foreground mt-3 text-xs">
                    Pearson r = <span className="tabular-nums">{hrvVsLoad.r.toFixed(2)}</span>{" "}
                    over {hrvVsLoad.n} paired days.{" "}
                    {describeR(hrvVsLoad.r)} Correlation is not causation, and{" "}
                    {hrvVsLoad.n} days is a small sample.
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Readiness &amp; sleep</CardTitle>
            <CardDescription>
              How readiness tracks the night&rsquo;s sleep
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[240px] w-full">
              <ComposedChart data={series} margin={{ left: -20, right: -10 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis
                  yAxisId="score"
                  domain={[0, 100]}
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={44}
                />
                <YAxis
                  yAxisId="hours"
                  orientation="right"
                  domain={[0, 12]}
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={44}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  yAxisId="score"
                  dataKey="readiness"
                  stroke="var(--color-readiness)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
                <Line
                  yAxisId="hours"
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
      </div>
    </div>
  );
}

function describeR(r: number): string {
  const a = Math.abs(r);
  const strength = a < 0.2 ? "Essentially no" : a < 0.4 ? "A weak" : a < 0.6 ? "A moderate" : "A strong";
  const direction = r < 0 ? "inverse" : "positive";
  return `${strength} ${direction} relationship.`;
}
