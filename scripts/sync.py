#!/usr/bin/env python3
"""Snapshot Garmin Connect data into a local SQLite database.

Deliberately separate from the MCP server: those tools format strings for an
LLM, while this wants raw dicts. Only `token_utils` is reused, so authentication
stays in one place (run `garmin-mcp-auth` once; tokens live in ~/.garminconnect).

Read-only by construction -- every Garmin call here is a `get_*`. Nothing in
this script writes to the Garmin account, matching the read-only posture the
MCP allowlist enforces for Claude.

Usage:
    ./.venv/bin/python scripts/sync.py                 # last 90 days, fill gaps
    ./.venv/bin/python scripts/sync.py --days 30
    ./.venv/bin/python scripts/sync.py --refresh-days 5 # re-fetch recent days
    ./.venv/bin/python scripts/sync.py --full           # ignore sync_log, refetch
"""

from __future__ import annotations

import argparse
import datetime as dt
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from garminconnect import Garmin  # noqa: E402
from garmin_mcp.token_utils import get_token_path  # noqa: E402

DB_PATH = REPO_ROOT / "data" / "garmin.db"
SCHEMA_PATH = Path(__file__).parent / "schema.sql"

# Garmin's endpoints are unofficial and rate-limit under bursts. One day at a
# time with a short pause keeps a 90-day backfill well inside tolerance.
REQUEST_PAUSE_S = 0.35


def _f(value: Any) -> Optional[float]:
    """Coerce to float, mapping Garmin's nulls and stray strings to None."""
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _i(value: Any) -> Optional[int]:
    f = _f(value)
    return int(f) if f is not None else None


# Columns added after the first schema version. ALTER TABLE has no
# IF NOT EXISTS in SQLite, and schema.sql is replayed on every run, so these
# are applied here against the live table instead.
MIGRATIONS = {
    "activity_samples": [
        ("ground_contact_ms", "REAL"),
        ("vertical_oscillation_cm", "REAL"),
        ("vertical_ratio", "REAL"),
        ("stride_length_cm", "REAL"),
        ("grade_adj_speed", "REAL"),
        ("impact_load_factor", "REAL"),
        ("performance_condition", "REAL"),
        ("available_stamina", "REAL"),
        ("vertical_speed", "REAL"),
    ],
}


def apply_migrations(conn: sqlite3.Connection) -> None:
    for table, columns in MIGRATIONS.items():
        existing = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        for name, col_type in columns:
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {col_type}")
    conn.commit()


def connect_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA_PATH.read_text())
    apply_migrations(conn)
    return conn


def upsert(conn: sqlite3.Connection, table: str, key: str, row: Dict[str, Any]) -> None:
    """Insert or replace a row, keyed on `key`, updating every other column."""
    cols = list(row)
    updates = ", ".join(f"{c}=excluded.{c}" for c in cols if c != key)
    conn.execute(
        f"INSERT INTO {table} ({', '.join(cols)}) "
        f"VALUES ({', '.join('?' for _ in cols)}) "
        f"ON CONFLICT({key}) DO UPDATE SET {updates}",
        [row[c] for c in cols],
    )


def log_sync(conn, source: str, date: str, status: str, detail: str = "") -> None:
    upsert(
        conn,
        "sync_log",
        "source, date",
        {
            "source": source,
            "date": date,
            "status": status,
            "detail": detail[:500],
            "synced_at": dt.datetime.now().isoformat(timespec="seconds"),
        },
    )


def fetched_dates(conn: sqlite3.Connection, source: str) -> set:
    """Dates already resolved for a source -- 'ok' or 'empty' both count.

    'empty' must count, otherwise every run re-requests days Garmin has no data
    for (rest days, pre-watch dates) and the backfill never converges.
    """
    rows = conn.execute(
        "SELECT date FROM sync_log WHERE source = ? AND status IN ('ok', 'empty')",
        (source,),
    )
    return {r["date"] for r in rows}


# --- per-source extractors: raw Garmin payload -> table row ------------------


def extract_stats(payload: Dict[str, Any], date: str, now: str) -> Optional[Dict]:
    if not payload or payload.get("totalSteps") is None:
        return None
    return {
        "date": date,
        "total_calories": _f(payload.get("totalKilocalories")),
        "active_calories": _f(payload.get("activeKilocalories")),
        "resting_calories": _f(payload.get("bmrKilocalories")),
        "total_steps": _i(payload.get("totalSteps")),
        "total_distance_m": _i(payload.get("totalDistanceMeters")),
        "min_heart_rate": _i(payload.get("minHeartRate")),
        "max_heart_rate": _i(payload.get("maxHeartRate")),
        "resting_heart_rate": _i(payload.get("restingHeartRate")),
        "avg_stress": _i(payload.get("averageStressLevel")),
        "max_stress": _i(payload.get("maxStressLevel")),
        "body_battery_high": _i(payload.get("bodyBatteryHighestValue")),
        "body_battery_low": _i(payload.get("bodyBatteryLowestValue")),
        "moderate_intensity_min": _i(payload.get("moderateIntensityMinutes")),
        "vigorous_intensity_min": _i(payload.get("vigorousIntensityMinutes")),
        "floors_ascended": _f(payload.get("floorsAscended")),
        "synced_at": now,
    }


def extract_sleep(payload: Dict[str, Any], date: str, now: str) -> Optional[Dict]:
    dto = (payload or {}).get("dailySleepDTO") or {}
    if not dto.get("sleepTimeSeconds"):
        return None
    return {
        "date": date,
        "sleep_seconds": _i(dto.get("sleepTimeSeconds")),
        "nap_seconds": _i(dto.get("napTimeSeconds")),
        "deep_seconds": _i(dto.get("deepSleepSeconds")),
        "light_seconds": _i(dto.get("lightSleepSeconds")),
        "rem_seconds": _i(dto.get("remSleepSeconds")),
        "awake_seconds": _i(dto.get("awakeSleepSeconds")),
        "awake_count": _i(dto.get("awakeCount")),
        "avg_sleep_stress": _f(dto.get("avgSleepStress")),
        "avg_spo2": _f(dto.get("averageSpO2Value")),
        "lowest_spo2": _i(dto.get("lowestSpO2Value")),
        "avg_respiration": _f(dto.get("averageRespirationValue")),
        "sleep_start_local_ms": _i(dto.get("sleepStartTimestampLocal")),
        "sleep_end_local_ms": _i(dto.get("sleepEndTimestampLocal")),
        "synced_at": now,
    }


