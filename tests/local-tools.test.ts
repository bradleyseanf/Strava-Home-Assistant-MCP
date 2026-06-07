import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { summarizeRunningRows, groupWeeklyRunningLoad, buildTrainingContext } from "../src/analytics.js";
import { readActivityById, readRecentActivities, readRunActivitiesSince, searchActivities, withDatabase } from "../src/database.js";
import { registerStravaTools } from "../src/tools.js";

function isoDaysAgo(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}

function makeTempDb(): { dbPath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strava-home-assistant-mcp-"));
  const dbPath = path.join(dir, "strava.db");
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE strava_activities (
      activity_id TEXT PRIMARY KEY,
      name TEXT,
      sport_type TEXT,
      start_date_local TEXT,
      distance_mi REAL,
      moving_time_sec INTEGER,
      elapsed_time_sec INTEGER,
      pace_min_per_mi REAL,
      speed_mph REAL,
      elevation_gain_ft REAL,
      calories REAL,
      average_heartrate REAL,
      max_heartrate REAL,
      activity_url TEXT,
      latitude REAL,
      longitude REAL,
      polyline TEXT,
      source TEXT,
      raw_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const insert = db.prepare(`
    INSERT INTO strava_activities (
      activity_id, name, sport_type, start_date_local, distance_mi, moving_time_sec,
      elapsed_time_sec, pace_min_per_mi, speed_mph, elevation_gain_ft, calories,
      average_heartrate, max_heartrate, activity_url, latitude, longitude, polyline,
      source, raw_json, created_at, updated_at
    ) VALUES (
      @activity_id, @name, @sport_type, @start_date_local, @distance_mi, @moving_time_sec,
      @elapsed_time_sec, @pace_min_per_mi, @speed_mph, @elevation_gain_ft, @calories,
      @average_heartrate, @max_heartrate, @activity_url, @latitude, @longitude, @polyline,
      @source, @raw_json, @created_at, @updated_at
    );
  `);

  const rows = [
    {
      activity_id: "run-long",
      name: "Long run",
      sport_type: "Run",
      start_date_local: isoDaysAgo(14),
      distance_mi: 10.2,
      moving_time_sec: 3720,
      elapsed_time_sec: 3780,
      pace_min_per_mi: 10.16,
      speed_mph: 5.91,
      elevation_gain_ft: 260,
      calories: 920,
      average_heartrate: 144,
      max_heartrate: 168,
      activity_url: "https://www.strava.com/activities/run-long",
      latitude: 40,
      longitude: -73,
      polyline: null,
      source: "home-assistant",
      raw_json: JSON.stringify({ id: "run-long" }),
      created_at: isoDaysAgo(14),
      updated_at: isoDaysAgo(14),
    },
    {
      activity_id: "run-easy",
      name: "Easy run",
      sport_type: "Run",
      start_date_local: isoDaysAgo(2),
      distance_mi: 4.5,
      moving_time_sec: 2760,
      elapsed_time_sec: 2820,
      pace_min_per_mi: 10.22,
      speed_mph: 5.87,
      elevation_gain_ft: 110,
      calories: null,
      average_heartrate: null,
      max_heartrate: 158,
      activity_url: "https://www.strava.com/activities/run-easy",
      latitude: 40,
      longitude: -73,
      polyline: null,
      source: "home-assistant",
      raw_json: JSON.stringify({ id: "run-easy" }),
      created_at: isoDaysAgo(2),
      updated_at: isoDaysAgo(2),
    },
    {
      activity_id: "bike-ride",
      name: "Recovery ride",
      sport_type: "Ride",
      start_date_local: isoDaysAgo(3),
      distance_mi: 18.25,
      moving_time_sec: 3600,
      elapsed_time_sec: 3660,
      pace_min_per_mi: null,
      speed_mph: 18.25,
      elevation_gain_ft: 420,
      calories: 520,
      average_heartrate: 126,
      max_heartrate: 143,
      activity_url: "https://www.strava.com/activities/bike-ride",
      latitude: 40,
      longitude: -73,
      polyline: null,
      source: "home-assistant",
      raw_json: JSON.stringify({ id: "bike-ride" }),
      created_at: isoDaysAgo(3),
      updated_at: isoDaysAgo(3),
    },
    {
      activity_id: "bad-date-run",
      name: "Broken date run",
      sport_type: "Run",
      start_date_local: "not-a-date",
      distance_mi: 3.1,
      moving_time_sec: 1800,
      elapsed_time_sec: 1860,
      pace_min_per_mi: 9.68,
      speed_mph: 6.2,
      elevation_gain_ft: 70,
      calories: 310,
      average_heartrate: 139,
      max_heartrate: 151,
      activity_url: "https://www.strava.com/activities/bad-date-run",
      latitude: 40,
      longitude: -73,
      polyline: null,
      source: "home-assistant",
      raw_json: JSON.stringify({ id: "bad-date-run" }),
      created_at: isoDaysAgo(1),
      updated_at: isoDaysAgo(1),
    },
  ];

  for (const row of rows) {
    insert.run(row);
  }

  db.close();

  return {
    dbPath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function registerFakeTools(dbPath: string) {
  const tools: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }> = [];
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
      tools.push({ name, handler });
      return {};
    }),
  } as any;

  registerStravaTools(server, { dbPath });
  return tools;
}

