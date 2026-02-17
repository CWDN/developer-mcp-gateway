import type {
  OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  auth as mcpAuth,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata,
  OAuthClientInformationFull,
  OAuthTokens as SdkOAuthTokens,
  OAuthClientInformation,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Store } from "./store.js";
import type { OAuthConfig } from "./types.js";

// Re-export the SDK types we use so the rest of the codebase can reference them
export type { OAuthClientProvider, SdkOAuthTokens };

// ─── Types ─────────────────────────────────────────────────────────────────────

type OAuthClientInformationMixed = OAuthClientInformation | OAuthClientInformationFull;

/**
 * Callback invoked when the user must be redirected to an authorization URL.
 * The gateway emits this as an event so the frontend can open the URL.
 */
export type OnAuthRedirect = (serverId: string, authorizationUrl: URL) => void;

// ─── GatewayOAuthProvider ──────────────────────────────────────────────────────

/**
 * Implements the MCP SDK's `OAuthClientProvider` interface, backed by the
 * gateway's persistent store.
 *
 * One instance is created per remote server. The SDK's transport layer calls
 * into this provider automatically when it receives a 401 from the MCP server:
 *
 * 1. The SDK fetches `.well-known/oauth-protected-resource` and
 *    `.well-known/oauth-authorization-server` to discover the authorization
 *    server metadata (endpoints, supported scopes, PKCE methods, etc.).
 *
 * 2. If no `clientInformation()` is available, the SDK attempts RFC 7591
 *    Dynamic Client Registration using our `clientMetadata`.
 *
 * 3. The SDK generates a PKCE code verifier/challenge, builds the
 *    authorization URL, and calls `redirectToAuthorization(url)`.
 *
 * 4. After the user completes consent and the callback hits our
 *    `/oauth/callback/:serverId` endpoint, we call
 *    `mcpAuth(provider, { serverUrl, authorizationCode })` which exchanges
 *    the code for tokens and saves them via `saveTokens()`.
 *
 * 5. The transport retries the connection with the new Bearer token.
 */
export class GatewayOAuthProvider implements OAuthClientProvider {
  public readonly serverId: string;

  private store: Store;
  private gatewayBaseUrl: string;
  private oauthConfig: OAuthConfig;
  private _onAuthRedirect: OnAuthRedirect;

  // In-memory code verifier (also persisted to store for crash recovery)
  private _codeVerifier: string = "";

  constructor(opts: {
    serverId: string;
    store: Store;
    gatewayBaseUrl: string;
    oauthConfig: OAuthConfig;
    onAuthRedirect: OnAuthRedirect;
  }) {
    this.serverId = opts.serverId;
    this.store = opts.store;
    this.gatewayBaseUrl = opts.gatewayBaseUrl.replace(/\/+$/, "");
    this.oauthConfig = opts.oauthConfig;
    this._onAuthRedirect = opts.onAuthRedirect;

    // Hydrate in-memory code verifier from store if a flow was in-flight
    const persisted = this.store.getCodeVerifier(this.serverId);
    if (persisted) {
      this._codeVerifier = persisted;
    }
  }

  // ─── OAuthClientProvider interface ─────────────────────────────────────────

  /**
   * The redirect URI that the authorization server will send the user back to.
   * We encode the serverId in the path so the callback handler knows which
   * provider to resume.
   */
  get redirectUrl(): string {
    return `${this.gatewayBaseUrl}/oauth/callback/${encodeURIComponent(this.serverId)}`;
  }

  /**
   * Metadata about this OAuth client, used for Dynamic Client Registration
   * (RFC 7591) if no pre-registered `clientId` was supplied.
   */
  get clientMetadata(): OAuthClientMetadata {
    const meta: OAuthClientMetadata = {
      redirect_uris: [this.redirectUrl] as unknown as OAuthClientMetadata["redirect_uris"],
      client_name: "MCP Gateway",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.oauthConfig.clientSecret
        ? "client_secret_post"
        : "none",
    };

    if (this.oauthConfig.scopes && this.oauthConfig.scopes.length > 0) {
      meta.scope = this.oauthConfig.scopes.join(" ");
    }

    return meta;
  }