def extract_hrv(payload: Dict[str, Any], date: str, now: str) -> Optional[Dict]:
    summary = (payload or {}).get("hrvSummary") or {}
    if summary.get("lastNightAvg") is None and summary.get("weeklyAvg") is None:
        return None
    baseline = summary.get("baseline") or {}
    return {
        "date": date,
        "last_night_avg": _i(summary.get("lastNightAvg")),
        "last_night_5min_high": _i(summary.get("lastNight5MinHigh")),
        "weekly_avg": _i(summary.get("weeklyAvg")),
        "baseline_low_upper": _i(baseline.get("lowUpper")),
        "baseline_balanced_low": _i(baseline.get("balancedLow")),
        "baseline_balanced_upper": _i(baseline.get("balancedUpper")),
        "status": summary.get("status"),
        "feedback_phrase": summary.get("feedbackPhrase"),
        "synced_at": now,
    }


def extract_readiness(payload: Any, date: str, now: str) -> Optional[Dict]:
    # get_training_readiness returns a list; the first entry is the day's record.
    if isinstance(payload, list):
        payload = payload[0] if payload else {}
    if not payload or payload.get("score") is None:
        return None
    return {
        "date": date,
        "score": _i(payload.get("score")),
        "level": payload.get("level"),
        "feedback_short": payload.get("feedbackShort"),
        "sleep_score": _i(payload.get("sleepScore")),
        "sleep_score_factor_pct": _i(payload.get("sleepScoreFactorPercent")),
        "recovery_time_min": _i(payload.get("recoveryTime")),
        "recovery_time_factor_pct": _i(payload.get("recoveryTimeFactorPercent")),
        "acwr_factor_pct": _i(payload.get("acwrFactorPercent")),
        "acute_load": _i(payload.get("acuteLoad")),
        "hrv_factor_pct": _i(payload.get("hrvFactorPercent")),
        "hrv_weekly_average": _i(payload.get("hrvWeeklyAverage")),
        "stress_history_factor_pct": _i(payload.get("stressHistoryFactorPercent")),
        "sleep_history_factor_pct": _i(payload.get("sleepHistoryFactorPercent")),
        "synced_at": now,
    }


def extract_training_load(payload: Dict[str, Any], date: str, now: str) -> Optional[Dict]:
    # latestTrainingStatusData is keyed by device ID, not the DTO itself. Prefer
    # the primary training device, else the first -- same rule the MCP server's
    # get_training_load_trend applies. `or {}` coalesces Garmin's explicit nulls,
    # which would otherwise break the chained .get calls.
    recent = (payload or {}).get("mostRecentTrainingStatus") or {}
    per_device = recent.get("latestTrainingStatusData") or {}
    device: Dict[str, Any] = {}
    for candidate in per_device.values():
        if not isinstance(candidate, dict):
            continue
        if candidate.get("primaryTrainingDevice"):
            device = candidate
            break
        if not device:
            device = candidate

    load = device.get("acuteTrainingLoadDTO") or {}
    vo2 = ((payload or {}).get("mostRecentVO2Max") or {}).get("generic") or {}

    atl = _f(load.get("dailyTrainingLoadAcute"))
    ctl = _f(load.get("dailyTrainingLoadChronic"))
    if atl is None and ctl is None and vo2.get("vo2MaxValue") is None:
        return None

    return {
        "date": date,
        "atl": atl,
        "ctl": ctl,
        "tsb": round(ctl - atl, 1) if atl is not None and ctl is not None else None,
        "acwr": _f(load.get("dailyAcuteChronicWorkloadRatio")),
        "acwr_percent": _i(load.get("acwrPercent")),
        "acwr_status": load.get("acwrStatus"),
        "optimal_chronic_min": _f(load.get("minTrainingLoadChronic")),
        "optimal_chronic_max": _f(load.get("maxTrainingLoadChronic")),
        "training_status": device.get("trainingStatusFeedbackPhrase"),
        "fitness_trend": _i(device.get("fitnessTrend")),
        "vo2max": _f(vo2.get("vo2MaxValue")),
        "synced_at": now,
    }


def extract_wellness(payload: Dict[str, Any], date: str, now: str) -> Optional[Dict]:
    """get_user_summary is a superset of get_stats.

    It carries the stress-duration breakdown, body-battery charge/drain/sleep
    values, SpO2, respiration and the sedentary/active/sleeping time budget in
    one call -- several planned tables collapse into this one.
    """
    if not payload or payload.get("totalSteps") is None:
        return None
    return {
        "date": date,
        "highly_active_seconds": _i(payload.get("highlyActiveSeconds")),
        "active_seconds": _i(payload.get("activeSeconds")),
        "sedentary_seconds": _i(payload.get("sedentarySeconds")),
        "sleeping_seconds": _i(payload.get("sleepingSeconds")),
        "stress_duration": _i(payload.get("stressDuration")),
        "rest_stress_duration": _i(payload.get("restStressDuration")),
        "activity_stress_duration": _i(payload.get("activityStressDuration")),
        "low_stress_duration": _i(payload.get("lowStressDuration")),
        "medium_stress_duration": _i(payload.get("mediumStressDuration")),
        "high_stress_duration": _i(payload.get("highStressDuration")),
        "stress_percentage": _f(payload.get("stressPercentage")),
        "rest_stress_percentage": _f(payload.get("restStressPercentage")),
        "bb_charged": _i(payload.get("bodyBatteryChargedValue")),
        "bb_drained": _i(payload.get("bodyBatteryDrainedValue")),
        "bb_during_sleep": _i(payload.get("bodyBatteryDuringSleep")),
        "bb_at_wake_time": _i(payload.get("bodyBatteryAtWakeTime")),
        "floors_ascended": _f(payload.get("floorsAscended")),
        "floors_descended": _f(payload.get("floorsDescended")),
        "floors_ascended_m": _f(payload.get("floorsAscendedInMeters")),
        "avg_spo2": _f(payload.get("averageSpo2")),
        "lowest_spo2": _i(payload.get("lowestSpo2")),
        "avg_waking_respiration": _f(payload.get("avgWakingRespirationValue")),
        "highest_respiration": _f(payload.get("highestRespirationValue")),
        "lowest_respiration": _f(payload.get("lowestRespirationValue")),
        "resting_calories_activity": _f(payload.get("restingCaloriesFromActivity")),
        "avg_altitude_m": _f(payload.get("averageMonitoringEnvironmentAltitude")),
        "last7_avg_resting_hr": _i(payload.get("lastSevenDaysAvgRestingHeartRate")),
        "daily_step_goal": _i(payload.get("dailyStepGoal")),
        "intensity_minutes_goal": _i(payload.get("intensityMinutesGoal")),
        "synced_at": now,
    }


