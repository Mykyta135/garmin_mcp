"""Unit tests for the local-snapshot tools (no Garmin access, temp SQLite only)."""
import datetime as dt
import sqlite3
from pathlib import Path

import pytest

from garmin_mcp import local_db

SCHEMA = Path(__file__).resolve().parents[2] / "scripts" / "schema.sql"
TODAY = dt.date(2026, 11, 11)


@pytest.fixture
def conn(tmp_path):
    db = sqlite3.connect(tmp_path / "garmin.db")
    db.executescript(SCHEMA.read_text())
    now = "2026-11-11T08:00:00"
    db.execute(
        "INSERT INTO morning_readiness(date, score, level, feedback_short, recovery_time_min, sleep_score, synced_at)"
        " VALUES ('2026-11-11', 84, 'HIGH', 'RESTED_AND_READY', 0, 96, ?)", (now,)
    )
    db.execute(
        "INSERT INTO sleep(date, sleep_seconds, deep_seconds, rem_seconds, awake_count, synced_at)"
        " VALUES ('2026-11-11', 32280, 6660, 7260, 1, ?)", (now,)
    )
    db.execute(
        "INSERT INTO hrv(date, last_night_avg, weekly_avg, baseline_balanced_low, baseline_balanced_upper, status, synced_at)"
        " VALUES ('2026-11-11', 53, 47, 45, 59, 'BALANCED', ?)", (now,)
    )
    for date, rhr in (("2026-11-11", 54), ("2026-11-01", 58), ("2026-10-20", 60)):
        db.execute(
            "INSERT INTO daily_stats(date, resting_heart_rate, avg_stress, body_battery_low, body_battery_high, synced_at)"
            " VALUES (?, ?, 19, 34, 100, ?)", (date, rhr, now)
        )
    db.execute(
        "INSERT INTO training_load(date, atl, ctl, tsb, acwr, acwr_status, training_status, vo2max, synced_at)"
        " VALUES ('2026-11-11', 351, 306, -45, 1.1, 'OPTIMAL', 'PRODUCTIVE_3', 36, ?)", (now,)
    )
    db.execute(
        "INSERT INTO training_load(date, atl, ctl, tsb, vo2max, synced_at) VALUES ('2026-10-10', 200, 250, 50, 34.5, ?)",
        (now,),
    )
    db.execute(
        "INSERT INTO activities(activity_id, date, start_time_local, type_key, distance_m, duration_s, moving_duration_s,"
        " avg_hr, max_hr, training_load, aerobic_te, anaerobic_te, synced_at)"
        " VALUES (1, '2026-11-11', '2026-11-11 15:20:00', 'running', 5112, 2918, 2918, 159, 181, 67.7, 3.1, 0.4, ?)",
        (now,),
    )
    db.commit()
    db.row_factory = sqlite3.Row
    yield db
    db.close()


def test_brief_covers_every_section(conn):
    text = local_db.build_brief(conn, TODAY, 7)
    assert "Readiness: 84 HIGH (RESTED_AND_READY)" in text
    assert "Sleep: 8h58" in text
    assert "HRV: 53 ms" in text and "BALANCED" in text
    assert "Resting HR 54 (-5 vs 28-day 59)" in text
    assert "VO2max 36 (+1.5 in 28 d)" in text
    assert "running: 5.1 km, 0h49 9:30/km" in text
    assert "Totals: running 1×" in text


def test_brief_without_data_says_so(tmp_path):
    db = sqlite3.connect(tmp_path / "empty.db")
    db.executescript(SCHEMA.read_text())
    db.row_factory = sqlite3.Row
    text = local_db.build_brief(db, TODAY, 7)
    assert "no row for today" in text
    assert "Activities, last 7 days: 0" in text


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM activities",
        "UPDATE sleep SET sleep_seconds = 0",
        "SELECT 1; DROP TABLE sleep",
        "PRAGMA table_info(sleep)",
        "WITH x AS (SELECT 1) INSERT INTO sleep(date, synced_at) VALUES ('x', 'y')",
    ],
)
def test_query_rejects_writes(conn, sql):
    assert local_db.run_query(conn, sql) == "Only a single read-only SELECT/WITH statement is allowed."


def test_query_limits_rows(conn):
    out = local_db.run_query(conn, "SELECT date FROM daily_stats ORDER BY date", limit=2)
    lines = out.splitlines()
    assert lines[0] == "date"
    assert lines[1:3] == ["2026-10-20", "2026-11-01"]
    assert "more than 2 rows" in lines[3]


def test_query_reports_sql_errors(conn):
    assert local_db.run_query(conn, "SELECT nope FROM sleep").startswith("SQL error:")
