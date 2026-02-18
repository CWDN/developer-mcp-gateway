// ─── Authentication Configuration ───────────────────────────────────────────────

/**
 * Authentication mode for remote MCP servers.
 * 
 * - `none`: No authentication required
 * - `oauth`: Standard MCP OAuth 2.0 with auto-discovery via .well-known endpoints
 * - `bearer`: Static bearer token (e.g., GitHub Copilot, pre-authenticated APIs)
 * - `api-key`: API key sent in a custom header (e.g., X-API-Key)
 * - `custom`: Fully custom header-based authentication
 */
export type AuthMode = "none" | "oauth" | "bearer" | "api-key" | "custom";

/**
 * Base authentication configuration shared by all auth modes.
 */
interface BaseAuthConfig {
  mode: AuthMode;
}

/**
 * No authentication required.
 */
export interface NoAuthConfig extends BaseAuthConfig {
  mode: "none";
}

/**
 * OAuth 2.0 authentication with auto-discovery.
 * 
 * The gateway auto-discovers authorization server metadata via
 * .well-known/oauth-authorization-server and .well-known/oauth-protected-resource
 * (per the MCP spec). Users only need to flip `enabled: true` and optionally
 * supply pre-registered client credentials.
 */
export interface OAuthAuthConfig extends BaseAuthConfig {
  mode: "oauth";
  /** Pre-registered OAuth client ID (optional – if omitted, dynamic registration is attempted) */
  clientId?: string;
  /** Pre-registered OAuth client secret (optional – public clients omit this) */
  clientSecret?: string;
  /** Scopes to request (optional – auto-discovered from server metadata if omitted) */
  scopes?: string[];
}

/**
 * Static bearer token authentication.
 * 
 * Use this for APIs that require a pre-authenticated bearer token,
 * such as GitHub Copilot's MCP endpoint.
 */
export interface BearerAuthConfig extends BaseAuthConfig {
  mode: "bearer";
  /** The bearer token to include in the Authorization header */
  token: string;
}

/**
 * API key authentication sent in a header.
 * 
 * Common patterns:
 * - X-API-Key: <key>
 * - Authorization: ApiKey <key>
 */
export interface ApiKeyAuthConfig extends BaseAuthConfig {
  mode: "api-key";
  /** The API key value */
  key: string;
  /** The header name to use (default: "X-API-Key") */
  headerName?: string;
  /** Optional prefix for the header value (e.g., "ApiKey " → "ApiKey <key>") */
  headerPrefix?: string;
}

/**
 * Fully custom header-based authentication.
 * 
 * Use this when the authentication mechanism doesn't fit the other patterns.
 * Allows specifying arbitrary headers for authentication.
 */
export interface CustomAuthConfig extends BaseAuthConfig {
  mode: "custom";
  /** Custom headers to include with every request for authentication */
  headers: Record<string, string>;
}

/**
 * Union type for all authentication configurations.
 */
export type AuthConfig =
  | NoAuthConfig
  | OAuthAuthConfig
  | BearerAuthConfig
  | ApiKeyAuthConfig
  | CustomAuthConfig;

// ─── Legacy OAuth Configuration (for backwards compatibility) ──────────────────

/**
 * @deprecated Use AuthConfig with mode: "oauth" instead.
 * Kept for backwards compatibility with existing configurations.
 * 
 * Simplified OAuth config: the gateway auto-discovers authorization server
 * metadata via .well-known/oauth-authorization-server and
 * .well-known/oauth-protected-resource (per the MCP spec).
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
  /** Additional headers to include with requests (non-auth headers) */
  headers?: Record<string, string>;
  /** 
   * New flexible authentication configuration.
   * Takes precedence over the legacy `oauth` field if both are present.
   */
  auth?: AuthConfig;
  /** 
   * @deprecated Use `auth` with mode: "oauth" instead.
   * Kept for backwards compatibility.
   */
  oauth?: OAuthConfig;
}

export type ServerConfig = LocalServerConfig | RemoteServerConfig;

// ─── Helper Functions ──────────────────────────────────────────────────────────

/**
 * Converts legacy OAuthConfig to new AuthConfig format.
 */
export function legacyOAuthToAuthConfig(oauth: OAuthConfig): AuthConfig {
  if (!oauth.enabled) {
    return { mode: "none" };
  }
  return {
    mode: "oauth",
    clientId: oauth.clientId,
    clientSecret: oauth.clientSecret,
    scopes: oauth.scopes,
  };
}

/**
 * Gets the effective AuthConfig for a remote server,
 * handling backwards compatibility with legacy oauth field.
 */
export function getEffectiveAuthConfig(server: RemoteServerConfig): AuthConfig {
  // New auth config takes precedence
  if (server.auth) {
    return server.auth;
  }
  
  // Fall back to legacy oauth config
  if (server.oauth) {
    return legacyOAuthToAuthConfig(server.oauth);
  }
  
  // Default: no auth
  return { mode: "none" };
}

/**
 * Builds authentication headers for a given auth config.
 * Returns headers that should be merged into the request.
 * 
 * For OAuth mode, returns empty object (handled by SDK's authProvider).
 */
export function buildAuthHeaders(auth: AuthConfig): Record<string, string> {
  switch (auth.mode) {
    case "none":
      return {};
    
    case "oauth":
      // OAuth is handled by the SDK's authProvider, not via static headers
      return {};
    
    case "bearer":
      return {
        Authorization: `Bearer ${auth.token}`,
      };
    
    case "api-key": {
      const headerName = auth.headerName ?? "X-API-Key";
      const headerValue = auth.headerPrefix
        ? `${auth.headerPrefix}${auth.key}`
        : auth.key;
      return {
        [headerName]: headerValue,
      };
    }
    
    case "custom":
      return { ...auth.headers };
    
    default:
      return {};
  }
}

/**
 * Checks if the auth config requires OAuth flow (needs SDK authProvider).
 */
export function requiresOAuthProvider(auth: AuthConfig): boolean {
  return auth.mode === "oauth";
}

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
  /** New flexible auth config */
  auth?: AuthConfig;
  /** @deprecated Use `auth` instead */
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
  /** New flexible auth config (set to null to remove) */
  auth?: AuthConfig | null;
  /** @deprecated Use `auth` instead */
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