"use client";

import { useMemo, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NotEnoughData } from "@/components/empty-state";
import type { PairResult } from "@/lib/correlate";

/**
 * Ranked correlation findings across every metric pair and lag.
 *
 * Ranked on q (FDR-adjusted), not r: with thousands of hypotheses the largest
 * r is usually the noisiest small-sample pair, not the strongest real effect.
 */
export function MatrixView({
  results,
  totalTests,
  metricCount,
  maxPairs,
}: {
  results: PairResult[];
  totalTests: number;
  metricCount: number;
  maxPairs: number;
}) {
  const [showProvisional, setShowProvisional] = useState(true);
  const [lagFilter, setLagFilter] = useState<number | "all">("all");

  const filtered = useMemo(
    () =>
      results.filter(
        (r) =>
          (showProvisional || !r.provisional) &&
          (lagFilter === "all" || r.lag === lagFilter),
      ),
    [results, showProvisional, lagFilter],
  );

  if (results.length === 0) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Correlation matrix</CardTitle>
            <CardDescription>
              Every metric pair, at same-day and lagged offsets
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NotEnoughData
              have={maxPairs}
              need={12}
              what="A pairwise correlation matrix"
            />
            <p className="text-muted-foreground mt-3 text-xs">
              {metricCount} metrics are being tracked and will enter the matrix
              automatically once enough paired days exist. The sync is already
              collecting them — nothing to change here.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Correlation findings</CardTitle>
          <CardDescription>
            {totalTests.toLocaleString()} hypotheses tested across {metricCount}{" "}
            metrics. Ranked by FDR-adjusted q, not raw r.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(["all", 0, 1, 2] as const).map((l) => (
              <button
                key={String(l)}
                onClick={() => setLagFilter(l)}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  lagFilter === l
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "hover:bg-muted"
                }`}
              >
                {l === "all" ? "All lags" : l === 0 ? "Same day" : `+${l}d`}
              </button>
            ))}
            <button
              onClick={() => setShowProvisional((v) => !v)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                showProvisional ? "hover:bg-muted" : "bg-primary text-primary-foreground border-transparent"
              }`}
            >
              {showProvisional ? "Hide provisional" : "Showing solid only"}
            </button>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Relationship</TableHead>
                  <TableHead>Lag</TableHead>
                  <TableHead className="text-right">r</TableHead>
                  <TableHead className="text-right">n</TableHead>
                  <TableHead className="text-right">q</TableHead>
                  <TableHead>Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground text-center">
                      Nothing matches this filter
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.slice(0, 60).map((res) => (
                    <TableRow key={`${res.x}-${res.y}-${res.lag}`}>
                      <TableCell className="font-medium">
                        {res.xLabel}
                        <span className="text-muted-foreground mx-1.5">
                          {res.lag === 0 ? "↔" : "→"}
                        </span>
                        {res.yLabel}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {res.lag === 0 ? "same day" : `+${res.lag}d`}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium tabular-nums ${
                          res.r < 0 ? "text-[var(--chart-2)]" : "text-[var(--chart-1)]"
                        }`}
                      >
                        {res.r.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{res.n}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {res.q < 0.001 ? "<0.001" : res.q.toFixed(3)}
                      </TableCell>
                      <TableCell>
                        {res.q < 0.05 && !res.provisional ? (
                          <Badge>Holds up</Badge>
                        ) : res.q < 0.05 ? (
                          <Badge variant="secondary">Provisional</Badge>
                        ) : (
                          <Badge variant="outline">Not significant</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <p className="text-muted-foreground text-xs leading-relaxed">
            <strong className="text-foreground">How to read this.</strong> r is
            the correlation; q is the false-discovery-adjusted p-value, which
            accounts for testing thousands of pairs at once. &ldquo;Provisional&rdquo;
            means fewer than 21 paired days — real enough to note, not enough to
            act on. Consecutive days are not independent samples, so even a
            passing q overstates certainty. Nothing here shows causation: a
            lagged correlation says the numbers moved together, not that one
            caused the other.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
