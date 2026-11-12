import "server-only";

import { getDb } from "@/lib/db";

/**
 * Config-driven correlation engine.
 *
 * Add a metric to METRICS and it joins the matrix automatically — that is the
 * "scale" part. The statistics are the careful part: with a young dataset most
 * apparent correlations are noise, so every result carries its sample size,
 * and results below a floor are suppressed rather than rendered faintly.
 *
 * Three guards, in order of how often they matter here:
 *
 *  1. Sample floor. Pearson r on 8 points is meaningless; MIN_PAIRS drops it.
 *  2. Multiple comparisons. Testing ~40 metrics pairwise is ~800 hypotheses;
 *     at p<0.05 roughly 40 fire by chance. We report Benjamini-Hochberg
 *     q-values (FDR) alongside raw p, and the UI ranks on q.
 *  3. Autocorrelation. Consecutive days are not independent samples, so the
 *     effective n is below the raw pair count and p is optimistic even after
 *     FDR. Flagged in the UI rather than silently corrected — the honest fix
 *     needs more data, not a cleverer formula.
 */

export type MetricDef = {
  key: string;
  label: string;
  table: string;
  column: string;
  group: "recovery" | "sleep" | "load" | "activity" | "body" | "stress";
  /** Higher is better — used only for phrasing, never for the maths. */
  goodHigh?: boolean;
  unit?: string;
};

export const METRICS: MetricDef[] = [
  // recovery
  { key: "hrv", label: "HRV (overnight)", table: "hrv", column: "last_night_avg", group: "recovery", goodHigh: true, unit: "ms" },
  { key: "hrv_weekly", label: "HRV weekly avg", table: "hrv", column: "weekly_avg", group: "recovery", goodHigh: true, unit: "ms" },
  { key: "readiness", label: "Training readiness", table: "training_readiness", column: "score", group: "recovery", goodHigh: true },
  { key: "recovery_time", label: "Recovery time", table: "training_readiness", column: "recovery_time_min", group: "recovery", unit: "min" },
  { key: "rhr", label: "Resting HR", table: "daily_stats", column: "resting_heart_rate", group: "recovery", unit: "bpm" },
  { key: "rhr_7d", label: "Resting HR (7-day)", table: "wellness", column: "last7_avg_resting_hr", group: "recovery", unit: "bpm" },
  { key: "bb_charged", label: "Body Battery charged", table: "wellness", column: "bb_charged", group: "recovery", goodHigh: true },
  { key: "bb_drained", label: "Body Battery drained", table: "wellness", column: "bb_drained", group: "recovery" },
  { key: "bb_sleep", label: "BB gained in sleep", table: "wellness", column: "bb_during_sleep", group: "recovery", goodHigh: true },
  { key: "bb_wake", label: "BB at wake", table: "wellness", column: "bb_at_wake_time", group: "recovery", goodHigh: true },

  // sleep
  { key: "sleep_hours", label: "Sleep duration", table: "sleep", column: "sleep_seconds", group: "sleep", goodHigh: true, unit: "s" },
  { key: "deep_sleep", label: "Deep sleep", table: "sleep", column: "deep_seconds", group: "sleep", goodHigh: true, unit: "s" },
  { key: "rem_sleep", label: "REM sleep", table: "sleep", column: "rem_seconds", group: "sleep", goodHigh: true, unit: "s" },
  { key: "light_sleep", label: "Light sleep", table: "sleep", column: "light_seconds", group: "sleep", unit: "s" },
  { key: "awake_time", label: "Awake in bed", table: "sleep", column: "awake_seconds", group: "sleep", unit: "s" },
  { key: "awake_count", label: "Awakenings", table: "sleep", column: "awake_count", group: "sleep" },
  { key: "sleep_stress", label: "Sleep stress", table: "sleep", column: "avg_sleep_stress", group: "sleep" },
  { key: "sleep_spo2", label: "SpO2 in sleep", table: "spo2", column: "avg_sleep_spo2", group: "sleep", goodHigh: true, unit: "%" },
  { key: "sleep_resp", label: "Respiration in sleep", table: "respiration", column: "avg_sleep", group: "sleep", unit: "br/min" },

  // load
  { key: "ctl", label: "Fitness (CTL)", table: "training_load", column: "ctl", group: "load", goodHigh: true },
  { key: "atl", label: "Fatigue (ATL)", table: "training_load", column: "atl", group: "load" },
  { key: "tsb", label: "Form (TSB)", table: "training_load", column: "tsb", group: "load", goodHigh: true },
  { key: "acute_load", label: "Acute load", table: "training_readiness", column: "acute_load", group: "load" },
  { key: "vo2max", label: "VO2 max", table: "training_load", column: "vo2max", group: "load", goodHigh: true },

  // activity
  { key: "steps", label: "Steps", table: "daily_stats", column: "total_steps", group: "activity", goodHigh: true },
  { key: "distance", label: "Distance", table: "daily_stats", column: "total_distance_m", group: "activity", unit: "m" },
  { key: "active_cal", label: "Active calories", table: "daily_stats", column: "active_calories", group: "activity" },
  { key: "total_cal", label: "Total calories", table: "daily_stats", column: "total_calories", group: "activity" },
  { key: "floors", label: "Floors climbed", table: "wellness", column: "floors_ascended", group: "activity" },
  { key: "moderate_min", label: "Moderate intensity", table: "intensity_minutes", column: "moderate_minutes", group: "activity", unit: "min" },
  { key: "vigorous_min", label: "Vigorous intensity", table: "intensity_minutes", column: "vigorous_minutes", group: "activity", unit: "min" },
  { key: "active_sec", label: "Active time", table: "wellness", column: "active_seconds", group: "activity", unit: "s" },
  { key: "sedentary_sec", label: "Sedentary time", table: "wellness", column: "sedentary_seconds", group: "activity", unit: "s" },

  // stress
  { key: "avg_stress", label: "Average stress", table: "daily_stats", column: "avg_stress", group: "stress" },
  { key: "max_stress", label: "Peak stress", table: "daily_stats", column: "max_stress", group: "stress" },
  { key: "high_stress_dur", label: "High-stress time", table: "wellness", column: "high_stress_duration", group: "stress", unit: "s" },
  { key: "rest_stress_dur", label: "Restful time", table: "wellness", column: "rest_stress_duration", group: "stress", goodHigh: true, unit: "s" },
  { key: "stress_pct", label: "Stress %", table: "wellness", column: "stress_percentage", group: "stress", unit: "%" },

  // body
  { key: "weight", label: "Weight", table: "weight", column: "weight_g", group: "body", unit: "g" },
  { key: "fitness_age", label: "Fitness age", table: "fitness_age", column: "fitness_age", group: "body" },
  { key: "hydration", label: "Hydration", table: "hydration", column: "value_ml", group: "body", goodHigh: true, unit: "ml" },
  { key: "sweat_loss", label: "Sweat loss", table: "hydration", column: "sweat_loss_ml", group: "body", unit: "ml" },
];