def extract_spo2(payload: Dict[str, Any], date: str, now: str) -> Optional[Dict]:
    if not payload or payload.get("averageSpO2") is None:
        return None
    return {
        "date": date,
        "average_spo2": _f(payload.get("averageSpO2")),
        "lowest_spo2": _i(payload.get("lowestSpO2")),
        "latest_spo2": _i(payload.get("latestSpO2")),
        "avg_sleep_spo2": _f(payload.get("avgSleepSpO2")),
        "last7_avg_spo2": _f(payload.get("lastSevenDaysAvgSpO2")),
        "synced_at": now,
    }


def extract_respiration(payload: Dict[str, Any], date: str, now: str) -> Optional[Dict]:
    if not payload or payload.get("avgWakingRespirationValue") is None:
        return None
    return {
        "date": date,
        "avg_waking": _f(payload.get("avgWakingRespirationValue")),
        "avg_sleep": _f(payload.get("avgSleepRespirationValue")),
        "lowest": _f(payload.get("lowestRespirationValue")),
        "highest": _f(payload.get("highestRespirationValue")),
        "synced_at": now,
    }


def extract_intensity(payload: Dict[str, Any], date: str, now: str) -> Optional[Dict]:
    if not payload or payload.get("moderateMinutes") is None:
        return None
    return {
        "date": date,
        "moderate_minutes": _i(payload.get("moderateMinutes")),
        "vigorous_minutes": _i(payload.get("vigorousMinutes")),
        "weekly_moderate": _i(payload.get("weeklyModerate")),
        "weekly_vigorous": _i(payload.get("weeklyVigorous")),
        "weekly_total": _i(payload.get("weeklyTotal")),
        "week_goal": _i(payload.get("weekGoal")),
        "synced_at": now,
    }


def extract_hydration(payload: Dict[str, Any], date: str, now: str) -> Optional[Dict]:
    # valueInML is 0.0 on days with no logging, which is real data (nothing
    # drunk / nothing logged), so only a wholly absent payload counts as empty.
    if not payload or payload.get("valueInML") is None:
        return None
    return {
        "date": date,
        "value_ml": _f(payload.get("valueInML")),
        "goal_ml": _f(payload.get("goalInML")),
        "sweat_loss_ml": _f(payload.get("sweatLossInML")),
        "activity_intake_ml": _f(payload.get("activityIntakeInML")),
        "synced_at": now,
    }


def extract_fitness_age(payload: Dict[str, Any], date: str, now: str) -> Optional[Dict]:
    if not payload or payload.get("fitnessAge") is None:
        return None
    parts = payload.get("components") or {}

    def comp(name: str) -> Optional[float]:
        return _f((parts.get(name) or {}).get("value"))

    return {
        "date": date,
        "chronological_age": _f(payload.get("chronologicalAge")),
        "fitness_age": _f(payload.get("fitnessAge")),
        "achievable_fitness_age": _f(payload.get("achievableFitnessAge")),
        "previous_fitness_age": _f(payload.get("previousFitnessAge")),
        "component_rhr": comp("rhr"),
        "component_bmi": comp("bmi"),
        "component_vigorous_days": comp("vigorousDaysAvg"),
        "component_vigorous_min": comp("vigorousMinutesAvg"),
        "last_updated": payload.get("lastUpdated"),
        "synced_at": now,
    }


DAILY_SOURCES = [
    ("daily_stats", "get_stats", extract_stats),
    ("wellness", "get_user_summary", extract_wellness),
    ("sleep", "get_sleep_data", extract_sleep),
    ("hrv", "get_hrv_data", extract_hrv),
    ("training_readiness", "get_training_readiness", extract_readiness),
    ("training_load", "get_training_status", extract_training_load),
    ("spo2", "get_spo2_data", extract_spo2),
    ("respiration", "get_respiration_data", extract_respiration),
    ("intensity_minutes", "get_intensity_minutes_data", extract_intensity),
    ("hydration", "get_hydration_data", extract_hydration),
    ("fitness_age", "get_fitnessage_data", extract_fitness_age),
]


def sync_daily(
    conn: sqlite3.Connection,
    client: Garmin,
    dates: Iterable[str],
    table: str,
    method: str,
    extract: Callable,
    skip: set,
) -> Dict[str, int]:
    counts = {"ok": 0, "empty": 0, "error": 0, "skipped": 0}
    now = dt.datetime.now().isoformat(timespec="seconds")
    fetch = getattr(client, method)

    for date in dates:
        if date in skip:
            counts["skipped"] += 1
            continue
        try:
            row = extract(fetch(date), date, now)
        except Exception as exc:  # keep going; one bad day must not kill the run
            counts["error"] += 1
            log_sync(conn, table, date, "error", f"{type(exc).__name__}: {exc}")
            print(f"  {table} {date}: ERROR {type(exc).__name__}: {exc}", file=sys.stderr)
        else:
            if row:
                upsert(conn, table, "date", row)
                log_sync(conn, table, date, "ok")
                counts["ok"] += 1
            else:
                log_sync(conn, table, date, "empty")
                counts["empty"] += 1
        conn.commit()
        time.sleep(REQUEST_PAUSE_S)

    return counts


def sync_activities(conn: sqlite3.Connection, client: Garmin, start: str, end: str) -> int:
    """Fetch activities by date range -- one call, not one per day."""
    now = dt.datetime.now().isoformat(timespec="seconds")
    activities = client.get_activities_by_date(start, end) or []
    for act in activities:
        start_local = act.get("startTimeLocal") or ""
        upsert(
            conn,
            "activities",
            "activity_id",
            {
                "activity_id": _i(act.get("activityId")),
                "date": start_local[:10],
                "start_time_local": start_local,
                "name": act.get("activityName"),
                "type_key": (act.get("activityType") or {}).get("typeKey"),
                "duration_s": _f(act.get("duration")),
                "moving_duration_s": _f(act.get("movingDuration")),
                "distance_m": _f(act.get("distance")),
                "calories": _f(act.get("calories")),
                "avg_hr": _f(act.get("averageHR")),
                "max_hr": _f(act.get("maxHR")),
                "avg_speed": _f(act.get("averageSpeed")),
                "elevation_gain": _f(act.get("elevationGain")),
                "training_load": _f(act.get("activityTrainingLoad")),
                "aerobic_te": _f(act.get("aerobicTrainingEffect")),
                "anaerobic_te": _f(act.get("anaerobicTrainingEffect")),
                "moderate_intensity_min": _i(act.get("moderateIntensityMinutes")),
                "vigorous_intensity_min": _i(act.get("vigorousIntensityMinutes")),
                "steps": _i(act.get("steps")),
                "synced_at": now,
            },
        )
    conn.commit()
    return len(activities)


