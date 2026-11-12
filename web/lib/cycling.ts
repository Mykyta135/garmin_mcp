import "server-only";

import { getDb } from "@/lib/db";

/**
 * Physics-based cycling power estimate, as a stand-in for a power meter.
 *
 * Garmin will not estimate cycling VO2 max without a power meter, because on a
 * bike speed says little about work: gradient, wind, tyres, drafting and
 * coasting all break the relationship. This module reconstructs mechanical
 * power from the physics instead:
 *
 *   P = (P_gravity + P_rolling + P_aero) / drivetrain_efficiency
 *   P_gravity = m·g·sin(θ)·v
 *   P_rolling = m·g·Crr·cos(θ)·v
 *   P_aero    = ½·ρ·CdA·v³        (ρ from the ride's own temperature/humidity)
 *
 * IMPORTANT, and the reason this is useful at all: CdA and Crr below are
 * estimates, so ABSOLUTE watts are probably wrong by a wide margin. But the
 * rider keeps the same bike, tyres and position, so those errors are a constant
 * factor -- they cancel in any ratio or trend. Read the direction, never the
 * number.
 */

/** Hardtail MTB, upright position, knobby tyres on tarmac. */
const BIKE_MASS_KG = 14.0;
const CRR = 0.015;
const CDA = 0.45;
const DRIVETRAIN = 0.97;
const G = 9.81;

/** Lviv sits at roughly this elevation; only shifts air density slightly. */
const BASE_ALTITUDE_M = 300;

/** Air density from temperature and humidity — colder air is denser, so the
 *  same speed costs more watts in winter. Without this the seasonal drift
 *  would masquerade as a fitness change. */
export function airDensity(tempF: number, humidityPct: number, altitudeM = BASE_ALTITUDE_M): number {
  const tempC = ((tempF - 32) * 5) / 9;
  const tempK = tempC + 273.15;
  // Barometric formula for station pressure at altitude.
  const pressure = 101325 * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588);
  // Saturation vapour pressure (Tetens), then partial pressures.
  const pSat = 610.78 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const pVapour = (humidityPct / 100) * pSat;
  const pDry = pressure - pVapour;
  // Humid air is *less* dense than dry air at the same temperature.
  return pDry / (287.05 * tempK) + pVapour / (461.495 * tempK);
}

export type RiderMass = { date: string; massKg: number };

/**
 * Rider mass per date, carried forward from the most recent weigh-in.
 *
 * Mass matters: P_gravity is linear in it, so a 75.0 -> 72.0 kg change is a 4%
 * shift in modelled watts on the same climb. Holding mass constant would book
 * weight loss as a fitness gain.
 */
export function getMassByDate(): RiderMass[] {
  try {
    return getDb()
      .prepare(
        `SELECT date, weight_g / 1000.0 AS massKg
           FROM body_composition WHERE weight_g IS NOT NULL
         UNION
         SELECT date, weight_g / 1000.0 AS massKg
           FROM weight WHERE weight_g IS NOT NULL
         ORDER BY date`,
      )
      .all() as RiderMass[];
  } catch {
    return [];
  }
}

function massOn(date: string, masses: RiderMass[], fallback = 63.5): number {
  let current = fallback;
  for (const m of masses) {
    if (m.date <= date) current = m.massKg;
    else break;
  }
  return current;
}

export type RideSample = {
  elapsed_s: number | null;
  heart_rate: number | null;
  speed: number | null;
  altitude: number | null;
  latitude: number | null;
};

export type RideAnalysis = {
  activity_id: number;
  date: string;
  start_time: string | null;
  name: string | null;
  direction: "uphill" | "downhill" | "flat";
  duration_min: number;
  distance_km: number;
  elevation_gain: number;
  elevation_loss: number;
  net_elevation: number;
  avg_speed_kmh: number;
  avg_hr: number | null;
  mass_kg: number;
  air_density: number;
  /** Mean modelled power over moving samples only. */
  avg_power_w: number;
  /** Power while actually pedalling uphill — the cleanest fitness signal. */
  climb_power_w: number | null;
  /** Efficiency factor: watts per heartbeat. Higher = fitter. */
  watts_per_hr: number | null;
  /** Mass-normalised, so weight loss is not booked as fitness. */
  watts_per_kg_per_hr: number | null;
  sample_count: number;
};

