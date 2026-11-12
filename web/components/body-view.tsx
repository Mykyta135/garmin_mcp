"use client";

import {
  Bar,
  BarChart,
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
import { NotEnoughData } from "@/components/empty-state";
import type {
  BodyComposition,
  FitnessAge,
  MorningReadiness,
  RunningTolerance,
  WeeklySummary,
} from "@/lib/db";
import { shortDate } from "@/lib/format";

const config = {
  fitness_age: { label: "Fitness age", color: "var(--chart-2)" },
  chronological: { label: "Actual age", color: "var(--chart-1)" },
  achievable: { label: "Achievable", color: "var(--chart-3)" },
  morning: { label: "Morning readiness", color: "var(--chart-4)" },
  impact: { label: "Impact load", color: "var(--chart-2)" },
  tolerance: { label: "Tolerance", color: "var(--chart-1)" },
  steps: { label: "Weekly steps", color: "var(--chart-1)" },
  stress: { label: "Avg stress", color: "var(--chart-5)" },
  weight: { label: "Weight (kg)", color: "var(--chart-3)" },
} satisfies ChartConfig;

export function BodyView({
  fitnessAge,
  morning,
  tolerance,
  weekly,
  composition,
  ftp,
  device,
}: {
  fitnessAge: FitnessAge[];
  morning: MorningReadiness[];
  tolerance: RunningTolerance[];
  weekly: WeeklySummary[];
  composition: BodyComposition[];
  ftp: { functional_threshold_power: number | null; sport: string | null } | null;
  device: {
    product_display_name: string | null;
    firmware_version: string | null;
    time_format: string | null;
  } | null;
}) {
  const latestAge = fitnessAge.at(-1) ?? null;
  const latestMorning = morning.at(-1) ?? null;

  const ageSeries = fitnessAge.map((f) => ({
    date: shortDate(f.date),
    fitness_age: f.fitness_age,
    chronological: f.chronological_age,
    achievable: f.achievable_fitness_age,
  }));

  const morningSeries = morning.map((m) => ({
    date: shortDate(m.date),
    morning: m.score,
  }));

  const toleranceSeries = tolerance.map((t) => ({
    date: shortDate(t.date),
    impact: t.total_impact_load,
    tolerance: t.tolerance,
  }));

  const weeklySeries = weekly.map((w) => ({
    week: shortDate(w.week_start),
    steps: w.total_steps,
    stress: w.avg_stress,
  }));

  const weightSeries = composition.map((c) => ({
    date: shortDate(c.date),
    weight: c.weight_g != null ? Math.round((c.weight_g / 1000) * 10) / 10 : null,
  }));

  const ageGap =
    latestAge?.fitness_age != null && latestAge.chronological_age != null
      ? latestAge.fitness_age - latestAge.chronological_age
      : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Fitness age"
          value={latestAge?.fitness_age != null ? latestAge.fitness_age.toFixed(1) : null}
          hint={
            ageGap != null
              ? `${ageGap > 0 ? "+" : ""}${ageGap.toFixed(1)} vs actual ${latestAge?.chronological_age}`
              : null
          }
        />
        <StatTile
          label="Morning readiness"
          value={latestMorning?.score}
          hint={latestMorning?.level?.replace(/_/g, " ").toLowerCase() ?? null}
        />
        <StatTile
          label="FTP"
          value={ftp?.functional_threshold_power}
          unit="W"
          hint={ftp?.sport?.toLowerCase() ?? null}
        />
        <StatTile
          label="Weight"
          value={weightSeries.at(-1)?.weight}
          unit="kg"
          hint={latestAge?.component_bmi != null ? `BMI ${latestAge.component_bmi}` : null}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Fitness age</CardTitle>
            <CardDescription>
              Against your actual age and Garmin&rsquo;s achievable target
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[220px] w-full">
              <ComposedChart data={ageSeries} margin={{ left: -20, right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line dataKey="fitness_age" stroke="var(--color-fitness_age)" strokeWidth={2} dot={false} connectNulls />
                <Line dataKey="chronological" stroke="var(--color-chronological)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
                <Line dataKey="achievable" stroke="var(--color-achievable)" strokeWidth={1.5} strokeDasharray="2 2" dot={false} connectNulls />
              </ComposedChart>
            </ChartContainer>
            {latestAge ? (
              <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                Garmin drives this from resting HR, BMI and vigorous activity. Your
                BMI component ({latestAge.component_bmi ?? "—"}) carries the most
                weight, so it moves only when a weigh-in does.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Morning readiness</CardTitle>
            <CardDescription>
              Measured at wake, before training clouds it
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[220px] w-full">
              <ComposedChart data={morningSeries} margin={{ left: -20, right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} width={40} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ReferenceLine y={50} stroke="var(--border)" strokeDasharray="3 3" />
                <Line dataKey="morning" stroke="var(--color-morning)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Running impact load</CardTitle>
            <CardDescription>
              Cumulative impact against what your body tolerates
            </CardDescription>
          </CardHeader>
          <CardContent>
            {toleranceSeries.length < 2 ? (
              <NotEnoughData have={toleranceSeries.length} need={4} what="An impact-load trend" />
            ) : (
              <>
                <ChartContainer config={config} className="h-[220px] w-full">
                  <ComposedChart data={toleranceSeries} margin={{ left: -20, right: 8 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} width={52} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="impact" fill="var(--color-impact)" radius={[3, 3, 0, 0]} />
                    <Line dataKey="tolerance" stroke="var(--color-tolerance)" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
                  </ComposedChart>
                </ChartContainer>
                <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                  Impact staying below the tolerance line means your running volume
                  is within what your body currently absorbs.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Weekly volume</CardTitle>
            <CardDescription>Garmin&rsquo;s own weekly rollups</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[220px] w-full">
              <ComposedChart data={weeklySeries} margin={{ left: -20, right: -10 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis yAxisId="s" tickLine={false} axisLine={false} fontSize={11} width={52} />
                <YAxis yAxisId="st" orientation="right" domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} width={36} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar yAxisId="s" dataKey="steps" fill="var(--color-steps)" radius={[3, 3, 0, 0]} />
                <Line yAxisId="st" dataKey="stress" stroke="var(--color-stress)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {weightSeries.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Weight</CardTitle>
            <CardDescription>{weightSeries.length} weigh-ins recorded</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[180px] w-full">
              <ComposedChart data={weightSeries} margin={{ left: -20, right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} width={44} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line dataKey="weight" stroke="var(--color-weight)" strokeWidth={2} dot={{ r: 4 }} connectNulls />
              </ComposedChart>
            </ChartContainer>
          </CardContent>
        </Card>
      ) : null}

      {device ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Device</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            <Badge variant="secondary">{device.product_display_name ?? "—"}</Badge>
            {device.firmware_version ? (
              <Badge variant="outline">firmware {device.firmware_version}</Badge>
            ) : null}
            {device.time_format ? (
              <Badge variant="outline">
                {device.time_format.replace(/_/g, " ").replace("time ", "")}
              </Badge>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
