"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
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
import { NotEnoughData } from "@/components/empty-state";
import type {
  ImpactLoad,
  PerformanceRun,
  SportEfficiency,
  StrokeSummary,
  SwimLength,
} from "@/lib/experiments";
import { shortDate, titleize } from "@/lib/format";

const config = {
  load_per_hour: { label: "Load per hour", color: "var(--chart-2)" },
  pct_hr_max: { label: "% of max HR", color: "var(--chart-1)" },
  swolf: { label: "SWOLF", color: "var(--chart-2)" },
  mps: { label: "Metres per stroke", color: "var(--chart-3)" },
  start_value: { label: "Start", color: "var(--chart-1)" },
  end_value: { label: "End", color: "var(--chart-2)" },
  duration: { label: "Seconds", color: "var(--chart-5)" },
} satisfies ChartConfig;

export function ExperimentsView({
  sports,
  performance,
  impact,
  strokes,
  lengths,
}: {
  sports: SportEfficiency[];
  performance: PerformanceRun[];
  impact: ImpactLoad[];
  strokes: StrokeSummary[];
  lengths: SwimLength[];
}) {
  const freestyle = strokes.find((s) => s.stroke === "FREESTYLE");
  const breast = strokes.find((s) => s.stroke === "BREASTSTROKE");
  const drill = strokes.find((s) => s.stroke === "DRILL");
  const best = sports[0];

  // Fatigue within a session needs a session that actually has SWOLF across
  // several lengths. The most recent swim may be entirely drills (no stroke
  // count by design), so pick the session with the most SWOLF lengths rather
  // than simply the newest -- otherwise this card silently disappears.
  const swolfLengths = lengths.filter((l) => l.swolf != null);
  const byDate = new Map<string, SwimLength[]>();
  for (const l of swolfLengths) {
    if (!byDate.has(l.date)) byDate.set(l.date, []);
    byDate.get(l.date)!.push(l);
  }
  const bestSession = [...byDate.entries()].sort(
    (a, b) => b[1].length - a[1].length || b[0].localeCompare(a[0]),
  )[0];
  const latestSwolfDate = bestSession?.[0] ?? null;
  const sessionLengths = bestSession?.[1] ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Best load/hour"
          value={best ? best.label : null}
          hint={best ? `${best.load_per_hour} per hour` : null}
        />
        <StatTile
          label="Freestyle SWOLF"
          value={freestyle?.avg_swolf}
          hint={freestyle ? `${freestyle.metres_per_stroke} m per stroke` : null}
        />
        <StatTile
          label="Breaststroke SWOLF"
          value={breast?.avg_swolf}
          hint={breast ? `${breast.metres_per_stroke} m per stroke` : null}
        />
        <StatTile
          label="Running impact"
          value={impact.find((i) => i.type_key === "running")?.mean_factor}
          hint="load factor, outdoor running"
        />
      </div>

      {/* --- cross-sport efficiency --- */}
      <Card>
        <CardHeader>
          <CardTitle>Which sport gives the most per hour?</CardTitle>
          <CardDescription>
            Training load produced per hour against the heart-rate cost of producing it
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="h-[240px] w-full">
            <ComposedChart data={sports} margin={{ left: -20, right: -10 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={10} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis yAxisId="l" tickLine={false} axisLine={false} fontSize={11} width={44} />
              <YAxis yAxisId="p" orientation="right" domain={[50, 90]} tickLine={false} axisLine={false} fontSize={11} width={40} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar yAxisId="l" dataKey="load_per_hour" fill="var(--color-load_per_hour)" radius={[3, 3, 0, 0]} />
              <Line yAxisId="p" dataKey="pct_hr_max" stroke="var(--color-pct_hr_max)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ChartContainer>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sport</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Avg HR</TableHead>
                  <TableHead className="text-right">% max HR</TableHead>
                  <TableHead className="text-right">Load/h</TableHead>
                  <TableHead className="text-right">kcal/h</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sports.map((s) => (
                  <TableRow key={s.type_key}>
                    <TableCell className="font-medium">{s.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.hours}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.avg_hr}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.pct_hr_max}%</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{s.load_per_hour}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.kcal_per_hour}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
            Load per hour is the stimulus; % of max heart rate is what it costs.
            A sport high on the first and moderate on the second is where base
            fitness is cheapest to build. Max HR here is the highest actually
            recorded, not an age formula.
          </p>
        </CardContent>
      </Card>

      {/* --- swimming --- */}
      <Card>
        <CardHeader>
          <CardTitle>Swimming efficiency by stroke</CardTitle>
          <CardDescription>
            SWOLF = seconds + strokes for one length. Lower is better.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {strokes.length === 0 ? (
            <NotEnoughData have={0} need={1} what="Swim stroke analysis" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Stroke</TableHead>
                      <TableHead className="text-right">Lengths</TableHead>
                      <TableHead className="text-right">SWOLF</TableHead>
                      <TableHead className="text-right">Seconds</TableHead>
                      <TableHead className="text-right">Strokes</TableHead>
                      <TableHead className="text-right">m/stroke</TableHead>
                      <TableHead className="text-right">HR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {strokes.map((s) => (
                      <TableRow key={s.stroke}>
                        <TableCell className="font-medium">
                          {titleize(s.stroke)}
                          {s.with_swolf === 0 ? (
                            <Badge variant="outline" className="ml-2">no SWOLF</Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{s.lengths}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {s.avg_swolf ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{s.avg_seconds}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.avg_strokes ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.metres_per_stroke ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.avg_hr}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {drill ? (
                <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                  <strong className="text-foreground">Why drill sets show no SWOLF.</strong>{" "}
                  Garmin counts no strokes during a drill — the stroke pattern is
                  deliberately abnormal (one arm, kickboard, paddles), so SWOLF
                  would be meaningless. {drill.lengths} of your lengths are drills.
                  This is the watch working correctly, not a recording fault: swim
                  in Freestyle or Breaststroke mode if you want SWOLF.
                </p>
              ) : null}
              {freestyle && breast ? (
                <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                  Your freestyle travels{" "}
                  <strong className="text-foreground">
                    {(freestyle.metres_per_stroke! / breast.metres_per_stroke!).toFixed(2)}×
                  </strong>{" "}
                  further per stroke than your breaststroke, at a similar heart
                  rate ({freestyle.avg_hr} vs {breast.avg_hr} bpm). Freestyle is
                  the more economical stroke for you by a clear margin.
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {sessionLengths.length > 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Technique decay within a session</CardTitle>
            <CardDescription>
              {latestSwolfDate} — SWOLF per length as fatigue accumulates
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[220px] w-full">
              <ComposedChart
                data={sessionLengths.map((l) => ({
                  idx: `#${l.length_index}`,
                  swolf: l.swolf,
                  mps: l.metres_per_stroke,
                  hr: l.avg_hr,
                }))}
                margin={{ left: -20, right: -10 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="idx" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis yAxisId="s" tickLine={false} axisLine={false} fontSize={11} width={44} />
                <YAxis yAxisId="m" orientation="right" tickLine={false} axisLine={false} fontSize={11} width={40} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar yAxisId="s" dataKey="swolf" fill="var(--color-swolf)" radius={[3, 3, 0, 0]} />
                <Line yAxisId="m" dataKey="mps" stroke="var(--color-mps)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ChartContainer>
            <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
              Rising SWOLF and falling distance-per-stroke across a session mean
              technique is degrading, not that you are swimming harder. Connect
              shows these per length but never as a within-session trend.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* --- performance condition --- */}
      <Card>
        <CardHeader>
          <CardTitle>Performance condition</CardTitle>
          <CardDescription>
            Garmin&rsquo;s live assessment — start value tracks freshness, drift tracks fade
          </CardDescription>
        </CardHeader>
        <CardContent>
          {performance.length < 2 ? (
            <NotEnoughData have={performance.length} need={2} what="A performance-condition trend" />
          ) : (
            <>
              <ChartContainer config={config} className="h-[220px] w-full">
                <ComposedChart
                  data={performance.map((p) => ({
                    date: shortDate(p.date),
                    start_value: p.start_value,
                    end_value: p.end_value,
                  }))}
                  margin={{ left: -20, right: 8 }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line dataKey="start_value" stroke="var(--color-start_value)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line dataKey="end_value" stroke="var(--color-end_value)" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} connectNulls />
                </ComposedChart>
              </ChartContainer>
              <div className="mt-3 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Start</TableHead>
                      <TableHead className="text-right">End</TableHead>
                      <TableHead className="text-right">Drift</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {performance.map((p) => (
                      <TableRow key={p.activity_id}>
                        <TableCell>
                          <a href={`/activity/${p.activity_id}`} className="hover:underline underline-offset-4">
                            {shortDate(p.date)}
                          </a>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.start_value}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.end_value}</TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            p.drift < -2 ? "text-[var(--chart-2)]" : ""
                          }`}
                        >
                          {p.drift > 0 ? "+" : ""}
                          {p.drift}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                A starting value trending toward zero across sessions means you
                begin each run less fresh than before — exactly what accumulated
                fatigue looks like. Negative drift within a session is normal;
                large negative drift on an easy run is not.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* --- impact load --- */}
      {impact.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Impact load</CardTitle>
            <CardDescription>
              Landing force, recorded only while running — an injury-risk proxy
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Activity</TableHead>
                    <TableHead className="text-right">Samples</TableHead>
                    <TableHead className="text-right">Mean factor</TableHead>
                    <TableHead className="text-right">Peak</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {impact.map((i) => (
                    <TableRow key={i.type_key}>
                      <TableCell className="font-medium">{i.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.samples}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.mean_factor}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.max_factor}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
              Outdoor running carries roughly double the impact factor of the
              treadmill, which is the surface difference. Cycling and swimming
              record none at all — which is exactly why they build the engine
              without building tendon tolerance for running.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
