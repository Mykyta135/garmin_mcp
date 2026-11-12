-- Local snapshot of Garmin Connect data. One row per calendar date per table,
-- so cross-metric questions ("HRV on high-load weeks") are a join, not N API
-- calls. Every table is keyed on `date` (YYYY-MM-DD) for exactly that reason.
--
-- Sync is idempotent: scripts/sync.py upserts on the date key, so re-running is
-- safe and recent days get corrected as Garmin revises them.

CREATE TABLE IF NOT EXISTS daily_stats (
    date                     TEXT PRIMARY KEY,
    total_calories           REAL,
    active_calories          REAL,
    -- Garmin's bmrKilocalories is really RMR (basal plus sedentary-to-light
    -- movement), not true BMR. Named after the field, read with that caveat.
    resting_calories         REAL,
    total_steps              INTEGER,
    total_distance_m         INTEGER,
    min_heart_rate           INTEGER,
    max_heart_rate           INTEGER,
    resting_heart_rate       INTEGER,
    avg_stress               INTEGER,
    max_stress               INTEGER,
    body_battery_high        INTEGER,
    body_battery_low         INTEGER,
    moderate_intensity_min   INTEGER,
    vigorous_intensity_min   INTEGER,
    floors_ascended          REAL,
    synced_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sleep (
    date                     TEXT PRIMARY KEY,
    sleep_seconds            INTEGER,
    nap_seconds              INTEGER,
    deep_seconds             INTEGER,
    light_seconds            INTEGER,
    rem_seconds              INTEGER,
    awake_seconds            INTEGER,
    awake_count              INTEGER,
    avg_sleep_stress         REAL,
    avg_spo2                 REAL,
    lowest_spo2              INTEGER,
    avg_respiration          REAL,
    sleep_start_local_ms     INTEGER,
    sleep_end_local_ms       INTEGER,
    synced_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hrv (
    date                     TEXT PRIMARY KEY,
    last_night_avg           INTEGER,
    last_night_5min_high     INTEGER,
    weekly_avg               INTEGER,
    -- baseline/status stay NULL until Garmin establishes an HRV baseline;
    -- expect gaps across early dates in the backfill.
    baseline_low_upper       INTEGER,
    baseline_balanced_low    INTEGER,
    baseline_balanced_upper  INTEGER,
    status                   TEXT,
    feedback_phrase          TEXT,
    synced_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS training_readiness (
    date                     TEXT PRIMARY KEY,
    score                    INTEGER,
    level                    TEXT,
    feedback_short           TEXT,
    sleep_score              INTEGER,
    sleep_score_factor_pct   INTEGER,
    recovery_time_min        INTEGER,
    recovery_time_factor_pct INTEGER,
    acwr_factor_pct          INTEGER,
    acute_load               INTEGER,
    hrv_factor_pct           INTEGER,
    hrv_weekly_average       INTEGER,
    stress_history_factor_pct INTEGER,
    sleep_history_factor_pct INTEGER,
    synced_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS training_load (
    date                     TEXT PRIMARY KEY,
    atl                      REAL,  -- acute (7-day fatigue)
    ctl                      REAL,  -- chronic (42-day fitness)
    tsb                      REAL,  -- ctl - atl (form)
    -- Garmin often leaves dailyAcuteChronicWorkloadRatio null while populating
    -- acwr_percent, so both are stored and readers prefer whichever exists.
    acwr                     REAL,
    acwr_percent             INTEGER,
    acwr_status              TEXT,
    optimal_chronic_min      REAL,
    optimal_chronic_max      REAL,
    training_status          TEXT,
    fitness_trend            INTEGER,
    vo2max                   REAL,
    synced_at                TEXT NOT NULL
);

-- Keyed on activity_id, not date: several activities can share a day. `date` is
-- the local calendar date, indexed so it joins cleanly against the daily tables.
CREATE TABLE IF NOT EXISTS activities (
    activity_id              INTEGER PRIMARY KEY,
    date                     TEXT NOT NULL,
    start_time_local         TEXT,
    name                     TEXT,
    type_key                 TEXT,
    duration_s               REAL,
    moving_duration_s        REAL,
    distance_m               REAL,
    calories                 REAL,
    avg_hr                   REAL,
    max_hr                   REAL,
    avg_speed                REAL,
    elevation_gain           REAL,
    training_load            REAL,
    aerobic_te               REAL,
    anaerobic_te             REAL,
    moderate_intensity_min   INTEGER,
    vigorous_intensity_min   INTEGER,
    steps                    INTEGER,
    synced_at                TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type_key);

-- Records which dates have been fetched per source, including dates Garmin
-- returned nothing for. Without this the sync cannot tell "no data exists" from
-- "never fetched", and would re-request empty days on every run forever.
CREATE TABLE IF NOT EXISTS sync_log (
    source                   TEXT NOT NULL,
    date                     TEXT NOT NULL,
    status                   TEXT NOT NULL,  -- 'ok' | 'empty' | 'error'
    detail                   TEXT,
    synced_at                TEXT NOT NULL,
    PRIMARY KEY (source, date)
);

-- ---------------------------------------------------------------------------
-- Extended metric tables.
--
-- get_user_summary turned out to be a superset of get_stats: it carries the
-- stress-duration breakdown, body-battery charge/drain/sleep values, SpO2,
-- respiration and sedentary/active/sleeping seconds in a single call. It backs
-- `wellness` below, and daily_stats above is kept for continuity.
--
-- Deliberately NOT stored: get_max_metrics (returns {} for this account) and
-- endurance/hill scores (all-null -- Garmin needs months of history first).
-- Empty columns are worse than absent ones; add them when they populate.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wellness (
    date                     TEXT PRIMARY KEY,
    -- time budget: these four partition the day, useful against sleep/HRV
    highly_active_seconds    INTEGER,
    active_seconds           INTEGER,
    sedentary_seconds        INTEGER,
    sleeping_seconds         INTEGER,
    -- stress split by kind, not just an average
    stress_duration          INTEGER,
    rest_stress_duration     INTEGER,
    activity_stress_duration INTEGER,
    low_stress_duration      INTEGER,
    medium_stress_duration   INTEGER,
    high_stress_duration     INTEGER,
    stress_percentage        REAL,
    rest_stress_percentage   REAL,
    -- body battery: charge/drain is the interesting pair, not just the peak
    bb_charged               INTEGER,
    bb_drained               INTEGER,
    bb_during_sleep          INTEGER,
    bb_at_wake_time          INTEGER,
    floors_ascended          REAL,
    floors_descended         REAL,
    floors_ascended_m        REAL,
    avg_spo2                 REAL,
    lowest_spo2              INTEGER,
    avg_waking_respiration   REAL,
    highest_respiration      REAL,
    lowest_respiration       REAL,
    resting_calories_activity REAL,
    avg_altitude_m           REAL,
    last7_avg_resting_hr     INTEGER,
    daily_step_goal          INTEGER,
    intensity_minutes_goal   INTEGER,
    synced_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spo2 (
    date                     TEXT PRIMARY KEY,
    average_spo2             REAL,
    lowest_spo2              INTEGER,
    latest_spo2              INTEGER,
    avg_sleep_spo2           REAL,
    last7_avg_spo2           REAL,
    synced_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS respiration (
    date                     TEXT PRIMARY KEY,
    avg_waking               REAL,
    avg_sleep                REAL,
    lowest                   REAL,
    highest                  REAL,
    synced_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intensity_minutes (
    date                     TEXT PRIMARY KEY,
    moderate_minutes         INTEGER,
    vigorous_minutes         INTEGER,
    weekly_moderate          INTEGER,
    weekly_vigorous          INTEGER,
    weekly_total             INTEGER,
    week_goal                INTEGER,
    synced_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hydration (
    date                     TEXT PRIMARY KEY,
    value_ml                 REAL,
    goal_ml                  REAL,
    sweat_loss_ml            REAL,
    activity_intake_ml       REAL,
    synced_at                TEXT NOT NULL
);

-- Garmin recomputes fitness age slowly (lastUpdated lags the date), so rows
-- repeat for stretches. Stored per-date anyway so it joins like everything else.
CREATE TABLE IF NOT EXISTS fitness_age (
    date                     TEXT PRIMARY KEY,
    chronological_age        REAL,
    fitness_age              REAL,
    achievable_fitness_age   REAL,
    previous_fitness_age     REAL,
    component_rhr            REAL,
    component_bmi            REAL,
    component_vigorous_days  REAL,
    component_vigorous_min   REAL,
    last_updated             TEXT,
    synced_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS body_battery (
    date                     TEXT PRIMARY KEY,
    charged                  INTEGER,
    drained                  INTEGER,
    synced_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weight (
    date                     TEXT PRIMARY KEY,
    weight_g                 REAL,
    min_weight_g             REAL,
    max_weight_g             REAL,
    bmi                      REAL,
    body_fat                 REAL,
    body_water               REAL,
    muscle_mass              REAL,
    entries                  INTEGER,
    source_type              TEXT,
    synced_at                TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Per-activity detail. Keyed on activity_id (plus lap index where relevant),
-- not date: these are properties of a session, not of a day.
--
-- These endpoints cost one HTTP request per activity, so sync fetches them
-- once and never re-fetches: an activity's splits do not change after upload.
-- `activity_detail_log` records what has been fetched, including activities
-- that legitimately have no data (a walk has no exercise sets).
--
-- Deliberately NOT stored: nutrition (this account logs no food -- empty
-- tables are worse than absent ones; add when logging starts).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS activity_laps (
    activity_id              INTEGER NOT NULL,
    lap_index                INTEGER NOT NULL,
    start_time_gmt           TEXT,
    distance_m               REAL,
    duration_s               REAL,
    moving_duration_s        REAL,
    elevation_gain           REAL,
    elevation_loss           REAL,
    max_elevation            REAL,
    min_elevation            REAL,
    avg_speed                REAL,
    avg_moving_speed         REAL,
    max_speed                REAL,
    calories                 REAL,
    avg_hr                   REAL,
    max_hr                   REAL,
    -- MTB-specific: Garmin's "grit" (terrain difficulty) and "flow" (smoothness)
    grit                     REAL,
    avg_flow                 REAL,
    start_lat                REAL,
    start_lon                REAL,
    intensity_type           TEXT,
    synced_at                TEXT NOT NULL,
    PRIMARY KEY (activity_id, lap_index)
);

CREATE INDEX IF NOT EXISTS idx_laps_activity ON activity_laps(activity_id);

CREATE TABLE IF NOT EXISTS activity_hr_zones (
    activity_id              INTEGER NOT NULL,
    zone_number              INTEGER NOT NULL,
    secs_in_zone             REAL,
    zone_low_boundary        INTEGER,
    synced_at                TEXT NOT NULL,
    PRIMARY KEY (activity_id, zone_number)
);

CREATE TABLE IF NOT EXISTS activity_weather (
    activity_id              INTEGER PRIMARY KEY,
    temp                     REAL,
    apparent_temp            REAL,
    dew_point                REAL,
    relative_humidity        INTEGER,
    wind_speed               REAL,
    wind_gust                REAL,
    wind_direction           INTEGER,
    wind_compass             TEXT,
    weather_type             TEXT,
    latitude                 REAL,
    longitude                REAL,
    synced_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_exercise_sets (
    activity_id              INTEGER NOT NULL,
    set_index                INTEGER NOT NULL,
    exercise_name            TEXT,
    exercise_category        TEXT,
    set_type                 TEXT,
    repetition_count         INTEGER,
    weight_g                 REAL,
    duration_s               REAL,
    start_time_gmt           TEXT,
    synced_at                TEXT NOT NULL,
    PRIMARY KEY (activity_id, set_index)
);

-- Account-level reference data: one row per record/item, refreshed each sync
-- since these are small and change rarely.
CREATE TABLE IF NOT EXISTS personal_records (
    record_id                INTEGER PRIMARY KEY,
    type_id                  INTEGER,
    activity_id              INTEGER,
    activity_name            TEXT,
    activity_type            TEXT,
    value                    REAL,
    start_time_local         TEXT,
    synced_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gear (
    gear_pk                  INTEGER PRIMARY KEY,
    uuid                     TEXT,
    make_name                TEXT,
    model_name               TEXT,
    custom_make_model        TEXT,
    gear_type                TEXT,
    status                   TEXT,
    display_name             TEXT,
    notes                    TEXT,
    date_begin               TEXT,
    max_distance_km          REAL,
    total_distance_km        REAL,
    total_activities         INTEGER,
    synced_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
    device_id                INTEGER PRIMARY KEY,
    application_key          TEXT,
    display_name             TEXT,
    product_display_name     TEXT,
    serial_number            TEXT,
    firmware_version         TEXT,
    last_used_device_name    TEXT,
    synced_at                TEXT NOT NULL
);

-- Per-activity fetch bookkeeping: mirrors sync_log but keyed on activity, so a
-- one-shot detail fetch is never repeated. 'empty' is a real outcome (a walk
-- has no exercise sets) and must be recorded, or it retries forever.
CREATE TABLE IF NOT EXISTS activity_detail_log (
    activity_id              INTEGER NOT NULL,
    source                   TEXT NOT NULL,
    status                   TEXT NOT NULL,
    detail                   TEXT,
    synced_at                TEXT NOT NULL,
    PRIMARY KEY (activity_id, source)
);

-- ---------------------------------------------------------------------------
-- Round three: remaining daily/weekly scalars, account reference data, and
-- opt-in intraday time-series.
-- ---------------------------------------------------------------------------

-- Garmin's running-injury metric. Weekly-indexed upstream (startOfWeek), but
-- keyed on calendar_date since that is what it reports per row.
CREATE TABLE IF NOT EXISTS running_tolerance (
    date                     TEXT PRIMARY KEY,
    total_impact_load        REAL,
    total_distance_m         REAL,
    tolerance                REAL,
    start_of_week            TEXT,
    end_of_week              TEXT,
    synced_at                TEXT NOT NULL
);

-- Distinct from training_readiness: this is the AFTER_WAKEUP_RESET snapshot,
-- where the stored one is AFTER_POST_EXERCISE_RESET. Same shape, different
-- moment -- worth keeping both rather than overwriting one with the other.
CREATE TABLE IF NOT EXISTS morning_readiness (
    date                     TEXT PRIMARY KEY,
    score                    INTEGER,
    level                    TEXT,
    feedback_short           TEXT,
    feedback_long            TEXT,
    sleep_score              INTEGER,
    sleep_score_factor_pct   INTEGER,
    recovery_time_min        INTEGER,
    recovery_time_factor_pct INTEGER,
    acwr_factor_pct          INTEGER,
    acute_load               INTEGER,
    hrv_factor_pct           INTEGER,
    hrv_weekly_average       INTEGER,
    stress_history_factor_pct INTEGER,
    sleep_history_factor_pct INTEGER,
    valid_sleep              INTEGER,
    input_context            TEXT,
    timestamp_local          TEXT,
    synced_at                TEXT NOT NULL
);

-- Weekly rollups Garmin computes itself. Keyed on week-start date.
CREATE TABLE IF NOT EXISTS weekly_summary (
    week_start               TEXT PRIMARY KEY,
    total_steps              REAL,
    average_steps            REAL,
    total_distance_m         REAL,
    average_distance_m       REAL,
    data_days_count          INTEGER,
    avg_stress               INTEGER,
    synced_at                TEXT NOT NULL
);

-- Point-in-time threshold metrics. Keyed on the reported calendar date so a
-- re-test lands as a new row rather than overwriting history.
CREATE TABLE IF NOT EXISTS threshold_metrics (
    date                     TEXT PRIMARY KEY,
    sport                    TEXT,
    functional_threshold_power INTEGER,
    is_stale                 INTEGER,
    source_type              TEXT,
    synced_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS body_composition (
    date                     TEXT PRIMARY KEY,
    weight_g                 REAL,
    bmi                      REAL,
    body_fat                 REAL,
    body_water               REAL,
    bone_mass                REAL,
    muscle_mass              REAL,
    physique_rating          REAL,
    visceral_fat             REAL,
    metabolic_age            REAL,
    source_type              TEXT,
    synced_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS badges (
    badge_id                 INTEGER NOT NULL,
    earned_number            INTEGER NOT NULL,
    badge_key                TEXT,
    badge_name               TEXT,
    category_id              INTEGER,
    difficulty_id            INTEGER,
    points                   INTEGER,
    earned_date              TEXT,
    progress_value           REAL,
    target_value             REAL,
    premium                  INTEGER,
    synced_at                TEXT NOT NULL,
    -- A repeatable badge is earned several times; badge_id alone is not unique.
    PRIMARY KEY (badge_id, earned_number)
);

-- Garmin's own type taxonomy. Replaces guessing display names from type_key.
CREATE TABLE IF NOT EXISTS activity_types (
    type_id                  INTEGER PRIMARY KEY,
    type_key                 TEXT,
    parent_type_id           INTEGER,
    is_hidden                INTEGER,
    trimmable                INTEGER,
    restricted               INTEGER,
    synced_at                TEXT NOT NULL
);

-- Watch configuration. Captured because it answers questions the metric tables
-- cannot -- e.g. whether timeFormat explains a mis-scheduled notification.
CREATE TABLE IF NOT EXISTS device_settings (
    device_id                INTEGER PRIMARY KEY,
    time_format              TEXT,
    date_format              TEXT,
    measurement_units        TEXT,
    alarms_json              TEXT,
    raw_json                 TEXT,
    synced_at                TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Intraday time-series. Opt-in via --intraday: these are 100x the row count of
-- everything else combined (~1000 points per day), and the correlation engine
-- works on daily scalars, so it cannot consume them. They exist for intraday
-- charts -- stress through the day, HR within one activity.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intraday_steps (
    date                     TEXT NOT NULL,
    start_gmt                TEXT NOT NULL,
    end_gmt                  TEXT,
    steps                    INTEGER,
    pushes                   INTEGER,
    activity_level           TEXT,
    synced_at                TEXT NOT NULL,
    PRIMARY KEY (date, start_gmt)
);

CREATE TABLE IF NOT EXISTS intraday_stress (
    date                     TEXT NOT NULL,
    timestamp_ms             INTEGER NOT NULL,
    stress_level             INTEGER,
    synced_at                TEXT NOT NULL,
    PRIMARY KEY (date, timestamp_ms)
);

CREATE TABLE IF NOT EXISTS intraday_body_battery (
    date                     TEXT NOT NULL,
    timestamp_ms             INTEGER NOT NULL,
    status                   TEXT,
    level                    INTEGER,
    version                  REAL,
    synced_at                TEXT NOT NULL,
    PRIMARY KEY (date, timestamp_ms)
);

-- Per-activity metric streams (HR, speed, altitude, cadence, power) sampled
-- along the activity. One row per sample per activity.
CREATE TABLE IF NOT EXISTS activity_samples (
    activity_id              INTEGER NOT NULL,
    sample_index             INTEGER NOT NULL,
    elapsed_s                REAL,
    heart_rate               REAL,
    speed                    REAL,
    altitude                 REAL,
    cadence                  REAL,
    power                    REAL,
    latitude                 REAL,
    longitude                REAL,
    synced_at                TEXT NOT NULL,
    PRIMARY KEY (activity_id, sample_index)
);

-- Running dynamics columns (ground_contact_ms, vertical_oscillation_cm,
-- vertical_ratio, stride_length_cm, grade_adj_speed, impact_load_factor,
-- performance_condition, available_stamina, vertical_speed) are added to
-- activity_samples by scripts/sync.py at startup, not here: executescript
-- replays this file on every run and ALTER TABLE has no IF NOT EXISTS.
-- Unlike cycling power these need no modelling -- the watch measures them.

CREATE INDEX IF NOT EXISTS idx_samples_activity ON activity_samples(activity_id);

-- Per-length pool swimming. SWOLF (seconds + strokes for one length, lower is
-- better) is null during DRILL sets by design: a drill has no normal stroke
-- pattern so Garmin counts no strokes. Those rows are kept anyway -- their
-- duration and heart rate still matter.
CREATE TABLE IF NOT EXISTS swim_lengths (
    activity_id              INTEGER NOT NULL,
    length_index             INTEGER NOT NULL,
    distance_m               REAL,
    duration_s               REAL,
    avg_speed                REAL,
    avg_hr                   REAL,
    max_hr                   REAL,
    total_strokes            INTEGER,
    swolf                    REAL,
    swim_stroke              TEXT,
    synced_at                TEXT NOT NULL,
    PRIMARY KEY (activity_id, length_index)
);

CREATE INDEX IF NOT EXISTS idx_swim_activity ON swim_lengths(activity_id);
