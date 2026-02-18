// ─── Types (mirrors server types) ──────────────────────────────────────────────

export type ServerTransport = "stdio" | "sse" | "streamable-http";

export type RequestType = "tool" | "resource" | "prompt";

export interface RequestLogEntry {
  id: string;
  timestamp: string;
  type: RequestType;
  method: string;
  originalMethod?: string;
  server: {
    id: string;
    name: string;
  };
  request: Record<string, unknown>;
  response?: {
    content: unknown;
    isError?: boolean;
  };
  durationMs?: number;
  sessionId?: string;
  status: "pending" | "success" | "error";
  errorMessage?: string;
}

export interface RequestLogFilter {
  type?: RequestType;
  serverId?: string;
  status?: "pending" | "success" | "error";
  query?: string;
  limit?: number;
  offset?: number;
  since?: string | number;
  until?: string | number;
}

export interface RequestLogStats {
  total: number;
  byType: Record<RequestType, number>;
  byStatus: Record<string, number>;
  byServer: Record<string, number>;
  avgDurationMs: number;
  errorRate: number;
}

export interface RequestLogsResponse {
  logs: RequestLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "awaiting_oauth";

// ─── Authentication Configuration ──────────────────────────────────────────────

/**
 * Authentication mode for remote MCP servers.
 */
export type AuthMode = "none" | "oauth" | "bearer" | "api-key" | "custom";

/**
 * No authentication required.
 */
export interface NoAuthConfig {
  mode: "none";
}

/**
 * OAuth 2.0 authentication with auto-discovery.
 */
export interface OAuthAuthConfig {
  mode: "oauth";
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
}

/**
 * Static bearer token authentication.
 */
export interface BearerAuthConfig {
  mode: "bearer";
  token: string;
}

/**
 * API key authentication sent in a header.
 */
export interface ApiKeyAuthConfig {
  mode: "api-key";
  key: string;
  headerName?: string;
  headerPrefix?: string;
}

/**
 * Fully custom header-based authentication.
 */
export interface CustomAuthConfig {
  mode: "custom";
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

/**
 * @deprecated Use AuthConfig with mode: "oauth" instead.
 * Kept for backwards compatibility.
 */
export interface OAuthConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
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
  arguments?: { name: string; description?: string; required?: boolean }[];
}

export interface ServerRuntime {
  status: ConnectionStatus;
  error?: string;
  tools: ToolInfo[];
  resources: ResourceInfo[];
  prompts: PromptInfo[];
  lastConnected?: string;
}

export interface AuthStatus {
  requiresAuth: boolean;
  isAuthenticated: boolean;
  hasClientInfo: boolean;
}

export interface ServerEntry {
  id: string;
  name: string;
  enabled: boolean;
  transport: ServerTransport;
  createdAt: string;
  updatedAt: string;
  // Local (stdio)
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  // Remote (sse / streamable-http)
  url?: string;
  headers?: Record<string, string>;
  /** New flexible authentication configuration */
  authConfig?: AuthConfig;
  /** @deprecated Use authConfig instead */
  oauth?: OAuthConfig;
  // Runtime
  runtime: ServerRuntime;
  auth: AuthStatus;
}

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

export interface HealthInfo {
  status: string;
  servers: { total: number; connected: number };
  uptime: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface CreateLocalServerPayload {
  name: string;
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
}

export interface CreateRemoteServerPayload {
  name: string;
  transport: "sse" | "streamable-http";
  url: string;
  headers?: Record<string, string>;
  /** New flexible authentication configuration */
  auth?: AuthConfig;
  /** @deprecated Use auth instead */
  oauth?: OAuthConfig;
  enabled?: boolean;
}

/**
 * Response from the /auth/initiate endpoint.
 * `result` is "AUTHORIZED" if tokens already exist, or "REDIRECT" if the
 * user must visit `authUrl` to authenticate.
 */
export interface InitiateAuthResponse {
  result: "AUTHORIZED" | "REDIRECT";
  authUrl?: string;
}

export type CreateServerPayload =
  | CreateLocalServerPayload
  | CreateRemoteServerPayload;

export interface UpdateServerPayload {
  name?: string;
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  /** New flexible authentication configuration (set to null to remove) */
  auth?: AuthConfig | null;
  /** @deprecated Use auth instead */
  oauth?: OAuthConfig | null;
}

// ─── API Base ──────────────────────────────────────────────────────────────────

const API_BASE = "/api";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });

  const body = (await res.json()) as ApiResponse<T>;

  if (!body.success) {
    throw new ApiError(body.error ?? "Unknown API error", res.status);
  }

  return body.data as T;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// ─── Server CRUD ─────────────────────────────────────────────────────────────

export async function listServers(): Promise<ServerEntry[]> {
  return request<ServerEntry[]>("/servers");
}

export async function getServer(id: string): Promise<ServerEntry> {
  return request<ServerEntry>(`/servers/${encodeURIComponent(id)}`);
}

