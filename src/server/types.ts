// ─── OAuth Configuration ───────────────────────────────────────────────────────

/**
 * Simplified OAuth config: the gateway auto-discovers authorization server
 * metadata via .well-known/oauth-authorization-server and
 * .well-known/oauth-protected-resource (per the MCP spec).
 *
 * Users only need to flip `enabled: true` and optionally supply pre-registered
 * client credentials. If no clientId is provided the gateway will attempt
 * RFC 7591 Dynamic Client Registration automatically.
 */
export interface OAuthConfig {
  /** Whether OAuth is required for this server */
  enabled: boolean;
  /** Pre-registered OAuth client ID (optional – if omitted, dynamic registration is attempted) */
  clientId?: string;
  /** Pre-registered OAuth client secret (optional – public clients omit this) */
  clientSecret?: string;
  /** Scopes to request (optional – auto-discovered from server metadata if omitted) */
  scopes?: string[];
}

/**
 * Persisted OAuth state managed by the SDK-backed auth provider.
 * Stored per-server in the gateway store.
 */
export interface OAuthPersistedState {
  /** Client information returned by dynamic registration or provided statically */
  clientInfo?: {
    client_id: string;
    client_secret?: string;
    client_id_issued_at?: number;
    client_secret_expires_at?: number;
    /** If this came from dynamic registration it may include full metadata */
    [key: string]: unknown;
  };
  /** OAuth tokens (access, refresh, etc.) */
  tokens?: {
    access_token: string;
    token_type: string;
    expires_in?: number;
    scope?: string;
    refresh_token?: string;
    /** Extra fields the server may return */
    [key: string]: unknown;
  };
  /** PKCE code verifier for the in-flight authorization */
  codeVerifier?: string;
}

// ─── MCP Server Configuration ──────────────────────────────────────────────────

export type ServerTransport = "stdio" | "sse" | "streamable-http";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "awaiting_oauth";

export interface BaseServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: ServerTransport;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** Local MCP server spawned as a child process (stdio transport) */
export interface LocalServerConfig extends BaseServerConfig {
  transport: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/** Remote MCP server connected via SSE or Streamable HTTP */
export interface RemoteServerConfig extends BaseServerConfig {
  transport: "sse" | "streamable-http";
  url: string;
  headers?: Record<string, string>;
  oauth?: OAuthConfig;
}

export type ServerConfig = LocalServerConfig | RemoteServerConfig;

// ─── Runtime State ─────────────────────────────────────────────────────────────

export interface ServerStatus {
  id: string;
  name: string;
  transport: ServerTransport;
  enabled: boolean;
  status: ConnectionStatus;
  error?: string;
  tools: ToolInfo[];
  resources: ResourceInfo[];
  prompts: PromptInfo[];
  lastConnected?: string;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface ResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface PromptInfo {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

// ─── API Request / Response Types ──────────────────────────────────────────────

export interface CreateLocalServerRequest {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
}

export interface CreateRemoteServerRequest {
  name: string;
  transport: "sse" | "streamable-http";
  url: string;
  headers?: Record<string, string>;
  oauth?: OAuthConfig;
  enabled?: boolean;
}

export type CreateServerRequest =
  | (CreateLocalServerRequest & { transport: "stdio" })
  | CreateRemoteServerRequest;

export interface UpdateServerRequest {
  name?: string;
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  oauth?: OAuthConfig | null;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Store Shape ───────────────────────────────────────────────────────────────

export interface GatewayStore {
  servers: ServerConfig[];
  /** SDK-managed OAuth state keyed by server id */
  oauthState: Record<string, OAuthPersistedState>;
}

// ─── Gateway Events ────────────────────────────────────────────────────────────

export type GatewayEvent =
  | { type: "server:added"; server: ServerConfig }
  | { type: "server:updated"; server: ServerConfig }
  | { type: "server:removed"; serverId: string }
  | { type: "server:status"; status: ServerStatus }
  | { type: "server:connected"; serverId: string }
  | { type: "server:disconnected"; serverId: string; error?: string }
  | { type: "oauth:required"; serverId: string; authUrl: string };