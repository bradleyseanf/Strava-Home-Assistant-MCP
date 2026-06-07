import fs from "node:fs";
import Database from "better-sqlite3";

export type StravaActivity = {
  activity_id: string;
  name: string | null;
  sport_type: string | null;
  start_date_local: string | null;
  distance_mi: number | null;
  moving_time_sec: number | null;
  elapsed_time_sec: number | null;
  pace_min_per_mi: number | null;
  speed_mph: number | null;
  elevation_gain_ft: number | null;
  calories: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  activity_url: string | null;
  latitude: number | null;
  longitude: number | null;
  polyline: string | null;
  source: string | null;
  raw_json: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type StravaActivityPreview = Omit<StravaActivity, "raw_json">;

export type WeeklyRunningLoadRow = {
  week: string;
  run_count: number;
  total_miles: number;
  total_hours: number;
  avg_pace_min_per_mi: number | null;
  avg_heart_rate: number | null;
  total_elevation_ft: number;
};

export type RunningSummary = {
  date_range: {
    start: string | null;
    end: string | null;
  };
  run_count: number;
  total_miles: number;
  total_moving_time_hours: number;
  average_pace_min_per_mi: number | null;
  average_heart_rate: number | null;
  max_heart_rate: number | null;
  total_elevation_gain_ft: number;
  average_distance_mi: number | null;
  longest_run: StravaActivityPreview | null;
  notes: string[];
};

export type TrainingContext = {
  days: number;
  recent_runs: StravaActivityPreview[];
  weekly_running_load: WeeklyRunningLoadRow[];
  current_mileage: {
    "7_day_miles": number;
    "14_day_miles": number;
    "30_day_miles": number;
  };
  long_run: StravaActivityPreview | null;
  average_pace_min_per_mi: number | null;
  average_heart_rate: number | null;
  notes: string[];
};

type SqliteDatabase = {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  pragma(sql: string): void;
  close(): void;
};

const FULL_COLUMNS = [
  "activity_id",
  "name",
  "sport_type",
  "start_date_local",
  "distance_mi",
  "moving_time_sec",
  "elapsed_time_sec",
  "pace_min_per_mi",
  "speed_mph",
  "elevation_gain_ft",
  "calories",
  "average_heartrate",
  "max_heartrate",
  "activity_url",
  "latitude",
  "longitude",
  "polyline",
  "source",
  "raw_json",
  "created_at",
  "updated_at",
] as const;

function mapRow(row: Record<string, unknown>): StravaActivity {
  return {
    activity_id: String(row.activity_id),
    name: row.name == null ? null : String(row.name),
    sport_type: row.sport_type == null ? null : String(row.sport_type),
    start_date_local: row.start_date_local == null ? null : String(row.start_date_local),
    distance_mi: row.distance_mi == null ? null : Number(row.distance_mi),
    moving_time_sec: row.moving_time_sec == null ? null : Number(row.moving_time_sec),
    elapsed_time_sec: row.elapsed_time_sec == null ? null : Number(row.elapsed_time_sec),
    pace_min_per_mi: row.pace_min_per_mi == null ? null : Number(row.pace_min_per_mi),
    speed_mph: row.speed_mph == null ? null : Number(row.speed_mph),
    elevation_gain_ft: row.elevation_gain_ft == null ? null : Number(row.elevation_gain_ft),
    calories: row.calories == null ? null : Number(row.calories),
    average_heartrate: row.average_heartrate == null ? null : Number(row.average_heartrate),
    max_heartrate: row.max_heartrate == null ? null : Number(row.max_heartrate),
    activity_url: row.activity_url == null ? null : String(row.activity_url),
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    polyline: row.polyline == null ? null : String(row.polyline),
    source: row.source == null ? null : String(row.source),
    raw_json: row.raw_json == null ? null : String(row.raw_json),
    created_at: row.created_at == null ? null : String(row.created_at),
    updated_at: row.updated_at == null ? null : String(row.updated_at),
  };
}

export function toPreview(activity: StravaActivity): StravaActivityPreview {
  const { raw_json: _rawJson, ...preview } = activity;
  return preview;
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function openReadOnlyDatabase(dbPath: string): SqliteDatabase {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database not found at ${dbPath}.`);
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true }) as unknown as SqliteDatabase;
  db.pragma("query_only = 1");
  return db;
}

export function withDatabase<T>(dbPath: string, handler: (db: SqliteDatabase) => T): T {
  const db = openReadOnlyDatabase(dbPath);

  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("strava_activities") as { name?: string } | undefined;

    if (!table) {
      throw new Error("Table strava_activities was not found in the SQLite database.");
    }

    return handler(db);
  } finally {
    db.close();
  }
}

function readRows(db: SqliteDatabase, sql: string, params: unknown[]): StravaActivity[] {
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(mapRow);
}

export function readActivityById(db: SqliteDatabase, activityId: string): StravaActivity | null {
  const row = db
    .prepare(`SELECT ${FULL_COLUMNS.join(", ")} FROM strava_activities WHERE activity_id = ?`)
    .get(activityId) as Record<string, unknown> | undefined;

  return row ? mapRow(row) : null;
}

export function readRecentActivities(
  db: SqliteDatabase,
  options: { sportType?: string; limit: number },
): StravaActivity[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.sportType) {
    where.push("sport_type = ?");
    params.push(options.sportType);
  }

  const sql = [
    `SELECT ${FULL_COLUMNS.join(", ")}`,
    "FROM strava_activities",
    where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
    "ORDER BY datetime(start_date_local) DESC, start_date_local DESC",
    "LIMIT ?",
  ]
    .filter(Boolean)
    .join(" ");

  params.push(options.limit);
  return readRows(db, sql, params);
}

export function searchActivities(
  db: SqliteDatabase,
  options: { query: string; sportType?: string; limit: number },
): StravaActivity[] {
  const where: string[] = [];
  const params: unknown[] = [];
  const like = `%${escapeLike(options.query)}%`;

  where.push("(name LIKE ? ESCAPE '\\' OR raw_json LIKE ? ESCAPE '\\')");
  params.push(like, like);

  if (options.sportType) {
    where.push("sport_type = ?");
    params.push(options.sportType);
  }

  const sql = [
    `SELECT ${FULL_COLUMNS.join(", ")}`,
    "FROM strava_activities",
    `WHERE ${where.join(" AND ")}`,
    "ORDER BY datetime(start_date_local) DESC, start_date_local DESC",
    "LIMIT ?",
  ].join(" ");

  params.push(options.limit);
  return readRows(db, sql, params);
}

export function readRunActivitiesSince(db: SqliteDatabase, sinceIso: string): StravaActivity[] {
  return readRows(
    db,
    `SELECT ${FULL_COLUMNS.join(", ")}
     FROM strava_activities
     WHERE sport_type = 'Run'
       AND start_date_local IS NOT NULL
       AND datetime(start_date_local) IS NOT NULL
       AND datetime(start_date_local) >= datetime(?)
     ORDER BY datetime(start_date_local) DESC, start_date_local DESC`,
    [sinceIso],
  );
}

