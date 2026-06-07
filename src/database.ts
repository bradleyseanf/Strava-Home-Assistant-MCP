import fs from "node:fs";
import { execFile } from "node:child_process";

import Database from "better-sqlite3";

import type { RuntimeConfig } from "./config.js";

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

export type ActivityQueryOptions = {
  sportType?: string;
  limit: number;
};

export type SearchQueryOptions = {
  query: string;
  sportType?: string;
  limit: number;
};

export interface StravaActivityStore {
  ensureReady(): Promise<void>;
  close(): Promise<void>;
  readActivityById(activityId: string): Promise<StravaActivity | null>;
  readRecentActivities(options: ActivityQueryOptions): Promise<StravaActivity[]>;
  searchActivities(options: SearchQueryOptions): Promise<StravaActivity[]>;
  readRunActivitiesSince(sinceIso: string): Promise<StravaActivity[]>;
}

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

const TABLE_NAME = "strava_activities";

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

function sqliteSelectSql(columns: readonly string[]): string {
  return `SELECT ${columns.join(", ")}`;
}

function parseRows(rows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows as Record<string, unknown>[];
}

function validateActivityRows(rows: unknown): StravaActivity[] {
  return parseRows(rows).map(mapRow);
}

function normalizeJsonParseError(stdout: string): Error {
  return new Error(`Remote sqlite3 returned invalid JSON. Raw output: ${stdout.slice(0, 200)}`);
}

function isSqliteMissing(stderr: string): boolean {
  return /sqlite3: not found|command not found|No such file or directory/i.test(stderr);
}

function isTableMissing(stderr: string): boolean {
  return /no such table: strava_activities/i.test(stderr);
}

function isDbOpenError(stderr: string): boolean {
  return /unable to open database file|disk i\/o error|database is locked/i.test(stderr);
}

function isSshFailure(stderr: string): boolean {
  return /ssh: |Permission denied|Could not resolve hostname|Connection closed|Connection refused|Host key verification failed/i.test(stderr);
}

function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildRemoteSqliteCommand(dbPath: string, sql: string): string {
  return `sqlite3 -json ${shellQuoteSingle(dbPath)} ${shellQuoteSingle(sql)}`;
}

