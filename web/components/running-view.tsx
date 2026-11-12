"use client";

import {
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
  FormVerdict,
  GaitComparison,
  PaceConfound,
  RunMetrics,
} from "@/lib/running";
import { shortDate } from "@/lib/format";

const config = {
  gct: { label: "Ground contact (ms)", color: "var(--chart-2)" },
  vr: { label: "Vertical ratio (%)", color: "var(--chart-4)" },
  cadence: { label: "Cadence (spm)", color: "var(--chart-1)" },
  mpb: { label: "Metres per beat", color: "var(--chart-3)" },
  hr: { label: "Heart rate", color: "var(--chart-2)" },
} satisfies ChartConfig;

const STATUS_STYLE: Record<FormVerdict["status"], string> = {
  good: "text-[var(--chart-3)]",
  borderline: "text-[var(--chart-5)]",
  work: "text-[var(--chart-2)]",
};

export function RunningView({
  runs,
  verdicts,
  confounds,
  gait,
  cadenceTargetSpm,
  heightCm,
  paceMatched,
}: {
  runs: RunMetrics[];
  verdicts: FormVerdict[];
  confounds: PaceConfound[];
  gait: GaitComparison[];
  cadenceTargetSpm: number;
  heightCm: number;
  paceMatched: Array<{
    band_kmh: number;
    runs: number;
    change_pct: number | null;
    comparable: boolean;
  }>;
}) {
  if (runs.length === 0) {
    return (
      <NotEnoughData have={0} need={2} what="Running economy analysis" />
    );
  }

  const series = runs.map((r) => ({
    date: shortDate(r.date),
    gct: r.ground_contact_ms,
    vr: r.vertical_ratio,
    cadence: r.cadence_spm,
    mpb: r.metres_per_beat,
    pace: r.pace_min_km,
  }));

  const scatter = runs.map((r) => ({
    speed: r.avg_speed_kmh,
    mpb: r.metres_per_beat,
    date: shortDate(r.date),
  }));

  const mpbConfound = confounds.find((c) => c.metric === "metres_per_beat");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {verdicts.slice(0, 4).map((v) => (
          <StatTile
            key={v.key}
            label={v.label}
            value={v.value}
            unit={v.unit}
            hint={v.target}
            className={STATUS_STYLE[v.status]}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Form against height-scaled targets</CardTitle>
          <CardDescription>
            Norms adjusted for {heightCm} cm — not the usual 170–180 spm advice
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {verdicts.map((v) => (
            <div key={v.key} className="border-b pb-3 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{v.label}</span>
                <span className="flex items-baseline gap-2">
                  <span className={`text-lg font-semibold tabular-nums ${STATUS_STYLE[v.status]}`}>
                    {v.value}
                    <span className="text-muted-foreground ml-1 text-xs font-normal">{v.unit}</span>
                  </span>
                  <Badge
                    variant={
                      v.status === "good" ? "default" : v.status === "borderline" ? "secondary" : "outline"
                    }
                  >
                    {v.status === "good" ? "good" : v.status === "borderline" ? "borderline" : "work on this"}
                  </Badge>
                </span>
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                target {v.target}
              </div>
              <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">{v.note}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ground contact &amp; vertical ratio</CardTitle>
            <CardDescription>
              The two metrics that do not simply track pace
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[220px] w-full">
              <ComposedChart data={series} margin={{ left: -20, right: -10 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis yAxisId="l" tickLine={false} axisLine={false} fontSize={11} width={44} />
                <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} fontSize={11} width={40} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line yAxisId="l" dataKey="gct" stroke="var(--color-gct)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line yAxisId="r" dataKey="vr" stroke="var(--color-vr)" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Why &ldquo;economy&rdquo; is mostly pace</CardTitle>
            <CardDescription>
              Metres per heartbeat against speed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[220px] w-full">
              <ScatterChart margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="speed"
                  name="Speed"
                  unit=" km/h"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  domain={["dataMin - 0.5", "dataMax + 0.5"]}
                />
                <YAxis
                  type="number"
                  dataKey="mpb"
                  name="m/beat"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={44}
                />
                <ZAxis range={[70, 70]} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Scatter data={scatter} fill="var(--color-mpb)" />
              </ScatterChart>
            </ChartContainer>
            {mpbConfound ? (
              <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                r = <strong className="text-foreground">{mpbConfound.r.toFixed(2)}</strong>{" "}
                against speed. Nearly all of this metric is just how fast you ran,
                so a fall in it across runs means those runs were slower — not that
                you became less efficient. Economy has to be compared within a pace
                band, which is the table below.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How much is each metric just pace?</CardTitle>
          <CardDescription>
            Correlation with speed — high means the metric carries little technique signal
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">r vs speed</TableHead>
                  <TableHead>Reads as</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {confounds.map((c) => (
                  <TableRow key={c.metric}>
                    <TableCell className="font-medium">{c.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.r.toFixed(3)}</TableCell>
                    <TableCell>
                      {c.confounded ? (
                        <Badge variant="outline">mostly pace</Badge>
                      ) : (
                        <Badge>real technique signal</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Economy within matched pace bands</CardTitle>
          <CardDescription>
            The honest comparison — only runs at similar speed
          </CardDescription>
        </CardHeader>
        <CardContent>
          {paceMatched.filter((b) => b.comparable).length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No two runs fall in the same pace band yet. Economy cannot be
              compared across different speeds, so this fills in once you repeat a
              pace. Running the same route at the same effort twice is what makes
              this measurable.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pace band</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paceMatched.map((b) => (
                    <TableRow key={b.band_kmh}>
                      <TableCell className="tabular-nums">~{b.band_kmh} km/h</TableCell>
                      <TableCell className="text-right tabular-nums">{b.runs}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.change_pct != null ? `${b.change_pct > 0 ? "+" : ""}${b.change_pct}%` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {gait.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Cadence across gaits</CardTitle>
            <CardDescription>
              Walking and rucking record no running dynamics, but their turnover still matters
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Activity</TableHead>
                    <TableHead className="text-right">Speed</TableHead>
                    <TableHead className="text-right">Cadence</TableHead>
                    <TableHead className="text-right">Avg HR</TableHead>
                    <TableHead>Dynamics</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gait.map((g) => (
                    <TableRow key={g.type_key}>
                      <TableCell className="font-medium">{g.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{g.speed_kmh} km/h</TableCell>
                      <TableCell className="text-right tabular-nums">{g.cadence_spm} spm</TableCell>
                      <TableCell className="text-right tabular-nums">{g.avg_hr}</TableCell>
                      <TableCell>
                        {g.has_dynamics ? (
                          <Badge variant="secondary">recorded</Badge>
                        ) : (
                          <Badge variant="outline">not recorded</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
              Rucking runs at near-running cadence while walking is far slower in
              turnover. That makes a loaded walk a low-impact way to train the same
              fast-turnover pattern as running — useful while carrying fatigue,
              since it adds running specificity without the landing forces.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Every run</CardTitle>
          <CardDescription>{runs.length} runs with dynamics recorded</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Dist</TableHead>
                  <TableHead className="text-right">Pace</TableHead>
                  <TableHead className="text-right">HR</TableHead>
                  <TableHead className="text-right">Cadence</TableHead>
                  <TableHead className="text-right">Stride</TableHead>
                  <TableHead className="text-right">GCT</TableHead>
                  <TableHead className="text-right">VR</TableHead>
                  <TableHead className="text-right">Power</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.activity_id}>
                    <TableCell className="whitespace-nowrap">
                      <a href={`/activity/${r.activity_id}`} className="hover:underline underline-offset-4">
                        {shortDate(r.date)}
                      </a>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.distance_km} km</TableCell>
                    <TableCell className="text-right tabular-nums">{r.pace_min_km.toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.avg_hr}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        r.cadence_spm >= cadenceTargetSpm * 0.95 ? "text-[var(--chart-3)]" : ""
                      }`}
                    >
                      {r.cadence_spm}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.stride_cm}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        r.ground_contact_ms > 305 ? "text-[var(--chart-2)]" : ""
                      }`}
                    >
                      {r.ground_contact_ms}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.vertical_ratio}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.avg_power_w}W</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
