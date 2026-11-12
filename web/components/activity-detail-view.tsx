"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
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
import type {
  Activity,
  ExerciseSet,
  HrZone,
  Lap,
  Sample,
  Weather,
} from "@/lib/db";
import { duration, km, titleize } from "@/lib/format";

const config = {
  heart_rate: { label: "Heart rate", color: "var(--chart-2)" },
  altitude: { label: "Altitude", color: "var(--chart-3)" },
  speed: { label: "Speed", color: "var(--chart-1)" },
  cadence: { label: "Cadence", color: "var(--chart-4)" },
  power: { label: "Power", color: "var(--chart-5)" },
  minutes: { label: "Minutes", color: "var(--chart-2)" },
} satisfies ChartConfig;

const ZONE_NAMES = ["", "Warm up", "Easy", "Aerobic", "Threshold", "Maximum"];

export function ActivityDetailView({
  activity,
  laps,
  zones,
  weather,
  sets,
  samples,
}: {
  activity: Activity;
  laps: Lap[];
  zones: HrZone[];
  weather: Weather | null;
  sets: ExerciseSet[];
  samples: Sample[];
}) {
  const stream = samples.map((s) => ({
    t: Math.round((s.elapsed_s ?? 0) / 60),
    heart_rate: s.heart_rate,
    altitude: s.altitude,
    // m/s reads as noise on a shared axis; km/h is the unit people think in.
    speed: s.speed != null ? Math.round(s.speed * 3.6 * 10) / 10 : null,
    cadence: s.cadence,
    power: s.power,
  }));

  const zoneData = zones.map((z) => ({
    zone: `Z${z.zone_number}`,
    label: ZONE_NAMES[z.zone_number] ?? `Zone ${z.zone_number}`,
    minutes: Math.round(((z.secs_in_zone ?? 0) / 60) * 10) / 10,
    boundary: z.zone_low_boundary,
  }));

  // Each metric is checked independently: a bike with no cadence sensor still
  // has speed, and swimming has neither. Assuming they travel together hides
  // good data behind a missing sibling.
  const hasPower = stream.some((s) => s.power != null);
  const hasAltitude = stream.some((s) => s.altitude != null);
  const hasSpeed = stream.some((s) => s.speed != null);
  const hasCadence = stream.some((s) => s.cadence != null);
  const motionParts = [
    hasSpeed && "Speed",
    hasCadence && "cadence",
    hasPower && "power",
  ].filter(Boolean) as string[];
  const isDistanceSport = (activity.distance_m ?? 0) > 100;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Duration" value={duration(activity.duration_s)} />
        <StatTile
          label="Distance"
          value={isDistanceSport ? km(activity.distance_m) : null}
        />
        <StatTile
          label="Avg / max HR"
          value={
            activity.avg_hr
              ? `${Math.round(activity.avg_hr)} / ${Math.round(activity.max_hr ?? 0)}`
              : null
          }
          unit="bpm"
        />
        <StatTile
          label="Training load"
          value={activity.training_load ? Math.round(activity.training_load) : null}
          hint={
            activity.aerobic_te
              ? `aerobic TE ${activity.aerobic_te.toFixed(1)}`
              : null
          }
        />
      </div>

      {weather ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Conditions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            <Badge variant="secondary">{weather.weather_type ?? "—"}</Badge>
            {weather.temp != null ? (
              <Badge variant="outline">{weather.temp}°F feels {weather.apparent_temp}°F</Badge>
            ) : null}
            {weather.relative_humidity != null ? (
              <Badge variant="outline">{weather.relative_humidity}% humidity</Badge>
            ) : null}
            {weather.wind_speed != null ? (
              <Badge variant="outline">
                wind {weather.wind_speed} {weather.wind_compass ?? ""}
              </Badge>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {stream.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Heart rate{hasAltitude ? " & elevation" : ""}</CardTitle>
            <CardDescription>
              {samples.length} samples over {Math.round((activity.duration_s ?? 0) / 60)} minutes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[260px] w-full">
              <ComposedChart data={stream} margin={{ left: -20, right: -10 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="t"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  unit="m"
                />
                <YAxis yAxisId="hr" tickLine={false} axisLine={false} fontSize={11} width={44} />
                {hasAltitude ? (
                  <YAxis yAxisId="alt" orientation="right" tickLine={false} axisLine={false} fontSize={11} width={44} />
                ) : null}
                <ChartTooltip content={<ChartTooltipContent />} />
                {hasAltitude ? (
                  <Area
                    yAxisId="alt"
                    dataKey="altitude"
                    stroke="var(--color-altitude)"
                    fill="var(--color-altitude)"
                    fillOpacity={0.12}
                    strokeWidth={1}
                    connectNulls
                  />
                ) : null}
                <Line
                  yAxisId="hr"
                  dataKey="heart_rate"
                  stroke="var(--color-heart_rate)"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                />
              </ComposedChart>
            </ChartContainer>
          </CardContent>
        </Card>
      ) : null}

      {hasSpeed || hasCadence || hasPower ? (
        <Card>
          <CardHeader>
            <CardTitle>{motionParts.join(", ").replace(/, ([^,]*)$/, " & $1")}</CardTitle>
            <CardDescription>
              {hasSpeed ? "Speed in km/h" : "Per-sample readings"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[220px] w-full">
              <ComposedChart data={stream} margin={{ left: -20, right: -10 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="t" tickLine={false} axisLine={false} fontSize={11} unit="m" />
                <YAxis yAxisId="l" tickLine={false} axisLine={false} fontSize={11} width={44} />
                <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} fontSize={11} width={44} />
                <ChartTooltip content={<ChartTooltipContent />} />
                {hasSpeed ? (
                  <Line yAxisId="l" dataKey="speed" stroke="var(--color-speed)" strokeWidth={1.5} dot={false} connectNulls />
                ) : null}
                {hasCadence ? (
                  <Line yAxisId="r" dataKey="cadence" stroke="var(--color-cadence)" strokeWidth={1} dot={false} connectNulls />
                ) : null}
                {hasPower ? (
                  <Line yAxisId="r" dataKey="power" stroke="var(--color-power)" strokeWidth={1} dot={false} connectNulls />
                ) : null}
              </ComposedChart>
            </ChartContainer>
          </CardContent>
        </Card>
      ) : null}

      {zoneData.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Time in heart-rate zones</CardTitle>
            <CardDescription>Minutes per zone for this activity</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[200px] w-full">
              <BarChart data={zoneData} margin={{ left: -20, right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="zone" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} width={44} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="minutes" fill="var(--color-minutes)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
            <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {zoneData.map((z) => (
                <span key={z.zone}>
                  <strong className="text-foreground">{z.zone}</strong> {z.label}
                  {z.boundary ? ` ≥${z.boundary}bpm` : ""} · {z.minutes}m
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {sets.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Exercise sets</CardTitle>
            <CardDescription>{sets.length} sets recorded</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Exercise</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Reps</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="text-right">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sets.map((s) => (
                    <TableRow key={s.set_index}>
                      <TableCell className="text-muted-foreground">{s.set_index + 1}</TableCell>
                      <TableCell className="font-medium">
                        {titleize(s.exercise_name ?? s.exercise_category)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.set_type === "ACTIVE" ? "secondary" : "outline"}>
                          {titleize(s.set_type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.repetition_count ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.weight_g ? `${Math.round(s.weight_g / 1000)} kg` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {duration(s.duration_s)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {laps.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Laps</CardTitle>
            <CardDescription>{laps.length} laps</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lap</TableHead>
                    <TableHead className="text-right">Distance</TableHead>
                    <TableHead className="text-right">Time</TableHead>
                    <TableHead className="text-right">Avg HR</TableHead>
                    <TableHead className="text-right">Climb</TableHead>
                    {laps.some((l) => l.grit != null) ? (
                      <TableHead className="text-right">Grit / Flow</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {laps.slice(0, 40).map((l) => (
                    <TableRow key={l.lap_index}>
                      <TableCell>{l.lap_index}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.distance_m ? km(l.distance_m) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {duration(l.duration_s)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.avg_hr ? Math.round(l.avg_hr) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.elevation_gain != null ? `${Math.round(l.elevation_gain)}m` : "—"}
                      </TableCell>
                      {laps.some((x) => x.grit != null) ? (
                        <TableCell className="text-right tabular-nums">
                          {l.grit != null
                            ? `${l.grit.toFixed(1)} / ${(l.avg_flow ?? 0).toFixed(1)}`
                            : "—"}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
