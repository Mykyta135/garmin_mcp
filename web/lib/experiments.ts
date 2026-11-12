import "server-only";

import { getDb } from "@/lib/db";

/**
 * Analyses Garmin Connect does not surface as trends.
 *
 * Everything here is computed from measured sensor values. Where a metric is
 * absent by design (stroke count during drill sets, running dynamics while
 * walking) that is reported as such rather than filled with zeros.
 */

function safeAll<T>(sql: string, params: unknown[] = []): T[] {
  try {
    return getDb().prepare(sql).all(...(params as never[])) as T[];
  } catch {
    return [];
  }
}

// --- cross-sport aerobic efficiency ----------------------------------------

export type SportEfficiency = {
  type_key: string;
  label: string;
  sessions: number;
  hours: number;
  avg_hr: number;
  pct_hr_max: number;
  load_per_hour: number;
  kcal_per_hour: number;
  avg_aerobic_te: number;
};

const SPORT_LABELS: Record<string, string> = {
  lap_swimming: "Swimming",
  running: "Running",
  treadmill_running: "Treadmill",
  mountain_biking: "Mountain biking",
  strength_training: "Strength",
  rucking: "Rucking",
  walking: "Walking",
  table_tennis: "Table tennis",
  breathwork: "Breathwork",
};

/**
 * Training load produced per hour, against the heart-rate cost of producing it.
 *
 * Answers a practical question Connect cannot: which sport gives this athlete
 * the most aerobic stimulus per hour spent. `pct_hr_max` uses the highest heart
 * rate actually recorded rather than an age formula, since a measured maximum
 * beats 220-minus-age.
 */
export function getSportEfficiency(): SportEfficiency[] {
  const maxRow = safeAll<{ m: number | null }>("SELECT MAX(max_hr) AS m FROM activities");
  const hrMax = maxRow[0]?.m ?? 200;

  return safeAll<Record<string, number | string>>(
    `SELECT type_key,
            COUNT(*)                                   AS sessions,
            SUM(duration_s) / 3600.0                   AS hours,
            AVG(avg_hr)                                AS avg_hr,
            SUM(training_load) / (SUM(duration_s) / 3600.0) AS load_per_hour,
            SUM(calories)     / (SUM(duration_s) / 3600.0) AS kcal_per_hour,
            AVG(aerobic_te)                            AS avg_te
       FROM activities
      WHERE avg_hr IS NOT NULL AND duration_s > 0
      GROUP BY type_key HAVING sessions >= 2
      ORDER BY load_per_hour DESC`,
  ).map((r) => ({
    type_key: String(r.type_key),
    label: SPORT_LABELS[String(r.type_key)] ?? String(r.type_key),
    sessions: Number(r.sessions),
    hours: Math.round(Number(r.hours) * 10) / 10,
    avg_hr: Math.round(Number(r.avg_hr)),
    pct_hr_max: Math.round((Number(r.avg_hr) / hrMax) * 1000) / 10,
    load_per_hour: Math.round(Number(r.load_per_hour) * 10) / 10,
    kcal_per_hour: Math.round(Number(r.kcal_per_hour)),
    avg_aerobic_te: Math.round(Number(r.avg_te ?? 0) * 10) / 10,
  }));
}

// --- performance condition --------------------------------------------------

export type PerformanceRun = {
  activity_id: number;
  date: string;
  type_key: string;
  samples: number;
  start_value: number;
  end_value: number;
  /** end - start: how far condition fell across the session. */
  drift: number;
  mean_value: number;
};

/**
 * Garmin's real-time performance condition, read two ways.
 *
 * Within a session the drift from start to finish measures how quickly the
 * athlete fades. Across sessions the starting value tracks accumulated
 * freshness. Connect shows the number live on the watch but never as a trend,
 * which is the only form in which it says anything about fitness.
 */
export function getPerformanceRuns(): PerformanceRun[] {
  const rides = safeAll<{ activity_id: number; date: string; type_key: string }>(
    `SELECT a.activity_id, a.date, a.type_key
       FROM activities a JOIN activity_samples s USING(activity_id)
      WHERE s.performance_condition IS NOT NULL
      GROUP BY a.activity_id ORDER BY a.date`,
  );

  const out: PerformanceRun[] = [];
  for (const ride of rides) {
    const vals = safeAll<{ v: number }>(
      `SELECT performance_condition AS v FROM activity_samples
        WHERE activity_id = ? AND performance_condition IS NOT NULL
        ORDER BY sample_index`,
      [ride.activity_id],
    ).map((r) => r.v);

    if (vals.length < 30) continue;
    // Average the first and last tenth rather than single samples, which are
    // noisy at the very start and end of a recording.
    const edge = Math.max(5, Math.floor(vals.length / 10));
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    const start = mean(vals.slice(0, edge));
    const end = mean(vals.slice(-edge));

    out.push({
      activity_id: ride.activity_id,
      date: ride.date,
      type_key: ride.type_key,
      samples: vals.length,
      start_value: Math.round(start * 10) / 10,
      end_value: Math.round(end * 10) / 10,
      drift: Math.round((end - start) * 10) / 10,
      mean_value: Math.round(mean(vals) * 10) / 10,
    });
  }
  return out;
}