/**
 * Per-sample power integration for one ride.
 *
 * Works on samples rather than ride averages: a ride average smears a 10%
 * climb and a coast into one meaningless number, whereas summing per second
 * captures what the rider actually did. Coasting samples (zero or falling
 * speed with no grade) contribute zero, which is physically right.
 */
export function analyseRide(
  activityId: number,
  masses: RiderMass[],
): RideAnalysis | null {
  const db = getDb();

  const meta = db
    .prepare(
      `SELECT a.activity_id, a.date, a.start_time_local, a.name, a.distance_m,
              a.duration_s, a.avg_hr, a.avg_speed,
              w.temp, w.relative_humidity
         FROM activities a
         LEFT JOIN activity_weather w ON w.activity_id = a.activity_id
        WHERE a.activity_id = ?`,
    )
    .get(activityId) as
    | {
        activity_id: number;
        date: string;
        start_time_local: string | null;
        name: string | null;
        distance_m: number | null;
        duration_s: number | null;
        avg_hr: number | null;
        avg_speed: number | null;
        temp: number | null;
        relative_humidity: number | null;
      }
    | undefined;

  if (!meta) return null;

  const samples = db
    .prepare(
      `SELECT elapsed_s, heart_rate, speed, altitude, latitude
         FROM activity_samples WHERE activity_id = ? ORDER BY sample_index`,
    )
    .all(activityId) as RideSample[];

  if (samples.length < 30) return null;

  const massKg = massOn(meta.date, masses);
  const totalMass = massKg + BIKE_MASS_KG;
  const rho = airDensity(meta.temp ?? 60, meta.relative_humidity ?? 50);

  let gain: number;
  let loss: number;
  let powerSum = 0;
  let powerCount = 0;
  let climbPowerSum = 0;
  let climbCount = 0;

  // Elevation comes from Garmin's own per-lap totals, not from differencing
  // the sample altitudes. The barometric altimeter reads pressure, not height,
  // so it jitters by ~0.5 m at 1 Hz; summing raw deltas over ~1800 samples
  // accumulates kilometres of phantom climbing (an early version reported
  // 2314 m on a ride whose laps recorded 271 m). Garmin already filters this
  // in firmware, so their lap figure is the real measurement.
  const lapTotals = db
    .prepare(
      `SELECT COALESCE(SUM(elevation_gain), 0) AS gain,
              COALESCE(SUM(elevation_loss), 0) AS loss
         FROM activity_laps WHERE activity_id = ?`,
    )
    .get(activityId) as { gain: number; loss: number };

  gain = lapTotals.gain;
  loss = lapTotals.loss;

  // Power still needs a per-sample gradient, so altitude is smoothed for that
  // purpose only -- never re-summed into the elevation totals above.
  const SMOOTH = 15;
  const alt: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - SMOOTH); j <= Math.min(samples.length - 1, i + SMOOTH); j++) {
      const a = samples[j].altitude;
      if (a != null) {
        sum += a;
        n++;
      }
    }
    alt.push(n ? sum / n : (samples[i].altitude ?? 0));
  }

  const WINDOW = 10;
  const MIN_ALT_DELTA_M = 0.3;

  for (let i = WINDOW; i < samples.length; i++) {
    const prev = samples[i - WINDOW];
    const cur = samples[i];
    const v = cur.speed;
    if (v == null || v <= 0.5) continue; // stopped or coasting to a halt

    const dt = (cur.elapsed_s ?? 0) - (prev.elapsed_s ?? 0);
    if (dt <= 0) continue;

    const rawDAlt = alt[i] - alt[i - WINDOW];
    const dAlt = Math.abs(rawDAlt) < MIN_ALT_DELTA_M ? 0 : rawDAlt;

    const vPrev = prev.speed ?? v;
    const dDist = ((v + vPrev) / 2) * dt;
    if (dDist <= 0) continue;

    const grade = Math.max(-0.25, Math.min(0.25, dAlt / dDist));
    const theta = Math.atan(grade);

    const pGrav = totalMass * G * Math.sin(theta) * v;
    const pRoll = totalMass * G * CRR * Math.cos(theta) * v;
    const pAero = 0.5 * rho * CDA * Math.pow(v, 3);

    // Descending, gravity does the work: clamp at zero rather than crediting
    // the rider with negative output.
    const power = Math.max(0, (pGrav + pRoll + pAero) / DRIVETRAIN);

    powerSum += power;
    powerCount++;

    // Only sustained climbing counts toward the fitness signal. A high
    // threshold keeps brief noise-driven "climbs" on fast descents out: those
    // were scoring higher power than the real evening climbs, which is
    // physically impossible since the rider is mostly coasting.
    if (grade > 0.02 && v > 1.5) {
      climbPowerSum += power;
      climbCount++;
    }
  }

  if (powerCount === 0) return null;

  const avgPower = powerSum / powerCount;
  const climbPower = climbCount > 0 ? climbPowerSum / climbCount : null;
  const net = gain - loss;

  return {
    activity_id: meta.activity_id,
    date: meta.date,
    start_time: meta.start_time_local,
    name: meta.name,
    direction: net > 15 ? "uphill" : net < -15 ? "downhill" : "flat",
    duration_min: Math.round((meta.duration_s ?? 0) / 60),
    distance_km: Math.round(((meta.distance_m ?? 0) / 1000) * 100) / 100,
    elevation_gain: Math.round(gain),
    elevation_loss: Math.round(loss),
    net_elevation: Math.round(net),
    avg_speed_kmh: Math.round((meta.avg_speed ?? 0) * 3.6 * 100) / 100,
    avg_hr: meta.avg_hr,
    mass_kg: massKg,
    air_density: Math.round(rho * 1000) / 1000,
    avg_power_w: Math.round(avgPower * 10) / 10,
    climb_power_w: climbPower != null ? Math.round(climbPower * 10) / 10 : null,
    watts_per_hr:
      meta.avg_hr && climbPower != null
        ? Math.round((climbPower / meta.avg_hr) * 1000) / 1000
        : null,
    watts_per_kg_per_hr:
      meta.avg_hr && climbPower != null
        ? Math.round((climbPower / massKg / meta.avg_hr) * 100000) / 100000
        : null,
    sample_count: samples.length,
  };
}

