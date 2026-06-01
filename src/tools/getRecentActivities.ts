import { z } from "zod";
import { getRecentActivities as fetchActivities } from "../stravaClient.js";
import { getStravaAccessToken } from "../config.js";
// Reverted SDK type imports

const GetRecentActivitiesInputSchema = z.object({
  perPage: z.number().int().positive().optional().default(30).describe("Number of activities to retrieve (default: 30)"),
});

type GetRecentActivitiesInput = z.infer<typeof GetRecentActivitiesInputSchema>;

// Export the tool definition directly
export const getRecentActivities = {
    name: "get-recent-activities",
    description: "Fetches the most recent activities for the authenticated athlete.",
    inputSchema: GetRecentActivitiesInputSchema,
    // Ensure the return type matches the expected structure, relying on inference
    execute: async ({ perPage }: GetRecentActivitiesInput) => {
      const token = await getStravaAccessToken();

      if (!token || token === 'YOUR_STRAVA_ACCESS_TOKEN_HERE') {
        console.error("Missing or placeholder STRAVA_ACCESS_TOKEN in .env");
        // Use literal type for content item
        return {
          content: [{ type: "text" as const, text: "❌ Configuration Error: STRAVA_ACCESS_TOKEN is missing or not set in the .env file." }],
          isError: true,
        };
      }

      try {
        console.error(`Fetching ${perPage} recent activities...`);
        const activities = await fetchActivities(token, perPage);
        console.error(`Successfully fetched ${activities?.length ?? 0} activities.`);

        if (!activities || activities.length === 0) {
           return {
             content: [{ type: "text" as const, text: "No recent activities found." }]
            };
        }

        // Map to content items with literal type
        const contentItems = activities.map(activity => {
          const dateStr = activity.start_date ? new Date(activity.start_date).toLocaleDateString() : 'N/A';
          const distanceStr = activity.distance ? `${(activity.distance / 1000).toFixed(2)} km` : 'N/A';
          // Ensure each item conforms to { type: "text", text: string }
          const item: { type: "text", text: string } = {
             type: "text" as const,
             text: `${activity.type || activity.sport_type} ${activity.name} (ID: ${activity.id ?? 'N/A'}) — ${distanceStr} on ${dateStr}`
            };
          return item;
        });

        // Return the basic McpResponse structure
        return { content: contentItems };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
        console.error("Error in get-recent-activities tool:", errorMessage);
        return {
          content: [{ type: "text" as const, text: `❌ API Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
};
