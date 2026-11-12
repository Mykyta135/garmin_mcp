"""Tools over the local SQLite snapshot (data/garmin.db) written by scripts/sync.py.

Why these exist: "sync + how am I doing" was the most repeated request, and each time
the assistant re-wrote ad-hoc sqlite scripts in the shell. These three tools make it
one call each, read the same snapshot the web dashboard reads, and never hit Garmin
except through the sync script.

- sync_local      run scripts/sync.py for the last N days
- daily_brief     readiness, sleep, HRV, load, VO2max and recent activities in one text
- query_garmin_db read-only SELECT over the snapshot
"""
import asyncio
import contextlib
import datetime as dt
import os
import re
import sqlite3
import sys
from pathlib import Path
from statistics import mean
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.getenv("GARMIN_DB_PATH") or REPO_ROOT / "data" / "garmin.db")
SYNC_SCRIPT = REPO_ROOT / "scripts" / "sync.py"
SYNC_TIMEOUT_S = 600
MAX_ROWS = 500
READ_ONLY_SQL = re.compile(r"^\s*(select|with)\b", re.I)
WRITE_WORDS = re.compile(r"\b(insert|update|delete|drop|alter|create|replace|attach|pragma|vacuum)\b", re.I)


def _connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise FileNotFoundError(f"No local snapshot at {DB_PATH}. Run sync_local first.")
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _one(conn, sql: str, *params) -> Optional[sqlite3.Row]:
    try:
        return conn.execute(sql, params).fetchone()
    except sqlite3.OperationalError:
        return None  # table missing in an older snapshot


def _all(conn, sql: str, *params) -> List[sqlite3.Row]:
    try:
        return conn.execute(sql, params).fetchall()
    except sqlite3.OperationalError:
        return []


def _hm(seconds: Optional[float]) -> str:
    if not seconds:
        return "—"
    m = int(round(seconds / 60))
    return f"{m // 60}h{m % 60:02d}"


def _clock(local_ms: Optional[int]) -> str:
    # Garmin's *_local_ms are wall-clock times encoded as epoch ms, so read them as UTC.
    if not local_ms:
        return "—"
    return dt.datetime.fromtimestamp(local_ms / 1000, tz=dt.timezone.utc).strftime("%H:%M")


def _pace(distance_m: Optional[float], duration_s: Optional[float]) -> str:
    if not distance_m or not duration_s or distance_m < 200:
        return ""
    sec_per_km = duration_s / (distance_m / 1000)
    return f" {int(sec_per_km // 60)}:{int(sec_per_km % 60):02d}/km"


def _fmt(value: Any, unit: str = "") -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        value = round(value, 1)
        if value == int(value):
            value = int(value)
    return f"{value}{unit}"