# Garmin rejects a body-battery range wider than this with a 400; 31 days is
# accepted and 32 is not, so the window is chunked rather than requested whole.
BODY_BATTERY_MAX_SPAN_DAYS = 31


def _date_chunks(start: str, end: str, span: int):
    """Yield (start, end) pairs of at most `span` days, inclusive."""
    current = dt.date.fromisoformat(start)
    last = dt.date.fromisoformat(end)
    while current <= last:
        chunk_end = min(current + dt.timedelta(days=span - 1), last)
        yield current.isoformat(), chunk_end.isoformat()
        current = chunk_end + dt.timedelta(days=1)


def sync_body_battery(conn: sqlite3.Connection, client: Garmin, start: str, end: str) -> int:
    now = dt.datetime.now().isoformat(timespec="seconds")
    rows: list = []
    for chunk_start, chunk_end in _date_chunks(start, end, BODY_BATTERY_MAX_SPAN_DAYS):
        rows.extend(client.get_body_battery(chunk_start, chunk_end) or [])
        time.sleep(REQUEST_PAUSE_S)
    stored = 0
    for row in rows:
        date = row.get("date")
        # The range endpoint emits a row per calendar day whether or not the
        # watch was worn; a null charge is "no data", not a zero-charge day.
        if not date or row.get("charged") is None:
            continue
        stored += 1
        upsert(
            conn,
            "body_battery",
            "date",
            {
                "date": date,
                "charged": _i(row.get("charged")),
                "drained": _i(row.get("drained")),
                "synced_at": now,
            },
        )
    conn.commit()
    return stored


def sync_weight(conn: sqlite3.Connection, client: Garmin, start: str, end: str) -> int:
    """Weigh-ins arrive as per-day summaries over a range, not per-date calls.

    Weight is stored in grams exactly as Garmin returns it; converting here
    would bake in a unit assumption the dashboard is better placed to make.
    """
    now = dt.datetime.now().isoformat(timespec="seconds")
    payload = client.get_weigh_ins(start, end) or {}
    summaries = payload.get("dailyWeightSummaries") or []
    for summary in summaries:
        date = summary.get("summaryDate")
        if not date:
            continue
        latest = summary.get("latestWeight") or {}
        upsert(
            conn,
            "weight",
            "date",
            {
                "date": date,
                "weight_g": _f(latest.get("weight")),
                "min_weight_g": _f(summary.get("minWeight")),
                "max_weight_g": _f(summary.get("maxWeight")),
                "bmi": _f(latest.get("bmi")),
                "body_fat": _f(latest.get("bodyFat")),
                "body_water": _f(latest.get("bodyWater")),
                "muscle_mass": _f(latest.get("muscleMass")),
                "entries": _i(summary.get("numOfWeightEntries")),
                "source_type": latest.get("sourceType"),
                "synced_at": now,
            },
        )
    conn.commit()
    return len(summaries)


# --- per-activity detail ---------------------------------------------------
#
# One HTTP call per activity per source, so these are fetched once and never
# re-fetched: an activity's splits do not change after upload. Bookkeeping
# lives in activity_detail_log, which records 'empty' as a real outcome (a walk
# has no exercise sets) so it is not retried on every run.


def fetched_activity_details(conn: sqlite3.Connection, source: str) -> set:
    rows = conn.execute(
        "SELECT activity_id FROM activity_detail_log "
        "WHERE source = ? AND status IN ('ok', 'empty')",
        (source,),
    )
    return {r["activity_id"] for r in rows}


def log_activity_detail(conn, activity_id: int, source: str, status: str, detail: str = "") -> None:
    upsert(
        conn,
        "activity_detail_log",
        "activity_id, source",
        {
            "activity_id": activity_id,
            "source": source,
            "status": status,
            "detail": detail[:500],
            "synced_at": dt.datetime.now().isoformat(timespec="seconds"),
        },
    )


def store_laps(conn, activity_id: int, payload: Any, now: str) -> int:
    laps = (payload or {}).get("lapDTOs") or []
    for lap in laps:
        upsert(
            conn,
            "activity_laps",
            "activity_id, lap_index",
            {
                "activity_id": activity_id,
                "lap_index": _i(lap.get("lapIndex")),
                "start_time_gmt": lap.get("startTimeGMT"),
                "distance_m": _f(lap.get("distance")),
                "duration_s": _f(lap.get("duration")),
                "moving_duration_s": _f(lap.get("movingDuration")),
                "elevation_gain": _f(lap.get("elevationGain")),
                "elevation_loss": _f(lap.get("elevationLoss")),
                "max_elevation": _f(lap.get("maxElevation")),
                "min_elevation": _f(lap.get("minElevation")),
                "avg_speed": _f(lap.get("averageSpeed")),
                "avg_moving_speed": _f(lap.get("averageMovingSpeed")),
                "max_speed": _f(lap.get("maxSpeed")),
                "calories": _f(lap.get("calories")),
                "avg_hr": _f(lap.get("averageHR")),
                "max_hr": _f(lap.get("maxHR")),
                "grit": _f(lap.get("grit")),
                "avg_flow": _f(lap.get("avgFlow")),
                "start_lat": _f(lap.get("startLatitude")),
                "start_lon": _f(lap.get("startLongitude")),
                "intensity_type": lap.get("intensityType"),
                "synced_at": now,
            },
        )
    return len(laps)


def store_hr_zones(conn, activity_id: int, payload: Any, now: str) -> int:
    zones = payload if isinstance(payload, list) else []
    for zone in zones:
        if not isinstance(zone, dict):
            continue
        upsert(
            conn,
            "activity_hr_zones",
            "activity_id, zone_number",
            {
                "activity_id": activity_id,
                "zone_number": _i(zone.get("zoneNumber")),
                "secs_in_zone": _f(zone.get("secsInZone")),
                "zone_low_boundary": _i(zone.get("zoneLowBoundary")),
                "synced_at": now,
            },
        )
    return len(zones)


def store_weather(conn, activity_id: int, payload: Any, now: str) -> int:
    if not payload or payload.get("temp") is None:
        return 0
    upsert(
        conn,
        "activity_weather",
        "activity_id",
        {
            "activity_id": activity_id,
            "temp": _f(payload.get("temp")),
            "apparent_temp": _f(payload.get("apparentTemp")),
            "dew_point": _f(payload.get("dewPoint")),
            "relative_humidity": _i(payload.get("relativeHumidity")),
            "wind_speed": _f(payload.get("windSpeed")),
            "wind_gust": _f(payload.get("windGust")),
            "wind_direction": _i(payload.get("windDirection")),
            "wind_compass": payload.get("windDirectionCompassPoint"),
            "weather_type": (payload.get("weatherTypeDTO") or {}).get("desc"),
            "latitude": _f(payload.get("latitude")),
            "longitude": _f(payload.get("longitude")),
            "synced_at": now,
        },
    )
    return 1


