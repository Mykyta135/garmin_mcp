import "server-only";

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

/**
 * Read-only handle on the snapshot written by ../scripts/sync.py.
 *
 * The dashboard never talks to Garmin directly: it reads this file. That keeps
 * the unofficial endpoints off the request path, so a page load can't break
 * when Garmin changes an API, and makes cross-metric questions plain SQL.
 */

const DB_PATH =
  process.env.GARMIN_DB_PATH ??
  path.join(process.cwd(), "..", "data", "garmin.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    // turbopackIgnore: the path is built from an env var / relative parent, so
    // static analysis would otherwise trace the whole project into the bundle.
    if (!fs.existsSync(/* turbopackIgnore: true */ DB_PATH)) {
      throw new Error(
        `No Garmin snapshot at ${DB_PATH}. Run: ./.venv/bin/python scripts/sync.py`,
      );
    }
    // readonly: the dashboard is a viewer. Only sync.py writes here, and this
    // makes that guarantee structural rather than a convention.
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma("journal_mode = WAL");
  }
  return db;
}

export type DailyStats = {
  date: string;
  total_calories: number | null;
  active_calories: number | null;
  resting_calories: number | null;
  total_steps: number | null;
  total_distance_m: number | null;
  min_heart_rate: number | null;
  max_heart_rate: number | null;
  resting_heart_rate: number | null;
  avg_stress: number | null;
  max_stress: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  moderate_intensity_min: number | null;
  vigorous_intensity_min: number | null;
  floors_ascended: number | null;
};

export type Sleep = {
  date: string;
  sleep_seconds: number | null;
  deep_seconds: number | null;
  light_seconds: number | null;
  rem_seconds: number | null;
  awake_seconds: number | null;
  awake_count: number | null;
  avg_sleep_stress: number | null;
  avg_spo2: number | null;
  avg_respiration: number | null;
};

export type Hrv = {
  date: string;
  last_night_avg: number | null;
  last_night_5min_high: number | null;
  weekly_avg: number | null;
  status: string | null;
  feedback_phrase: string | null;
};

export type Readiness = {
  date: string;
  score: number | null;
  level: string | null;
  feedback_short: string | null;
  sleep_score: number | null;
  recovery_time_min: number | null;
  acute_load: number | null;
  hrv_weekly_average: number | null;
  hrv_factor_pct: number | null;
  sleep_history_factor_pct: number | null;
  stress_history_factor_pct: number | null;
};

export type TrainingLoad = {
  date: string;
  atl: number | null;
  ctl: number | null;
  tsb: number | null;
  acwr: number | null;
  acwr_percent: number | null;
  acwr_status: string | null;
  optimal_chronic_min: number | null;
  optimal_chronic_max: number | null;
  training_status: string | null;
  vo2max: number | null;
};

export type Activity = {
  activity_id: number;
  date: string;
  start_time_local: string | null;
  name: string | null;
  type_key: string | null;
  duration_s: number | null;
  distance_m: number | null;
  calories: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  training_load: number | null;
  aerobic_te: number | null;
  anaerobic_te: number | null;
};

/** Inclusive lower bound, `days` back from the most recent data (not today). */
function sinceClause(days: number): string {
  return `date >= date((SELECT MAX(date) FROM daily_stats), '-${days - 1} days')`;
}

export function getLatestDate(): string | null {
  const row = getDb()
    .prepare("SELECT MAX(date) AS d FROM daily_stats")
    .get() as { d: string | null } | undefined;
  return row?.d ?? null;
}

export function getDailyStats(days = 30): DailyStats[] {
  return getDb()
    .prepare(
      `SELECT * FROM daily_stats WHERE ${sinceClause(days)} ORDER BY date`,
    )
    .all() as DailyStats[];
}

export function getSleep(days = 30): Sleep[] {
  return getDb()
    .prepare(`SELECT * FROM sleep WHERE ${sinceClause(days)} ORDER BY date`)
    .all() as Sleep[];
}

export function getHrv(days = 30): Hrv[] {
  return getDb()
    .prepare(`SELECT * FROM hrv WHERE ${sinceClause(days)} ORDER BY date`)
    .all() as Hrv[];
}

