#!/usr/bin/env node
import dotenv from "dotenv";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { assertDatabaseConfig, loadConfig } from "./config.js";
import { createStravaActivityStore } from "./database.js";
import { registerStravaTools } from "./tools.js";

dotenv.config();

function createMcpServer(store: Awaited<ReturnType<typeof createStravaActivityStore>>): McpServer {
  const server = new McpServer({
    name: "strava-home-assistant-mcp",
    version: process.env.npm_package_version ?? "0.1.0",
  });

  registerStravaTools(server, { store });
  return server;
}

function bearerAuth(token?: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!token) {
      next();
      return;
    }

    const header = req.header("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match || match[1] !== token) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Provide the configured bearer token in the Authorization header.",
      });
      return;
    }

    next();
  };
}

async function start(): Promise<void> {
  const config = loadConfig();
  assertDatabaseConfig(config);
  const store = await createStravaActivityStore(config);
  await store.ensureReady();

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.json({
      name: "strava-home-assistant-mcp",
      version: process.env.npm_package_version ?? "0.1.0",
      health: `http://${config.host}:${config.port}/health`,
      mcp: `http://${config.host}:${config.port}/mcp`,
      dbMode: config.dbMode,
    });
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      mode: config.dbMode,
      host: config.host,
      port: config.port,
      dbPath: config.dbPath,
      authEnabled: Boolean(config.authToken),
    });
  });

  app.all("/mcp", bearerAuth(config.authToken), async (req, res) => {
    const server = createMcpServer(store);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    const cleanup = async () => {
      await transport.close();
      await server.close();
    };

    res.on("close", () => {
      void cleanup();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      await cleanup();

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    const listener = app.listen(config.port, config.host, () => {
      console.error(`Strava Home Assistant MCP listening on http://${config.host}:${config.port}`);
      resolve();
    });

    listener.on("error", reject);

    process.on("SIGINT", () => {
      listener.close(() => process.exit(0));
    });

    process.on("SIGTERM", () => {
      listener.close(() => process.exit(0));
    });
  });
}

async function main(): Promise<void> {
  try {
    await start();
  } catch (error) {
    console.error("Failed to start Strava Home Assistant MCP.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();
