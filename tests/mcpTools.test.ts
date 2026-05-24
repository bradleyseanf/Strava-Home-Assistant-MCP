import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerStravaTools } from "../src/mcpTools.ts";

describe("registerStravaTools", () => {
    it("registers every tool with an output schema", () => {
        const registrations: Array<{ name: string; config: any }> = [];
        const server = {
            registerTool: vi.fn((name: string, config: any) => {
                registrations.push({ name, config });
                return {};
            }),
        } as any;

        registerStravaTools(server);

        expect(registrations.length).toBeGreaterThan(0);
        for (const registration of registrations) {
            expect(registration.config.outputSchema).toBeDefined();
            expect(registration.config.outputSchema.summary).toBeDefined();
            expect(registration.config.outputSchema.isError).toBeDefined();
            expect(registration.config.outputSchema.contentCount).toBeDefined();
        }
    });

    it("registers against a real McpServer without throwing", () => {
        const server = new McpServer({ name: "test", version: "1.0.0" });

        expect(() => registerStravaTools(server)).not.toThrow();
    });
});