  /**
   * Returns stored client information (client_id + optional client_secret).
   *
   * If the user pre-configured a clientId we return that; otherwise we look
   * for information saved earlier by Dynamic Client Registration.
   */
  clientInformation(): OAuthClientInformationMixed | undefined {
    // 1. Check if we have dynamically-registered or previously-saved info
    const stored = this.store.getClientInfo(this.serverId);
    if (stored && stored.client_id) {
      return stored as OAuthClientInformationMixed;
    }

    // 2. Fall back to the statically-configured clientId (if any)
    if (this.oauthConfig.clientId) {
      const info: OAuthClientInformation = {
        client_id: this.oauthConfig.clientId,
      };
      if (this.oauthConfig.clientSecret) {
        info.client_secret = this.oauthConfig.clientSecret;
      }
      return info;
    }

    // 3. No client information available → the SDK will attempt dynamic registration
    return undefined;
  }

  /**
   * Persist client information obtained via Dynamic Client Registration.
   */
  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    console.log(
      `[OAuth] Saving client information for server "${this.serverId}" (client_id: ${clientInformation.client_id})`
    );
    this.store.setClientInfo(this.serverId, {
      client_id: clientInformation.client_id,
      client_secret: (clientInformation as OAuthClientInformationFull).client_secret,
      client_id_issued_at: (clientInformation as OAuthClientInformationFull).client_id_issued_at,
      client_secret_expires_at: (clientInformation as OAuthClientInformationFull).client_secret_expires_at,
    });
  }

  /**
   * Return any stored tokens for this server.
   */
  tokens(): SdkOAuthTokens | undefined {
    const stored = this.store.getTokens(this.serverId);
    if (!stored || !stored.access_token) return undefined;
    return stored as SdkOAuthTokens;
  }

  /**
   * Persist tokens after a successful authorization or token refresh.
   */
  saveTokens(tokens: SdkOAuthTokens): void {
    console.log(
      `[OAuth] Saving tokens for server "${this.serverId}" (type: ${tokens.token_type})`
    );
    this.store.setTokens(this.serverId, {
      access_token: tokens.access_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
      scope: tokens.scope,
      refresh_token: tokens.refresh_token,
    });
  }

  /**
   * Called by the SDK when the user must visit an authorization URL.
   * We emit an event so the frontend can open the URL in a browser tab.
   */
  redirectToAuthorization(authorizationUrl: URL): void {
    console.log(
      `[OAuth] Authorization required for server "${this.serverId}": ${authorizationUrl.toString()}`
    );
    this._onAuthRedirect(this.serverId, authorizationUrl);
  }

  /**
   * Save the PKCE code verifier before redirecting to the authorization server.
   */
  saveCodeVerifier(codeVerifier: string): void {
    this._codeVerifier = codeVerifier;
    this.store.setCodeVerifier(this.serverId, codeVerifier);
  }

  /**
   * Retrieve the PKCE code verifier (needed when exchanging the auth code).
   */
  codeVerifier(): string {
    return this._codeVerifier || this.store.getCodeVerifier(this.serverId) || "";
  }

  /**
   * Called by the SDK when credentials are known to be invalid,
   * allowing us to clean up stored state.
   */
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): void {
    console.log(
      `[OAuth] Invalidating credentials for server "${this.serverId}" (scope: ${scope})`
    );
    switch (scope) {
      case "all":
        this.store.removeOAuthState(this.serverId);
        this._codeVerifier = "";
        break;
      case "client":
        // Remove client info but keep tokens
        {
          const state = this.store.getOAuthState(this.serverId);
          if (state) {
            delete state.clientInfo;
            this.store.setOAuthState(this.serverId, state);
          }
        }
        break;
      case "tokens":
        this.store.removeTokens(this.serverId);
        break;
      case "verifier":
        this._codeVerifier = "";
        this.store.clearCodeVerifier(this.serverId);
        break;
    }
  }
}

// ─── OAuthManager ──────────────────────────────────────────────────────────────

/**
 * High-level manager that creates and caches `GatewayOAuthProvider` instances
 * per server, and exposes helper methods used by the API routes and gateway.
 */
export class OAuthManager {
  private store: Store;
  private gatewayBaseUrl: string;
  private providers = new Map<string, GatewayOAuthProvider>();
  private _onAuthRedirect: OnAuthRedirect;

  constructor(
    store: Store,
    gatewayBaseUrl: string,
    onAuthRedirect: OnAuthRedirect
  ) {
    this.store = store;
    this.gatewayBaseUrl = gatewayBaseUrl.replace(/\/+$/, "");
    this._onAuthRedirect = onAuthRedirect;
  }

  /**
   * Update the gateway base URL (e.g. after runtime configuration).
   */
  setBaseUrl(url: string): void {
    this.gatewayBaseUrl = url.replace(/\/+$/, "");
  }

