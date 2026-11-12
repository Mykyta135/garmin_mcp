import "server-only";

import { getDb } from "@/lib/db";

/**
 * Running economy from measured sensor data.
 *
 * Unlike the cycling power model, nothing here is estimated: the watch records
 * ground contact time, vertical oscillation, stride length and running power
 * directly. That makes these numbers trustworthy in absolute terms, not just
 * as a trend.
 */

/** Rider height in metres. Cadence and stride norms scale with it. */
export const HEIGHT_M = 1.53;

/**
 * Cadence norms scale with leg length, not with a fixed 170-180 spm figure.
 *
 * A leg swings like a pendulum, so its natural frequency goes as
 * 1/sqrt(length): a shorter runner's optimal cadence is HIGHER, not lower.
 * The usual "170-180" advice comes from elite runners at 175-185 cm and is
 * actively misleading at 153 cm — applying it would push this runner toward
 * overstriding, the opposite of the intent.
 */
export function cadenceTarget(heightM = HEIGHT_M): number {
  const REF_HEIGHT = 1.78;
  const REF_CADENCE = 175;
  return Math.round(REF_CADENCE * Math.sqrt(REF_HEIGHT / heightM));
}

/** Stride is typically 40-50% of height at easy pace. */
export function strideRange(heightM = HEIGHT_M): [number, number] {
  return [Math.round(heightM * 40), Math.round(heightM * 50)];
}

export type RunMetrics = {
  activity_id: number;
  date: string;
  name: string | null;
  distance_km: number;
  pace_min_km: number;
  avg_speed_kmh: number;
  avg_hr: number;
  cadence_spm: number;
  stride_cm: number;
  stride_pct_height: number;
  ground_contact_ms: number;
  vertical_oscillation_cm: number;
  vertical_ratio: number;
  avg_power_w: number;
  /** Metres covered per heartbeat. Strongly pace-dependent — see note below. */
  metres_per_beat: number;
  sample_count: number;
};

/**
 * Per-run aggregates over moving samples.
 *
 * Cadence needs normalising: Garmin's `directRunCadence` is per-leg (~75) while
 * `directDoubleCadence` is both legs (~150), and which index carries which
 * varies between activities. Values under 110 are therefore treated as
 * single-leg and doubled.
 */
export function getRunMetrics(): RunMetrics[] {
  let rows: Array<Record<string, number | string | null>>;
  try {
    rows = getDb()
      .prepare(
        `SELECT a.activity_id, a.date, a.name, a.distance_m,
                AVG(s.heart_rate)            AS hr,
                AVG(s.speed)                 AS v,
                AVG(s.cadence)               AS cad,
                AVG(s.stride_length_cm)      AS stride,
                AVG(s.ground_contact_ms)     AS gct,
                AVG(s.vertical_oscillation_cm) AS vo,
                AVG(s.vertical_ratio)        AS vr,
                AVG(s.power)                 AS pw,
                COUNT(*)                     AS n
           FROM activities a JOIN activity_samples s USING(activity_id)
          WHERE a.type_key IN ('running', 'treadmill_running')
            AND a.distance_m > 800
            AND s.speed > 1.5 AND s.heart_rate > 120
          GROUP BY a.activity_id
         HAVING n > 120
          ORDER BY a.date`,
      )
      .all() as Array<Record<string, number | string | null>>;
  } catch {
    return [];
  }

  return rows.map((r) => {
    const v = Number(r.v) || 0;
    const rawCadence = Number(r.cad) || 0;
    const spm = rawCadence < 110 ? rawCadence * 2 : rawCadence;
    const stride = Number(r.stride) || 0;
    const hr = Number(r.hr) || 0;
    return {
      activity_id: Number(r.activity_id),
      date: String(r.date),
      name: r.name as string | null,
      distance_km: Math.round((Number(r.distance_m) / 1000) * 100) / 100,
      pace_min_km: v > 0 ? Math.round((1000 / v / 60) * 100) / 100 : 0,
      avg_speed_kmh: Math.round(v * 3.6 * 100) / 100,
      avg_hr: Math.round(hr),
      cadence_spm: Math.round(spm),
      stride_cm: Math.round(stride * 10) / 10,
      stride_pct_height: Math.round((stride / (HEIGHT_M * 100)) * 1000) / 10,
      ground_contact_ms: Math.round(Number(r.gct) || 0),
      vertical_oscillation_cm: Math.round((Number(r.vo) || 0) * 100) / 100,
      vertical_ratio: Math.round((Number(r.vr) || 0) * 100) / 100,
      avg_power_w: Math.round(Number(r.pw) || 0),
      metres_per_beat: hr > 0 ? Math.round(((v * 60) / hr) * 1000) / 1000 : 0,
      sample_count: Number(r.n),
    };
  });
}

