import "server-only";

import { getDb } from "@/lib/db";

/**
 * Segment-level cycling analysis.
 *
 * Built after a per-ride comparison produced a false +21.5% "fitness gain":
 * that figure came from six rides whose first entries happened to be the
 * slowest, so it measured sort order rather than form. Cutting every ride into
 * fixed blocks and grouping by gradient turns 6 data points into ~250 and makes
 * the absence of a trend visible instead of hiding it.
 *
 * Deliberately uses only measured values — speed, heart rate, mass — with no
 * CdA/Crr guesses. Gradient is used solely to BUCKET segments, never to model
 * power, because at this rider's ~1.3% grades the aero term dominates and that
 * term carries the guessed coefficient.
 */

const SEGMENT_SECONDS = 60;
const ALT_SMOOTH = 15;

export type Segment = {
  date: string;
  activity_id: number;
  speed_kmh: number;
  avg_hr: number;
  grade: number;
  mass_kg: number;
  /** Speed per heartbeat, adjusted for body mass. */
  efficiency: number;
};

export type GradeBand = {
  key: string;
  label: string;
  lo: number;
  hi: number;
};

export const GRADE_BANDS: GradeBand[] = [
  { key: "desc_steep", label: "Descent >4%", lo: -99, hi: -0.04 },
  { key: "desc", label: "Descent 1-4%", lo: -0.04, hi: -0.01 },
  { key: "flat", label: "Flat ±1%", lo: -0.01, hi: 0.01 },
  { key: "climb", label: "Climb 1-4%", lo: 0.01, hi: 0.04 },
  { key: "climb_steep", label: "Climb >4%", lo: 0.04, hi: 99 },
];

function massByDate(): Array<{ date: string; massKg: number }> {
  try {
    return getDb()
      .prepare(
        `SELECT date, weight_g / 1000.0 AS massKg FROM body_composition WHERE weight_g IS NOT NULL
         UNION SELECT date, weight_g / 1000.0 FROM weight WHERE weight_g IS NOT NULL
         ORDER BY date`,
      )
      .all() as Array<{ date: string; massKg: number }>;
  } catch {
    return [];
  }
}

/** Cut every cycling ride into fixed-duration segments. */
export function getSegments(): Segment[] {
  const db = getDb();
  let rides: Array<{ activity_id: number; date: string }>;
  try {
    rides = db
      .prepare(
        `SELECT DISTINCT a.activity_id, a.date
           FROM activities a JOIN activity_samples s USING(activity_id)
          WHERE a.type_key IN ('mountain_biking','cycling','road_biking','gravel_cycling')
          ORDER BY a.start_time_local`,
      )
      .all() as Array<{ activity_id: number; date: string }>;
  } catch {
    return [];
  }

  const masses = massByDate();
  const massOn = (date: string) => {
    let current = 65.0;
    for (const m of masses) {
      if (m.date <= date) current = m.massKg;
      else break;
    }
    return current;
  };
  const refMass = masses.length ? masses[masses.length - 1].massKg : 63.5;

  const out: Segment[] = [];

  for (const ride of rides) {
    const samples = db
      .prepare(
        `SELECT elapsed_s, heart_rate, speed, altitude
           FROM activity_samples WHERE activity_id = ? ORDER BY sample_index`,
      )
      .all(ride.activity_id) as Array<{
      elapsed_s: number | null;
      heart_rate: number | null;
      speed: number | null;
      altitude: number | null;
    }>;

    if (samples.length < SEGMENT_SECONDS * 2) continue;

    // Smooth altitude before differencing: the barometric altimeter jitters by
    // ~0.5 m at 1 Hz, which is large relative to a 60 s elevation change.
    const alt: number[] = [];
    for (let i = 0; i < samples.length; i++) {
      let sum = 0;
      let n = 0;
      for (let j = Math.max(0, i - ALT_SMOOTH); j <= Math.min(samples.length - 1, i + ALT_SMOOTH); j++) {
        const a = samples[j].altitude;
        if (a != null) {
          sum += a;
          n++;
        }
      }
      if (n) {
        sum /= n;
        alt.push(sum);
      } else {
        alt.push(samples[i].altitude ?? 0);
      }
    }

    const mass = massOn(ride.date);

    for (let start = 0; start + SEGMENT_SECONDS < samples.length; start += SEGMENT_SECONDS) {
      const block = samples.slice(start, start + SEGMENT_SECONDS);
      const speeds = block.map((b) => b.speed).filter((v): v is number => v != null);
      const hrs = block.map((b) => b.heart_rate).filter((v): v is number => v != null);
      // Require most of the block to be present, or the mean is unreliable.
      if (speeds.length < SEGMENT_SECONDS * 0.8 || hrs.length < SEGMENT_SECONDS * 0.8) continue;

      const v = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      const hr = hrs.reduce((a, b) => a + b, 0) / hrs.length;
      // Stopped, or coasting with the heart at rest: not a work segment.
      if (v < 1.0 || hr < 80) continue;

      const a0 = alt[start];
      const a1 = alt[Math.min(start + SEGMENT_SECONDS, alt.length - 1)];
      const dt = (block[block.length - 1].elapsed_s ?? 0) - (block[0].elapsed_s ?? 0);
      if (dt <= 0) continue;
      const dist = v * dt;
      if (dist < 10) continue;

      const kmh = v * 3.6;
      out.push({
        date: ride.date,
        activity_id: ride.activity_id,
        speed_kmh: Math.round(kmh * 100) / 100,
        avg_hr: Math.round(hr * 10) / 10,
        grade: Math.round(((a1 - a0) / dist) * 10000) / 10000,
        mass_kg: mass,
        // Mass-adjusted so weight loss is not booked as a fitness gain.
        efficiency: Math.round((kmh / hr) * (mass / refMass) * 100000) / 100000,
      });
    }
  }

  return out;
}

