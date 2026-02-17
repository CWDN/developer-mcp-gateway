import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GatewayStore, ServerConfig, OAuthPersistedState } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_STORE_PATH = path.resolve(__dirname, "../../data/gateway-store.json");

const EMPTY_STORE: GatewayStore = {
  servers: [],
  oauthState: {},
};

export class Store {
  private filePath: string;
  private data: GatewayStore;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_STORE_PATH;
    this.data = this.load();
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  private load(): GatewayStore {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw) as GatewayStore;
        // Basic shape validation
        if (!Array.isArray(parsed.servers)) parsed.servers = [];
        if (!parsed.oauthState || typeof parsed.oauthState !== "object") parsed.oauthState = {};
        // Migrate legacy "tokens" key if present
        if ("tokens" in parsed && typeof (parsed as Record<string, unknown>).tokens === "object" && !(parsed as Record<string, unknown>).oauthState) {
          parsed.oauthState = {};
        }
        return parsed;
      }
    } catch (err) {
      console.error(`[Store] Failed to load store from ${this.filePath}:`, err);
    }
    return structuredClone(EMPTY_STORE);
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flush();
    }, 200);
  }

  /** Immediately write to disk if there are pending changes */
  flush(): void {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Write to a temp file first, then rename for atomicity
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), "utf-8");
      fs.renameSync(tmpPath, this.filePath);
      this.dirty = false;
    } catch (err) {
      console.error(`[Store] Failed to save store to ${this.filePath}:`, err);
    }
  }

  /** Clean up timers — call on shutdown */
  close(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.flush();
  }

  // ─── Server CRUD ───────────────────────────────────────────────────────────

  getAllServers(): ServerConfig[] {
    return structuredClone(this.data.servers);
  }

  getServer(id: string): ServerConfig | undefined {
    const server = this.data.servers.find((s) => s.id === id);
    return server ? structuredClone(server) : undefined;
  }

  getServerByName(name: string): ServerConfig | undefined {
    const server = this.data.servers.find(
      (s) => s.name.toLowerCase() === name.toLowerCase()
    );
    return server ? structuredClone(server) : undefined;
  }

  addServer(server: ServerConfig): ServerConfig {
    // Ensure no duplicate IDs
    if (this.data.servers.some((s) => s.id === server.id)) {
      throw new Error(`Server with id "${server.id}" already exists`);
    }
    // Ensure no duplicate names
    if (
      this.data.servers.some(
        (s) => s.name.toLowerCase() === server.name.toLowerCase()
      )
    ) {
      throw new Error(`Server with name "${server.name}" already exists`);
    }
    this.data.servers.push(structuredClone(server));
    this.scheduleSave();
    return structuredClone(server);
  }

  updateServer(id: string, updates: Partial<ServerConfig>): ServerConfig {
    const index = this.data.servers.findIndex((s) => s.id === id);
    if (index === -1) {
      throw new Error(`Server with id "${id}" not found`);
    }

    // If name is being changed, check for duplicates
    if (updates.name) {
      const duplicate = this.data.servers.find(
        (s) => s.id !== id && s.name.toLowerCase() === updates.name!.toLowerCase()
      );
      if (duplicate) {
        throw new Error(`Server with name "${updates.name}" already exists`);
      }
    }

    const existing = this.data.servers[index];
    const updated = {
      ...existing,
      ...updates,
      id, // ID cannot be changed
      transport: existing.transport, // transport cannot be changed after creation
      updatedAt: new Date().toISOString(),
    } as ServerConfig;

    this.data.servers[index] = updated;
    this.scheduleSave();
    return structuredClone(updated);
  }

  removeServer(id: string): boolean {
    const index = this.data.servers.findIndex((s) => s.id === id);
    if (index === -1) return false;

    this.data.servers.splice(index, 1);
    // Also remove any stored OAuth state for this server
    delete this.data.oauthState[id];
    this.scheduleSave();
    return true;
  }

  setServerEnabled(id: string, enabled: boolean): ServerConfig {
    return this.updateServer(id, { enabled });
  }

  // ─── OAuth Persisted State ─────────────────────────────────────────────────

  /**
   * Get the full persisted OAuth state for a server.
   */
  getOAuthState(serverId: string): OAuthPersistedState | undefined {
    const state = this.data.oauthState[serverId];
    return state ? structuredClone(state) : undefined;
  }

  /**
   * Replace the full persisted OAuth state for a server.
   */
  setOAuthState(serverId: string, state: OAuthPersistedState): void {
    this.data.oauthState[serverId] = structuredClone(state);
    this.scheduleSave();
  }

  /**
   * Merge partial updates into the existing OAuth state for a server,
   * creating a new entry if none exists yet.
   */
  updateOAuthState(serverId: string, partial: Partial<OAuthPersistedState>): void {
    const existing = this.data.oauthState[serverId] ?? {};
    this.data.oauthState[serverId] = { ...existing, ...structuredClone(partial) };
    this.scheduleSave();
  }

  /**
   * Remove all persisted OAuth state for a server (tokens, client info, verifier).
   */
  removeOAuthState(serverId: string): boolean {
    if (!(serverId in this.data.oauthState)) return false;
    delete this.data.oauthState[serverId];
    this.scheduleSave();
    return true;
  }

  /**
   * Get stored client information for a server.
   */
  getClientInfo(serverId: string): OAuthPersistedState["clientInfo"] | undefined {
    return this.data.oauthState[serverId]?.clientInfo
      ? structuredClone(this.data.oauthState[serverId].clientInfo)
      : undefined;
  }

  /**
   * Save client information (from dynamic registration or static config).
   */
  setClientInfo(serverId: string, clientInfo: NonNullable<OAuthPersistedState["clientInfo"]>): void {
    if (!this.data.oauthState[serverId]) {
      this.data.oauthState[serverId] = {};
    }
    this.data.oauthState[serverId].clientInfo = structuredClone(clientInfo);
    this.scheduleSave();
  }

  /**
   * Get stored tokens for a server.
   */
  getTokens(serverId: string): OAuthPersistedState["tokens"] | undefined {
    return this.data.oauthState[serverId]?.tokens
      ? structuredClone(this.data.oauthState[serverId].tokens)
      : undefined;
  }

  /**
   * Save tokens for a server.
   */
  setTokens(serverId: string, tokens: NonNullable<OAuthPersistedState["tokens"]>): void {
    if (!this.data.oauthState[serverId]) {
      this.data.oauthState[serverId] = {};
    }
    this.data.oauthState[serverId].tokens = structuredClone(tokens);
    this.scheduleSave();
  }

  /**
   * Remove only the tokens for a server (keeps client info intact).
   */
  removeTokens(serverId: string): boolean {
    const state = this.data.oauthState[serverId];
    if (!state?.tokens) return false;
    delete state.tokens;
    this.scheduleSave();
    return true;
  }

  /**
   * Get the stored PKCE code verifier for an in-flight authorization.
   */
  getCodeVerifier(serverId: string): string | undefined {
    return this.data.oauthState[serverId]?.codeVerifier;
  }

  /**
   * Save the PKCE code verifier for an in-flight authorization.
   */
  setCodeVerifier(serverId: string, codeVerifier: string): void {
    if (!this.data.oauthState[serverId]) {
      this.data.oauthState[serverId] = {};
    }
    this.data.oauthState[serverId].codeVerifier = codeVerifier;
    this.scheduleSave();
  }

  /**
   * Clear the PKCE code verifier after authorization completes.
   */
  clearCodeVerifier(serverId: string): void {
    const state = this.data.oauthState[serverId];
    if (state) {
      delete state.codeVerifier;
      this.scheduleSave();
    }
  }

  /**
   * Check whether a server currently has stored tokens.
   */
  hasTokens(serverId: string): boolean {
    return !!this.data.oauthState[serverId]?.tokens?.access_token;
  }

  /**
   * Check whether a server has stored client information.
   */
  hasClientInfo(serverId: string): boolean {
    return !!this.data.oauthState[serverId]?.clientInfo?.client_id;
  }

  // ─── Bulk Operations ──────────────────────────────────────────────────────

  getEnabledServers(): ServerConfig[] {
    return structuredClone(this.data.servers.filter((s) => s.enabled));
  }

  /** Reset the store to its default empty state */
  reset(): void {
    this.data = structuredClone(EMPTY_STORE);
    this.scheduleSave();
  }

  /** Export the full store data (e.g. for backup) */
  export(): GatewayStore {
    return structuredClone(this.data);
  }

  /** Import store data, replacing existing state */
  import(data: GatewayStore): void {
    this.data = structuredClone(data);
    this.scheduleSave();
  }
}