export function getReadiness(days = 30): Readiness[] {
  return getDb()
    .prepare(
      `SELECT * FROM training_readiness WHERE ${sinceClause(days)} ORDER BY date`,
    )
    .all() as Readiness[];
}

export function getTrainingLoad(days = 30): TrainingLoad[] {
  return getDb()
    .prepare(
      `SELECT * FROM training_load WHERE ${sinceClause(days)} ORDER BY date`,
    )
    .all() as TrainingLoad[];
}

export function getActivities(days = 30): Activity[] {
  return getDb()
    .prepare(
      `SELECT * FROM activities WHERE ${sinceClause(days)} ORDER BY start_time_local DESC`,
    )
    .all() as Activity[];
}

/** Most recent row of each daily table — the "today" summary tiles. */
export function getLatestSnapshot() {
  const one = <T>(table: string): T | null =>
    (getDb()
      .prepare(`SELECT * FROM ${table} ORDER BY date DESC LIMIT 1`)
      .get() as T | undefined) ?? null;

  return {
    stats: one<DailyStats>("daily_stats"),
    sleep: one<Sleep>("sleep"),
    hrv: one<Hrv>("hrv"),
    readiness: one<Readiness>("training_readiness"),
    load: one<TrainingLoad>("training_load"),
  };
}

export type CorrelationPoint = {
  date: string;
  hrv: number | null;
  atl: number | null;
  ctl: number | null;
  /** Rolling 7-day activity training load ending on `date`. */
  load_7d: number | null;
  sleep_hours: number | null;
  readiness: number | null;
};

/**
 * One row per day joining HRV against training load — the question the Garmin
 * website can't answer, since it shows each metric on a separate page.
 *
 * LEFT JOINs from a date spine so a day missing one metric still appears;
 * the chart decides how to render the gap rather than the row vanishing.
 */
export function getCorrelation(days = 90): CorrelationPoint[] {
  return getDb()
    .prepare(
      `WITH spine AS (
         SELECT date FROM daily_stats
         UNION SELECT date FROM hrv
         UNION SELECT date FROM training_load
       )
       SELECT
         s.date,
         h.last_night_avg AS hrv,
         tl.atl,
         tl.ctl,
         (SELECT ROUND(SUM(a.training_load), 1)
            FROM activities a
           WHERE a.date <= s.date
             AND a.date > date(s.date, '-7 days')) AS load_7d,
         ROUND(sl.sleep_seconds / 3600.0, 2) AS sleep_hours,
         r.score AS readiness
       FROM spine s
       LEFT JOIN hrv h ON h.date = s.date
       LEFT JOIN training_load tl ON tl.date = s.date
       LEFT JOIN sleep sl ON sl.date = s.date
       LEFT JOIN training_readiness r ON r.date = s.date
       WHERE s.date >= date((SELECT MAX(date) FROM spine), '-${days - 1} days')
       ORDER BY s.date`,
    )
    .all() as CorrelationPoint[];
}

/**
 * Pearson r over pairs where both series have a value.
 *
 * Returns null below `minPairs`: with a new watch there are only a handful of
 * nights, and a correlation computed on 4 points is noise dressed as a finding.
 */
export function pearson(
  points: CorrelationPoint[],
  xKey: keyof CorrelationPoint,
  yKey: keyof CorrelationPoint,
  minPairs = 14,
): { r: number; n: number } | null {
  const pairs = points
    .map((p) => [p[xKey], p[yKey]])
    .filter(
      (pair): pair is [number, number] =>
        typeof pair[0] === "number" && typeof pair[1] === "number",
    );

  if (pairs.length < minPairs) return null;

  const n = pairs.length;
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
  if (den === 0) return null;
  return { r: num / den, n };
}

// ---------------------------------------------------------------------------
// Round-three tables: activity detail, intraday series, and reference data.
// ---------------------------------------------------------------------------

export type MorningReadiness = {
  date: string;
  score: number | null;
  level: string | null;
  feedback_short: string | null;
  sleep_score: number | null;
  recovery_time_min: number | null;
  acute_load: number | null;
  hrv_weekly_average: number | null;
  input_context: string | null;
};