def build_brief(conn: sqlite3.Connection, today: dt.date, days: int = 7) -> str:
    t = today.isoformat()
    since = (today - dt.timedelta(days=days - 1)).isoformat()
    month_ago = (today - dt.timedelta(days=28)).isoformat()
    lines: List[str] = []

    synced = _one(conn, "SELECT max(synced_at) AS s FROM daily_stats")
    lines.append(f"Garmin brief for {t} (snapshot synced {synced['s'] if synced and synced['s'] else 'never'})")

    r = _one(conn, "SELECT * FROM morning_readiness WHERE date = ?", t) or _one(
        conn, "SELECT * FROM training_readiness WHERE date = ?", t
    )
    if r:
        lines.append(
            f"Readiness: {_fmt(r['score'])} {r['level'] or ''} ({r['feedback_short'] or '—'}), "
            f"recovery left {_fmt(r['recovery_time_min'])} min, sleep score {_fmt(r['sleep_score'])}"
        )
    else:
        lines.append("Readiness: no row for today yet (sync after waking, or the watch hasn't uploaded).")

    s = _one(conn, "SELECT * FROM sleep WHERE date = ?", t)
    if s:
        lines.append(
            f"Sleep: {_hm(s['sleep_seconds'])} ({_clock(s['sleep_start_local_ms'])}–{_clock(s['sleep_end_local_ms'])}), "
            f"deep {_hm(s['deep_seconds'])}, REM {_hm(s['rem_seconds'])}, woke {_fmt(s['awake_count'])}×"
        )

    h = _one(conn, "SELECT * FROM hrv WHERE date = ?", t)
    if h:
        lines.append(
            f"HRV: {_fmt(h['last_night_avg'])} ms last night, 7-day {_fmt(h['weekly_avg'])}, "
            f"balanced {_fmt(h['baseline_balanced_low'])}–{_fmt(h['baseline_balanced_upper'])} → {h['status'] or '—'}"
        )

    d = _one(conn, "SELECT * FROM daily_stats WHERE date = ?", t)
    rhr_avg = _one(
        conn,
        "SELECT avg(resting_heart_rate) AS a FROM daily_stats WHERE date >= ? AND date < ? AND resting_heart_rate > 0",
        month_ago, t,
    )
    if d:
        avg = rhr_avg["a"] if rhr_avg else None
        delta = f" ({d['resting_heart_rate'] - avg:+.0f} vs 28-day {avg:.0f})" if avg and d["resting_heart_rate"] else ""
        lines.append(
            f"Resting HR {_fmt(d['resting_heart_rate'])}{delta}, stress avg {_fmt(d['avg_stress'])}, "
            f"body battery {_fmt(d['body_battery_low'])}–{_fmt(d['body_battery_high'])}"
        )

    load = _one(conn, "SELECT * FROM training_load WHERE atl IS NOT NULL ORDER BY date DESC LIMIT 1")
    if load:
        acwr = load["acwr"] if load["acwr"] is not None else (
            load["acwr_percent"] / 100 if load["acwr_percent"] is not None else None
        )
        vo2_then = _one(
            conn, "SELECT vo2max FROM training_load WHERE date <= ? AND vo2max IS NOT NULL ORDER BY date DESC LIMIT 1",
            month_ago,
        )
        vo2_delta = ""
        if vo2_then and load["vo2max"] is not None and vo2_then["vo2max"] is not None:
            vo2_delta = f" ({load['vo2max'] - vo2_then['vo2max']:+.1f} in 28 d)"
        lines.append(
            f"Load ({load['date']}): acute {_fmt(load['atl'])}, chronic {_fmt(load['ctl'])}, form {_fmt(load['tsb'])}, "
            f"ACWR {_fmt(acwr)} {load['acwr_status'] or ''}; status {load['training_status'] or '—'}; "
            f"VO2max {_fmt(load['vo2max'])}{vo2_delta}"
        )

    acts = _all(
        conn,
        "SELECT * FROM activities WHERE date >= ? ORDER BY start_time_local DESC",
        since,
    )
    lines.append(f"Activities, last {days} days: {len(acts)}")
    totals: Dict[str, Dict[str, float]] = {}
    for a in acts:
        kind = a["type_key"] or "other"
        tot = totals.setdefault(kind, {"n": 0, "km": 0.0, "load": 0.0, "min": 0.0})
        tot["n"] += 1
        tot["km"] += (a["distance_m"] or 0) / 1000
        tot["load"] += a["training_load"] or 0
        tot["min"] += (a["duration_s"] or 0) / 60
        pace = _pace(a["distance_m"], a["moving_duration_s"] or a["duration_s"]) if kind in ("running", "walking", "trail_running", "treadmill_running") else ""
        lines.append(
            f"- {a['date']} {kind}: {_fmt((a['distance_m'] or 0) / 1000)} km, {_hm(a['duration_s'])}{pace}, "
            f"HR {_fmt(a['avg_hr'])}/{_fmt(a['max_hr'])}, load {_fmt(a['training_load'])}, "
            f"TE {_fmt(a['aerobic_te'])}/{_fmt(a['anaerobic_te'])}"
        )
    if totals:
        lines.append(
            "Totals: " + "; ".join(
                f"{k} {int(v['n'])}× {v['km']:.1f} km {int(v['min'])} min load {int(v['load'])}"
                for k, v in sorted(totals.items(), key=lambda kv: -kv[1]["load"])
            )
        )

    trend = _all(
        conn,
        "SELECT h.date, h.last_night_avg AS hrv, d.resting_heart_rate AS rhr, s.sleep_seconds AS sleep "
        "FROM hrv h LEFT JOIN daily_stats d USING(date) LEFT JOIN sleep s USING(date) "
        "WHERE h.date >= ? ORDER BY h.date",
        since,
    )
    if trend:
        hrvs = [row["hrv"] for row in trend if row["hrv"]]
        sleeps = [row["sleep"] for row in trend if row["sleep"]]
        lines.append(
            f"{days}-day trend: HRV {' '.join(_fmt(row['hrv']) for row in trend)}"
            + (f" (avg {mean(hrvs):.0f})" if hrvs else "")
            + (f"; sleep avg {_hm(mean(sleeps))}" if sleeps else "")
        )
    return "\n".join(lines)


