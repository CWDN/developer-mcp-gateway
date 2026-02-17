import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { OAuthManager } from "./oauth.js";
import { Gateway } from "./gateway.js";
import { createApiRouter, createOAuthRouter } from "./api.js";
import { createMcpProxyRouter } from "./mcp-proxy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Configuration ───────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3099", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const GATEWAY_BASE_URL =
  process.env.GATEWAY_BASE_URL ?? `http://localhost:${PORT}`;
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, "../../data");
const STORE_PATH = path.resolve(DATA_DIR, "gateway-store.json");

// ─── Ensure data directory exists ────────────────────────────────────────────

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ─── Initialize core components ──────────────────────────────────────────────

const store = new Store(STORE_PATH);

// The OAuthManager needs a callback that fires when the SDK's auth provider
// determines the user must visit an authorization URL.  We forward this as
// a gateway event so the frontend (via SSE) and the API can pick it up.
const oauthManager = new OAuthManager(
  store,
  GATEWAY_BASE_URL,
  (serverId: string, authorizationUrl: URL) => {
    // Emit the event through the gateway so SSE subscribers receive it
    gateway.emit("event", {
      type: "oauth:required",
      serverId,
      authUrl: authorizationUrl.toString(),
    });
  }
);

const gateway = new Gateway(store, oauthManager);

// ─── Express App Setup ──────────────────────────────────────────────────────

const app = express();

// Middleware
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, _res, next) => {
  if (
    req.path.startsWith("/api/") ||
    req.path.startsWith("/oauth/") ||
    req.path.startsWith("/mcp")
  ) {
    console.log(`[HTTP] ${req.method} ${req.path}`);
  }
  next();
});

// ─── API Routes ──────────────────────────────────────────────────────────────

const apiRouter = createApiRouter(gateway, store, oauthManager);
app.use("/api", apiRouter);

// ─── MCP Proxy Endpoint (Streamable HTTP) ────────────────────────────────────

const mcpProxyRouter = createMcpProxyRouter(gateway);
app.use("/mcp", mcpProxyRouter);

// ─── OAuth Callback Routes ──────────────────────────────────────────────────

const oauthRouter = createOAuthRouter(gateway, store, oauthManager);
app.use("/oauth", oauthRouter);

// ─── Static File Serving (production) ────────────────────────────────────────

const clientDistPath = path.resolve(__dirname, "../../dist/client");
if (fs.existsSync(clientDistPath)) {
  console.log(`[Server] Serving static client from ${clientDistPath}`);
  app.use(express.static(clientDistPath));

  // SPA fallback — serve index.html for any non-API, non-OAuth route
  app.get("*", (req, res) => {
    if (
      !req.path.startsWith("/api/") &&
      !req.path.startsWith("/oauth/")
    ) {
      res.sendFile(path.join(clientDistPath, "index.html"));
    }
  });
} else {
  // In development, Vite dev server handles the client
  app.get("/", (_req, res) => {
    res.json({
      message: "MCP Gateway API is running.",
      hint: "Run `npm run dev` to start both the API server and the Vite dev server for the UI.",
      docs: {
        health: "/api/health",
        servers: "/api/servers",
        tools: "/api/tools",
        resources: "/api/resources",
        prompts: "/api/prompts",
        events: "/api/events (SSE)",
      },
    });
  });
}

// ─── Error Handling ──────────────────────────────────────────────────────────

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("[Server] Unhandled error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
);

// ─── Start Server ────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  try {
    // Initialize the gateway (loads configs and connects to enabled servers)
    await gateway.initialize();

    const server = app.listen(PORT, HOST, () => {
      console.log("");
      console.log("╔══════════════════════════════════════════════════════╗");
      console.log("║                  MCP Gateway                        ║");
      console.log("╠══════════════════════════════════════════════════════╣");
      console.log(`║  API Server:  http://${HOST}:${PORT}                 `);
      console.log(`║  Health:      http://localhost:${PORT}/api/health     `);
      console.log(`║  UI:          http://localhost:5173  (dev mode)       `);
      console.log(`║  MCP URL:     http://localhost:${PORT}/mcp            `);
      console.log(`║  Base URL:    ${GATEWAY_BASE_URL}                    `);
      console.log(`║  Data Dir:    ${DATA_DIR}                            `);
      console.log("╚══════════════════════════════════════════════════════╝");
      console.log("");
      console.log(
        "[Server] OAuth callback URL pattern: " +
          `${GATEWAY_BASE_URL}/oauth/callback/{serverId}`
      );
      console.log(
        "[Server] OAuth metadata is auto-discovered from .well-known endpoints."
      );
      console.log(
        "[Server] MCP clients can connect via Streamable HTTP at: " +
          `${GATEWAY_BASE_URL}/mcp`
      );
      console.log("");
    });

    // ─── Graceful Shutdown ─────────────────────────────────────────────────

    const shutdown = async (signal: string) => {
      console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);

      // Stop accepting new connections
      server.close(() => {
        console.log("[Server] HTTP server closed.");
      });

      // Shut down gateway (disconnects all MCP servers)
      try {
        await gateway.shutdown();
      } catch (err) {
        console.error("[Server] Error during gateway shutdown:", err);
      }

      // Flush store to disk
      store.close();

      console.log("[Server] Shutdown complete. Goodbye!");
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (reason, promise) => {
      console.error(
        "[Server] Unhandled promise rejection at:",
        promise,
        "reason:",
        reason
      );
    });

    // Handle uncaught exceptions
    process.on("uncaughtException", (err) => {
      console.error("[Server] Uncaught exception:", err);
      // Don't exit — let the process continue running
    });
  } catch (err) {
    console.error("[Server] Failed to start:", err);
    process.exit(1);
  }
}

start();