export type BandSummary = {
  band: string;
  label: string;
  segments: number;
  speed_kmh: number;
  avg_hr: number;
  efficiency: number;
};

export function summariseBands(segments: Segment[]): BandSummary[] {
  return GRADE_BANDS.map((b) => {
    const group = segments.filter((s) => s.grade >= b.lo && s.grade < b.hi);
    const n = group.length || 1;
    return {
      band: b.key,
      label: b.label,
      segments: group.length,
      speed_kmh: Math.round((group.reduce((s, g) => s + g.speed_kmh, 0) / n) * 100) / 100,
      avg_hr: Math.round((group.reduce((s, g) => s + g.avg_hr, 0) / n) * 10) / 10,
      efficiency: Math.round((group.reduce((s, g) => s + g.efficiency, 0) / n) * 100000) / 100000,
    };
  }).filter((b) => b.segments > 0);
}

export type BandTrend = {
  band: string;
  label: string;
  segments: number;
  weeks: Array<{ week: string; segments: number; speed_kmh: number; avg_hr: number; efficiency: number }>;
  /** Least-squares slope of efficiency per day, with its r². */
  slope_per_day: number;
  r_squared: number;
  change_pct: number | null;
  /** r² below this means time explains almost none of the variance. */
  meaningful: boolean;
};

/**
 * Weekly efficiency trend within each gradient band, plus a regression.
 *
 * The regression is the point: a week-to-week table always looks like it is
 * moving. r² says whether that movement is signal. On this dataset the flat
 * band gives r²≈0.06, i.e. noise — which is the honest answer and the reason
 * this function reports r² alongside the change.
 */
export function getBandTrends(segments: Segment[]): BandTrend[] {
  return GRADE_BANDS.map((b) => {
    const group = segments.filter((s) => s.grade >= b.lo && s.grade < b.hi);
    if (group.length < 10) return null;

    const byWeek = new Map<string, Segment[]>();
    for (const s of group) {
      const d = new Date(s.date + "T00:00:00Z");
      const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const week = `${d.getUTCFullYear()}-W${String(
        Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getUTCDay() + 1) / 7),
      ).padStart(2, "0")}`;
      if (!byWeek.has(week)) byWeek.set(week, []);
      byWeek.get(week)!.push(s);
    }

    const weeks = [...byWeek.entries()]
      .sort(([a], [c]) => a.localeCompare(c))
      .map(([week, g]) => ({
        week,
        segments: g.length,
        speed_kmh: Math.round((g.reduce((s, x) => s + x.speed_kmh, 0) / g.length) * 100) / 100,
        avg_hr: Math.round((g.reduce((s, x) => s + x.avg_hr, 0) / g.length) * 10) / 10,
        efficiency: Math.round((g.reduce((s, x) => s + x.efficiency, 0) / g.length) * 100000) / 100000,
      }));

    const day0 = new Date(group[0].date + "T00:00:00Z").getTime();
    const xs = group.map((s) => (new Date(s.date + "T00:00:00Z").getTime() - day0) / 86400000);
    const ys = group.map((s) => s.efficiency);
    const n = xs.length;
    const mx = xs.reduce((a, c) => a + c, 0) / n;
    const my = ys.reduce((a, c) => a + c, 0) / n;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    const slope = dx ? num / dx : 0;
    const r = dx && dy ? num / Math.sqrt(dx * dy) : 0;

    const first = weeks[0];
    const last = weeks[weeks.length - 1];

    return {
      band: b.key,
      label: b.label,
      segments: group.length,
      weeks,
      slope_per_day: Math.round(slope * 1000000) / 1000000,
      r_squared: Math.round(r * r * 1000) / 1000,
      change_pct:
        weeks.length > 1 && first.efficiency > 0
          ? Math.round((last.efficiency / first.efficiency - 1) * 1000) / 10
          : null,
      meaningful: r * r >= 0.25 && group.length >= 20,
    };
  }).filter((t): t is BandTrend => t !== null);
}