function execFileAsync(
  file: string,
  args: string[],
  options: { maxBuffer?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const err = error as Error & { stdout?: string; stderr?: string };
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function localTableCheck(db: SqliteDatabase): void {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(TABLE_NAME) as { name?: string } | undefined;

  if (!table) {
    throw new Error(`Table ${TABLE_NAME} was not found in the SQLite database.`);
  }
}

class LocalStravaActivityStore implements StravaActivityStore {
  private readonly db: SqliteDatabase;

  constructor(dbPath: string) {
    if (!fs.existsSync(dbPath)) {
      throw new Error(`SQLite database not found at ${dbPath}.`);
    }

    this.db = new Database(dbPath, { readonly: true, fileMustExist: true }) as unknown as SqliteDatabase;
    this.db.pragma("query_only = 1");
  }

  async ensureReady(): Promise<void> {
    localTableCheck(this.db);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async readActivityById(activityId: string): Promise<StravaActivity | null> {
    localTableCheck(this.db);
    const row = this.db
      .prepare(`${sqliteSelectSql(FULL_COLUMNS)} FROM ${TABLE_NAME} WHERE activity_id = ?`)
      .get(activityId) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : null;
  }

  async readRecentActivities(options: ActivityQueryOptions): Promise<StravaActivity[]> {
    localTableCheck(this.db);
    const where: string[] = [];
    const params: unknown[] = [];

    if (options.sportType) {
      where.push("sport_type = ?");
      params.push(options.sportType);
    }

    const sql = [
      `${sqliteSelectSql(FULL_COLUMNS)} FROM ${TABLE_NAME}`,
      where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
      "ORDER BY datetime(start_date_local) DESC, start_date_local DESC",
      "LIMIT ?",
    ]
      .filter(Boolean)
      .join(" ");

    params.push(options.limit);
    const rows = this.db.prepare(sql).all(...params);
    return validateActivityRows(rows);
  }

  async searchActivities(options: SearchQueryOptions): Promise<StravaActivity[]> {
    localTableCheck(this.db);
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
      `${sqliteSelectSql(FULL_COLUMNS)} FROM ${TABLE_NAME}`,
      `WHERE ${where.join(" AND ")}`,
      "ORDER BY datetime(start_date_local) DESC, start_date_local DESC",
      "LIMIT ?",
    ].join(" ");

    params.push(options.limit);
    const rows = this.db.prepare(sql).all(...params);
    return validateActivityRows(rows);
  }

  async readRunActivitiesSince(sinceIso: string): Promise<StravaActivity[]> {
    localTableCheck(this.db);
    const rows = this.db
      .prepare(
        `${sqliteSelectSql(FULL_COLUMNS)} FROM ${TABLE_NAME}
         WHERE sport_type = 'Run'
           AND start_date_local IS NOT NULL
           AND datetime(start_date_local) IS NOT NULL
           AND datetime(start_date_local) >= datetime(?)
         ORDER BY datetime(start_date_local) DESC, start_date_local DESC`,
      )
      .all(sinceIso);
    return validateActivityRows(rows);
  }
}

class SshStravaActivityStore implements StravaActivityStore {
  constructor(private readonly config: RuntimeConfig) {}

  async ensureReady(): Promise<void> {
    await this.queryJson(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${shellQuoteSingle(TABLE_NAME)};`);
  }

  async close(): Promise<void> {
    return;
  }

  private async runRemoteSql(sql: string): Promise<string> {
    if (!this.config.sshHost || !this.config.sshUser || !this.config.sshKeyPath) {
      throw new Error("SSH database mode requires STRAVA_SSH_HOST, STRAVA_SSH_USER, and STRAVA_SSH_KEY_PATH.");
    }

    const remoteCommand = buildRemoteSqliteCommand(this.config.dbPath, sql);
    const sshArgs = [
      "-i",
      this.config.sshKeyPath,
      "-p",
      String(this.config.sshPort),
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      `${this.config.sshUser}@${this.config.sshHost}`,
      remoteCommand,
    ];

    try {
      const { stdout, stderr } = await execFileAsync("ssh", sshArgs, { maxBuffer: 10 * 1024 * 1024 });
      if (stderr.trim()) {
        console.error("SSH sqlite3 stderr:", stderr.trim());
      }
      return stdout;
    } catch (error) {
      const err = error as Error & { stdout?: string; stderr?: string; code?: number | string | null };
      const stderr = String(err.stderr ?? "");
      if (stderr.trim()) {
        console.error("SSH sqlite3 stderr:", stderr.trim());
      }

      if (isSqliteMissing(stderr)) {
        throw new Error("SSH database query failed: sqlite3 is missing on the Home Assistant VM.");
      }
      if (isTableMissing(stderr)) {
        throw new Error(`SSH database query failed: table ${TABLE_NAME} was not found.`);
      }
      if (isDbOpenError(stderr)) {
        throw new Error("SSH database query failed: the remote SQLite database could not be opened.");
      }
      if (isSshFailure(stderr) || err.code === 255) {
        throw new Error("SSH connection failed while querying the SQLite database.");
      }

      throw new Error("SSH connection failed while querying the SQLite database.");
    }
  }

  private async queryJson(sql: string): Promise<unknown> {
    const stdout = await this.runRemoteSql(sql);
    const trimmed = stdout.trim();

    if (!trimmed) {
      return [];
    }

    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      throw normalizeJsonParseError(trimmed);
    }
  }

  private async queryRows(sql: string): Promise<StravaActivity[]> {
    const parsed = await this.queryJson(sql);
    return validateActivityRows(parsed);
  }

  async readActivityById(activityId: string): Promise<StravaActivity | null> {
    const rows = await this.queryRows(`${sqliteSelectSql(FULL_COLUMNS)} FROM ${TABLE_NAME} WHERE activity_id = ${shellQuoteSingle(activityId)}`);
    return rows[0] ?? null;
  }

  async readRecentActivities(options: ActivityQueryOptions): Promise<StravaActivity[]> {
    const where = [`1 = 1`];
    if (options.sportType) {
      where.push(`sport_type = ${shellQuoteSingle(options.sportType)}`);
    }

    return this.queryRows(
      `${sqliteSelectSql(FULL_COLUMNS)} FROM ${TABLE_NAME}
       WHERE ${where.join(" AND ")}
       ORDER BY datetime(start_date_local) DESC, start_date_local DESC
       LIMIT ${Number(options.limit)}`,
    );
  }

  async searchActivities(options: SearchQueryOptions): Promise<StravaActivity[]> {
    const like = `%${escapeLike(options.query)}%`;
    const where = [
      `(name LIKE ${shellQuoteSingle(like)} ESCAPE '\\' OR raw_json LIKE ${shellQuoteSingle(like)} ESCAPE '\\')`,
    ];

    if (options.sportType) {
      where.push(`sport_type = ${shellQuoteSingle(options.sportType)}`);
    }

    return this.queryRows(
      `${sqliteSelectSql(FULL_COLUMNS)} FROM ${TABLE_NAME}
       WHERE ${where.join(" AND ")}
       ORDER BY datetime(start_date_local) DESC, start_date_local DESC
       LIMIT ${Number(options.limit)}`,
    );
  }

  async readRunActivitiesSince(sinceIso: string): Promise<StravaActivity[]> {
    return this.queryRows(
      `${sqliteSelectSql(FULL_COLUMNS)} FROM ${TABLE_NAME}
       WHERE sport_type = 'Run'
         AND start_date_local IS NOT NULL
         AND datetime(start_date_local) IS NOT NULL
         AND datetime(start_date_local) >= datetime(${shellQuoteSingle(sinceIso)})
       ORDER BY datetime(start_date_local) DESC, start_date_local DESC`,
    );
  }
}

export async function createStravaActivityStore(config: RuntimeConfig): Promise<StravaActivityStore> {
  if (config.dbMode === "ssh") {
    return new SshStravaActivityStore(config);
  }

  return new LocalStravaActivityStore(config.dbPath);
}
