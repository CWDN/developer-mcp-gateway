import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import type {
  ServerConfig,
  LocalServerConfig,
  RemoteServerConfig,
  CreateServerRequest,
  UpdateServerRequest,
  ApiResponse,
  OAuthConfig,
} from "./types.js";
import type { Gateway } from "./gateway.js";
import type { Store } from "./store.js";
import type { OAuthManager } from "./oauth.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function success<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

function error(message: string): ApiResponse {
  return { success: false, error: message };
}

function now(): string {
  return new Date().toISOString();
}

// Route params types
interface IdParams {
  id: string;
}

interface ServerIdParams {
  serverId: string;
}

// ─── API Router Factory ──────────────────────────────────────────────────────

export function createApiRouter(
  gateway: Gateway,
  store: Store,
  oauthManager: OAuthManager
): Router {
  const router = Router();

  // ─── Server CRUD ─────────────────────────────────────────────────────────

  /**
   * GET /api/servers
   * List all registered servers and their runtime statuses.
   */
  router.get("/servers", (_req: Request, res: Response) => {
    try {
      const statuses = gateway.getAllServerStatuses();
      const configs = store.getAllServers();

      const servers = configs.map((config) => {
        const status = statuses.find((s) => s.id === config.id);
        const authStatus = oauthManager.getAuthStatus(config.id);

        return {
          ...config,
          // Strip sensitive fields from OAuth config
          oauth:
            config.transport !== "stdio" && (config as RemoteServerConfig).oauth
              ? {
                  ...(config as RemoteServerConfig).oauth,
                  clientSecret: (config as RemoteServerConfig).oauth?.clientSecret
                    ? "••••••••"
                    : undefined,
                }
              : undefined,
          runtime: status
            ? {
                status: status.status,
                error: status.error,
                tools: status.tools,
                resources: status.resources,
                prompts: status.prompts,
                lastConnected: status.lastConnected,
              }
            : {
                status: "disconnected",
                tools: [],
                resources: [],
                prompts: [],
              },
          auth: authStatus,
        };
      });

      res.json(success(servers));
    } catch (err) {
      console.error("[API] Error listing servers:", err);
      res.status(500).json(error("Failed to list servers."));
    }
  });

  /**
   * GET /api/servers/:id
   * Get a single server's config and runtime status.
   */
  router.get("/servers/:id", (req: Request<IdParams>, res: Response) => {
    try {
      const id = req.params.id;
      const config = store.getServer(id);
      if (!config) {
        res.status(404).json(error(`Server "${id}" not found.`));
        return;
      }

      const status = gateway.getServerStatus(id);
      const authStatus = oauthManager.getAuthStatus(id);

      const server = {
        ...config,
        oauth:
          config.transport !== "stdio" && (config as RemoteServerConfig).oauth
            ? {
                ...(config as RemoteServerConfig).oauth,
                clientSecret: (config as RemoteServerConfig).oauth?.clientSecret
                  ? "••••••••"
                  : undefined,
              }
            : undefined,
        runtime: status
          ? {
              status: status.status,
              error: status.error,
              tools: status.tools,
              resources: status.resources,
              prompts: status.prompts,
              lastConnected: status.lastConnected,
            }
          : {
              status: "disconnected",
              tools: [],
              resources: [],
              prompts: [],
            },
        auth: authStatus,
      };

      res.json(success(server));
    } catch (err) {
      console.error("[API] Error getting server:", err);
      res.status(500).json(error("Failed to get server."));
    }
  });

  /**
   * POST /api/servers
   * Register a new MCP server (local or remote).
   */
  router.post("/servers", async (req: Request, res: Response) => {
    try {
      const body = req.body as CreateServerRequest;

      if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
        res.status(400).json(error("Server name is required."));
        return;
      }

      if (!body.transport) {
        res
          .status(400)
          .json(
            error(
              "Transport type is required (stdio, sse, or streamable-http)."
            )
          );
        return;
      }

      const id = uuidv4();
      const timestamp = now();
      let config: ServerConfig;

      if (body.transport === "stdio") {
        if (!body.command || typeof body.command !== "string") {
          res
            .status(400)
            .json(error("Command is required for stdio transport."));
          return;
        }

        config = {
          id,
          name: body.name.trim(),
          enabled: body.enabled !== false,
          transport: "stdio",
          command: body.command,
          args: body.args ?? [],
          env: body.env,
          cwd: body.cwd,
          createdAt: timestamp,
          updatedAt: timestamp,
        } satisfies LocalServerConfig;
      } else if (
        body.transport === "sse" ||
        body.transport === "streamable-http"
      ) {
        if (!body.url || typeof body.url !== "string") {
          res
            .status(400)
            .json(error("URL is required for remote transport."));
          return;
        }

        // Validate URL
        try {
          new URL(body.url);
        } catch {
          res.status(400).json(error("Invalid URL format."));
          return;
        }

        // Validate OAuth config if provided
        if (body.oauth) {
          const oauthErrors = validateOAuthConfig(body.oauth);
          if (oauthErrors.length > 0) {
            res
              .status(400)
              .json(
                error(`Invalid OAuth config: ${oauthErrors.join(", ")}`)
              );
            return;
          }
        }

        config = {
          id,
          name: body.name.trim(),
          enabled: body.enabled !== false,
          transport: body.transport,
          url: body.url,
          headers: body.headers,
          oauth: body.oauth,
          createdAt: timestamp,
          updatedAt: timestamp,
        } satisfies RemoteServerConfig;
      } else {
        res.status(400).json(
          error(
            `Invalid transport "${String(
              (body as unknown as Record<string, unknown>).transport
            )}". Must be stdio, sse, or streamable-http.`
          )
        );
        return;
      }

      // Check for duplicate name
      const existing = store.getServerByName(config.name);
      if (existing) {
        res
          .status(409)
          .json(error(`A server named "${config.name}" already exists.`));
        return;
      }

      const status = await gateway.registerServer(config);

      res.status(201).json(
        success({
          ...config,
          oauth:
            config.transport !== "stdio" &&
            (config as RemoteServerConfig).oauth
              ? {
                  ...(config as RemoteServerConfig).oauth,
                  clientSecret: (config as RemoteServerConfig).oauth
                    ?.clientSecret
                    ? "••••••••"
                    : undefined,
                }
              : undefined,
          runtime: {
            status: status.status,
            error: status.error,
            tools: status.tools,
            resources: status.resources,
            prompts: status.prompts,
            lastConnected: status.lastConnected,
          },
          auth: oauthManager.getAuthStatus(config.id),
        })
      );
    } catch (err) {
      console.error("[API] Error creating server:", err);
      const message =
        err instanceof Error ? err.message : "Failed to create server.";
      res.status(500).json(error(message));
    }
  });

  /**
   * PATCH /api/servers/:id
   * Update a server's configuration.
   */
  router.patch(
    "/servers/:id",
    async (req: Request<IdParams>, res: Response) => {
      try {
        const id = req.params.id;
        const body = req.body as UpdateServerRequest;

        const existing = store.getServer(id);
        if (!existing) {
          res.status(404).json(error(`Server "${id}" not found.`));
          return;
        }

        // Validate name uniqueness if changing
        if (body.name && body.name.trim()) {
          const duplicate = store.getServerByName(body.name.trim());
          if (duplicate && duplicate.id !== id) {
            res
              .status(409)
              .json(
                error(`A server named "${body.name}" already exists.`)
              );
            return;
          }
        }

        // Validate URL if changing for remote servers
        if (body.url && existing.transport !== "stdio") {
          try {
            new URL(body.url);
          } catch {
            res.status(400).json(error("Invalid URL format."));
            return;
          }
        }

        // Validate OAuth config if provided
        if (body.oauth && existing.transport !== "stdio") {
          const oauthErrors = validateOAuthConfig(
            body.oauth as unknown as Record<string, unknown>
          );
          if (oauthErrors.length > 0) {
            res
              .status(400)
              .json(
                error(`Invalid OAuth config: ${oauthErrors.join(", ")}`)
              );
            return;
          }
        }

        // Build updates, filtering out undefined/irrelevant fields
        const updates: Partial<ServerConfig> = {};
        if (body.name !== undefined) updates.name = body.name.trim();
        if (body.enabled !== undefined) updates.enabled = body.enabled;

        if (existing.transport === "stdio") {
          if (body.command !== undefined)
            (updates as Partial<LocalServerConfig>).command = body.command;
          if (body.args !== undefined)
            (updates as Partial<LocalServerConfig>).args = body.args;
          if (body.env !== undefined)
            (updates as Partial<LocalServerConfig>).env = body.env;
          if (body.cwd !== undefined)
            (updates as Partial<LocalServerConfig>).cwd = body.cwd;
        } else {
          if (body.url !== undefined)
            (updates as Partial<RemoteServerConfig>).url = body.url;
          if (body.headers !== undefined)
            (updates as Partial<RemoteServerConfig>).headers =
              body.headers;
          if (body.oauth !== undefined) {
            (updates as Partial<RemoteServerConfig>).oauth =
              body.oauth === null ? undefined : body.oauth;
          }
        }

        const status = await gateway.updateServer(id, updates);
        const updatedConfig = store.getServer(id)!;

        res.json(
          success({
            ...updatedConfig,
            oauth:
              updatedConfig.transport !== "stdio" &&
              (updatedConfig as RemoteServerConfig).oauth
                ? {
                    ...(updatedConfig as RemoteServerConfig).oauth,
                    clientSecret: (updatedConfig as RemoteServerConfig)
                      .oauth?.clientSecret
                      ? "••••••••"
                      : undefined,
                  }
                : undefined,
            runtime: {
              status: status.status,
              error: status.error,
              tools: status.tools,
              resources: status.resources,
              prompts: status.prompts,
              lastConnected: status.lastConnected,
            },
            auth: oauthManager.getAuthStatus(id),
          })
        );
      } catch (err) {
        console.error("[API] Error updating server:", err);
        const message =
          err instanceof Error ? err.message : "Failed to update server.";
        res.status(500).json(error(message));
      }
    }
  );

  /**
   * DELETE /api/servers/:id
   * Remove a server from the gateway.
   */
  router.delete(
    "/servers/:id",
    async (req: Request<IdParams>, res: Response) => {
      try {
        const id = req.params.id;
        const existing = store.getServer(id);
        if (!existing) {
          res.status(404).json(error(`Server "${id}" not found.`));
          return;
        }

        await gateway.removeServer(id);
        res.json(success({ id, removed: true }));
      } catch (err) {
        console.error("[API] Error removing server:", err);
        const message =
          err instanceof Error ? err.message : "Failed to remove server.";
        res.status(500).json(error(message));
      }
    }
  );

  // ─── Connection Control ──────────────────────────────────────────────────

  /**
   * POST /api/servers/:id/connect
   * Manually connect to a server.
   */
  router.post(
    "/servers/:id/connect",
    async (req: Request<IdParams>, res: Response) => {
      try {
        const id = req.params.id;
        const existing = store.getServer(id);
        if (!existing) {
          res.status(404).json(error(`Server "${id}" not found.`));
          return;
        }

        await gateway.connectServer(id);
        const status = gateway.getServerStatus(id);
        res.json(success(status));
      } catch (err) {
        console.error("[API] Error connecting server:", err);
        const message =
          err instanceof Error ? err.message : "Failed to connect.";
        res.status(500).json(error(message));
      }
    }
  );

  /**
   * POST /api/servers/:id/disconnect
   * Manually disconnect from a server.
   */
  router.post(
    "/servers/:id/disconnect",
    async (req: Request<IdParams>, res: Response) => {
      try {
        const id = req.params.id;
        const existing = store.getServer(id);
        if (!existing) {
          res.status(404).json(error(`Server "${id}" not found.`));
          return;
        }

        await gateway.disconnectServer(id);
        const status = gateway.getServerStatus(id);
        res.json(success(status));
      } catch (err) {
        console.error("[API] Error disconnecting server:", err);
        const message =
          err instanceof Error ? err.message : "Failed to disconnect.";
        res.status(500).json(error(message));
      }
    }
  );

  /**
   * POST /api/servers/:id/reconnect
   * Reconnect a server (disconnect + connect).
   */
  router.post(
    "/servers/:id/reconnect",
    async (req: Request<IdParams>, res: Response) => {
      try {
        const id = req.params.id;
        const existing = store.getServer(id);
        if (!existing) {
          res.status(404).json(error(`Server "${id}" not found.`));
          return;
        }

        await gateway.reconnectServer(id);
        const status = gateway.getServerStatus(id);
        res.json(success(status));
      } catch (err) {
        console.error("[API] Error reconnecting server:", err);
        const message =
          err instanceof Error ? err.message : "Failed to reconnect.";
        res.status(500).json(error(message));
      }
    }
  );

  /**
   * POST /api/servers/:id/refresh
   * Refresh capabilities (tools, resources, prompts) for a connected server.
   */
  router.post(
    "/servers/:id/refresh",
    async (req: Request<IdParams>, res: Response) => {
      try {
        const id = req.params.id;
        const status = await gateway.refreshCapabilities(id);
        res.json(success(status));
      } catch (err) {
        console.error("[API] Error refreshing capabilities:", err);
        const message =
          err instanceof Error
            ? err.message
            : "Failed to refresh capabilities.";
        res.status(500).json(error(message));
      }
    }
  );

  // ─── Enable / Disable ────────────────────────────────────────────────────

  /**
   * POST /api/servers/:id/enable
   * Enable a server and connect to it.
   */
  router.post(
    "/servers/:id/enable",
    async (req: Request<IdParams>, res: Response) => {
      try {
        const id = req.params.id;
        const status = await gateway.updateServer(id, { enabled: true });
        res.json(success(status));
      } catch (err) {
        console.error("[API] Error enabling server:", err);
        const message =
          err instanceof Error
            ? err.message
            : "Failed to enable server.";
        res.status(500).json(error(message));
      }
    }
  );

  /**
   * POST /api/servers/:id/disable
   * Disable a server and disconnect from it.
   */
  router.post(
    "/servers/:id/disable",
    async (req: Request<IdParams>, res: Response) => {
      try {
        const id = req.params.id;
        const status = await gateway.updateServer(id, { enabled: false });
        res.json(success(status));
      } catch (err) {
        console.error("[API] Error disabling server:", err);
        const message =
          err instanceof Error
            ? err.message
            : "Failed to disable server.";
        res.status(500).json(error(message));
      }
    }
  );

  // ─── OAuth ───────────────────────────────────────────────────────────────

  /**
   * GET /api/servers/:id/auth/status
   * Check the OAuth authentication status for a server.
   */
  router.get(
    "/servers/:id/auth/status",
    (req: Request<IdParams>, res: Response) => {
      try {
        const id = req.params.id;
        const existing = store.getServer(id);
        if (!existing) {
          res.status(404).json(error(`Server "${id}" not found.`));
          return;
        }

        const authStatus = oauthManager.getAuthStatus(id);
        res.json(success(authStatus));
      } catch (err) {
        console.error("[API] Error getting auth status:", err);
        res.status(500).json(error("Failed to get auth status."));
      }
    }
  );

  /**
   * POST /api/servers/:id/auth/initiate
   * Begin the OAuth authorization flow for a remote server.
   *
   * The SDK will automatically:
   * 1. Discover .well-known/oauth-authorization-server metadata
   * 2. Attempt dynamic client registration if no clientId is configured
   * 3. Build the PKCE authorization URL
   * 4. The provider's redirectToAuthorization() will fire a gateway event
   *
   * Returns { result: "AUTHORIZED" | "REDIRECT", authUrl?: string }
   */
  router.post(
    "/servers/:id/auth/initiate",
    async (req: Request<IdParams>, res: Response) => {
      try {
        const id = req.params.id;
        const config = store.getServer(id);
        if (!config) {
          res.status(404).json(error(`Server "${id}" not found.`));
          return;
        }

        if (config.transport === "stdio") {
          res
            .status(400)
            .json(
              error("OAuth is not applicable for local stdio servers.")
            );
          return;
        }

        const remoteConfig = config as RemoteServerConfig;
        if (!remoteConfig.oauth?.enabled) {
          res
            .status(400)
            .json(
              error(
                "This server does not have OAuth enabled. Edit the server and enable OAuth first."
              )
            );
          return;
        }

        // Capture the auth URL when the provider emits the redirect event.
        // We temporarily wrap the redirect callback to catch the URL.
        let capturedAuthUrl: string | undefined;
        const provider = oauthManager.getProvider(id, remoteConfig.oauth);
        const originalRedirect =
          provider.redirectToAuthorization.bind(provider);

        provider.redirectToAuthorization = (authorizationUrl: URL) => {
          capturedAuthUrl = authorizationUrl.toString();
          originalRedirect(authorizationUrl);
        };

        try {
          const result = await oauthManager.initiateAuth(
            id,
            remoteConfig.url,
            remoteConfig.oauth
          );

          // Restore original redirect function
          provider.redirectToAuthorization = originalRedirect;

          res.json(
            success({
              result,
              authUrl: capturedAuthUrl,
            })
          );
        } catch (authErr) {
          // Restore original redirect function even on error
          provider.redirectToAuthorization = originalRedirect;
          throw authErr;
        }
      } catch (err) {
        console.error("[API] Error initiating auth:", err);
        const message =
          err instanceof Error
            ? err.message
            : "Failed to initiate auth.";
        res.status(500).json(error(message));
      }
    }
  );

  /**
   * POST /api/servers/:id/auth/revoke
   * Revoke OAuth tokens and clear all stored OAuth state for a server.
   */
  router.post(
    "/servers/:id/auth/revoke",
    async (req: Request<IdParams>, res: Response) => {
      try {
        const id = req.params.id;
        const config = store.getServer(id);
        if (!config) {
          res.status(404).json(error(`Server "${id}" not found.`));
          return;
        }

        oauthManager.revokeTokens(id);

        // Disconnect the server since tokens are revoked
        try {
          await gateway.disconnectServer(id);
        } catch {
          // Ignore disconnect errors during revocation
        }

        res.json(success({ revoked: true }));
      } catch (err) {
        console.error("[API] Error revoking tokens:", err);
        const message =
          err instanceof Error
            ? err.message
            : "Failed to revoke tokens.";
        res.status(500).json(error(message));
      }
    }
  );

  // ─── Aggregated Capabilities ─────────────────────────────────────────────

  /**
   * GET /api/tools
   * List all available tools across all connected servers.
   */
  router.get("/tools", (_req: Request, res: Response) => {
    try {
      const tools = gateway.getAllTools();
      res.json(success(tools));
    } catch (err) {
      console.error("[API] Error listing tools:", err);
      res.status(500).json(error("Failed to list tools."));
    }
  });

  /**
   * GET /api/resources
   * List all available resources across all connected servers.
   */
  router.get("/resources", (_req: Request, res: Response) => {
    try {
      const resources = gateway.getAllResources();
      res.json(success(resources));
    } catch (err) {
      console.error("[API] Error listing resources:", err);
      res.status(500).json(error("Failed to list resources."));
    }
  });

  /**
   * GET /api/prompts
   * List all available prompts across all connected servers.
   */
  router.get("/prompts", (_req: Request, res: Response) => {
    try {
      const prompts = gateway.getAllPrompts();
      res.json(success(prompts));
    } catch (err) {
      console.error("[API] Error listing prompts:", err);
      res.status(500).json(error("Failed to list prompts."));
    }
  });

  // ─── Tool Invocation ─────────────────────────────────────────────────────

  /**
   * POST /api/tools/call
   * Call a tool on a specific server or auto-route by tool name.
   */
  router.post("/tools/call", async (req: Request, res: Response) => {
    try {
      const {
        serverId,
        toolName,
        arguments: args,
      } = req.body as {
        serverId?: string;
        toolName: string;
        arguments?: Record<string, unknown>;
      };

      if (!toolName) {
        res.status(400).json(error("toolName is required."));
        return;
      }

      let result: unknown;

      if (serverId) {
        result = await gateway.callTool(serverId, toolName, args ?? {});
      } else {
        const { result: toolResult } = await gateway.callToolByName(
          toolName,
          args ?? {}
        );
        result = toolResult;
      }

      res.json(success(result));
    } catch (err) {
      console.error("[API] Error calling tool:", err);
      const message =
        err instanceof Error ? err.message : "Failed to call tool.";
      res.status(500).json(error(message));
    }
  });

  // ─── Server-Sent Events (live status updates) ────────────────────────────

  /**
   * GET /api/events
   * SSE stream of gateway events for live UI updates.
   */
  router.get("/events", (req: Request, res: Response) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send initial state
    const statuses = gateway.getAllServerStatuses();
    for (const status of statuses) {
      res.write(
        `data: ${JSON.stringify({ type: "server:status", status })}\n\n`
      );
    }

    // Listen for gateway events
    const onEvent = (event: unknown) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    gateway.on("event", onEvent);

    // Keep-alive ping every 30 seconds
    const keepAlive = setInterval(() => {
      res.write(": ping\n\n");
    }, 30000);

    // Cleanup on connection close
    req.on("close", () => {
      gateway.off("event", onEvent);
      clearInterval(keepAlive);
    });
  });

  // ─── Health Check ────────────────────────────────────────────────────────

  /**
   * GET /api/health
   * Simple health check endpoint.
   */
  router.get("/health", (_req: Request, res: Response) => {
    const statuses = gateway.getAllServerStatuses();
    const connected = statuses.filter((s) => s.status === "connected").length;
    const total = statuses.length;

    res.json(
      success({
        status: "ok",
        servers: { total, connected },
        uptime: process.uptime(),
      })
    );
  });

  return router;
}

