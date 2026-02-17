// ─── Types (mirrors server types) ──────────────────────────────────────────────

export type ServerTransport = "stdio" | "sse" | "streamable-http";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "awaiting_oauth";

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

// ─── Server-Sent Events ────────────────────────────────────────────────────────

export type GatewayEventData =
  | { type: "server:status"; status: ServerStatus }
  | { type: "server:added"; server: ServerEntry }
  | { type: "server:updated"; server: ServerEntry }
  | { type: "server:removed"; serverId: string }
  | { type: "server:connected"; serverId: string }
  | { type: "server:disconnected"; serverId: string; error?: string }
  | { type: "oauth:required"; serverId: string; authUrl: string };

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