// --- impact load ------------------------------------------------------------

export type ImpactLoad = {
  type_key: string;
  label: string;
  samples: number;
  mean_factor: number;
  max_factor: number;
};

/** Injury-risk proxy: cumulative landing force, recorded only while running. */
export function getImpactLoad(): ImpactLoad[] {
  return safeAll<Record<string, number | string>>(
    `SELECT a.type_key, COUNT(*) AS samples,
            AVG(s.impact_load_factor) AS mean_factor,
            MAX(s.impact_load_factor) AS max_factor
       FROM activity_samples s JOIN activities a USING(activity_id)
      WHERE s.impact_load_factor IS NOT NULL
      GROUP BY a.type_key ORDER BY mean_factor DESC`,
  ).map((r) => ({
    type_key: String(r.type_key),
    label: SPORT_LABELS[String(r.type_key)] ?? String(r.type_key),
    samples: Number(r.samples),
    mean_factor: Math.round(Number(r.mean_factor) * 1000) / 1000,
    max_factor: Math.round(Number(r.max_factor) * 100) / 100,
  }));
}

// --- swimming ---------------------------------------------------------------

export type StrokeSummary = {
  stroke: string;
  lengths: number;
  with_swolf: number;
  avg_swolf: number | null;
  avg_seconds: number;
  avg_strokes: number | null;
  /** Distance covered per stroke — Garmin stores 0.0 for this, so it is
   *  computed here as length distance divided by stroke count. */
  metres_per_stroke: number | null;
  avg_hr: number;
};

export function getStrokeSummaries(): StrokeSummary[] {
  return safeAll<Record<string, number | string | null>>(
    `SELECT swim_stroke, COUNT(*) AS lengths,
            SUM(swolf IS NOT NULL)      AS with_swolf,
            AVG(swolf)                  AS avg_swolf,
            AVG(duration_s)             AS avg_seconds,
            AVG(total_strokes)          AS avg_strokes,
            AVG(distance_m / total_strokes) AS mps,
            AVG(avg_hr)                 AS avg_hr
       FROM swim_lengths
      GROUP BY swim_stroke ORDER BY lengths DESC`,
  ).map((r) => ({
    stroke: String(r.swim_stroke ?? "unknown"),
    lengths: Number(r.lengths),
    with_swolf: Number(r.with_swolf),
    avg_swolf: r.avg_swolf != null ? Math.round(Number(r.avg_swolf) * 10) / 10 : null,
    avg_seconds: Math.round(Number(r.avg_seconds) * 10) / 10,
    avg_strokes: r.avg_strokes != null ? Math.round(Number(r.avg_strokes) * 10) / 10 : null,
    metres_per_stroke: r.mps != null ? Math.round(Number(r.mps) * 100) / 100 : null,
    avg_hr: Math.round(Number(r.avg_hr ?? 0)),
  }));
}

export type SwimLength = {
  activity_id: number;
  date: string;
  length_index: number;
  duration_s: number | null;
  avg_hr: number | null;
  total_strokes: number | null;
  swolf: number | null;
  swim_stroke: string | null;
  metres_per_stroke: number | null;
};

/** Every length, for the within-session fatigue view. */
export function getSwimLengths(): SwimLength[] {
  return safeAll<Record<string, number | string | null>>(
    `SELECT l.activity_id, a.date, l.length_index, l.duration_s, l.avg_hr,
            l.total_strokes, l.swolf, l.swim_stroke,
            CASE WHEN l.total_strokes > 0 THEN l.distance_m / l.total_strokes END AS mps
       FROM swim_lengths l JOIN activities a USING(activity_id)
      ORDER BY a.date, l.length_index`,
  ).map((r) => ({
    activity_id: Number(r.activity_id),
    date: String(r.date),
    length_index: Number(r.length_index),
    duration_s: r.duration_s != null ? Math.round(Number(r.duration_s) * 10) / 10 : null,
    avg_hr: r.avg_hr != null ? Math.round(Number(r.avg_hr)) : null,
    total_strokes: r.total_strokes != null ? Number(r.total_strokes) : null,
    swolf: r.swolf != null ? Number(r.swolf) : null,
    swim_stroke: r.swim_stroke as string | null,
    metres_per_stroke: r.mps != null ? Math.round(Number(r.mps) * 100) / 100 : null,
  }));
}
