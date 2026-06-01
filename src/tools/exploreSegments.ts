// import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"; // Removed
import { z } from "zod";
import {
    exploreSegments as fetchExploreSegments, // Renamed import
    StravaExplorerResponse
} from "../stravaClient.js";
import { getStravaAccessToken } from "../config.js";

const ExploreSegmentsInputSchema = z.object({
    bounds: z.string()
        .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "Bounds must be in the format: south_west_lat,south_west_lng,north_east_lat,north_east_lng")
        .describe("The geographical area to search, specified as a comma-separated string: south_west_lat,south_west_lng,north_east_lat,north_east_lng"),
    activityType: z.enum(["running", "riding"])
        .optional()
        .describe("Filter segments by activity type (optional: 'running' or 'riding')."),
    minCat: z.number().int().min(0).max(5).optional()
        .describe("Filter by minimum climb category (optional, 0-5). Requires riding activityType."),
    maxCat: z.number().int().min(0).max(5).optional()
        .describe("Filter by maximum climb category (optional, 0-5). Requires riding activityType."),
});

type ExploreSegmentsInput = z.infer<typeof ExploreSegmentsInputSchema>;

// Export the tool definition directly
export const exploreSegments = {
    name: "explore-segments",
    description: "Searches for popular segments within a given geographical area.",
    inputSchema: ExploreSegmentsInputSchema,
    execute: async ({ bounds, activityType, minCat, maxCat }: ExploreSegmentsInput) => {
        const token = await getStravaAccessToken();

        if (!token || token === 'YOUR_STRAVA_ACCESS_TOKEN_HERE') {
            console.error("Missing or placeholder STRAVA_ACCESS_TOKEN in .env");
            return {
                content: [{ type: "text" as const, text: "❌ Configuration Error: STRAVA_ACCESS_TOKEN is missing or not set in the .env file." }],
                isError: true,
            };
        }
        if ((minCat !== undefined || maxCat !== undefined) && activityType !== 'riding') {
            return {
                content: [{ type: "text" as const, text: "❌ Input Error: Climb category filters (minCat, maxCat) require activityType to be 'riding'." }],
                isError: true,
            };
        }

        try {
            console.error(`Exploring segments within bounds: ${bounds}...`);
            const response: StravaExplorerResponse = await fetchExploreSegments(token, bounds, activityType, minCat, maxCat);
            console.error(`Found ${response.segments?.length ?? 0} segments.`);

            if (!response.segments || response.segments.length === 0) {
                return { content: [{ type: "text" as const, text: " MNo segments found in the specified area with the given filters." }] };
            }

            const segmentItems = response.segments.map(segment => {
                const distance = (segment.distance / 1000).toFixed(2);
                const elevDifference = segment.elev_difference.toFixed(0);
                const text = `
🗺️ **${segment.name}** (ID: ${segment.id})
   - Climb: Cat ${segment.climb_category_desc} (${segment.climb_category})
   - Distance: ${distance} km
   - Avg Grade: ${segment.avg_grade}%
   - Elev Difference: ${elevDifference} m
   - Starred: ${segment.starred ? 'Yes' : 'No'}
                `.trim();
                const item: { type: "text", text: string } = { type: "text" as const, text };
                return item;
            });

            const responseText = `**Found Segments:**\n\n${segmentItems.map(item => item.text).join("\n---\n")}`;

            return { content: [{ type: "text" as const, text: responseText }] };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
            console.error("Error in explore-segments tool:", errorMessage);
            return {
                content: [{ type: "text" as const, text: `❌ API Error: ${errorMessage}` }],
                isError: true,
            };
        }
    }
};

// Remove the old registration function
/*
export function registerExploreSegmentsTool(server: McpServer) {
    server.tool(
        exploreSegments.name,
        exploreSegments.description,
        exploreSegments.inputSchema.shape,
        exploreSegments.execute
    );
}
*/ 