export async function createServer(
  payload: CreateServerPayload
): Promise<ServerEntry> {
  return request<ServerEntry>("/servers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateServer(
  id: string,
  payload: UpdateServerPayload
): Promise<ServerEntry> {
  return request<ServerEntry>(`/servers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteServer(
  id: string
): Promise<{ id: string; removed: boolean }> {
  return request<{ id: string; removed: boolean }>(
    `/servers/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

// ─── Connection Control ────────────────────────────────────────────────────────

export async function connectServer(id: string): Promise<ServerStatus> {
  return request<ServerStatus>(
    `/servers/${encodeURIComponent(id)}/connect`,
    { method: "POST" }
  );
}

export async function disconnectServer(id: string): Promise<ServerStatus> {
  return request<ServerStatus>(
    `/servers/${encodeURIComponent(id)}/disconnect`,
    { method: "POST" }
  );
}

export async function reconnectServer(id: string): Promise<ServerStatus> {
  return request<ServerStatus>(
    `/servers/${encodeURIComponent(id)}/reconnect`,
    { method: "POST" }
  );
}

export async function refreshCapabilities(id: string): Promise<ServerStatus> {
  return request<ServerStatus>(
    `/servers/${encodeURIComponent(id)}/refresh`,
    { method: "POST" }
  );
}

export async function enableServer(id: string): Promise<ServerStatus> {
  return request<ServerStatus>(
    `/servers/${encodeURIComponent(id)}/enable`,
    { method: "POST" }
  );
}

export async function disableServer(id: string): Promise<ServerStatus> {
  return request<ServerStatus>(
    `/servers/${encodeURIComponent(id)}/disable`,
    { method: "POST" }
  );
}

// ─── OAuth ─────────────────────────────────────────────────────────────────────

export async function getAuthStatus(id: string): Promise<AuthStatus> {
  return request<AuthStatus>(
    `/servers/${encodeURIComponent(id)}/auth/status`
  );
}

export async function initiateAuth(
  id: string
): Promise<InitiateAuthResponse> {
  return request<InitiateAuthResponse>(
    `/servers/${encodeURIComponent(id)}/auth/initiate`,
    { method: "POST" }
  );
}

export async function revokeAuth(
  id: string
): Promise<{ revoked: boolean }> {
  return request<{ revoked: boolean }>(
    `/servers/${encodeURIComponent(id)}/auth/revoke`,
    { method: "POST" }
  );
}

// ─── Aggregated Capabilities ───────────────────────────────────────────────────

export interface AggregatedTool extends ToolInfo {
  serverId: string;
  serverName: string;
}

export interface AggregatedResource extends ResourceInfo {
  serverId: string;
  serverName: string;
}

export interface AggregatedPrompt extends PromptInfo {
  serverId: string;
  serverName: string;
}

export async function listAllTools(): Promise<AggregatedTool[]> {
  return request<AggregatedTool[]>("/tools");
}

export async function listAllResources(): Promise<AggregatedResource[]> {
  return request<AggregatedResource[]>("/resources");
}

export async function listAllPrompts(): Promise<AggregatedPrompt[]> {
  return request<AggregatedPrompt[]>("/prompts");
}

// ─── Tool Invocation ───────────────────────────────────────────────────────────

export async function callTool(
  toolName: string,
  args?: Record<string, unknown>,
  serverId?: string
): Promise<unknown> {
  return request<unknown>("/tools/call", {
    method: "POST",
    body: JSON.stringify({ toolName, arguments: args, serverId }),
  });
}

// ─── Health ────────────────────────────────────────────────────────────────────

export async function getHealth(): Promise<HealthInfo> {
  return request<HealthInfo>("/health");
}

// ─── Request Logs ──────────────────────────────────────────────────────────────

export async function getRequestLogs(
  filter?: RequestLogFilter
): Promise<RequestLogsResponse> {
  const params = new URLSearchParams();

  if (filter?.type) params.set("type", filter.type);
  if (filter?.serverId) params.set("serverId", filter.serverId);
  if (filter?.status) params.set("status", filter.status);
  if (filter?.query) params.set("query", filter.query);
  if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
  if (filter?.offset !== undefined) params.set("offset", String(filter.offset));
  if (filter?.since !== undefined) params.set("since", String(filter.since));
  if (filter?.until !== undefined) params.set("until", String(filter.until));

  const queryString = params.toString();
  const path = queryString ? `/logs?${queryString}` : "/logs";

  return request<RequestLogsResponse>(path);
}

export async function getRequestLog(id: string): Promise<RequestLogEntry> {
  return request<RequestLogEntry>(`/logs/${encodeURIComponent(id)}`);
}

export async function getRequestLogStats(): Promise<RequestLogStats> {
  return request<RequestLogStats>("/logs/stats");
}

export async function clearRequestLogs(): Promise<{ cleared: boolean }> {
  return request<{ cleared: boolean }>("/logs", { method: "DELETE" });
}

// ─── Server-Sent Events ────────────────────────────────────────────────────────

export type GatewayEventData =
  | { type: "server:status"; status: ServerStatus }
  | { type: "server:added"; server: ServerEntry }
  | { type: "server:updated"; server: ServerEntry }
  | { type: "server:removed"; serverId: string }
  | { type: "server:connected"; serverId: string }
  | { type: "server:disconnected"; serverId: string; error?: string }
  | { type: "oauth:required"; serverId: string; authUrl: string }
  | { type: "log:started"; log: RequestLogEntry }
  | { type: "log:completed"; log: RequestLogEntry };

export function subscribeToEvents(
  onEvent: (event: GatewayEventData) => void,
  onError?: (err: Event) => void
): () => void {
  const eventSource = new EventSource(`${API_BASE}/events`);

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as GatewayEventData;
      onEvent(data);
    } catch (err) {
      console.error("[SSE] Failed to parse event:", err);
    }
  };

  eventSource.onerror = (e) => {
    console.error("[SSE] Connection error:", e);
    onError?.(e);
  };

  // Return cleanup function
  return () => {
    eventSource.close();
  };
}