/** Below this many paired days a correlation is not reported at all. */
export const MIN_PAIRS = 12;
/** Below this it is reported but flagged as provisional. */
export const SOLID_PAIRS = 21;

export type Series = Record<string, Map<string, number>>;

/** One column per metric, keyed by date. One query per table, not per metric. */
export function loadSeries(days = 365): Series {
  const db = getDb();
  const out: Series = {};
  const byTable = new Map<string, MetricDef[]>();
  for (const m of METRICS) {
    if (!byTable.has(m.table)) byTable.set(m.table, []);
    byTable.get(m.table)!.push(m);
  }

  for (const [table, metrics] of byTable) {
    let rows: Array<Record<string, unknown>>;
    try {
      const cols = metrics.map((m) => `"${m.column}"`).join(", ");
      rows = db
        .prepare(
          `SELECT date, ${cols} FROM "${table}"
            WHERE date >= date((SELECT MAX(date) FROM daily_stats), '-${days - 1} days')
            ORDER BY date`,
        )
        .all() as Array<Record<string, unknown>>;
    } catch {
      // A table that doesn't exist yet (schema added, sync not yet re-run)
      // should degrade to "no data", not crash the page.
      continue;
    }
    for (const m of metrics) {
      const series = new Map<string, number>();
      for (const row of rows) {
        const v = row[m.column];
        if (typeof v === "number" && Number.isFinite(v)) {
          series.set(row.date as string, v);
        }
      }
      out[m.key] = series;
    }
  }
  return out;
}

export type PairResult = {
  x: string;
  y: string;
  xLabel: string;
  yLabel: string;
  lag: number;
  r: number;
  n: number;
  p: number;
  q: number;
  provisional: boolean;
};

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function pearsonRaw(pairs: Array<[number, number]>): number | null {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? null : num / den;
}

/**
 * Two-sided p for Pearson r via the t approximation, t = r*sqrt((n-2)/(1-r^2)).
 * Uses a continued-fraction incomplete beta — no dependency needed.
 */
