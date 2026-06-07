import os from "node:os";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  STRAVA_DB_PATH: z.string().trim().min(1).default("/data/strava_mcp.db"),
  MCP_HOST: z.string().trim().min(1).default("127.0.0.1"),
  MCP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MCP_AUTH_TOKEN: z.string().trim().min(1).optional(),
});

export type RuntimeConfig = {
  dbPath: string;
  host: string;
  port: number;
  authToken?: string;
};

function resolvePath(rawPath: string): string {
  const expanded = rawPath.startsWith("~") ? path.join(os.homedir(), rawPath.slice(1)) : rawPath;
  return path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = envSchema.parse(env);

  return {
    dbPath: resolvePath(parsed.STRAVA_DB_PATH),
    host: parsed.MCP_HOST,
    port: parsed.MCP_PORT,
    authToken: parsed.MCP_AUTH_TOKEN,
  };
}

