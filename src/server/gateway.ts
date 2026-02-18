import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { EventEmitter } from "node:events";
import type {
  ServerConfig,
  LocalServerConfig,
  RemoteServerConfig,
  ServerStatus,
  ConnectionStatus,
  ToolInfo,
  ResourceInfo,
  PromptInfo,
  GatewayEvent,
  AuthConfig,
  OAuthAuthConfig,
} from "./types.js";
import {
  getEffectiveAuthConfig,
  buildAuthHeaders,
  requiresOAuthProvider,
} from "./types.js";
import type { Store } from "./store.js";
import type { OAuthManager } from "./oauth.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ManagedServer {
  config: ServerConfig;
  client: Client | null;
  transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport | null;
  status: ConnectionStatus;
  error?: string;
  tools: ToolInfo[];
  resources: ResourceInfo[];
  prompts: PromptInfo[];
  lastConnected?: string;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  reconnectAttempts: number;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;

/**
 * Default timeout for tool/resource/prompt requests in milliseconds.
 * The MCP SDK defaults to 60 seconds, but some operations (e.g., Jira API calls)
 * can take longer. This sets a more generous default of 5 minutes.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Expand tilde (~) to the user's home directory in a path.
 * Node's spawn doesn't expand ~ like a shell does, so we need to do it manually.
 */
function expandTilde(path: string | undefined): string | undefined {
  if (!path) return path;
  if (path.startsWith("~/")) {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return home + path.slice(1);
  }
  if (path === "~") {
    return process.env.HOME || process.env.USERPROFILE || path;
  }
  return path;
}

// ─── Gateway ───────────────────────────────────────────────────────────────────

export class Gateway extends EventEmitter {
  private servers = new Map<string, ManagedServer>();
  private store: Store;
  private oauthManager: OAuthManager;
  private shutdownRequested = false;

