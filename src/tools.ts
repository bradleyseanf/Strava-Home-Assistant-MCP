import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  buildTrainingContext,
  dateNotesForActivities,
  groupWeeklyRunningLoad,
  previewActivity,
  summarizeRunningRows,
} from "./analytics.js";
import {
  readActivityById,
  readRecentActivities,
  readRunActivitiesSince,
  searchActivities,
  withDatabase,
  type StravaActivity,
  type StravaActivityPreview,
} from "./database.js";

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
};

type ToolDefinition = {
  dbPath: string;
};

const recentActivitiesInput = z.object({
  sport_type: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional().default(20),
});

const activityByIdInput = z.object({
  activity_id: z.string().trim().min(1),
});

const runningSummaryInput = z.object({
  days: z.number().int().min(1).max(3650).optional().default(30),
});

const weeklyRunningLoadInput = z.object({
  weeks: z.number().int().min(1).max(520).optional().default(12),
});

const searchActivitiesInput = z.object({
  query: z.string().trim().min(1),
  sport_type: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

const trainingContextInput = z.object({
  days: z.number().int().min(1).max(3650).optional().default(60),
});

function result(structuredContent: Record<string, unknown>): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function limit(value: number, max: number): number {
  return Math.min(Math.max(value, 1), max);
}

function toPreviewList(rows: StravaActivity[]): StravaActivityPreview[] {
  return rows.map(previewActivity);
}

export function registerStravaTools(server: McpServer, options: ToolDefinition): void {
  server.registerTool(
    "get_recent_activities",
    {
      title: "Get Recent Activities",
      description: "Return recent Strava activities from the local SQLite database.",
      inputSchema: recentActivitiesInput,
    },
    async ({ sport_type, limit: count }): Promise<ToolResponse> => {
      const activities = withDatabase(options.dbPath, (db) =>
        readRecentActivities(db, {
          sportType: sport_type,
          limit: limit(count, 200),
        }),
      );

      return result({
        count: activities.length,
        sport_type: sport_type ?? null,
        activities: toPreviewList(activities),
        notes: dateNotesForActivities(activities),
      });
    },
  );

  server.registerTool(
    "get_activity_by_id",
    {
      title: "Get Activity By ID",
      description: "Return exactly one Strava activity by activity_id, including raw_json when available.",
      inputSchema: activityByIdInput,
    },
    async ({ activity_id }): Promise<ToolResponse> => {
      const activity = withDatabase(options.dbPath, (db) => readActivityById(db, activity_id));

      if (!activity) {
        return result({
          found: false,
          activity_id,
          activity: null,
          message: "No activity found for the requested activity_id.",
          notes: [],
        });
      }

      return result({
        found: true,
        activity,
        notes: dateNotesForActivities([activity]),
      });
    },
  );

  server.registerTool(
    "get_running_summary",
    {
      title: "Get Running Summary",
      description: "Return a compact running summary for the last N days.",
      inputSchema: runningSummaryInput,
    },
    async ({ days }): Promise<ToolResponse> => {
      const rows = withDatabase(options.dbPath, (db) => readRunActivitiesSince(db, new Date(Date.now() - days * 86_400_000).toISOString()));
      const summary = summarizeRunningRows(rows);

      return result({
        days,
        ...summary,
      });
    },
  );

  server.registerTool(
    "get_weekly_running_load",
    {
      title: "Get Weekly Running Load",
      description: "Group run activities by week and return weekly load metrics.",
      inputSchema: weeklyRunningLoadInput,
    },
    async ({ weeks }): Promise<ToolResponse> => {
      const rows = withDatabase(options.dbPath, (db) => readRunActivitiesSince(db, new Date(Date.now() - weeks * 7 * 86_400_000).toISOString()));
      const weekly = groupWeeklyRunningLoad(rows);

      return result({
        weeks,
        weeks_returned: weekly.length,
        rows: weekly,
        notes: rows.length === 0 ? ["No runs were found in the requested period."] : [],
      });
    },
  );

  server.registerTool(
    "search_activities",
    {
      title: "Search Activities",
      description: "Search activity name and raw_json text with a LIKE query.",
      inputSchema: searchActivitiesInput,
    },
    async ({ query, sport_type, limit: count }): Promise<ToolResponse> => {
      const activities = withDatabase(options.dbPath, (db) =>
        searchActivities(db, {
          query,
          sportType: sport_type,
          limit: limit(count, 100),
        }),
      );

      return result({
        query,
        sport_type: sport_type ?? null,
        count: activities.length,
        activities: toPreviewList(activities),
        notes: dateNotesForActivities(activities),
      });
    },
  );

  server.registerTool(
    "get_training_context_for_ai",
    {
      title: "Get Training Context For AI",
      description: "Return an AI-friendly training context for run planning.",
      inputSchema: trainingContextInput,
    },
    async ({ days }): Promise<ToolResponse> => {
      const lookbackDays = Math.max(days, 30);
      const rows = withDatabase(options.dbPath, (db) => readRunActivitiesSince(db, new Date(Date.now() - lookbackDays * 86_400_000).toISOString()));
      const context = buildTrainingContext(rows, days);

      return result(context);
    },
  );
}