describe("Strava Home Assistant MCP", () => {
  it("registers the six tools", () => {
    const { dbPath, cleanup } = makeTempDb();

    try {
      const tools = registerFakeTools(dbPath);
      expect(tools.map((tool) => tool.name)).toEqual([
        "get_recent_activities",
        "get_activity_by_id",
        "get_running_summary",
        "get_weekly_running_load",
        "search_activities",
        "get_training_context_for_ai",
      ]);
    } finally {
      cleanup();
    }
  });

  it("queries SQLite data and builds training context", async () => {
    const { dbPath, cleanup } = makeTempDb();

    try {
      const tools = registerFakeTools(dbPath);
      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool.handler]));

      const recent = await byName.get_recent_activities({ sport_type: "Run", limit: 10 });
      const recentJson = JSON.parse((recent as any).content[0].text);
      expect(recentJson.count).toBe(3);
      expect(recentJson.notes[0]).toContain("invalid start_date_local");

      const byId = await byName.get_activity_by_id({ activity_id: "bad-date-run" });
      const byIdJson = JSON.parse((byId as any).content[0].text);
      expect(byIdJson.found).toBe(true);
      expect(byIdJson.notes[0]).toContain("invalid start_date_local");
      expect(byIdJson.activity.raw_json).toContain("bad-date-run");

      const summary = await byName.get_running_summary({ days: 30 });
      const summaryJson = JSON.parse((summary as any).content[0].text);
      expect(summaryJson.run_count).toBe(2);
      expect(summaryJson.longest_run.activity_id).toBe("run-long");

      const weekly = await byName.get_weekly_running_load({ weeks: 12 });
      const weeklyJson = JSON.parse((weekly as any).content[0].text);
      expect(weeklyJson.weeks_returned).toBeGreaterThan(0);
      expect(weeklyJson.rows[0].week).toMatch(/^20\d{2}-W\d{2}$/);

      const search = await byName.search_activities({ query: "Long", sport_type: "Run", limit: 5 });
      const searchJson = JSON.parse((search as any).content[0].text);
      expect(searchJson.count).toBe(1);
      expect(searchJson.activities[0].activity_id).toBe("run-long");

      const context = await byName.get_training_context_for_ai({ days: 60 });
      const contextJson = JSON.parse((context as any).content[0].text);
      expect(contextJson.current_mileage["7_day_miles"]).toBeGreaterThan(0);
      expect(contextJson.current_mileage["14_day_miles"]).toBeGreaterThanOrEqual(contextJson.current_mileage["7_day_miles"]);
      expect(contextJson.current_mileage["30_day_miles"]).toBeGreaterThanOrEqual(contextJson.current_mileage["14_day_miles"]);
      expect(contextJson.long_run.activity_id).toBe("run-long");
      expect(contextJson.notes.some((note: string) => note.includes("average_heartrate"))).toBe(true);
      expect(contextJson.notes.some((note: string) => note.includes("calories"))).toBe(true);

      const dbSummary = withDatabase(dbPath, (db) => {
        const recentRuns = readRunActivitiesSince(db, new Date(Date.now() - 30 * 86_400_000).toISOString());
        const summary = summarizeRunningRows(recentRuns);
        const weeklyLoad = groupWeeklyRunningLoad(recentRuns);
        const directRecent = readRecentActivities(db, { sportType: "Run", limit: 10 });
        const directSearch = searchActivities(db, { query: "Long", sportType: "Run", limit: 5 });
        const directById = readActivityById(db, "run-long");

        return {
          summary,
          weeklyLoad,
          directRecent,
          directSearch,
          directById,
        };
      });

      expect(dbSummary.summary.run_count).toBe(2);
      expect(dbSummary.weeklyLoad.length).toBeGreaterThan(0);
      expect(dbSummary.directRecent.length).toBe(3);
      expect(dbSummary.directSearch.length).toBe(1);
      expect(dbSummary.directById?.activity_id).toBe("run-long");
    } finally {
      cleanup();
    }
  });
});