/** Every ride with usable samples, oldest first. */
export function analyseAllRides(): RideAnalysis[] {
  let ids: Array<{ activity_id: number }>;
  try {
    ids = getDb()
      .prepare(
        `SELECT DISTINCT a.activity_id
           FROM activities a JOIN activity_samples s USING(activity_id)
          WHERE a.type_key IN ('mountain_biking', 'cycling', 'gravel_cycling', 'road_biking')
          ORDER BY a.start_time_local`,
      )
      .all() as Array<{ activity_id: number }>;
  } catch {
    return [];
  }

  const masses = getMassByDate();
  return ids
    .map((r) => analyseRide(r.activity_id, masses))
    .filter((r): r is RideAnalysis => r !== null);
}

export type FitnessTrend = {
  date: string;
  /** Mass-normalised efficiency, 7-ride rolling mean. */
  ef_smooth: number | null;
  ef_raw: number | null;
  climb_power_w: number | null;
  mass_kg: number;
};

/**
 * Rolling efficiency trend over uphill rides only.
 *
 * Restricted to climbs because they are the repeatable, gravity-dominated
 * efforts where the model is most trustworthy: on a descent the rider may be
 * doing nothing at all, and flat riding is dominated by the aero term, which
 * carries the guessed CdA.
 */
export function getFitnessTrend(window = 7): FitnessTrend[] {
  const climbs = analyseAllRides().filter(
    (r) => r.direction === "uphill" && r.watts_per_kg_per_hr != null,
  );

  return climbs.map((ride, i) => {
    const slice = climbs.slice(Math.max(0, i - window + 1), i + 1);
    const vals = slice
      .map((s) => s.watts_per_kg_per_hr)
      .filter((v): v is number => v != null);
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return {
      date: ride.date,
      ef_smooth: mean != null ? Math.round(mean * 100000) / 100000 : null,
      ef_raw: ride.watts_per_kg_per_hr,
      climb_power_w: ride.climb_power_w,
      mass_kg: ride.mass_kg,
    };
  });
}