def run_query(conn: sqlite3.Connection, sql: str, limit: int = 200) -> str:
    if not READ_ONLY_SQL.match(sql) or WRITE_WORDS.search(sql) or ";" in sql.strip().rstrip(";"):
        return "Only a single read-only SELECT/WITH statement is allowed."
    limit = max(1, min(int(limit), MAX_ROWS))
    try:
        cur = conn.execute(sql)
    except sqlite3.Error as e:
        return f"SQL error: {e}"
    cols = [c[0] for c in cur.description or []]
    rows = cur.fetchmany(limit + 1)
    more = len(rows) > limit
    out = [" | ".join(cols)] + [" | ".join("" if v is None else str(v) for v in row) for row in rows[:limit]]
    if more:
        out.append(f"… more than {limit} rows; narrow the query or raise limit (max {MAX_ROWS}).")
    return "\n".join(out)


async def run_sync(days: int, details: bool) -> str:
    days = max(1, min(int(days), 120))
    cmd = [sys.executable, str(SYNC_SCRIPT), "--days", str(days), "--refresh-days", str(min(days, 7))]
    if not details:
        cmd.append("--no-details")
    proc = await asyncio.create_subprocess_exec(
        *cmd, cwd=str(REPO_ROOT), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=SYNC_TIMEOUT_S)
    except asyncio.TimeoutError:
        proc.kill()
        return f"Sync timed out after {SYNC_TIMEOUT_S}s; partial data may be stored. Try fewer days."
    text = out.decode(errors="replace").strip().splitlines()
    tail = "\n".join(text[-25:])
    status = "ok" if proc.returncode == 0 else f"failed (exit {proc.returncode})"
    hint = ""
    if proc.returncode != 0 and re.search(r"auth|token|login", tail, re.I):
        hint = "\nLooks like expired Garmin tokens: run `./.venv/bin/garmin-mcp-auth` in the repo, then retry."
    return f"Sync {status} for the last {days} day(s).\n{tail}{hint}"


def register_tools(app):
    @app.tool()
    async def sync_local(days: int = 3, details: bool = True) -> str:
        """Refresh the local snapshot (data/garmin.db) from Garmin Connect for the last N days.

        Use this before daily_brief or query_garmin_db when the user says "sync", "онови дані",
        or just finished a run/sleep. Default 3 days (Garmin revises recent days). details=False
        skips per-activity laps/zones/weather and is much faster.
        """
        return await run_sync(days, details)

    @app.tool()
    async def daily_brief(days: int = 7, date: str = "") -> str:
        """One-call summary from the local snapshot: today's readiness, last night's sleep and HRV,
        resting HR vs 28-day average, training load (acute/chronic/form/ACWR), status, VO2max trend,
        and every activity of the last N days with pace/HR/load. date=YYYY-MM-DD for another day.
        Run sync_local first if the snapshot is older than the user's latest activity."""
        try:
            day = dt.date.fromisoformat(date) if date else dt.date.today()
            with contextlib.closing(_connect()) as conn:
                return build_brief(conn, day, max(1, min(int(days), 42)))
        except Exception as e:
            return f"Error building brief: {e}"

    @app.tool()
    async def query_garmin_db(sql: str, limit: int = 200) -> str:
        """Read-only SQL (one SELECT/WITH) over the local snapshot. Tables are keyed on date
        (YYYY-MM-DD): daily_stats, sleep, hrv, training_readiness, morning_readiness, training_load,
        activities (activity_id, date, type_key, distance_m, duration_s, avg_hr, training_load, …),
        activity_laps, activity_hr_zones, weight, body_battery, wellness, … Use
        `SELECT name, sql FROM sqlite_master WHERE type='table'` to see columns."""
        try:
            with contextlib.closing(_connect()) as conn:
                return run_query(conn, sql, limit)
        except Exception as e:
            return f"Error: {e}"

    return app