  constructor(store: Store, oauthManager: OAuthManager) {
    super();
    this.store = store;
    this.oauthManager = oauthManager;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Initialize the gateway by loading all server configs from the store
   * and connecting to enabled servers.
   */
  async initialize(): Promise<void> {
    console.log("[Gateway] Initializing...");
    const configs = this.store.getAllServers();

    for (const config of configs) {
      this.servers.set(config.id, this.createManagedServer(config));
    }

    // Connect to all enabled servers in parallel
    const enabledServers = configs.filter((c) => c.enabled);
    const connectPromises = enabledServers.map((config) =>
      this.connectServer(config.id).catch((err) => {
        console.error(
          `[Gateway] Failed to connect to "${config.name}" during init:`,
          err
        );
      })
    );

    await Promise.allSettled(connectPromises);
    console.log(
      `[Gateway] Initialized with ${configs.length} server(s), ${enabledServers.length} enabled.`
    );
  }

  /**
   * Gracefully shut down all connections.
   */
  async shutdown(): Promise<void> {
    console.log("[Gateway] Shutting down...");
    this.shutdownRequested = true;

    const disconnectPromises: Promise<void>[] = [];
    for (const [id, managed] of this.servers.entries()) {
      if (managed.reconnectTimer) {
        clearTimeout(managed.reconnectTimer);
        managed.reconnectTimer = undefined;
      }
      if (managed.status === "connected" || managed.status === "connecting") {
        disconnectPromises.push(
          this.disconnectServer(id).catch((err) => {
            console.error(
              `[Gateway] Error disconnecting "${managed.config.name}":`,
              err
            );
          })
        );
      }
    }

    await Promise.allSettled(disconnectPromises);
    this.servers.clear();
    console.log("[Gateway] Shutdown complete.");
  }

  // ─── Server Registration ──────────────────────────────────────────────────

  /**
   * Register a new server in the gateway and optionally connect to it.
   */
  async registerServer(config: ServerConfig): Promise<ServerStatus> {
    // Persist to store
    this.store.addServer(config);

    const managed = this.createManagedServer(config);
    this.servers.set(config.id, managed);

    this.emitEvent({ type: "server:added", server: config });

    // Auto-connect if enabled
    if (config.enabled) {
      await this.connectServer(config.id).catch((err) => {
        console.error(
          `[Gateway] Failed to auto-connect "${config.name}":`,
          err
        );
      });
    }

    return this.getServerStatus(config.id)!;
  }

  /**
   * Update a server's configuration. Reconnects if the server is currently
   * connected and connection-relevant settings changed.
   */
  async updateServer(
    id: string,
    updates: Partial<ServerConfig>
  ): Promise<ServerStatus> {
    const managed = this.servers.get(id);
    if (!managed) {
      throw new Error(`Server "${id}" not found in gateway.`);
    }

    const previousConfig = { ...managed.config };

    // Update in store
    const updatedConfig = this.store.updateServer(id, updates);
    managed.config = updatedConfig;

    this.emitEvent({ type: "server:updated", server: updatedConfig });

    // If auth config changed for a remote server using OAuth, replace the provider
    if (updatedConfig.transport !== "stdio") {
      const remoteConfig = updatedConfig as RemoteServerConfig;
      const authConfig = getEffectiveAuthConfig(remoteConfig);
      
      if (requiresOAuthProvider(authConfig)) {
        // Convert to legacy format for the OAuthManager
        const oauthConfig = {
          enabled: true,
          clientId: (authConfig as OAuthAuthConfig).clientId,
          clientSecret: (authConfig as OAuthAuthConfig).clientSecret,
          scopes: (authConfig as OAuthAuthConfig).scopes,
        };
        this.oauthManager.replaceProvider(id, oauthConfig);
      } else {
        // If auth mode is no longer OAuth, remove the provider
        this.oauthManager.removeProvider(id);
      }
    }

    // Determine if we need to reconnect
    const needsReconnect = this.connectionSettingsChanged(
      previousConfig,
      updatedConfig
    );

    if (
      needsReconnect &&
      (managed.status === "connected" || managed.status === "connecting")
    ) {
      console.log(
        `[Gateway] Connection settings changed for "${updatedConfig.name}", reconnecting...`
      );
      await this.disconnectServer(id);
      if (updatedConfig.enabled) {
        await this.connectServer(id);
      }
    } else if (
      updatedConfig.enabled &&
      !previousConfig.enabled &&
      managed.status === "disconnected"
    ) {
      // Server was just enabled
      await this.connectServer(id);
    } else if (!updatedConfig.enabled && previousConfig.enabled) {
      // Server was just disabled
      await this.disconnectServer(id);
    }

    return this.getServerStatus(id)!;
  }

  /**
   * Remove a server from the gateway entirely.
   */
  async removeServer(id: string): Promise<void> {
    const managed = this.servers.get(id);
    if (!managed) {
      throw new Error(`Server "${id}" not found in gateway.`);
    }

    // Disconnect if connected
    if (managed.status === "connected" || managed.status === "connecting") {
      await this.disconnectServer(id);
    }

    if (managed.reconnectTimer) {
      clearTimeout(managed.reconnectTimer);
    }

    this.servers.delete(id);
    this.store.removeServer(id);
    this.oauthManager.removeProvider(id);

    this.emitEvent({ type: "server:removed", serverId: id });
  }

  // ─── Connection Management ─────────────────────────────────────────────────

  /**
   * Connect to a specific server.
   */
  async connectServer(id: string): Promise<void> {
    const managed = this.servers.get(id);
    if (!managed) {
      throw new Error(`Server "${id}" not found in gateway.`);
    }

    if (managed.status === "connected") {
      console.log(
        `[Gateway] Server "${managed.config.name}" is already connected.`
      );
      return;
    }

    if (managed.status === "connecting") {
      console.log(
        `[Gateway] Server "${managed.config.name}" is already connecting.`
      );
      return;
    }

    this.setStatus(managed, "connecting");

    try {
      const config = managed.config;

      if (config.transport === "stdio") {
        await this.connectLocalServer(managed, config);
      } else {
        await this.connectRemoteServer(managed, config);
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Unknown connection error";
      console.error(
        `[Gateway] Failed to connect to "${managed.config.name}":`,
        errorMsg
      );

      // If it's an auth-related error, mark as awaiting_oauth rather than generic error
      if (
        errorMsg.includes("Unauthorized") ||
        errorMsg.includes("401") ||
        managed.status === "awaiting_oauth"
      ) {
        // Status was already set to awaiting_oauth by the auth provider callback
        if (managed.status !== "awaiting_oauth") {
          this.setStatus(managed, "awaiting_oauth");
        }
      } else {
        this.setStatus(managed, "error", errorMsg);
        this.scheduleReconnect(managed);
      }
    }
  }

  /**
   * Disconnect from a specific server.
   */
  async disconnectServer(id: string): Promise<void> {
    const managed = this.servers.get(id);
    if (!managed) {
      throw new Error(`Server "${id}" not found in gateway.`);
    }

    if (managed.reconnectTimer) {
      clearTimeout(managed.reconnectTimer);
      managed.reconnectTimer = undefined;
    }
    managed.reconnectAttempts = 0;

    await this.closeConnection(managed);

    this.setStatus(managed, "disconnected");
    this.emitEvent({ type: "server:disconnected", serverId: id });
  }

  /**
   * Reconnect a server (disconnect then connect).
   */
  async reconnectServer(id: string): Promise<void> {
    const managed = this.servers.get(id);
    if (!managed) {
      throw new Error(`Server "${id}" not found in gateway.`);
    }

    managed.reconnectAttempts = 0; // Reset attempts on manual reconnect
    await this.disconnectServer(id);
    await this.connectServer(id);
  }

  // ─── Connection Implementations ────────────────────────────────────────────

  private async connectLocalServer(
    managed: ManagedServer,
    config: LocalServerConfig
  ): Promise<void> {
    console.log(
      `[Gateway] Connecting to local server "${config.name}" via stdio: ${config.command} ${config.args.join(" ")}`
    );

    // Expand tilde in cwd path (Node's spawn doesn't expand ~ like a shell does)
    const expandedCwd = expandTilde(config.cwd);
    if (config.cwd && expandedCwd !== config.cwd) {
      console.log(`[Gateway] Expanded cwd: "${config.cwd}" -> "${expandedCwd}"`);
    }
    
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: expandedCwd,
    });

    const client = new Client(
      {
        name: `mcp-gateway/${config.name}`,
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    managed.transport = transport;
    managed.client = client;

    // Handle transport closure
    transport.onclose = () => {
      if (managed.status === "connected") {
        console.log(
          `[Gateway] Local server "${config.name}" transport closed unexpectedly.`
        );
        this.setStatus(managed, "disconnected");
        this.emitEvent({
          type: "server:disconnected",
          serverId: config.id,
          error: "Transport closed unexpectedly",
        });
        if (!this.shutdownRequested && config.enabled) {
          this.scheduleReconnect(managed);
        }
      }
    };

    transport.onerror = (error) => {
      console.error(
        `[Gateway] Local server "${config.name}" transport error:`,
        error
      );
      this.setStatus(managed, "error", String(error));
    };

    await client.connect(transport);

    // Discover capabilities
    await this.discoverCapabilities(managed);

    this.setStatus(managed, "connected");
    managed.lastConnected = new Date().toISOString();
    managed.reconnectAttempts = 0;

    console.log(
      `[Gateway] Connected to local server "${config.name}" — ` +
        `${managed.tools.length} tools, ${managed.resources.length} resources, ${managed.prompts.length} prompts`
    );

    this.emitEvent({ type: "server:connected", serverId: config.id });
  }

  private async connectRemoteServer(
    managed: ManagedServer,
    config: RemoteServerConfig
  ): Promise<void> {
    console.log(
      `[Gateway] Connecting to remote server "${config.name}" via ${config.transport}: ${config.url}`
    );

    const url = new URL(config.url);

    // Get the effective auth configuration (handles backwards compatibility)
    const authConfig = getEffectiveAuthConfig(config);
    
    console.log(
      `[Gateway] Auth mode for "${config.name}": ${authConfig.mode}`
    );

    // Build the auth provider only if using OAuth mode.
    // The SDK transports accept an `authProvider` option and automatically
    // handle 401 responses by:
    //   1. Discovering .well-known/oauth-authorization-server metadata
    //   2. Performing dynamic client registration (if needed)
    //   3. Building the PKCE authorization URL
    //   4. Calling provider.redirectToAuthorization()
    //   5. On subsequent connect with tokens, attaching the Bearer header
    let authProvider = undefined;

    if (requiresOAuthProvider(authConfig)) {
      // For OAuth mode, we need to convert to legacy OAuthConfig format
      // for the OAuthManager (which still uses the legacy format internally)
      const oauthConfig = {
        enabled: true,
        clientId: (authConfig as OAuthAuthConfig).clientId,
        clientSecret: (authConfig as OAuthAuthConfig).clientSecret,
        scopes: (authConfig as OAuthAuthConfig).scopes,
      };
      authProvider = this.oauthManager.getProvider(config.id, oauthConfig);
    }

    // Build headers: start with user-configured headers, then add auth headers
    // For non-OAuth auth modes (bearer, api-key, custom), we add auth headers directly
    const headers: Record<string, string> = {
      ...(config.headers ?? {}),
      ...buildAuthHeaders(authConfig),
    };

    let transport: SSEClientTransport | StreamableHTTPClientTransport;

    if (config.transport === "sse") {
      transport = new SSEClientTransport(url, {
        authProvider,
        requestInit: {
          headers,
        },
      });
    } else {
      // streamable-http
      transport = new StreamableHTTPClientTransport(url, {
        authProvider,
        requestInit: {
          headers,
        },
      });
    }

    const client = new Client(
      {
        name: `mcp-gateway/${config.name}`,
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    managed.transport = transport;
    managed.client = client;

    // Handle transport closure
    transport.onclose = () => {
      if (managed.status === "connected") {
        console.log(
          `[Gateway] Remote server "${config.name}" transport closed.`
        );
        this.setStatus(managed, "disconnected");
        this.emitEvent({
          type: "server:disconnected",
          serverId: config.id,
          error: "Transport closed",
        });
        if (!this.shutdownRequested && config.enabled) {
          this.scheduleReconnect(managed);
        }
      }
    };

    transport.onerror = (error) => {
      console.error(
        `[Gateway] Remote server "${config.name}" transport error:`,
        error
      );
      this.setStatus(managed, "error", String(error));
    };

    try {
      await client.connect(transport);
    } catch (err) {
      // The SDK throws UnauthorizedError when the auth provider's
      // redirectToAuthorization() was called — meaning the user must
      // visit the authorization URL. We surface this as "awaiting_oauth".
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("Unauthorized") ||
        msg.includes("REDIRECT") ||
        msg.includes("401")
      ) {
        console.log(
          `[Gateway] Server "${config.name}" requires OAuth — waiting for user authorization.`
        );
        this.setStatus(managed, "awaiting_oauth");
        // Don't rethrow — the auth redirect event was already emitted
        // by the provider's redirectToAuthorization()
        return;
      }
      throw err;
    }

    // Discover capabilities
    await this.discoverCapabilities(managed);

    this.setStatus(managed, "connected");
    managed.lastConnected = new Date().toISOString();
    managed.reconnectAttempts = 0;

    console.log(
      `[Gateway] Connected to remote server "${config.name}" — ` +
        `${managed.tools.length} tools, ${managed.resources.length} resources, ${managed.prompts.length} prompts`
    );

    this.emitEvent({ type: "server:connected", serverId: config.id });
  }

  // ─── Capability Discovery ──────────────────────────────────────────────────

  private async discoverCapabilities(managed: ManagedServer): Promise<void> {
    const client = managed.client;
    if (!client) return;

    // Discover tools
    try {
      const toolsResult = await client.listTools();
      managed.tools = (toolsResult.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      }));
    } catch (err) {
      console.warn(
        `[Gateway] Could not list tools for "${managed.config.name}":`,
        err
      );
      managed.tools = [];
    }

    // Discover resources
    try {
      const resourcesResult = await client.listResources();
      managed.resources = (resourcesResult.resources ?? []).map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      }));
    } catch (err) {
      console.warn(
        `[Gateway] Could not list resources for "${managed.config.name}":`,
        err
      );
      managed.resources = [];
    }

    // Discover prompts
    try {
      const promptsResult = await client.listPrompts();
      managed.prompts = (promptsResult.prompts ?? []).map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments?.map((a) => ({
          name: a.name,
          description: a.description,
          required: a.required,
        })),
      }));
    } catch (err) {
      console.warn(
        `[Gateway] Could not list prompts for "${managed.config.name}":`,
        err
      );
      managed.prompts = [];
    }
  }

  /**
   * Refresh capabilities for a connected server.
   */
  async refreshCapabilities(id: string): Promise<ServerStatus> {
    const managed = this.servers.get(id);
    if (!managed) {
      throw new Error(`Server "${id}" not found in gateway.`);
    }
    if (managed.status !== "connected" || !managed.client) {
      throw new Error(
        `Server "${managed.config.name}" is not connected. Cannot refresh capabilities.`
      );
    }

    await this.discoverCapabilities(managed);
    this.emitStatusEvent(managed);
    return this.getServerStatus(id)!;
  }

  // ─── Tool Invocation ──────────────────────────────────────────────────────

  /**
   * Call a tool on a specific server.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const managed = this.servers.get(serverId);
    if (!managed) {
      throw new Error(`Server "${serverId}" not found in gateway.`);
    }
    if (managed.status !== "connected" || !managed.client) {
      throw new Error(
        `Server "${managed.config.name}" is not connected. Cannot call tool "${toolName}".`
      );
    }

    return managed.client.callTool(
      { name: toolName, arguments: args },
      undefined,
      { timeout: DEFAULT_REQUEST_TIMEOUT_MS }
    );
  }

  /**
   * Call a tool by name across all connected servers. Finds the first server
   * that provides the tool.
   */
  async callToolByName(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ serverId: string; result: unknown }> {
    for (const [id, managed] of this.servers.entries()) {
      if (managed.status !== "connected" || !managed.client) continue;
      const hasTool = managed.tools.some((t) => t.name === toolName);
      if (hasTool) {
        const result = await managed.client.callTool(
          { name: toolName, arguments: args },
          undefined,
          { timeout: DEFAULT_REQUEST_TIMEOUT_MS }
        );
        return { serverId: id, result };
      }
    }
    throw new Error(
      `No connected server provides a tool named "${toolName}".`
    );
  }

  // ─── Resource Access ──────────────────────────────────────────────────────

  /**
   * Read a resource from a specific server.
   */
  async readResource(
    serverId: string,
    uri: string
  ): Promise<unknown> {
    const managed = this.servers.get(serverId);
    if (!managed) {
      throw new Error(`Server "${serverId}" not found in gateway.`);
    }
    if (managed.status !== "connected" || !managed.client) {
      throw new Error(
        `Server "${managed.config.name}" is not connected. Cannot read resource "${uri}".`
      );
    }

    return managed.client.readResource(
      { uri },
      { timeout: DEFAULT_REQUEST_TIMEOUT_MS }
    );
  }

  // ─── Prompt Retrieval ──────────────────────────────────────────────────────

  /**
   * Get a prompt from a specific server.
   */
  async getPrompt(
    serverId: string,
    name: string,
    args?: Record<string, string>
  ): Promise<unknown> {
    const managed = this.servers.get(serverId);
    if (!managed) {
      throw new Error(`Server "${serverId}" not found in gateway.`);
    }
    if (managed.status !== "connected" || !managed.client) {
      throw new Error(
        `Server "${managed.config.name}" is not connected. Cannot get prompt "${name}".`
      );
    }

    return managed.client.getPrompt(
      { name, arguments: args },
      { timeout: DEFAULT_REQUEST_TIMEOUT_MS }
    );
  }

  // ─── Status & Queries ─────────────────────────────────────────────────────

  /**
   * Get the status of a specific server.
   */
  getServerStatus(id: string): ServerStatus | undefined {
    const managed = this.servers.get(id);
    if (!managed) return undefined;

    return {
      id: managed.config.id,
      name: managed.config.name,
      transport: managed.config.transport,
      enabled: managed.config.enabled,
      status: managed.status,
      error: managed.error,
      tools: [...managed.tools],
      resources: [...managed.resources],
      prompts: [...managed.prompts],
      lastConnected: managed.lastConnected,
    };
  }

  /**
   * Get the status of all registered servers.
   */
  getAllServerStatuses(): ServerStatus[] {
    const statuses: ServerStatus[] = [];
    for (const managed of this.servers.values()) {
      statuses.push({
        id: managed.config.id,
        name: managed.config.name,
        transport: managed.config.transport,
        enabled: managed.config.enabled,
        status: managed.status,
        error: managed.error,
        tools: [...managed.tools],
        resources: [...managed.resources],
        prompts: [...managed.prompts],
        lastConnected: managed.lastConnected,
      });
    }
    return statuses;
  }

  /**
   * Get all available tools across all connected servers.
   */
  getAllTools(): Array<ToolInfo & { serverId: string; serverName: string }> {
    const allTools: Array<ToolInfo & { serverId: string; serverName: string }> =
      [];
    for (const managed of this.servers.values()) {
      if (managed.status !== "connected") continue;
      for (const tool of managed.tools) {
        allTools.push({
          ...tool,
          serverId: managed.config.id,
          serverName: managed.config.name,
        });
      }
    }
    return allTools;
  }

  /**
   * Get all available resources across all connected servers.
   */
  getAllResources(): Array<
    ResourceInfo & { serverId: string; serverName: string }
  > {
    const allResources: Array<
      ResourceInfo & { serverId: string; serverName: string }
    > = [];
    for (const managed of this.servers.values()) {
      if (managed.status !== "connected") continue;
      for (const resource of managed.resources) {
        allResources.push({
          ...resource,
          serverId: managed.config.id,
          serverName: managed.config.name,
        });
      }
    }
    return allResources;
  }

  /**
   * Get all available prompts across all connected servers.
   */
  getAllPrompts(): Array<
    PromptInfo & { serverId: string; serverName: string }
  > {
    const allPrompts: Array<
      PromptInfo & { serverId: string; serverName: string }
    > = [];
    for (const managed of this.servers.values()) {
      if (managed.status !== "connected") continue;
      for (const prompt of managed.prompts) {
        allPrompts.push({
          ...prompt,
          serverId: managed.config.id,
          serverName: managed.config.name,
        });
      }
    }
    return allPrompts;
  }

  /**
   * Get server config from the store.
   */
  getServerConfig(id: string): ServerConfig | undefined {
    return this.store.getServer(id);
  }

  /**
   * Notify the gateway that OAuth has completed for a server so it can
   * proceed with connection.
   */
  async onOAuthComplete(serverId: string): Promise<void> {
    const managed = this.servers.get(serverId);
    if (!managed) return;

    if (
      managed.status === "awaiting_oauth" ||
      managed.status === "disconnected" ||
      managed.status === "error"
    ) {
      console.log(
        `[Gateway] OAuth completed for "${managed.config.name}", connecting...`
      );
      // Close any stale transport from the previous attempt
      await this.closeConnection(managed);
      this.setStatus(managed, "disconnected");
      await this.connectServer(serverId);
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private createManagedServer(config: ServerConfig): ManagedServer {
    return {
      config: { ...config },
      client: null,
      transport: null,
      status: "disconnected",
      tools: [],
      resources: [],
      prompts: [],
      reconnectAttempts: 0,
    };
  }

  private async closeConnection(managed: ManagedServer): Promise<void> {
    try {
      if (managed.client) {
        await managed.client.close();
      }
    } catch (err) {
      console.warn(
        `[Gateway] Error closing client for "${managed.config.name}":`,
        err
      );
    }

    try {
      if (managed.transport) {
        await managed.transport.close();
      }
    } catch (err) {
      console.warn(
        `[Gateway] Error closing transport for "${managed.config.name}":`,
        err
      );
    }

    managed.client = null;
    managed.transport = null;
    managed.tools = [];
    managed.resources = [];
    managed.prompts = [];
  }

  private setStatus(
    managed: ManagedServer,
    status: ConnectionStatus,
    error?: string
  ): void {
    managed.status = status;
    managed.error = error;
    this.emitStatusEvent(managed);
  }

  private emitStatusEvent(managed: ManagedServer): void {
    const status = this.getServerStatus(managed.config.id);
    if (status) {
      this.emitEvent({ type: "server:status", status });
    }
  }

  private emitEvent(event: GatewayEvent): void {
    this.emit("event", event);
  }

  private scheduleReconnect(managed: ManagedServer): void {
    if (this.shutdownRequested) return;
    if (!managed.config.enabled) return;
    if (managed.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log(
        `[Gateway] Max reconnect attempts reached for "${managed.config.name}".`
      );
      this.setStatus(
        managed,
        "error",
        `Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts.`
      );
      return;
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * Math.pow(2, managed.reconnectAttempts) +
        Math.random() * 1000,
      MAX_RECONNECT_DELAY_MS
    );

    managed.reconnectAttempts++;

    console.log(
      `[Gateway] Scheduling reconnect for "${managed.config.name}" in ${Math.round(delay)}ms (attempt ${managed.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
    );

    managed.reconnectTimer = setTimeout(async () => {
      managed.reconnectTimer = undefined;
      if (this.shutdownRequested || !managed.config.enabled) return;

      try {
        await this.connectServer(managed.config.id);
      } catch (err) {
        console.error(
          `[Gateway] Reconnect attempt failed for "${managed.config.name}":`,
          err
        );
      }
    }, delay);
  }

  /**
   * Check if connection-relevant settings changed between two configs.
   */
  private connectionSettingsChanged(
    prev: ServerConfig,
    next: ServerConfig
  ): boolean {
    if (prev.transport !== next.transport) return true;

    if (prev.transport === "stdio" && next.transport === "stdio") {
      return (
        prev.command !== next.command ||
        JSON.stringify(prev.args) !== JSON.stringify(next.args) ||
        JSON.stringify(prev.env) !== JSON.stringify(next.env) ||
        prev.cwd !== next.cwd
      );
    }

    if (prev.transport !== "stdio" && next.transport !== "stdio") {
      return (
        prev.url !== next.url ||
        JSON.stringify(prev.headers) !== JSON.stringify(next.headers) ||
        JSON.stringify(prev.auth) !== JSON.stringify(next.auth) ||
        JSON.stringify(prev.oauth) !== JSON.stringify(next.oauth)
      );
    }

    return true;
  }
}