export type RunningTolerance = {
  date: string;
  total_impact_load: number | null;
  total_distance_m: number | null;
  tolerance: number | null;
};

export type WeeklySummary = {
  week_start: string;
  total_steps: number | null;
  average_steps: number | null;
  total_distance_m: number | null;
  data_days_count: number | null;
  avg_stress: number | null;
};

export type BodyComposition = {
  date: string;
  weight_g: number | null;
  bmi: number | null;
  body_fat: number | null;
  muscle_mass: number | null;
};

export type FitnessAge = {
  date: string;
  chronological_age: number | null;
  fitness_age: number | null;
  achievable_fitness_age: number | null;
  component_rhr: number | null;
  component_bmi: number | null;
  component_vigorous_min: number | null;
};

export type Badge = {
  badge_id: number;
  badge_key: string | null;
  badge_name: string | null;
  category_id: number | null;
  points: number | null;
  earned_date: string | null;
  progress_value: number | null;
  target_value: number | null;
};

export type PersonalRecord = {
  record_id: number;
  type_id: number | null;
  activity_id: number | null;
  activity_name: string | null;
  activity_type: string | null;
  value: number | null;
  start_time_local: string | null;
};

export type Lap = {
  activity_id: number;
  lap_index: number;
  distance_m: number | null;
  duration_s: number | null;
  elevation_gain: number | null;
  avg_speed: number | null;
  max_speed: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  grit: number | null;
  avg_flow: number | null;
};

export type HrZone = {
  activity_id: number;
  zone_number: number;
  secs_in_zone: number | null;
  zone_low_boundary: number | null;
};

export type Weather = {
  activity_id: number;
  temp: number | null;
  apparent_temp: number | null;
  relative_humidity: number | null;
  wind_speed: number | null;
  wind_compass: string | null;
  weather_type: string | null;
};

export type ExerciseSet = {
  activity_id: number;
  set_index: number;
  exercise_name: string | null;
  exercise_category: string | null;
  set_type: string | null;
  repetition_count: number | null;
  weight_g: number | null;
  duration_s: number | null;
};

export type Sample = {
  sample_index: number;
  elapsed_s: number | null;
  heart_rate: number | null;
  speed: number | null;
  altitude: number | null;
  cadence: number | null;
  power: number | null;
};

export type IntradayPoint = {
  date: string;
  timestamp_ms: number;
  stress_level?: number | null;
  level?: number | null;
  status?: string | null;
};

/** A table added to the schema but not yet synced must read as empty, not throw. */
function safeAll<T>(sql: string, params: unknown[] = []): T[] {
  try {
    return getDb().prepare(sql).all(...(params as never[])) as T[];
  } catch {
    return [];
  }
}

function safeGet<T>(sql: string, params: unknown[] = []): T | null {
  try {
    return (getDb().prepare(sql).get(...(params as never[])) as T) ?? null;
  } catch {
    return null;
  }
}

export function getMorningReadiness(days = 30): MorningReadiness[] {
  return safeAll(
    `SELECT * FROM morning_readiness WHERE ${sinceClause(days)} ORDER BY date`,
  );
}

export function getRunningTolerance(): RunningTolerance[] {
  return safeAll("SELECT * FROM running_tolerance ORDER BY date");
}

export function getWeeklySummary(): WeeklySummary[] {
  return safeAll("SELECT * FROM weekly_summary ORDER BY week_start");
}

export function getBodyComposition(): BodyComposition[] {
  return safeAll("SELECT * FROM body_composition ORDER BY date");
}

export function getFitnessAge(days = 30): FitnessAge[] {
  return safeAll(
    `SELECT * FROM fitness_age WHERE ${sinceClause(days)} ORDER BY date`,
  );
}

export function getBadges(): Badge[] {
  return safeAll("SELECT * FROM badges ORDER BY earned_date DESC");
}

export function getPersonalRecords(): PersonalRecord[] {
  return safeAll("SELECT * FROM personal_records ORDER BY type_id");
}

