# How to run this

Two pieces: a **sync script** that snapshots Garmin Connect into SQLite, and a
**Next.js dashboard** that reads that snapshot. The dashboard never talks to
Garmin — so a page load can't break when Garmin changes an endpoint.

```
scripts/sync.py      Garmin  ->  data/garmin.db
web/                 data/garmin.db  ->  dashboard
```

---

## First-time setup

### 1. Authenticate with Garmin (once every ~6 months)

```bash
cd garmin_mcp
./.venv/bin/garmin-mcp-auth
```

Prompts for email, password, and an MFA code if enabled. Writes OAuth tokens to
`~/.garminconnect` (chmod 0600). No credentials are stored in the repo.

Check them at any time:

```bash
./.venv/bin/garmin-mcp-auth --verify
```

Until this is done every sync fails with an instruction to authenticate.

### 2. Install web dependencies (once)

```bash
cd web && npm install
```

---

## Daily use

### Sync, then view

```bash
cd garmin_mcp
./.venv/bin/python scripts/sync.py     # pull new data
cd web && npm run dev                  # http://localhost:3000
```

That's the whole loop. Sync takes a couple of minutes on a normal run (it skips
days it already has); the dev server starts in a few seconds.

---

## Sync options

```bash
./.venv/bin/python scripts/sync.py                 # last 90 days, fill gaps
./.venv/bin/python scripts/sync.py --days 30       # narrower window
./.venv/bin/python scripts/sync.py --refresh-days 7  # re-fetch last 7 days
./.venv/bin/python scripts/sync.py --full          # ignore sync_log, refetch all
./.venv/bin/python scripts/sync.py --no-details    # skip per-activity detail (faster)
./.venv/bin/python scripts/sync.py --details-only  # only activity detail + reference data
./.venv/bin/python scripts/sync.py --intraday      # also minute-level series (slow, large)
```

### Intraday series (`--intraday`)

Off by default. Adds minute-level stress, Body Battery and step buckets
(~1,000 points per day) plus per-activity metric streams (HR, speed, altitude,
cadence, power — up to 2,000 samples per activity). ~52,000 rows for 27 days.

The correlation engine cannot use these: it works on daily scalars. They exist
for intraday charts — stress across a day, HR within one activity. Skip the flag
unless you want those.

### Per-activity detail

Laps, HR zones, weather and exercise sets cost **one HTTP request per activity
per source** — ~4 requests per activity. They are fetched once and never
re-fetched, since an activity's splits don't change after upload, so a normal
re-run makes zero extra calls. Use `--no-details` to skip them entirely on a
quick sync.

**Safe to re-run.** Rows are upserted on the date key, so nothing duplicates.
`sync_log` records which dates were fetched — *including days Garmin had no data
for* — so empty days aren't re-requested forever. The most recent 3 days are
always re-fetched, since Garmin revises them after the fact.

**Read-only.** Every Garmin call in `sync.py` is a `get_*`. Nothing writes to
your Garmin account.

### Reading the output

```
daily_stats   ok=  7 empty=  0 error=  0 skipped= 83
```

- `ok` — fetched and stored
- `empty` — Garmin returned nothing (day before you owned the watch, or not worn)
- `error` — request failed; the run continues, and the date is retried next time
- `skipped` — already have it, outside the refresh window

---

## The dashboard

| Page | What it shows |
|---|---|
| `/` → **Readiness** | readiness score, overnight HRV, sleep stages, Body Battery vs. stress |
| `/` → **Training load** | CTL/ATL/TSB, daily load, HR-zone totals, activity table |
| `/` → **Correlations** | HRV against rolling 7-day load |
| `/activity` | every activity; click one for detail |
| `/activity/[id]` | HR & elevation streams, speed/cadence/power, zone breakdown, laps, exercise sets, weather |
| `/body` | fitness age, morning readiness, running impact load, weekly volume, weight, device info |
| `/day` | minute-level stress and Body Battery for one day (needs `--intraday`) |
| `/recovery` | **what today should look like** — Body Battery at wake with thresholds, sleep insights |
| `/running` | running economy — cadence, ground contact, vertical ratio against height-scaled norms |
| `/segments` | cycling rides cut into 60s blocks, grouped by gradient, with r² honesty check |
| `/experiments` | cross-sport efficiency, swimming SWOLF, performance condition, impact load |
| `/achievements` | personal records and badges |
| `/matrix` | every metric pair, same-day and lagged, ranked by FDR-adjusted q |

Charts render only the metrics an activity actually has: a bike with no cadence
sensor still shows speed, and swimming shows neither. A missing sensor never
hides the readings that do exist.

### Measured vs modelled

The analysis pages separate these deliberately, because conflating them
produces confident nonsense:

**Measured** (trust the absolute number) — running dynamics come off the watch's
own sensors: ground contact time, vertical oscillation, stride length, running
power, grade-adjusted speed. Nothing is estimated.

**Modelled** (trust only the direction, if that) — `lib/cycling.ts` reconstructs
cycling power from physics because Garmin will not estimate cycling VO2 max
without a power meter. Its CdA and Crr are guesses, so absolute watts are
wrong; they cancel in a ratio only while gravity dominates. At this rider's
~1.3% gradients the aero term dominates instead, so `/segments` uses gradient
only to *bucket* segments and compares measured speed-per-heartbeat within each
bucket.

### Honesty guards