function pValue(r: number, n: number): number {
  if (n < 3) return 1;
  const r2 = Math.min(Math.abs(r), 0.999999);
  const df = n - 2;
  const t2 = (r2 * r2 * df) / (1 - r2 * r2);
  return betaInc(df / (df + t2), df / 2, 0.5);
}

function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta =
    lgamma(a) + lgamma(b) - lgamma(a + b);
  const front =
    Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  let f = 1;
  let c = 1;
  let d = 0;
  for (let i = 0; i <= 200; i++) {
    const m = Math.floor(i / 2);
    let numerator: number;
    if (i === 0) numerator = 1;
    else if (i % 2 === 0)
      numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else
      numerator =
        (-((a + m) * (a + b + m)) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    const cd = c * d;
    f *= cd;
    if (Math.abs(1 - cd) < 1e-10) break;
  }
  return front * (f - 1);
}

function lgamma(z: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Every metric pair at every requested lag.
 *
 * lag > 0 asks "does X today predict Y in `lag` days?" — the physiologically
 * interesting direction (today's load against tomorrow's HRV) and the one a
 * same-day chart can't show. Each lag multiplies the hypothesis count, which is
 * exactly why the FDR correction below is not optional.
 */
export function correlateAll(
  series: Series,
  lags: number[] = [0, 1, 2],
): PairResult[] {
  const keys = METRICS.filter((m) => (series[m.key]?.size ?? 0) > 0);
  const label = new Map(METRICS.map((m) => [m.key, m.label]));
  const results: PairResult[] = [];

  for (let i = 0; i < keys.length; i++) {
    for (let j = 0; j < keys.length; j++) {
      const a = keys[i];
      const b = keys[j];
      for (const lag of lags) {
        // At lag 0 the matrix is symmetric, so only compute one triangle.
        if (lag === 0 && j <= i) continue;
        // At non-zero lag direction matters, so both orders are distinct — but
        // a metric against itself is just autocorrelation, not a finding.
        if (lag !== 0 && a.key === b.key) continue;

        const sx = series[a.key];
        const sy = series[b.key];
        const pairs: Array<[number, number]> = [];
        for (const [date, xv] of sx) {
          const yv = sy.get(lag === 0 ? date : shiftDate(date, lag));
          if (yv !== undefined) pairs.push([xv, yv]);
        }
        if (pairs.length < MIN_PAIRS) continue;

        const r = pearsonRaw(pairs);
        if (r === null || !Number.isFinite(r)) continue;

        results.push({
          x: a.key,
          y: b.key,
          xLabel: label.get(a.key)!,
          yLabel: label.get(b.key)!,
          lag,
          r,
          n: pairs.length,
          p: pValue(r, pairs.length),
          q: 1,
          provisional: pairs.length < SOLID_PAIRS,
        });
      }
    }
  }

  return applyBH(results);
}

/**
 * Benjamini-Hochberg FDR. Without this, a matrix of ~40 metrics at 3 lags runs
 * thousands of tests and produces dozens of "significant" results by chance.
 */
function applyBH(results: PairResult[]): PairResult[] {
  const sorted = [...results].sort((a, b) => a.p - b.p);
  const m = sorted.length;
  let prev = 1;
  for (let i = m - 1; i >= 0; i--) {
    const q = Math.min(prev, (sorted[i].p * m) / (i + 1));
    sorted[i].q = q;
    prev = q;
  }
  return sorted;
}

/** Metric pairs that are the same underlying measurement — never "findings". */
const TAUTOLOGIES = new Set([
  "steps|distance", "steps|active_cal", "distance|active_cal",
  "total_cal|active_cal", "sleep_hours|light_sleep", "sleep_hours|deep_sleep",
  "sleep_hours|rem_sleep", "avg_stress|stress_pct", "hrv|hrv_weekly",
  "rhr|rhr_7d", "atl|acute_load", "active_sec|active_cal",
  "moderate_min|active_cal", "sedentary_sec|active_sec",
  "avg_spo2|sleep_spo2", "bb_charged|bb_sleep", "bb_wake|bb_sleep",
  "high_stress_dur|stress_pct", "avg_stress|high_stress_dur",
  "moderate_min|steps", "vigorous_min|active_cal", "floors|steps",
]);

export function isTautology(x: string, y: string): boolean {
  return TAUTOLOGIES.has(`${x}|${y}`) || TAUTOLOGIES.has(`${y}|${x}`);
}