export function getThresholdMetrics() {
  return safeGet<{ date: string; sport: string | null; functional_threshold_power: number | null }>(
    "SELECT * FROM threshold_metrics ORDER BY date DESC LIMIT 1",
  );
}

export function getDeviceInfo() {
  return safeGet<{
    product_display_name: string | null;
    firmware_version: string | null;
    time_format: string | null;
    measurement_units: string | null;
  }>(
    `SELECT d.product_display_name, d.firmware_version,
            s.time_format, s.measurement_units
       FROM devices d LEFT JOIN device_settings s USING(device_id) LIMIT 1`,
  );
}

export function getActivityById(activityId: number): Activity | null {
  return safeGet<Activity>("SELECT * FROM activities WHERE activity_id = ?", [activityId]);
}

export function getLaps(activityId: number): Lap[] {
  return safeAll("SELECT * FROM activity_laps WHERE activity_id = ? ORDER BY lap_index", [activityId]);
}

export function getHrZones(activityId: number): HrZone[] {
  return safeAll("SELECT * FROM activity_hr_zones WHERE activity_id = ? ORDER BY zone_number", [activityId]);
}

export function getWeather(activityId: number): Weather | null {
  return safeGet<Weather>("SELECT * FROM activity_weather WHERE activity_id = ?", [activityId]);
}

export function getExerciseSets(activityId: number): ExerciseSet[] {
  return safeAll("SELECT * FROM activity_exercise_sets WHERE activity_id = ? ORDER BY set_index", [activityId]);
}

/**
 * Activity samples, downsampled to at most `maxPoints`.
 *
 * A 2,000-sample activity would ship ~200KB of JSON to the client for a chart
 * a few hundred pixels wide; modulo-striding keeps the shape and cuts the cost.
 */
export function getSamples(activityId: number, maxPoints = 400): Sample[] {
  const total = safeGet<{ n: number }>(
    "SELECT COUNT(*) n FROM activity_samples WHERE activity_id = ?",
    [activityId],
  );
  const stride = Math.max(1, Math.ceil((total?.n ?? 0) / maxPoints));
  return safeAll(
    `SELECT sample_index, elapsed_s, heart_rate, speed, altitude, cadence, power
       FROM activity_samples
      WHERE activity_id = ? AND sample_index % ? = 0
      ORDER BY sample_index`,
    [activityId, stride],
  );
}

/** Aggregate zone seconds across every activity in the window. */
export function getZoneTotals(days = 30) {
  return safeAll<{ zone_number: number; minutes: number; zone_low_boundary: number | null }>(
    `SELECT z.zone_number,
            ROUND(SUM(z.secs_in_zone) / 60.0, 1) AS minutes,
            MIN(z.zone_low_boundary) AS zone_low_boundary
       FROM activity_hr_zones z
       JOIN activities a USING(activity_id)
      WHERE a.${sinceClause(days)}
      GROUP BY z.zone_number ORDER BY z.zone_number`,
  );
}

export function getIntradayStress(date: string): IntradayPoint[] {
  return safeAll(
    "SELECT date, timestamp_ms, stress_level FROM intraday_stress WHERE date = ? ORDER BY timestamp_ms",
    [date],
  );
}

export function getIntradayBodyBattery(date: string): IntradayPoint[] {
  return safeAll(
    "SELECT date, timestamp_ms, level, status FROM intraday_body_battery WHERE date = ? ORDER BY timestamp_ms",
    [date],
  );
}

/** Dates that actually have intraday rows, newest first. */
export function getIntradayDates(): string[] {
  return safeAll<{ date: string }>(
    "SELECT DISTINCT date FROM intraday_stress ORDER BY date DESC",
  ).map((r) => r.date);
}

/** Activities that have per-sample streams, for the detail page index. */
export function getActivitiesWithSamples(): Array<Activity & { sample_count: number }> {
  return safeAll(
    `SELECT a.*, COUNT(s.sample_index) AS sample_count
       FROM activities a
       JOIN activity_samples s USING(activity_id)
      GROUP BY a.activity_id
      ORDER BY a.start_time_local DESC`,
  );
}