// ─── OAuth Callback Route (separate from /api prefix) ────────────────────────

/**
 * Creates the OAuth callback router.
 *
 * The callback URL is per-server: `/oauth/callback/:serverId`
 *
 * When the user completes authorization at the OAuth provider, they are
 * redirected here with `code` and `state` query parameters. We use the
 * MCP SDK's `auth()` function to exchange the code for tokens via the
 * server's `GatewayOAuthProvider`.
 */
export function createOAuthRouter(
  gateway: Gateway,
  store: Store,
  oauthManager: OAuthManager
): Router {
  const router = Router();

  /**
   * GET /oauth/callback/:serverId
   * Per-server OAuth redirect callback.
   */
  router.get(
    "/callback/:serverId",
    async (req: Request<ServerIdParams>, res: Response) => {
      const serverId = req.params.serverId;

      try {
        const code = req.query.code as string | undefined;
        const oauthError = req.query.error as string | undefined;
        const errorDescription = req.query
          .error_description as string | undefined;

        if (oauthError) {
          console.error(
            `[OAuth] Authorization error for server "${serverId}": ${oauthError} - ${errorDescription}`
          );
          res.redirect(
            `/?oauth=error&serverId=${encodeURIComponent(
              serverId
            )}&message=${encodeURIComponent(
              String(errorDescription || oauthError)
            )}`
          );
          return;
        }

        if (!code) {
          res.redirect(
            `/?oauth=error&serverId=${encodeURIComponent(
              serverId
            )}&message=Missing+authorization+code`
          );
          return;
        }

        // Look up the server config
        const config = store.getServer(serverId);
        if (!config) {
          res.redirect(
            `/?oauth=error&serverId=${encodeURIComponent(
              serverId
            )}&message=${encodeURIComponent(
              `Server "${serverId}" not found.`
            )}`
          );
          return;
        }

        if (config.transport === "stdio") {
          res.redirect(
            `/?oauth=error&serverId=${encodeURIComponent(
              serverId
            )}&message=OAuth+not+applicable+for+stdio+servers`
          );
          return;
        }

        const remoteConfig = config as RemoteServerConfig;
        if (!remoteConfig.oauth?.enabled) {
          res.redirect(
            `/?oauth=error&serverId=${encodeURIComponent(
              serverId
            )}&message=OAuth+not+enabled+for+this+server`
          );
          return;
        }

        // Exchange the authorization code for tokens using the MCP SDK
        console.log(
          `[OAuth] Exchanging authorization code for server "${config.name}" (${serverId})...`
        );

        const result = await oauthManager.handleCallback(
          serverId,
          remoteConfig.url,
          code,
          remoteConfig.oauth
        );

        console.log(
          `[OAuth] Token exchange result for "${config.name}": ${result}`
        );

        if (result === "AUTHORIZED") {
          // Notify the gateway so it can proceed with connection
          await gateway.onOAuthComplete(serverId);

          res.redirect(
            `/?oauth=success&serverId=${encodeURIComponent(serverId)}`
          );
        } else {
          // Shouldn't normally happen — "REDIRECT" after providing a code
          // means something went wrong or another redirect is needed
          res.redirect(
            `/?oauth=error&serverId=${encodeURIComponent(
              serverId
            )}&message=Unexpected+auth+result:+${encodeURIComponent(
              result
            )}`
          );
        }
      } catch (err) {
        console.error(
          `[OAuth] Callback error for server "${serverId}":`,
          err
        );
        const message =
          err instanceof Error ? err.message : "OAuth callback failed";
        res.redirect(
          `/?oauth=error&serverId=${encodeURIComponent(
            serverId
          )}&message=${encodeURIComponent(message)}`
        );
      }
    }
  );

  return router;
}

// ─── Validation Helpers ──────────────────────────────────────────────────────

function validateOAuthConfig(
  oauth: OAuthConfig | Record<string, unknown>
): string[] {
  const errors: string[] = [];
  const config = oauth as Record<string, unknown>;

  // `enabled` must be a boolean if present
  if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
    errors.push("enabled must be a boolean");
  }

  // `clientId` is optional but must be a string if present
  if (config.clientId !== undefined && typeof config.clientId !== "string") {
    errors.push("clientId must be a string");
  }

  // `clientSecret` is optional but must be a string if present
  if (
    config.clientSecret !== undefined &&
    typeof config.clientSecret !== "string"
  ) {
    errors.push("clientSecret must be a string");
  }

  // `scopes` is optional but must be an array of strings if present
  if (config.scopes !== undefined) {
    if (!Array.isArray(config.scopes)) {
      errors.push("scopes must be an array of strings");
    } else if (
      config.scopes.some((s: unknown) => typeof s !== "string")
    ) {
      errors.push("scopes must be an array of strings");
    }
  }

  return errors;
}