Two findings during development drove these, and both were artefacts that
looked like progress:

- A six-ride comparison showed **+21.5% fitness gain**. It was sort order: the
  earliest rides in that sample were the slowest. Segmenting into 60s blocks
  turned 6 points into ~250 and the trend vanished (r² ≈ 0.06).
- Barometric altitude differenced per-sample reported **2314 m of climbing** on
  a ride whose laps recorded 271 m. The altimeter reads pressure, not height,
  and jitters ~0.5 m at 1 Hz. Elevation now comes from Garmin's own lap totals.

So `/segments` prints r² beside every trend and labels anything under 0.25 as
"no trend — noise", and `/running` shows each metric's correlation with speed —
metres-per-beat is r ≈ 0.98 against pace, i.e. almost entirely a restatement of
how fast you ran.

### Swimming

`swim_lengths` stores per-length pool data: SWOLF, stroke count and the stroke
style Garmin detected. Distance-per-stroke is computed here because Garmin
reports `averageStrokeDistance` as 0.0.

SWOLF is null on DRILL lengths and that is correct, not a fault: a drill has a
deliberately abnormal stroke pattern (one arm, kickboard, paddles) so Garmin
counts no strokes. Swim in Freestyle or Breaststroke mode to get SWOLF.

### Height-scaled norms

Cadence norms scale as 1/sqrt(leg length), so the usual "170–180 spm" figure —
derived from runners 175–185 cm tall — is wrong for a 153 cm runner. The
scaled target is ~189 spm. `HEIGHT_M` in `lib/running.ts` drives this; change it
if the rider changes.

### What's in the snapshot

**35 tables**, covering 37 of the library's 94 read endpoints.

- **Daily metrics** — stats, wellness, sleep, HRV, training readiness, morning
  readiness, training load, SpO2, respiration, intensity minutes, hydration,
  fitness age, body battery, weight, body composition
- **Activities** — summary, laps, HR zones, weather, exercise sets, samples
- **Periodic** — weekly rollups, running tolerance, FTP/threshold metrics
- **Reference** — personal records, gear, devices, device settings, badges,
  activity types
- **Intraday** (opt-in) — stress, body battery, steps, activity samples

Deliberately not stored, and why:

| Skipped | Reason |
|---|---|
| nutrition (3) | nothing logged on this account |
| golf (3), women's health (3) | not applicable |
| workouts, plans, goals (7) | all return empty |
| badges/challenges (7 of 9) | social features, unused |
| `get_max_metrics`, endurance, hill score | return empty or all-null |
| `get_stats_and_body`, `get_floors`, `get_heart_rates`, `get_rhr_day`, `get_all_day_stress`, `get_daily_steps` | subsets of `get_user_summary`, already stored |

Empty tables are worse than absent ones — these get added if the data ever
starts arriving.

```bash
cd web
npm run dev     # dev server, hot reload
npm run build   # production build
npm start       # serve the production build
```

### Reading the matrix

It tests ~1,500 hypotheses, so most of the work is *not* reporting noise:

- **r** — the correlation, −1 to +1
- **n** — paired days behind it
- **q** — false-discovery-adjusted p-value. Rank on this, not r.
- **Holds up** — q<0.05 with 21+ paired days
- **Provisional** — q<0.05 but fewer than 21 days: worth noting, not acting on
- Below 12 paired days nothing is reported at all

Two caveats the page states and that are worth repeating: consecutive days
aren't independent samples, so even a passing q overstates certainty; and
correlation isn't causation, lag or no lag.

---

## Troubleshooting

**"No Garmin snapshot at …"** — the database doesn't exist yet. Run the sync.

**Sync fails with an auth error** — tokens expired (~6 months). Re-run
`./.venv/bin/garmin-mcp-auth`.

**"Another next dev server is already running"** — Next 16 allows one dev server
per directory. It names the PID and port; either use that one or `kill <PID>`.

**"requested date range is too big"** — Garmin caps body-battery requests at 31
days. `sync.py` already chunks around this; if you see it from another endpoint,
that endpoint needs the same treatment.

**Matrix says "not enough data yet"** — fewer than 12 paired days for every
metric pair. It fills in on its own; nothing to fix.

---

## Morning brief (launchd, 08:30)

`scripts/morning_brief.py` syncs the last 3 days, writes `data/brief-latest.txt`
(+ `data/briefs/brief-<date>.txt`) and shows a macOS notification with readiness,
HRV and sleep. If the Mac was asleep at 08:30, it runs on wake. No LLM involved.

```bash
# status / run now / log
launchctl print gui/$(id -u)/local.garmin-morning-brief | grep state
launchctl kickstart gui/$(id -u)/local.garmin-morning-brief
tail -f ~/Library/Logs/garmin-morning-brief.log
# remove
launchctl bootout gui/$(id -u)/local.garmin-morning-brief && rm ~/Library/LaunchAgents/local.garmin-morning-brief.plist
```

The same brief is available in Claude as the MCP tool `daily_brief` (plus
`sync_local` and read-only `query_garmin_db`).

---

## Notes

- `GARMIN_DB_PATH` overrides the database location (default `../data/garmin.db`).
- `data/*.db` is gitignored. It's personal health data — don't commit it.
- `web/AGENTS.md` and `web/CLAUDE.md` are generated by `next dev`, not written by hand.
- Tokens live in `~/.garminconnect`, outside the repo.