def store_exercise_sets(conn, activity_id: int, payload: Any, now: str) -> int:
    sets = (payload or {}).get("exerciseSets") or []
    stored = 0
    for idx, item in enumerate(sets):
        if not isinstance(item, dict):
            continue
        # exercises[] carries the name; a rest set has none.
        exercises = item.get("exercises") or []
        first = exercises[0] if exercises and isinstance(exercises[0], dict) else {}
        upsert(
            conn,
            "activity_exercise_sets",
            "activity_id, set_index",
            {
                "activity_id": activity_id,
                "set_index": idx,
                "exercise_name": first.get("name"),
                "exercise_category": first.get("category"),
                "set_type": item.get("setType"),
                "repetition_count": _i(item.get("repetitionCount")),
                "weight_g": _f(item.get("weight")),
                "duration_s": _f(item.get("duration")),
                "start_time_gmt": item.get("startTime"),
                "synced_at": now,
            },
        )
        stored += 1
    return stored


def store_swim_lengths(conn, activity_id: int, payload: Any, now: str) -> int:
    """Per-length pool data: SWOLF, stroke count and detected stroke style.

    SWOLF (seconds + strokes for one length) only exists outside DRILL sets:
    a drill has no normal stroke pattern, so Garmin records no stroke count and
    the metric would be meaningless. Those lengths are still stored, with a
    null SWOLF, because their duration and heart rate remain useful.
    """
    stored = 0
    for lap in (payload or {}).get("lapDTOs") or []:
        for length in lap.get("lengthDTOs") or []:
            if (length.get("distance") or 0) <= 0:
                continue
            idx = _i(length.get("lengthIndex"))
            if idx is None:
                continue
            swolf = _f(length.get("averageSWOLF"))
            strokes = _i(length.get("totalNumberOfStrokes"))
            upsert(
                conn,
                "swim_lengths",
                "activity_id, length_index",
                {
                    "activity_id": activity_id,
                    "length_index": idx,
                    "distance_m": _f(length.get("distance")),
                    "duration_s": _f(length.get("duration")),
                    "avg_speed": _f(length.get("averageSpeed")),
                    "avg_hr": _f(length.get("averageHR")),
                    "max_hr": _f(length.get("maxHR")),
                    # Zero means "not counted" here, not "zero strokes taken".
                    "total_strokes": strokes if strokes else None,
                    "swolf": swolf if swolf and swolf > 0 else None,
                    "swim_stroke": length.get("swimStroke"),
                    "synced_at": now,
                },
            )
            stored += 1
    return stored


ACTIVITY_DETAIL_SOURCES = [
    ("laps", "get_activity_splits", store_laps),
    ("swim_lengths", "get_activity_splits", store_swim_lengths),
    ("hr_zones", "get_activity_hr_in_timezones", store_hr_zones),
    ("weather", "get_activity_weather", store_weather),
    ("exercise_sets", "get_activity_exercise_sets", store_exercise_sets),
]


def sync_activity_details(conn: sqlite3.Connection, client: Garmin) -> Dict[str, int]:
    """Fetch per-activity detail for activities not already fetched."""
    now = dt.datetime.now().isoformat(timespec="seconds")
    totals: Dict[str, int] = {}
    ids = [
        r["activity_id"]
        for r in conn.execute("SELECT activity_id FROM activities ORDER BY date DESC")
    ]

    for source, method, store in ACTIVITY_DETAIL_SOURCES:
        done = fetched_activity_details(conn, source)
        fetch = getattr(client, method)
        ok = empty = err = 0
        for activity_id in ids:
            if activity_id in done:
                continue
            try:
                count = store(conn, activity_id, fetch(str(activity_id)), now)
            except Exception as exc:
                err += 1
                log_activity_detail(conn, activity_id, source, "error", f"{type(exc).__name__}: {exc}")
            else:
                if count:
                    ok += 1
                    log_activity_detail(conn, activity_id, source, "ok")
                else:
                    empty += 1
                    log_activity_detail(conn, activity_id, source, "empty")
            conn.commit()
            time.sleep(REQUEST_PAUSE_S)
        totals[source] = ok
        print(f"  {source:16s} ok={ok:3d} empty={empty:3d} error={err:3d} skipped={len(done):3d}")
    return totals


def sync_reference_data(conn: sqlite3.Connection, client: Garmin) -> Dict[str, int]:
    """Account-level data: records, gear, devices. Small, so refreshed wholly."""
    now = dt.datetime.now().isoformat(timespec="seconds")
    counts = {}

    try:
        records = client.get_personal_record() or []
        for rec in records:
            if not isinstance(rec, dict) or rec.get("id") is None:
                continue
            upsert(
                conn,
                "personal_records",
                "record_id",
                {
                    "record_id": _i(rec.get("id")),
                    "type_id": _i(rec.get("typeId")),
                    "activity_id": _i(rec.get("activityId")),
                    "activity_name": rec.get("activityName"),
                    # Several PR rows carry a null activityType; store as-is.
                    "activity_type": rec.get("activityType"),
                    "value": _f(rec.get("value")),
                    "start_time_local": rec.get("activityStartDateTimeLocalFormatted"),
                    "synced_at": now,
                },
            )
        counts["personal_records"] = len(records)
    except Exception as exc:
        print(f"  personal_records ERROR {exc}", file=sys.stderr)
        counts["personal_records"] = 0

    try:
        profile = client.get_user_profile() or {}
        profile_id = profile.get("profileId") or profile.get("id")
        items = client.get_gear(str(profile_id)) if profile_id else []
        for item in items or []:
            uuid = item.get("uuid")
            stats = {}
            if uuid:
                try:
                    stats = client.get_gear_stats(uuid) or {}
                except Exception:
                    stats = {}
            upsert(
                conn,
                "gear",
                "gear_pk",
                {
                    "gear_pk": _i(item.get("gearPk")),
                    "uuid": uuid,
                    "make_name": item.get("gearMakeName"),
                    "model_name": item.get("gearModelName"),
                    "custom_make_model": item.get("customMakeModel"),
                    "gear_type": item.get("gearTypeName"),
                    "status": item.get("gearStatusName"),
                    "display_name": item.get("displayName"),
                    "notes": item.get("notes"),
                    "date_begin": item.get("dateBegin"),
                    "max_distance_km": _f(item.get("maximumMeters")),
                    "total_distance_km": _f(stats.get("totalDistance")),
                    "total_activities": _i(stats.get("totalActivities")),
                    "synced_at": now,
                },
            )
        counts["gear"] = len(items or [])
    except Exception as exc:
        print(f"  gear ERROR {exc}", file=sys.stderr)
        counts["gear"] = 0

    try:
        devices = client.get_devices() or []
        last_used = {}
        try:
            last_used = client.get_device_last_used() or {}
        except Exception:
            last_used = {}
        for dev in devices:
            upsert(
                conn,
                "devices",
                "device_id",
                {
                    "device_id": _i(dev.get("deviceId") or dev.get("unitId")),
                    "application_key": dev.get("applicationKey"),
                    "display_name": dev.get("displayName"),
                    "product_display_name": dev.get("productDisplayName"),
                    "serial_number": dev.get("serialNumber"),
                    "firmware_version": dev.get("firmwareVersion") or dev.get("currentFirmwareVersion"),
                    "last_used_device_name": last_used.get("lastUsedDeviceName"),
                    "synced_at": now,
                },
            )
        counts["devices"] = len(devices)
    except Exception as exc:
        print(f"  devices ERROR {exc}", file=sys.stderr)
        counts["devices"] = 0

    conn.commit()
    return counts


