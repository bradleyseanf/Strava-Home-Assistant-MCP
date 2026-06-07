import os from "node:os";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  STRAVA_DB_MODE: z.enum(["local", "ssh"]).default("local"),
  STRAVA_DB_PATH: z.string().trim().min(1).default("/data/strava_mcp.db"),
  STRAVA_SSH_HOST: z.string().trim().min(1).optional(),
  STRAVA_SSH_USER: z.string().trim().min(1).optional(),
  STRAVA_SSH_PORT: z.coerce.number().int().min(1).max(65535).optional().default(22),
  STRAVA_SSH_KEY_PATH: z.string().trim().min(1).optional(),
  MCP_HOST: z.string().trim().min(1).default("127.0.0.1"),
  MCP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MCP_AUTH_TOKEN: z.string().trim().min(1).optional(),
});

export type RuntimeConfig = {
  dbMode: "local" | "ssh";
  dbPath: string;
  host: string;
  port: number;
  authToken?: string;
  sshHost?: string;
  sshUser?: string;
  sshPort: number;
  sshKeyPath?: string;
};

function resolvePath(rawPath: string): string {
  const expanded = rawPath.startsWith("~") ? path.join(os.homedir(), rawPath.slice(1)) : rawPath;
  return path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = envSchema.parse(env);

  return {
    dbMode: parsed.STRAVA_DB_MODE,
    dbPath: parsed.STRAVA_DB_MODE === "local" ? resolvePath(parsed.STRAVA_DB_PATH) : parsed.STRAVA_DB_PATH,
    host: parsed.MCP_HOST,
    port: parsed.MCP_PORT,
    authToken: parsed.MCP_AUTH_TOKEN,
    sshHost: parsed.STRAVA_SSH_HOST,
    sshUser: parsed.STRAVA_SSH_USER,
    sshPort: parsed.STRAVA_SSH_PORT,
    sshKeyPath: parsed.STRAVA_SSH_KEY_PATH,
  };
}

export function assertDatabaseConfig(config: RuntimeConfig): void {
  if (config.dbMode === "local") {
    return;
  }

  const missing: string[] = [];
  if (!config.sshHost) missing.push("STRAVA_SSH_HOST");
  if (!config.sshUser) missing.push("STRAVA_SSH_USER");
  if (!config.sshKeyPath) missing.push("STRAVA_SSH_KEY_PATH");

  if (missing.length > 0) {
    throw new Error(`SSH database mode requires: ${missing.join(", ")}.`);
  }
}
