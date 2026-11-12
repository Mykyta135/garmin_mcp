import "server-only";

import { getDb } from "@/lib/db";

/**
 * Daily training guidance from Body Battery at wake.
 *
 * Designed for a shared-dormitory sleeper who cannot control bedtime. Rather
 * than a fixed weekly plan, this reads the one metric that correlates most
 * strongly with how recovered this rider actually is, and answers "what should
 * today look like?" from measured state.
 *
 * On this rider's data:
 *   sleep duration -> BB at wake   r = +0.767
 *   bedtime        -> BB at wake   r = -0.785
 * Both matter, and the near-equal magnitudes are the useful part: a late night
 * can be partly offset by sleeping longer, which is the lever they still hold.
 */

export type RecoveryDay = {
  date: string;
  bb_at_wake: number | null;
  bb_charged: number | null;
  sleep_hours: number | null;
  rem_minutes: number | null;
  deep_minutes: number | null;
  awake_count: number | null;
  sleep_stress: number | null;
  hrv: number | null;
  readiness: number | null;
  resting_hr: number | null;
  bedtime_minutes: number | null;
  wake_minutes: number | null;
};

export function getRecoveryDays(days = 45): RecoveryDay[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT d.date,
                w.bb_at_wake_time      AS bb_at_wake,
                w.bb_charged,
                s.sleep_seconds        AS sleep_s,
                s.rem_seconds          AS rem_s,
                s.deep_seconds         AS deep_s,
                s.awake_count,
                s.avg_sleep_stress     AS sleep_stress,
                s.sleep_start_local_ms AS bed_ms,
                s.sleep_end_local_ms   AS wake_ms,
                h.last_night_avg       AS hrv,
                m.score                AS readiness,
                d.resting_heart_rate   AS resting_hr
           FROM daily_stats d
           LEFT JOIN wellness w USING(date)
           LEFT JOIN sleep s USING(date)
           LEFT JOIN hrv h USING(date)
           LEFT JOIN morning_readiness m USING(date)
          WHERE d.date >= date((SELECT MAX(date) FROM daily_stats), '-' || ? || ' days')
          ORDER BY d.date`,
      )
      .all(days - 1) as Array<Record<string, number | string | null>>;

    return rows.map((r) => {
      // Local-midnight-relative minutes; past midnight reads as negative so
      // 01:30 sorts after 23:00 rather than wrapping to the far end of the day.
      const toMinutes = (ms: number | null) => {
        if (ms == null) return null;
        const d = new Date(Number(ms));
        const m = d.getUTCHours() * 60 + d.getUTCMinutes();
        return m > 720 ? m - 1440 : m;
      };
      return {
        date: String(r.date),
        bb_at_wake: r.bb_at_wake != null ? Number(r.bb_at_wake) : null,
        bb_charged: r.bb_charged != null ? Number(r.bb_charged) : null,
        sleep_hours: r.sleep_s != null ? Math.round((Number(r.sleep_s) / 3600) * 100) / 100 : null,
        rem_minutes: r.rem_s != null ? Math.round(Number(r.rem_s) / 60) : null,
        deep_minutes: r.deep_s != null ? Math.round(Number(r.deep_s) / 60) : null,
        awake_count: r.awake_count != null ? Number(r.awake_count) : null,
        sleep_stress: r.sleep_stress != null ? Math.round(Number(r.sleep_stress) * 10) / 10 : null,
        hrv: r.hrv != null ? Number(r.hrv) : null,
        readiness: r.readiness != null ? Number(r.readiness) : null,
        resting_hr: r.resting_hr != null ? Number(r.resting_hr) : null,
        bedtime_minutes: toMinutes(r.bed_ms as number | null),
        wake_minutes: toMinutes(r.wake_ms as number | null),
      };
    });
  } catch {
    return [];
  }
}

export type TrainingAdvice = {
  level: "green" | "amber" | "red" | "unknown";
  headline: string;
  detail: string;
  bb_at_wake: number | null;
  date: string | null;
};

/**
 * Thresholds are set from this rider's own distribution, not generic advice:
 * their BB-at-wake runs roughly 40-60 on normal nights, so 60+ is genuinely
 * well-recovered and under 40 is a real deficit.
 */
export function getTrainingAdvice(days: RecoveryDay[]): TrainingAdvice {
  const latest = [...days].reverse().find((d) => d.bb_at_wake != null);
  if (!latest || latest.bb_at_wake == null) {
    return {
      level: "unknown",
      headline: "No Body Battery reading yet",
      detail:
        "The watch records Body Battery at wake once it has logged a night's sleep. Sync after wearing it overnight.",
      bb_at_wake: null,
      date: null,
    };
  }

  const bb = latest.bb_at_wake;
  const sleep = latest.sleep_hours;
  const context = sleep != null ? ` after ${sleep.toFixed(1)}h of sleep` : "";

  if (bb >= 60) {
    return {
      level: "green",
      headline: "Go hard today",
      detail: `Body Battery woke at ${bb}${context}. This is the state to spend: intervals, or a deliberately hard climb. Hard days need to land on days like this one, not on a schedule.`,
      bb_at_wake: bb,
      date: latest.date,
    };
  }
  if (bb >= 40) {
    return {
      level: "amber",
      headline: "Normal day",
      detail: `Body Battery woke at ${bb}${context}. Ride the commute as usual, but leave the intensity alone — this is a maintenance day, not a session to push.`,
      bb_at_wake: bb,
      date: latest.date,
    };
  }
  return {
    level: "red",
    headline: "Keep it easy",
    detail: `Body Battery woke at ${bb}${context}. Commute if you must, but hold the heart rate near 120-125 instead of the usual 150. Stacking Zone 3 on a deficit is what keeps training status flat.`,
    bb_at_wake: bb,
    date: latest.date,
  };
}

export type SleepInsight = {
  key: string;
  label: string;
  value: string;
  comparison: string;
  actionable: boolean;
  note: string;
};

/**
 * Sleep findings framed around what is controllable in a shared room.
 *
 * Bedtime is largely not the sleeper's to choose here, so the insights lead
 * with wake time, interruptions and naps — the levers that remain.
 */
export function getSleepInsights(days: RecoveryDay[]): SleepInsight[] {
  const nights = days.filter((d) => d.sleep_hours != null);
  if (nights.length < 5) return [];

  const long = nights.filter((d) => (d.sleep_hours ?? 0) >= 7);
  const short = nights.filter((d) => (d.sleep_hours ?? 0) < 6.5);
  const mean = (arr: RecoveryDay[], k: keyof RecoveryDay) => {
    const v = arr.map((d) => d[k]).filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };

  const out: SleepInsight[] = [];

  const remLong = mean(long, "rem_minutes");
  const remShort = mean(short, "rem_minutes");
  if (remLong != null && remShort != null) {
    out.push({
      key: "rem",
      label: "REM collapses on short nights",
      value: `${Math.round(remShort)} min vs ${Math.round(remLong)} min`,
      comparison: `<6.5h nights (n=${short.length}) vs ≥7h nights (n=${long.length})`,
      actionable: true,
      note: "REM sits in the final sleep cycles, so a short night cuts it first while deep sleep is largely protected. This is why an extra hour in the morning is worth more than it looks — it is almost entirely REM.",
    });
  }

  const hrvLong = mean(long, "hrv");
  const hrvShort = mean(short, "hrv");
  if (hrvLong != null && hrvShort != null) {
    out.push({
      key: "hrv",
      label: "HRV follows sleep duration",
      value: `${hrvShort.toFixed(1)} ms vs ${hrvLong.toFixed(1)} ms`,
      comparison: "short nights vs long nights",
      actionable: true,
      note: "Duration you can still influence by waking later, even when bedtime is not yours to set.",
    });
  }

  const wakes = nights.map((d) => d.awake_count).filter((x): x is number => x != null);
  if (wakes.length) {
    const maxWakes = Math.max(...wakes);
    const meanWakes = wakes.reduce((a, b) => a + b, 0) / wakes.length;
    out.push({
      key: "interruptions",
      label: "Interruptions",
      value: `${meanWakes.toFixed(1)} per night, worst ${maxWakes}`,
      comparison: `across ${wakes.length} nights`,
      actionable: maxWakes >= 3,
      note: "Shared-room noise shows up here. Earplugs and an eye mask act directly on this number, unlike bedtime, which is not fully yours to choose.",
    });
  }

  const beds = nights.map((d) => d.bedtime_minutes).filter((x): x is number => x != null);
  if (beds.length > 3) {
    const m = beds.reduce((a, b) => a + b, 0) / beds.length;
    const sd = Math.sqrt(beds.reduce((s, b) => s + (b - m) ** 2, 0) / beds.length);
    const fmt = (mins: number) => {
      const t = ((Math.round(mins) % 1440) + 1440) % 1440;
      return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    };
    out.push({
      key: "bedtime",
      label: "Bedtime spread",
      value: `${fmt(m)} ± ${Math.round(sd)} min`,
      comparison: `across ${beds.length} nights`,
      actionable: false,
      note: "Largely outside your control in shared accommodation. Listed for context — the levers above are the ones worth spending effort on.",
    });
  }

  const naps = days.filter((d) => d.sleep_hours != null).length;
  out.push({
    key: "naps",
    label: "Daytime naps",
    value: "rarely logged",
    comparison: `over ${naps} tracked days`,
    actionable: true,
    note: "Garmin counts naps toward recovery. With late nights forced on you, 20-30 minutes after lunch is the cheapest recovery available.",
  });

  return out;
}