  // ─── Provider lifecycle ──────────────────────────────────────────────────

  /**
   * Get or create an `OAuthClientProvider` for a server.
   */
  getProvider(
    serverId: string,
    oauthConfig: OAuthConfig
  ): GatewayOAuthProvider {
    let provider = this.providers.get(serverId);
    if (provider) return provider;

    provider = new GatewayOAuthProvider({
      serverId,
      store: this.store,
      gatewayBaseUrl: this.gatewayBaseUrl,
      oauthConfig,
      onAuthRedirect: this._onAuthRedirect,
    });

    this.providers.set(serverId, provider);
    return provider;
  }

  /**
   * Remove a provider (e.g. when a server is deleted).
   */
  removeProvider(serverId: string): void {
    this.providers.delete(serverId);
  }

  /**
   * Replace a provider (e.g. when OAuth config is updated).
   */
  replaceProvider(
    serverId: string,
    oauthConfig: OAuthConfig
  ): GatewayOAuthProvider {
    this.providers.delete(serverId);
    return this.getProvider(serverId, oauthConfig);
  }

  // ─── Auth Flow Helpers ─────────────────────────────────────────────────────

  /**
   * Initiate the OAuth authorization flow for a server.
   *
   * This calls the SDK's `auth()` which will:
   * 1. Discover the authorization server metadata
   * 2. Attempt dynamic client registration if needed
   * 3. Generate PKCE challenge
   * 4. Call `redirectToAuthorization()` on the provider
   *
   * Returns "REDIRECT" if the user must visit the auth URL, or "AUTHORIZED"
   * if tokens already exist and are valid.
   */
  async initiateAuth(
    serverId: string,
    serverUrl: string,
    oauthConfig: OAuthConfig
  ): Promise<"AUTHORIZED" | "REDIRECT"> {
    const provider = this.getProvider(serverId, oauthConfig);

    const scope =
      oauthConfig.scopes && oauthConfig.scopes.length > 0
        ? oauthConfig.scopes.join(" ")
        : undefined;

    const result = await mcpAuth(provider, {
      serverUrl,
      scope,
    });

    return result;
  }

  /**
   * Complete the OAuth authorization flow after the user is redirected back
   * to the gateway with an authorization code.
   *
   * This calls the SDK's `auth()` with the authorization code, which
   * exchanges it for tokens (using the stored PKCE verifier) and persists
   * them via the provider's `saveTokens()`.
   */
  async handleCallback(
    serverId: string,
    serverUrl: string,
    authorizationCode: string,
    oauthConfig: OAuthConfig
  ): Promise<"AUTHORIZED" | "REDIRECT"> {
    const provider = this.getProvider(serverId, oauthConfig);

    const scope =
      oauthConfig.scopes && oauthConfig.scopes.length > 0
        ? oauthConfig.scopes.join(" ")
        : undefined;

    const result = await mcpAuth(provider, {
      serverUrl,
      authorizationCode,
      scope,
    });

    // Clean up the code verifier now that the exchange is complete
    this.store.clearCodeVerifier(serverId);

    return result;
  }

  // ─── Status Queries ────────────────────────────────────────────────────────

  /**
   * Check the authentication status for a server.
   */
  getAuthStatus(serverId: string): {
    requiresAuth: boolean;
    isAuthenticated: boolean;
    hasClientInfo: boolean;
  } {
    const server = this.store.getServer(serverId);
    if (!server || server.transport === "stdio") {
      return { requiresAuth: false, isAuthenticated: false, hasClientInfo: false };
    }

    const requiresAuth = !!server.oauth?.enabled;
    if (!requiresAuth) {
      return { requiresAuth: false, isAuthenticated: false, hasClientInfo: false };
    }

    const isAuthenticated = this.store.hasTokens(serverId);
    const hasClientInfo = this.store.hasClientInfo(serverId);

    return { requiresAuth, isAuthenticated, hasClientInfo };
  }

  /**
   * Revoke / clear all stored OAuth state for a server (tokens, client info,
   * verifier). The user will need to re-authenticate.
   */
  revokeTokens(serverId: string): void {
    this.store.removeOAuthState(serverId);
    this.providers.delete(serverId);
    console.log(`[OAuth] Revoked all OAuth state for server "${serverId}"`);
  }
}

// ─── Error Class ─────────────────────────────────────────────────────────────

export class OAuthError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}