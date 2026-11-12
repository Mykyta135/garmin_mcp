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
import type { BandSummary, BandTrend, Segment } from "@/lib/segments";

const config = {
  speed_kmh: { label: "Speed (km/h)", color: "var(--chart-1)" },
  avg_hr: { label: "Heart rate", color: "var(--chart-2)" },
  efficiency: { label: "Efficiency", color: "var(--chart-3)" },
  segments: { label: "Segments", color: "var(--chart-4)" },
} satisfies ChartConfig;

export function SegmentsView({
  segments,
  bands,
  trends,
}: {
  segments: Segment[];
  bands: BandSummary[];
  trends: BandTrend[];
}) {
  if (segments.length < 20) {
    return <NotEnoughData have={segments.length} need={20} what="Segment analysis" />;
  }

  const scatter = segments.map((s) => ({
    grade: Math.round(s.grade * 1000) / 10,
    speed: s.speed_kmh,
    hr: s.avg_hr,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Segments" value={segments.length} hint="60s blocks" />
        <StatTile
          label="Rides analysed"
          value={new Set(segments.map((s) => s.activity_id)).size}
        />
        <StatTile
          label="Mean HR"
          value={Math.round(segments.reduce((s, g) => s + g.avg_hr, 0) / segments.length)}
          unit="bpm"
        />
        <StatTile
          label="Mean speed"
          value={(segments.reduce((s, g) => s + g.speed_kmh, 0) / segments.length).toFixed(1)}
          unit="km/h"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Why segments instead of whole rides</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Comparing six whole rides once produced an apparent{" "}
            <strong className="text-foreground">+21.5% fitness gain</strong> — which
            turned out to be an artefact: the earliest rides in that sample happened
            to be the slowest, so the figure measured sort order, not form. Cutting
            every ride into fixed 60-second blocks and grouping by gradient turns 6
            data points into {segments.length}, and the trend disappears. Each block
            uses only measured values — speed, heart rate, body mass — with no
            guessed aerodynamic constants.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Speed and heart rate by gradient</CardTitle>
          <CardDescription>
            Monotonic, as physiology demands — a sanity check on the segmentation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gradient band</TableHead>
                  <TableHead className="text-right">Segments</TableHead>
                  <TableHead className="text-right">Speed</TableHead>
                  <TableHead className="text-right">Avg HR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bands.map((b) => (
                  <TableRow key={b.band}>
                    <TableCell className="font-medium">{b.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.segments}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.speed_kmh} km/h</TableCell>
                    <TableCell className="text-right tabular-nums">{b.avg_hr}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Every segment</CardTitle>
          <CardDescription>Gradient against speed, coloured by nothing — just the spread</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="h-[260px] w-full">
            <ScatterChart margin={{ left: -20, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="grade"
                name="Gradient"
                unit="%"
                tickLine={false}
                axisLine={false}
                fontSize={11}
              />
              <YAxis
                type="number"
                dataKey="speed"
                name="Speed"
                unit=" km/h"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={44}
              />
              <ZAxis range={[20, 20]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Scatter data={scatter} fill="var(--color-speed_kmh)" fillOpacity={0.5} />
            </ScatterChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {trends.map((t) => (
        <Card key={t.band}>
          <CardHeader>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <CardTitle>{t.label}</CardTitle>
              <Badge variant={t.meaningful ? "default" : "outline"}>
                {t.meaningful ? "real trend" : "no trend — noise"}
              </Badge>
            </div>
            <CardDescription>
              {t.segments} segments · r² = {t.r_squared.toFixed(3)}
              {t.change_pct != null ? ` · week-to-week ${t.change_pct > 0 ? "+" : ""}${t.change_pct}%` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="h-[200px] w-full">
              <ComposedChart data={t.weeks} margin={{ left: -20, right: -10 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis yAxisId="e" tickLine={false} axisLine={false} fontSize={11} width={52} />
                <YAxis yAxisId="n" orientation="right" tickLine={false} axisLine={false} fontSize={11} width={36} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar yAxisId="n" dataKey="segments" fill="var(--color-segments)" fillOpacity={0.25} radius={[3, 3, 0, 0]} />
                <Line yAxisId="e" dataKey="efficiency" stroke="var(--color-efficiency)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ChartContainer>
            <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
              {t.meaningful ? (
                <>
                  r² of {t.r_squared.toFixed(3)} means time explains a real share of
                  the variance here, so this movement is worth reading.
                </>
              ) : (
                <>
                  r² of {t.r_squared.toFixed(3)} means time explains only{" "}
                  {Math.round(t.r_squared * 100)}% of the variation — the week-to-week
                  numbers move, but not in a direction. Treat this as flat.
                </>
              )}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