def extract_morning_readiness(payload: Any, date: str, now: str) -> Optional[Dict]:
    if isinstance(payload, list):
        payload = payload[0] if payload else {}
    if not payload or payload.get("score") is None:
        return None
    return {
        "date": date,
        "score": _i(payload.get("score")),
        "level": payload.get("level"),
        "feedback_short": payload.get("feedbackShort"),
        "feedback_long": payload.get("feedbackLong"),
        "sleep_score": _i(payload.get("sleepScore")),
        "sleep_score_factor_pct": _i(payload.get("sleepScoreFactorPercent")),
        "recovery_time_min": _i(payload.get("recoveryTime")),
        "recovery_time_factor_pct": _i(payload.get("recoveryTimeFactorPercent")),
        "acwr_factor_pct": _i(payload.get("acwrFactorPercent")),
        "acute_load": _i(payload.get("acuteLoad")),
        "hrv_factor_pct": _i(payload.get("hrvFactorPercent")),
        "hrv_weekly_average": _i(payload.get("hrvWeeklyAverage")),
        "stress_history_factor_pct": _i(payload.get("stressHistoryFactorPercent")),
        "sleep_history_factor_pct": _i(payload.get("sleepHistoryFactorPercent")),
        "valid_sleep": 1 if payload.get("validSleep") else 0,
        "input_context": payload.get("inputContext"),
        "timestamp_local": payload.get("timestampLocal"),
        "synced_at": now,
    }


DAILY_SOURCES_EXTRA = [
    ("morning_readiness", "get_morning_training_readiness", extract_morning_readiness),
]


def sync_range_metrics(conn: sqlite3.Connection, client: Garmin, start: str, end: str) -> Dict[str, int]:
    """Endpoints that take a date range and return per-period rows."""
    now = dt.datetime.now().isoformat(timespec="seconds")
    counts: Dict[str, int] = {}

    # running tolerance -- Garmin's impact-load / injury-risk metric
    try:
        rows = client.get_running_tolerance(start, end) or []
        for row in rows:
            date = row.get("calendarDate")
            if not date:
                continue
            upsert(conn, "running_tolerance", "date", {
                "date": date,
                "total_impact_load": _f(row.get("totalImpactLoad")),
                "total_distance_m": _f(row.get("totalDistance")),
                "tolerance": _f(row.get("tolerance")),
                "start_of_week": row.get("startOfWeek"),
                "end_of_week": row.get("endOfWeek"),
                "synced_at": now,
            })
        counts["running_tolerance"] = len(rows)
    except Exception as exc:
        print(f"  running_tolerance ERROR {exc}", file=sys.stderr)

    # body composition -- richer than get_weigh_ins (adds fat/water/muscle)
    try:
        payload = client.get_body_composition(start, end) or {}
        rows = payload.get("dateWeightList") or []
        for row in rows:
            date = row.get("calendarDate")
            if not date:
                continue
            upsert(conn, "body_composition", "date", {
                "date": date,
                "weight_g": _f(row.get("weight")),
                "bmi": _f(row.get("bmi")),
                "body_fat": _f(row.get("bodyFat")),
                "body_water": _f(row.get("bodyWater")),
                "bone_mass": _f(row.get("boneMass")),
                "muscle_mass": _f(row.get("muscleMass")),
                "physique_rating": _f(row.get("physiqueRating")),
                "visceral_fat": _f(row.get("visceralFat")),
                "metabolic_age": _f(row.get("metabolicAge")),
                "source_type": row.get("sourceType"),
                "synced_at": now,
            })
        counts["body_composition"] = len(rows)
    except Exception as exc:
        print(f"  body_composition ERROR {exc}", file=sys.stderr)

    # weekly rollups: steps and stress arrive separately, merged on week start
    try:
        weeks: Dict[str, Dict[str, Any]] = {}
        for row in client.get_weekly_steps(end, 52) or []:
            wk = row.get("calendarDate")
            vals = row.get("values") or {}
            if wk:
                weeks.setdefault(wk, {})["steps"] = vals
        for row in client.get_weekly_stress(end, 52) or []:
            wk = row.get("calendarDate")
            if wk:
                weeks.setdefault(wk, {})["stress"] = row.get("value")
        for wk, data in weeks.items():
            steps = data.get("steps") or {}
            upsert(conn, "weekly_summary", "week_start", {
                "week_start": wk,
                "total_steps": _f(steps.get("totalSteps")),
                "average_steps": _f(steps.get("averageSteps")),
                "total_distance_m": _f(steps.get("totalDistance")),
                "average_distance_m": _f(steps.get("averageDistance")),
                "data_days_count": _i(steps.get("wellnessDataDaysCount")),
                "avg_stress": _i(data.get("stress")),
                "synced_at": now,
            })
        counts["weekly_summary"] = len(weeks)
    except Exception as exc:
        print(f"  weekly_summary ERROR {exc}", file=sys.stderr)

    conn.commit()
    return counts


