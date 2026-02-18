# MCP Gateway

A full-featured Model Context Protocol (MCP) gateway with a web UI for registering and managing both local and remote MCP servers — including automatic OAuth 2.0 authentication for remote servers like Atlassian, GitHub, and others.

![MCP Gateway](https://img.shields.io/badge/MCP-Gateway-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue) ![React](https://img.shields.io/badge/React-19-blue) ![License](https://img.shields.io/badge/License-MIT-green)

## Overview

MCP Gateway acts as a centralized proxy and aggregator that connects to multiple MCP servers and exposes their tools, resources, and prompts through a single unified interface. It provides:

- **Web UI** for registering, configuring, and monitoring MCP servers
- **Local server support** via stdio transport (spawn child processes)
- **Remote server support** via SSE and Streamable HTTP transports
- **Flexible authentication** — supports multiple auth modes: OAuth 2.0 with auto-discovery, static bearer tokens, API keys, and custom headers
- **Automatic OAuth 2.0 discovery** — just provide the server URL (e.g. `https://mcp.atlassian.com/v1/mcp`) and the gateway auto-discovers authorization endpoints via `.well-known/oauth-authorization-server` and `.well-known/oauth-protected-resource`
- **PKCE + Dynamic Client Registration** — supports both pre-registered client IDs and RFC 7591 dynamic registration out of the box
- **Bearer token support** — for APIs like GitHub Copilot MCP that require pre-authenticated tokens
- **Live status updates** via Server-Sent Events (SSE)
- **Auto-reconnection** with exponential backoff
- **Persistent configuration** stored as JSON on disk

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Gateway                          │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐    │
│  │ React UI │  │ REST API │  │   OAuth Handler    │    │
│  │ (Vite)   │◄►│ (Express)│◄►│ (Auth Code + PKCE) │    │
│  └──────────┘  └────┬─────┘  └────────────────────┘    │
│                     │                                   │
│              ┌──────┴──────┐                            │
│              │   Gateway   │                            │
│              │   Engine    │                            │
│              └──────┬──────┘                            │
│                     │                                   │
│    ┌────────────────┼─────────────────┐                 │
│    │                │                 │                  │
│    ▼                ▼                 ▼                  │
│ ┌──────┐     ┌──────────┐     ┌──────────────┐         │
│ │stdio │     │   SSE    │     │ Streamable   │         │
│ │Client│     │  Client  │     │ HTTP Client  │         │
│ └──┬───┘     └────┬─────┘     └──────┬───────┘         │
└────┼──────────────┼──────────────────┼──────────────────┘
     │              │                  │
     ▼              ▼                  ▼
┌─────────┐  ┌───────────┐    ┌───────────────┐
│ Local   │  │  Remote   │    │   Remote      │
│ MCP     │  │  MCP      │    │   MCP         │
│ Server  │  │  Server   │    │   Server      │
│ (stdio) │  │  (SSE)    │    │   (HTTP)      │
└─────────┘  │  + OAuth  │    │   + OAuth     │
             └───────────┘    └───────────────┘
```

### Key Components

| Component | Path | Description |
|-----------|------|-------------|
| **Server Entry** | `src/server/index.ts` | Express app setup, startup, and graceful shutdown |
| **Gateway Engine** | `src/server/gateway.ts` | Core logic: connects to MCP servers, discovers capabilities, manages lifecycle |
| **API Routes** | `src/server/api.ts` | REST endpoints for CRUD, connection control, tool invocation, and SSE events |
| **OAuth Manager** | `src/server/oauth.ts` | `OAuthClientProvider` implementation backed by the MCP SDK's native auth flow with auto-discovery |
| **Store** | `src/server/store.ts` | JSON file-based persistence for server configs and OAuth state |
| **Types** | `src/server/types.ts` | Shared TypeScript type definitions |
| **React App** | `src/client/App.tsx` | Main UI component with server list, stats, and modal management |
| **Server Card** | `src/client/components/ServerCard.tsx` | Individual server display with status, capabilities, and actions |
| **Add Modal** | `src/client/components/AddServerModal.tsx` | Form for registering new local or remote servers |
| **Edit Modal** | `src/client/components/EditServerModal.tsx` | Form for updating existing server configurations |
| **API Client** | `src/client/api.ts` | Typed fetch wrappers for all API endpoints |

## Getting Started

### Prerequisites

- **Node.js** >= 18.x
- **npm** >= 9.x

### Installation

```bash
# Clone the repository
git clone <your-repo-url> mcp-gateway
cd mcp-gateway

# Install dependencies
npm install
```

### Development

Run both the API server and the Vite dev server concurrently:

```bash
npm run dev
```

This starts:
- **API Server** on `http://localhost:3099`
- **UI Dev Server** on `http://localhost:5173` (with proxy to API)

Open **http://localhost:5173** in your browser.

### Production Build

```bash
# Build both client and server
npm run build

# Start the production server (serves the UI as static files)
npm start
```

The production server runs on port `3099` by default and serves the UI from the built static files.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3099` | Port for the API/HTTP server |
| `HOST` | `0.0.0.0` | Host to bind the server to |
| `GATEWAY_BASE_URL` | `http://localhost:3099` | Public URL of the gateway (used for OAuth callbacks) |
| `DATA_DIR` | `./data` | Directory for persistent storage |

### Data Storage

Server configurations and OAuth tokens are stored in `data/gateway-store.json`. This file is automatically created on first run. You can back up or version-control this file as needed.

> **Security Note:** OAuth tokens (including refresh tokens) are stored in this file. Ensure appropriate file permissions in production environments.

## Usage Guide

### Adding a Local MCP Server (stdio)

1. Click **"Add Server"** in the top-right
2. Select **"Local Server"**
3. Fill in:
   - **Name**: A friendly name (e.g., "Filesystem Server")
   - **Command**: The executable (e.g., `npx`)
   - **Arguments**: Command arguments (e.g., `-y @modelcontextprotocol/server-filesystem /tmp`)
   - **Working Directory** (optional): Where to run the command
   - **Environment Variables** (optional): Key-value pairs
4. Click **"Add Server"**

The gateway will spawn the process and connect via stdio.

### Adding a Remote MCP Server (SSE or Streamable HTTP)

1. Click **"Add Server"**
2. Select **"Remote Server"**
3. Choose the transport protocol:
   - **SSE** (Server-Sent Events) — for servers using the SSE transport
   - **Streamable HTTP** — for servers using the newer Streamable HTTP transport
4. Fill in:
   - **Name**: A friendly name
   - **URL**: The server's endpoint URL
   - **Custom Headers** (optional): Additional HTTP headers
5. Click **"Add Server"**

### Authentication Options for Remote Servers

The gateway supports multiple authentication modes for remote MCP servers:

| Mode | Use Case | Example |
|------|----------|---------|
| **None** | Public servers with no authentication | Development/testing servers |
| **OAuth** | Servers implementing MCP OAuth 2.0 spec | Atlassian, compliant MCP servers |
| **Bearer** | Pre-authenticated bearer tokens | GitHub Copilot MCP, custom APIs |
| **API Key** | API key in a custom header | Third-party services |
| **Custom** | Arbitrary authentication headers | Legacy or custom auth schemes |

### Adding a Remote Server with OAuth (e.g. Atlassian)

For remote MCP servers that require OAuth 2.0 authentication (like `https://mcp.atlassian.com/v1/mcp`):

1. Follow the steps above for adding a remote server
2. Enter the server URL (e.g. `https://mcp.atlassian.com/v1/mcp`)
3. In the **Authentication** section, select **OAuth**
4. Optionally fill in:
   - **Client ID** — required if the server needs a pre-registered OAuth app; leave blank to attempt RFC 7591 Dynamic Client Registration automatically
   - **Client Secret** (optional) — only needed for confidential clients; public clients omit this
   - **Scopes** (optional) — if omitted, the server's default scopes are used
5. Click **"Add Server"**

**That's it.** You do _not_ need to manually enter authorization URLs, token URLs, or any other OAuth endpoint details. The gateway automatically discovers them by fetching the server's `.well-known/oauth-authorization-server` and `.well-known/oauth-protected-resource` metadata — exactly as the MCP specification requires.

When you enable the server or click **Authenticate**, the gateway:
1. Discovers the OAuth authorization server metadata from `.well-known` endpoints
2. Attempts Dynamic Client Registration if no Client ID was provided
3. Generates a PKCE code challenge and redirects you to the authorization page
4. Exchanges the authorization code for tokens on callback
5. Stores tokens securely and automatically refreshes them when they expire

You can revoke tokens at any time from the server's detail panel.

### Adding a Remote Server with Bearer Token (e.g. GitHub Copilot)

For APIs that require a pre-authenticated bearer token (like `https://api.githubcopilot.com/mcp/`):

1. Follow the steps above for adding a remote server
2. Enter the server URL (e.g. `https://api.githubcopilot.com/mcp/`)
3. In the **Authentication** section, select **Bearer**
4. Enter your access token in the **Bearer Token** field
5. Click **"Add Server"**

The gateway will include the token as `Authorization: Bearer <token>` with every request.

> **Note:** GitHub Copilot's MCP endpoint does not implement the standard OAuth discovery endpoints (`.well-known/oauth-authorization-server`), so OAuth auto-discovery won't work. Use the Bearer token mode instead with a valid GitHub Copilot access token.

### Adding a Remote Server with API Key

For services that use API key authentication:

1. Follow the steps above for adding a remote server
2. In the **Authentication** section, select **API Key**
3. Fill in:
   - **API Key** — your API key value
   - **Header Name** (optional) — defaults to `X-API-Key`
   - **Value Prefix** (optional) — e.g., `ApiKey ` to send `ApiKey your-key`
4. Click **"Add Server"**

### Adding a Remote Server with Custom Headers

For custom authentication schemes:

1. Follow the steps above for adding a remote server
2. In the **Authentication** section, select **Custom**
3. Add one or more authentication headers (key-value pairs)
4. Click **"Add Server"**

This allows you to configure arbitrary headers for authentication, such as custom tokens, signatures, or multi-header auth schemes.

### Managing Servers

Each server card in the UI provides:

- **Status indicator**: Connected (green), Connecting (yellow), Error (red), Disconnected (gray), Awaiting OAuth (blue)
- **Enable/Disable toggle**: Control whether a server should be active
- **Connect/Disconnect/Reconnect**: Manual connection control
- **Edit**: Modify server configuration
- **Delete**: Remove the server entirely
- **Expand**: View detailed configuration, OAuth status, and discovered capabilities (tools, resources, prompts)

## API Reference

### Server Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/servers` | List all servers with status |
| `GET` | `/api/servers/:id` | Get a specific server |
| `POST` | `/api/servers` | Register a new server |
| `PATCH` | `/api/servers/:id` | Update server configuration |
| `DELETE` | `/api/servers/:id` | Remove a server |

### Connection Control

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/servers/:id/connect` | Connect to a server |
| `POST` | `/api/servers/:id/disconnect` | Disconnect from a server |
| `POST` | `/api/servers/:id/reconnect` | Reconnect to a server |
| `POST` | `/api/servers/:id/refresh` | Refresh discovered capabilities |
| `POST` | `/api/servers/:id/enable` | Enable a server |
| `POST` | `/api/servers/:id/disable` | Disable a server |

### OAuth

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/servers/:id/auth/status` | Check OAuth status |
| `POST` | `/api/servers/:id/auth/initiate` | Start OAuth flow (auto-discovers endpoints, returns auth URL) |
| `POST` | `/api/servers/:id/auth/revoke` | Revoke OAuth tokens and clear stored state |
| `GET` | `/oauth/callback/:serverId` | Per-server OAuth redirect callback (handled automatically) |

### Aggregated Capabilities

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tools` | List all tools across connected servers |
| `GET` | `/api/resources` | List all resources across connected servers |
| `GET` | `/api/prompts` | List all prompts across connected servers |
| `POST` | `/api/tools/call` | Invoke a tool (auto-routes or specify server) |

### Live Updates

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/events` | SSE stream of gateway events |
| `GET` | `/api/health` | Health check with server stats |

### Example: Register a Server via API

```bash
# Local server
curl -X POST http://localhost:3099/api/servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Filesystem Server",
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    "enabled": true
  }'

# Remote server with OAuth (auto-discovery — no manual URLs needed!)
curl -X POST http://localhost:3099/api/servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Atlassian MCP",
    "transport": "streamable-http",
    "url": "https://mcp.atlassian.com/v1/mcp",
    "auth": {
      "mode": "oauth"
    },
    "enabled": true
  }'

# Remote server with a pre-registered OAuth client ID
curl -X POST http://localhost:3099/api/servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Remote MCP",
    "transport": "sse",
    "url": "https://mcp.example.com/sse",
    "auth": {
      "mode": "oauth",
      "clientId": "my-client-id",
      "clientSecret": "my-client-secret",
      "scopes": ["read", "write"]
    },
    "enabled": true
  }'

# Remote server with bearer token (e.g. GitHub Copilot)
curl -X POST http://localhost:3099/api/servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "GitHub Copilot MCP",
    "transport": "streamable-http",
    "url": "https://api.githubcopilot.com/mcp/",
    "auth": {
      "mode": "bearer",
      "token": "your-access-token-here"
    },
    "enabled": true
  }'

# Remote server with API key
curl -X POST http://localhost:3099/api/servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My API Service",
    "transport": "sse",
    "url": "https://api.example.com/mcp",
    "auth": {
      "mode": "api-key",
      "key": "your-api-key",
      "headerName": "X-API-Key"
    },
    "enabled": true
  }'

# Remote server with custom auth headers
curl -X POST http://localhost:3099/api/servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Custom Auth Server",
    "transport": "streamable-http",
    "url": "https://custom.example.com/mcp",
    "auth": {
      "mode": "custom",
      "headers": {
        "X-Custom-Token": "token-value",
        "X-Tenant-ID": "my-tenant"
      }
    },
    "enabled": true
  }'
```

## Tech Stack

- **Backend**: Node.js, Express, TypeScript
- **Frontend**: React 19, Vite 6, Tailwind CSS 3, Lucide Icons
- **MCP SDK**: `@modelcontextprotocol/sdk` v1.12+ (native `OAuthClientProvider` interface)
- **OAuth**: Authorization Code flow with PKCE (RFC 7636), automatic server metadata discovery (RFC 8414 / RFC 9728), optional Dynamic Client Registration (RFC 7591)
- **Storage**: JSON file-based persistence
- **Live Updates**: Server-Sent Events (SSE)

### How OAuth Auto-Discovery Works

When you enable OAuth for a remote server, the MCP SDK's transport layer handles the entire flow:

1. **401 Detection** — The transport attempts to connect. If the server returns `401 Unauthorized`, the auth flow begins.
2. **Protected Resource Metadata** — The SDK fetches `/.well-known/oauth-protected-resource` from the server to find the authorization server URL.
3. **Authorization Server Metadata** — The SDK fetches `/.well-known/oauth-authorization-server` (RFC 8414) or falls back to OpenID Connect Discovery to learn the `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, supported scopes, PKCE methods, etc.
4. **Dynamic Client Registration** — If no `clientId` was provided, the SDK attempts RFC 7591 registration at the discovered `registration_endpoint`.
5. **PKCE Authorization** — A code verifier/challenge pair is generated, and the user is redirected to the authorization endpoint.
6. **Token Exchange** — After consent, the callback at `/oauth/callback/{serverId}` exchanges the authorization code for tokens.
7. **Automatic Refresh** — On subsequent connections, expired tokens are refreshed transparently using the stored refresh token.

## Project Structure

```
mcp-gateway/
├── src/
│   ├── server/                 # Backend (Express + MCP SDK)
│   │   ├── index.ts            # Server entry point
│   │   ├── gateway.ts          # Core gateway engine
│   │   ├── api.ts              # REST API routes
│   │   ├── oauth.ts            # OAuth 2.0 handler
│   │   ├── store.ts            # JSON file persistence
│   │   └── types.ts            # Shared type definitions
│   └── client/                 # Frontend (React + Vite)
│       ├── index.html          # HTML entry
│       ├── main.tsx            # React entry
│       ├── index.css           # Tailwind + custom styles
│       ├── App.tsx             # Main application component
│       ├── api.ts              # API client
│       └── components/
│           ├── ServerCard.tsx         # Server display card
│           ├── AddServerModal.tsx     # Add server form
│           ├── EditServerModal.tsx    # Edit server form
│           └── OAuthNotification.tsx  # OAuth callback notification
├── data/                       # Persistent storage (auto-created)
│   └── gateway-store.json      # Server configs + OAuth state (tokens, client info, PKCE verifiers)
├── package.json
├── tsconfig.json
├── tsconfig.server.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
└── README.md
```

## Security Considerations

- **OAuth state** (tokens, client info, PKCE verifiers) is stored on disk in `data/gateway-store.json`. Restrict file permissions in production.
- **Client secrets** are masked in API responses (shown as `••••••••`).
- **PKCE** (Proof Key for Code Exchange) is used for all OAuth flows to prevent authorization code interception.
- **Per-server callback URLs** (`/oauth/callback/{serverId}`) ensure callbacks are routed to the correct provider without shared state.
- OAuth metadata is **always fetched from the server's `.well-known` endpoints** — no manual endpoint URLs are trusted from user input.
- The gateway's `OAuthClientProvider` implementation supports the SDK's `invalidateCredentials()` callback to automatically clear stale tokens or client registrations.
- The gateway **does not** expose MCP server credentials through the UI or API responses.

## License

MIT