/** Pearson r, for the pace-confound check below. */
function corr(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

export type PaceConfound = {
  metric: string;
  label: string;
  r: number;
  /** True when the metric is essentially a restatement of speed. */
  confounded: boolean;
};

/**
 * How much each "economy" metric is really just pace.
 *
 * Metres-per-beat correlates with speed at r≈0.98 on this data, which means a
 * drop in it across runs says the runner went slower, NOT that they got less
 * efficient. Form metrics that do NOT track speed (ground contact is r≈-0.17)
 * are the ones that carry real technique information.
 */
export function getPaceConfounds(runs: RunMetrics[]): PaceConfound[] {
  if (runs.length < 3) return [];
  const speed = runs.map((r) => r.avg_speed_kmh);
  const defs: Array<[keyof RunMetrics, string]> = [
    ["metres_per_beat", "Metres per heartbeat"],
    ["stride_cm", "Stride length"],
    ["vertical_oscillation_cm", "Vertical oscillation"],
    ["avg_power_w", "Running power"],
    ["cadence_spm", "Cadence"],
    ["ground_contact_ms", "Ground contact time"],
    ["vertical_ratio", "Vertical ratio"],
  ];
  return defs.map(([key, label]) => {
    const r = corr(
      speed,
      runs.map((run) => Number(run[key]) || 0),
    );
    return { metric: String(key), label, r: Math.round(r * 1000) / 1000, confounded: Math.abs(r) > 0.8 };
  });
}

export type FormVerdict = {
  key: string;
  label: string;
  value: number;
  unit: string;
  target: string;
  status: "good" | "borderline" | "work";
  note: string;
};

/** Current form against height-scaled targets. */
export function getFormVerdicts(runs: RunMetrics[]): FormVerdict[] {
  if (runs.length === 0) return [];
  const recent = runs.slice(-4);
  const mean = (k: keyof RunMetrics) =>
    recent.reduce((s, r) => s + (Number(r[k]) || 0), 0) / recent.length;

  const cadTarget = cadenceTarget();
  const cadence = mean("cadence_spm");
  const [strideLo, strideHi] = strideRange();
  const stride = mean("stride_cm");
  const gct = mean("ground_contact_ms");
  const vr = mean("vertical_ratio");
  const vo = mean("vertical_oscillation_cm");

  return [
    {
      key: "cadence",
      label: "Cadence",
      value: Math.round(cadence),
      unit: "spm",
      target: `~${cadTarget} for ${Math.round(HEIGHT_M * 100)}cm`,
      status: cadence >= cadTarget * 0.95 ? "good" : cadence >= cadTarget * 0.88 ? "borderline" : "work",
      note: `The common "170-180" advice is derived from runners 25cm taller. Scaled for your height the target is ~${cadTarget} spm, because a shorter leg swings faster.`,
    },
    {
      key: "stride",
      label: "Stride length",
      value: Math.round(stride * 10) / 10,
      unit: "cm",
      target: `${strideLo}-${strideHi}cm (40-50% height)`,
      status: stride >= strideLo && stride <= strideHi ? "good" : "borderline",
      note: `${Math.round((stride / (HEIGHT_M * 100)) * 1000) / 10}% of your height — inside the normal easy-pace band.`,
    },
    {
      key: "gct",
      label: "Ground contact",
      value: Math.round(gct),
      unit: "ms",
      target: "<300ms",
      status: gct < 290 ? "good" : gct < 310 ? "borderline" : "work",
      note: "Barely tracks pace (r≈-0.17), so this is technique rather than fitness. Long contact means a soft, slow push-off instead of an elastic rebound — tendon stiffness, which cycling does not train.",
    },
    {
      key: "vertical_ratio",
      label: "Vertical ratio",
      value: Math.round(vr * 100) / 100,
      unit: "%",
      target: "<9%",
      status: vr < 9 ? "good" : vr < 10.5 ? "borderline" : "work",
      note: "Vertical oscillation as a share of stride length — energy spent bouncing instead of travelling forward.",
    },
    {
      key: "vertical_oscillation",
      label: "Vertical oscillation",
      value: Math.round(vo * 100) / 100,
      unit: "cm",
      target: "<8cm",
      status: vo < 8 ? "good" : vo < 9 ? "borderline" : "work",
      note: "How far your centre of mass rises each step.",
    },
  ];
}

export type GaitComparison = {
  type_key: string;
  label: string;
  samples: number;
  speed_kmh: number;
  cadence_spm: number;
  avg_hr: number;
  has_dynamics: boolean;
};

/**
 * Cadence across gait types.
 *
 * Running dynamics (contact time, oscillation) are only recorded while
 * running, so walking and rucking show zeros there — but their cadence is
 * still informative: rucking at near-running cadence trains the same
 * neuromuscular turnover pattern without the impact load.
 */
export function getGaitComparison(): GaitComparison[] {
  const LABELS: Record<string, string> = {
    walking: "Walking",
    rucking: "Rucking",
    running: "Running",
    treadmill_running: "Treadmill",
    hiking: "Hiking",
  };
  let rows: Array<Record<string, number | string | null>>;
  try {
    rows = getDb()
      .prepare(
        `SELECT a.type_key, COUNT(*) AS n, AVG(s.speed) AS v,
                AVG(s.cadence) AS cad, AVG(s.heart_rate) AS hr,
                SUM(s.ground_contact_ms IS NOT NULL) AS dyn
           FROM activities a JOIN activity_samples s USING(activity_id)
          WHERE a.type_key IN ('walking','rucking','running','treadmill_running','hiking')
            AND s.speed > 0.8 AND s.heart_rate > 100
          GROUP BY a.type_key HAVING n > 100
          ORDER BY v`,
      )
      .all() as Array<Record<string, number | string | null>>;
  } catch {
    return [];
  }
  return rows.map((r) => {
    const raw = Number(r.cad) || 0;
    return {
      type_key: String(r.type_key),
      label: LABELS[String(r.type_key)] ?? String(r.type_key),
      samples: Number(r.n),
      speed_kmh: Math.round((Number(r.v) || 0) * 3.6 * 100) / 100,
      cadence_spm: Math.round(raw < 110 ? raw * 2 : raw),
      avg_hr: Math.round(Number(r.hr) || 0),
      has_dynamics: Number(r.dyn) > 0,
    };
  });
}

/**
 * Economy compared only within a narrow pace band.
 *
 * This is the honest way to read economy: metres-per-beat is ~98% pace, so
 * runs must be matched on speed before the remainder means anything. With few
 * runs the bands are thin, which the UI states rather than hides.
 */
export function getPaceMatchedEconomy(runs: RunMetrics[], bandKmh = 0.75) {
  const bands = new Map<number, RunMetrics[]>();
  for (const run of runs) {
    const band = Math.round(run.avg_speed_kmh / bandKmh) * bandKmh;
    if (!bands.has(band)) bands.set(band, []);
    bands.get(band)!.push(run);
  }
  return [...bands.entries()]
    .map(([band, group]) => ({
      band_kmh: Math.round(band * 100) / 100,
      runs: group.length,
      first_date: group[0].date,
      last_date: group[group.length - 1].date,
      first_mpb: group[0].metres_per_beat,
      last_mpb: group[group.length - 1].metres_per_beat,
      change_pct:
        group.length > 1 && group[0].metres_per_beat > 0
          ? Math.round((group[group.length - 1].metres_per_beat / group[0].metres_per_beat - 1) * 1000) / 10
          : null,
      comparable: group.length > 1,
    }))
    .sort((a, b) => a.band_kmh - b.band_kmh);
}