def sync_reference_extra(conn: sqlite3.Connection, client: Garmin) -> Dict[str, int]:
    """Account-level reference data added in round three."""
    now = dt.datetime.now().isoformat(timespec="seconds")
    counts: Dict[str, int] = {}

    try:
        ftp = client.get_cycling_ftp() or {}
        if isinstance(ftp, list):
            ftp = ftp[0] if ftp else {}
        cal = (ftp.get("calendarDate") or "")[:10]
        if cal and ftp.get("functionalThresholdPower") is not None:
            upsert(conn, "threshold_metrics", "date", {
                "date": cal,
                "sport": ftp.get("sport"),
                "functional_threshold_power": _i(ftp.get("functionalThresholdPower")),
                "is_stale": 1 if ftp.get("isStale") else 0,
                "source_type": ftp.get("biometricSourceType"),
                "synced_at": now,
            })
            counts["threshold_metrics"] = 1
    except Exception as exc:
        print(f"  threshold_metrics ERROR {exc}", file=sys.stderr)

    try:
        badges = client.get_earned_badges() or []
        for b in badges:
            if b.get("badgeId") is None:
                continue
            upsert(conn, "badges", "badge_id, earned_number", {
                "badge_id": _i(b.get("badgeId")),
                # Repeatable badges are earned more than once; default to 1 so
                # the composite key stays well-defined.
                "earned_number": _i(b.get("badgeEarnedNumber")) or 1,
                "badge_key": b.get("badgeKey"),
                "badge_name": b.get("badgeName"),
                "category_id": _i(b.get("badgeCategoryId")),
                "difficulty_id": _i(b.get("badgeDifficultyId")),
                "points": _i(b.get("badgePoints")),
                "earned_date": b.get("badgeEarnedDate"),
                "progress_value": _f(b.get("badgeProgressValue")),
                "target_value": _f(b.get("badgeTargetValue")),
                "premium": 1 if b.get("premium") else 0,
                "synced_at": now,
            })
        counts["badges"] = len(badges)
    except Exception as exc:
        print(f"  badges ERROR {exc}", file=sys.stderr)

    try:
        types = client.get_activity_types() or []
        for t in types:
            if t.get("typeId") is None:
                continue
            upsert(conn, "activity_types", "type_id", {
                "type_id": _i(t.get("typeId")),
                "type_key": t.get("typeKey"),
                "parent_type_id": _i(t.get("parentTypeId")),
                "is_hidden": 1 if t.get("isHidden") else 0,
                "trimmable": 1 if t.get("trimmable") else 0,
                "restricted": 1 if t.get("restricted") else 0,
                "synced_at": now,
            })
        counts["activity_types"] = len(types)
    except Exception as exc:
        print(f"  activity_types ERROR {exc}", file=sys.stderr)

    try:
        import json as _json
        stored = 0
        for dev in client.get_devices() or []:
            dev_id = dev.get("deviceId") or dev.get("unitId")
            if not dev_id:
                continue
            s = client.get_device_settings(str(dev_id)) or {}
            upsert(conn, "device_settings", "device_id", {
                "device_id": _i(dev_id),
                "time_format": s.get("timeFormat"),
                "date_format": s.get("dateFormat"),
                "measurement_units": s.get("measurementUnits"),
                "alarms_json": _json.dumps(s.get("alarms"), default=str),
                # Kept whole: this payload is the only record of watch config,
                # and which field matters is not knowable in advance.
                "raw_json": _json.dumps(s, default=str),
                "synced_at": now,
            })
            stored += 1
            time.sleep(REQUEST_PAUSE_S)
        counts["device_settings"] = stored
    except Exception as exc:
        print(f"  device_settings ERROR {exc}", file=sys.stderr)

    conn.commit()
    return counts


def sync_intraday(conn: sqlite3.Connection, client: Garmin, dates: Iterable[str]) -> Dict[str, int]:
    """Minute-level series. Opt-in: ~1000 rows per day, unusable by the
    correlation engine (which needs daily scalars), useful only for charts."""
    now = dt.datetime.now().isoformat(timespec="seconds")
    counts = {"steps": 0, "stress": 0, "body_battery": 0}

    for date in dates:
        try:
            for row in client.get_steps_data(date) or []:
                if not row.get("startGMT"):
                    continue
                upsert(conn, "intraday_steps", "date, start_gmt", {
                    "date": date,
                    "start_gmt": row.get("startGMT"),
                    "end_gmt": row.get("endGMT"),
                    "steps": _i(row.get("steps")),
                    "pushes": _i(row.get("pushes")),
                    "activity_level": row.get("primaryActivityLevel"),
                    "synced_at": now,
                })
                counts["steps"] += 1
        except Exception as exc:
            print(f"  intraday_steps {date} ERROR {exc}", file=sys.stderr)

        try:
            payload = client.get_stress_data(date) or {}
            for ts, level in payload.get("stressValuesArray") or []:
                # Garmin encodes "not measured" as a negative level.
                if level is None or level < 0:
                    continue
                upsert(conn, "intraday_stress", "date, timestamp_ms", {
                    "date": date, "timestamp_ms": _i(ts),
                    "stress_level": _i(level), "synced_at": now,
                })
                counts["stress"] += 1
            for entry in payload.get("bodyBatteryValuesArray") or []:
                if len(entry) < 3:
                    continue
                upsert(conn, "intraday_body_battery", "date, timestamp_ms", {
                    "date": date, "timestamp_ms": _i(entry[0]),
                    "status": entry[1], "level": _i(entry[2]),
                    "version": _f(entry[3]) if len(entry) > 3 else None,
                    "synced_at": now,
                })
                counts["body_battery"] += 1
        except Exception as exc:
            print(f"  intraday_stress {date} ERROR {exc}", file=sys.stderr)

        conn.commit()
        time.sleep(REQUEST_PAUSE_S)

    return counts


def sync_activity_samples(conn: sqlite3.Connection, client: Garmin) -> int:
    """Per-activity metric streams. Fetch-once, like the other detail sources."""
    now = dt.datetime.now().isoformat(timespec="seconds")
    done = fetched_activity_details(conn, "samples")
    ids = [r["activity_id"] for r in conn.execute("SELECT activity_id FROM activities ORDER BY date DESC")]
    total = 0
    for activity_id in ids:
        if activity_id in done:
            continue
        try:
            payload = client.get_activity_details(str(activity_id), maxchart=2000, maxpoly=0) or {}
            descriptors = payload.get("metricDescriptors") or []
            # Map Garmin's metric keys to columns by descriptor index.
            # Match Garmin's exact descriptor keys, not substrings: a payload
            # carries sumElapsedDuration, sumMovingDuration AND sumDuration, so
            # a "duration" substring match picks whichever comes first.
            WANTED = {
                "directheartrate": "heart_rate",
                "directspeed": "speed",
                "directelevation": "altitude",
                "directruncadence": "cadence",
                "directbikecadence": "cadence",
                "directdoublecadence": "cadence",
                "directpower": "power",
                "directlatitude": "latitude",
                "directlongitude": "longitude",
                "sumelapsedduration": "elapsed_s",
                # Running dynamics: measured by the watch, no modelling needed.
                "directgroundcontacttime": "ground_contact_ms",
                "directverticaloscillation": "vertical_oscillation_cm",
                "directverticalratio": "vertical_ratio",
                "directstridelength": "stride_length_cm",
                "directgradeadjustedspeed": "grade_adj_speed",
                "directimpactloadfactor": "impact_load_factor",
                "directperformancecondition": "performance_condition",
                "directavailablestamina": "available_stamina",
                "directverticalspeed": "vertical_speed",
            }
            idx: Dict[str, int] = {}
            for desc in descriptors:
                key = (desc.get("key") or "").lower()
                i = desc.get("metricsIndex")
                col = WANTED.get(key)
                if col and i is not None and col not in idx:
                    idx[col] = i
            metrics = payload.get("activityDetailMetrics") or []
            for n, sample in enumerate(metrics):
                vals = sample.get("metrics") or []
                def at(col):
                    i = idx.get(col)
                    return _f(vals[i]) if i is not None and i < len(vals) else None
                upsert(conn, "activity_samples", "activity_id, sample_index", {
                    "activity_id": activity_id, "sample_index": n,
                    "elapsed_s": at("elapsed_s"), "heart_rate": at("heart_rate"),
                    "speed": at("speed"), "altitude": at("altitude"),
                    "cadence": at("cadence"), "power": at("power"),
                    "latitude": at("latitude"), "longitude": at("longitude"),
                    "ground_contact_ms": at("ground_contact_ms"),
                    "vertical_oscillation_cm": at("vertical_oscillation_cm"),
                    "vertical_ratio": at("vertical_ratio"),
                    "stride_length_cm": at("stride_length_cm"),
                    "grade_adj_speed": at("grade_adj_speed"),
                    "impact_load_factor": at("impact_load_factor"),
                    "performance_condition": at("performance_condition"),
                    "available_stamina": at("available_stamina"),
                    "vertical_speed": at("vertical_speed"),
                    "synced_at": now,
                })
            total += len(metrics)
            log_activity_detail(conn, activity_id, "samples", "ok" if metrics else "empty")
        except Exception as exc:
            log_activity_detail(conn, activity_id, "samples", "error", f"{type(exc).__name__}: {exc}")
        conn.commit()
        time.sleep(REQUEST_PAUSE_S)
    return total


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=90, help="days back to cover")
    parser.add_argument(
        "--refresh-days",
        type=int,
        default=3,
        help="always re-fetch this many recent days (Garmin revises them)",
    )
    parser.add_argument("--full", action="store_true", help="ignore sync_log, refetch all")
    parser.add_argument(
        "--no-details",
        action="store_true",
        help="skip per-activity detail (laps, HR zones, weather, sets)",
    )
    parser.add_argument(
        "--details-only",
        action="store_true",
        help="only fetch per-activity detail and reference data",
    )
    parser.add_argument(
        "--intraday",
        action="store_true",
        help="also fetch minute-level series (~1000 rows/day) and activity samples",
    )
    args = parser.parse_args()

    today = dt.date.today()
    start = today - dt.timedelta(days=args.days - 1)
    dates = [(start + dt.timedelta(days=i)).isoformat() for i in range(args.days)]
    refresh_cutoff = (today - dt.timedelta(days=args.refresh_days - 1)).isoformat()

    print(f"Syncing {dates[0]} -> {dates[-1]} ({len(dates)} days) into {DB_PATH}")

    conn = connect_db()
    client = Garmin()
    client.login(get_token_path())
    print(f"Authenticated as {client.get_full_name()}\n")

    for table, method, extract in (
        [] if args.details_only else DAILY_SOURCES + DAILY_SOURCES_EXTRA
    ):
        skip: set = set()
        if not args.full:
            # Recent days are always re-fetched: Garmin backfills and revises
            # them for a few days after the fact.
            skip = {d for d in fetched_dates(conn, table) if d < refresh_cutoff}
        counts = sync_daily(conn, client, dates, table, method, extract, skip)
        print(
            f"{table:20s} ok={counts['ok']:3d} empty={counts['empty']:3d} "
            f"error={counts['error']:3d} skipped={counts['skipped']:3d}"
        )

    # Range-based sources: one call each for the whole window, so they are not
    # part of the per-date DAILY_SOURCES loop and need no sync_log gating.
    # One failing range source must not discard the per-date work already
    # committed above, so each is reported and skipped rather than raising.
    for name, fn in (
        []
        if args.details_only
        else [
            ("activities", sync_activities),
            ("body_battery", sync_body_battery),
            ("weight", sync_weight),
        ]
    ):
        try:
            n = fn(conn, client, dates[0], dates[-1])
            print(f"{name:20s} fetched={n}")
        except Exception as exc:
            log_sync(conn, name, dates[-1], "error", f"{type(exc).__name__}: {exc}")
            conn.commit()
            print(f"{name:20s} ERROR {type(exc).__name__}: {exc}", file=sys.stderr)

    if not args.details_only:
        print("\nRange metrics:")
        for name, count in sync_range_metrics(conn, client, dates[0], dates[-1]).items():
            print(f"  {name:18s} {count}")

    print("\nReference data:")
    ref = sync_reference_data(conn, client)
    ref.update(sync_reference_extra(conn, client))
    for name, count in ref.items():
        print(f"  {name:18s} {count}")

    if not args.no_details:
        print("\nPer-activity detail:")
        sync_activity_details(conn, client)

    if args.intraday:
        print("\nIntraday series:")
        for name, count in sync_intraday(conn, client, dates).items():
            print(f"  {name:18s} {count} points")
        print(f"  {'activity_samples':18s} {sync_activity_samples(conn, client)} points")

    print("\nRow counts:")
    for table in (
        "daily_stats",
        "wellness",
        "sleep",
        "hrv",
        "training_readiness",
        "training_load",
        "spo2",
        "respiration",
        "intensity_minutes",
        "hydration",
        "fitness_age",
        "body_battery",
        "weight",
        "activities",
        "activity_laps",
        "activity_hr_zones",
        "activity_weather",
        "activity_exercise_sets",
        "personal_records",
        "gear",
        "devices",
        "morning_readiness",
        "running_tolerance",
        "body_composition",
        "weekly_summary",
        "threshold_metrics",
        "badges",
        "activity_types",
        "device_settings",
        "intraday_steps",
        "intraday_stress",
        "intraday_body_battery",
        "activity_samples",
    ):
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table:20s} {count}")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
