import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { Router } from "express";
import type { Gateway } from "./gateway.js";
import type { ToolInfo, ResourceInfo, PromptInfo } from "./types.js";
import { getRequestLogStore, type RequestLogStore } from "./request-log.js";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Separator between server prefix and original tool/resource/prompt name */
const PREFIX_SEP = "__";

/** Maximum description length in tools/list to keep context lean.
 * Since we now compact input schemas aggressively, we can afford slightly
 * longer descriptions to give LLMs more context about tool purpose. */
const COMPACT_DESCRIPTION_LENGTH = 200;

/** Maximum length for property descriptions within compacted schemas */
const COMPACT_PROPERTY_DESC_LENGTH = 60;

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: Server;
  createdAt: number;
}

interface PrefixedTool extends ToolInfo {
  /** The prefixed name exposed to MCP clients (e.g. "atlassian__jira_search") */
  prefixedName: string;
  /** Original tool name on the upstream server */
  originalName: string;
  /** Sanitized version of originalName (matches pattern ^[a-zA-Z0-9_-]{1,128}$) */
  sanitizedName: string;
  /** Gateway server ID for routing */
  serverId: string;
  /** Human-friendly server name */
  serverName: string;
}

interface PrefixedResource extends ResourceInfo {
  prefixedUri: string;
  originalUri: string;
  serverId: string;
  serverName: string;
}

interface PrefixedPrompt extends PromptInfo {
  prefixedName: string;
  originalName: string;
  /** Sanitized version of originalName (matches pattern ^[a-zA-Z0-9_-]{1,128}$) */
  sanitizedName: string;
  serverId: string;
  serverName: string;
}

// ─── Name Helpers ──────────────────────────────────────────────────────────────

/**
 * Sanitize a name to match the required pattern: ^[a-zA-Z0-9_-]{1,128}$
 * 
 * Replaces invalid characters with underscores and truncates to 128 chars.
 * Examples:
 *   "my.tool.name" → "my_tool_name"
 *   "tool:v2" → "tool_v2"
 *   "hello world!" → "hello_world_"
 */
function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]+/g, "_") // Replace invalid chars with _
    .replace(/^_+|_+$/g, "") // Trim leading/trailing underscores
    .slice(0, 128); // Enforce max length
}

/**
 * Normalize a server name into a safe prefix for tool/prompt names.
 *
 * "Atlassian MCP"  → "atlassian_mcp"
 * "My  Cool--Server!" → "my_cool_server"
 */
function normalizePrefix(serverName: string): string {
  return serverName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_") // Replace non-alphanumeric runs with _
    .replace(/^_+|_+$/g, ""); // Trim leading/trailing underscores
}

/**
 * Build a prefixed tool/prompt name: `serverprefix__originalname`
 * Both parts are sanitized to ensure the result matches ^[a-zA-Z0-9_-]{1,128}$
 */
function prefixName(serverName: string, originalName: string): string {
  const prefix = normalizePrefix(serverName);
  const sanitizedOriginal = sanitizeName(originalName);
  const combined = `${prefix}${PREFIX_SEP}${sanitizedOriginal}`;
  // Ensure final result respects max length
  return combined.slice(0, 128);
}

/**
 * Parse a prefixed name back into [serverPrefix, originalName].
 * Returns undefined if the name doesn't contain the separator.
 */
function parsePrefixedName(
  prefixedName: string
): { prefix: string; originalName: string } | undefined {
  const idx = prefixedName.indexOf(PREFIX_SEP);
  if (idx === -1) return undefined;
  return {
    prefix: prefixedName.slice(0, idx),
    originalName: prefixedName.slice(idx + PREFIX_SEP.length),
  };
}

/**
 * Truncate a description for compact listing. Preserves whole words.
 */
function compactDescription(
  desc: string | undefined,
  maxLen = COMPACT_DESCRIPTION_LENGTH
): string | undefined {
  if (!desc) return undefined;
  if (desc.length <= maxLen) return desc;
  const truncated = desc.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.6 ? truncated.slice(0, lastSpace) : truncated) + "…";
}

/**
 * Compact an input schema for tools/list to minimize context window usage.
 * 
 * Strategy:
 * - Keep property names, types, required fields, and enums (essential for valid calls)
 * - Truncate or remove property descriptions (LLM can use gateway__search_tools for full details)
 * - Preserve nested structure for arrays/objects but compact recursively
 * 
 * This typically reduces schema size by 60-80% while preserving call validity.
 */
function compactInputSchema(
  schema: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!schema) return { type: "object", properties: {} };

  const schemaType = schema.type;
  const properties = schema.properties as Record<string, unknown> | undefined;
  const required = schema.required as string[] | undefined;

  // If no properties, return minimal schema
  if (!properties || Object.keys(properties).length === 0) {
    return { type: schemaType ?? "object", properties: {} };
  }

  const compactProps: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (!value || typeof value !== "object") continue;
    
    const prop = value as Record<string, unknown>;
    const compactProp: Record<string, unknown> = {};

    // Always keep type
    if (prop.type) compactProp.type = prop.type;

    // Keep enums - critical for valid values
    if (prop.enum) compactProp.enum = prop.enum;

    // Keep const values
    if (prop.const !== undefined) compactProp.const = prop.const;

    // Truncate description heavily - just enough for basic context
    if (prop.description && typeof prop.description === "string") {
      const truncated = compactDescription(prop.description, COMPACT_PROPERTY_DESC_LENGTH);
      if (truncated) compactProp.description = truncated;
    }

    // Handle arrays - compact the items schema
    if (prop.items && typeof prop.items === "object") {
      const items = prop.items as Record<string, unknown>;
      const compactItems: Record<string, unknown> = {};
      if (items.type) compactItems.type = items.type;
      if (items.enum) compactItems.enum = items.enum;
      // For complex item schemas, just keep the type
      compactProp.items = compactItems;
    }

    // Handle nested objects - recurse but with depth limit
    if (prop.properties && typeof prop.properties === "object") {
      // For nested objects, just indicate it's an object with properties
      // Full schema available via gateway__search_tools
      compactProp.type = "object";
      compactProp.description = compactProp.description ?? "(nested object)";
    }

    // Handle oneOf/anyOf/allOf - simplify to just indicate multiple options
    if (prop.oneOf || prop.anyOf || prop.allOf) {
      const variants = (prop.oneOf ?? prop.anyOf ?? prop.allOf) as unknown[];
      if (Array.isArray(variants) && variants.length > 0) {
        // Extract types from variants for a hint
        const types = variants
          .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
          .map((v) => v.type)
          .filter(Boolean);
        if (types.length > 0) {
          compactProp.type = types.length === 1 ? types[0] : types;
        }
      }
    }

    // Keep additionalProperties hint if present
    if (prop.additionalProperties !== undefined) {
      compactProp.additionalProperties = typeof prop.additionalProperties === "boolean" 
        ? prop.additionalProperties 
        : true;
    }

    compactProps[key] = compactProp;
  }

  const result: Record<string, unknown> = {
    type: schemaType ?? "object",
    properties: compactProps,
  };

  // Keep required array - essential for valid calls
  if (required && required.length > 0) {
    result.required = required;
  }

  return result;
}

// ─── Aggregation Helpers ───────────────────────────────────────────────────────

function aggregateTools(gateway: Gateway): PrefixedTool[] {
  const tools = gateway.getAllTools();
  return tools.map((t) => ({
    ...t,
    prefixedName: prefixName(t.serverName, t.name),
    originalName: t.name,
    sanitizedName: sanitizeName(t.name),
  }));
}

function aggregateResources(gateway: Gateway): PrefixedResource[] {
  const resources = gateway.getAllResources();
  return resources.map((r) => ({
    ...r,
    prefixedUri: r.uri, // URIs are already globally unique in practice
    originalUri: r.uri,
  }));
}

function aggregatePrompts(gateway: Gateway): PrefixedPrompt[] {
  const prompts = gateway.getAllPrompts();
  return prompts.map((p) => ({
    ...p,
    prefixedName: prefixName(p.serverName, p.name),
    originalName: p.name,
    sanitizedName: sanitizeName(p.name),
  }));
}

// ─── Gateway Meta-Tool Definitions ─────────────────────────────────────────────

const GATEWAY_META_TOOLS = {
  gateway__search_tools: {
    name: "gateway__search_tools",
    description:
      "Search for tools across all connected MCP servers by keyword. Returns matching tools with FULL " +
      "descriptions and input schemas. Use this to discover tools before calling them.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Search keyword(s) to match against tool names and descriptions. Case-insensitive.",
        },
        server: {
          type: "string",
          description:
            "Optional: filter results to a specific server name prefix (e.g. 'atlassian'). Case-insensitive.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 20).",
        },
      },
      required: ["query"],
    },
  },

  gateway__list_servers: {
    name: "gateway__list_servers",
    description:
      "List all connected MCP servers with their status and capability counts (tools, resources, prompts). " +
      "Use this to understand what servers are available before searching for specific tools.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },

  gateway__get_server_tools: {
    name: "gateway__get_server_tools",
    description:
      "List ALL tools for a specific server with full descriptions and input schemas. " +
      "Use this after gateway__list_servers to explore a server's capabilities in detail.",
    inputSchema: {
      type: "object" as const,
      properties: {
        server: {
          type: "string",
          description:
            "Server name prefix to list tools for (e.g. 'atlassian'). Case-insensitive. " +
            "Use gateway__list_servers to see available servers.",
        },
      },
      required: ["server"],
    },
  },
};

// ─── Meta-Tool Handlers ────────────────────────────────────────────────────────

function handleSearchTools(
  gateway: Gateway,
  args: Record<string, unknown>
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  const query = String(args.query ?? "").toLowerCase();
  const serverFilter = args.server
    ? String(args.server).toLowerCase()
    : undefined;
  const limit = typeof args.limit === "number" ? args.limit : 20;

  if (!query) {
    return {
      content: [{ type: "text", text: "Error: 'query' parameter is required." }],
      isError: true,
    };
  }

  const allTools = aggregateTools(gateway);

  const matches = allTools
    .filter((t) => {
      // Server filter
      if (serverFilter && !normalizePrefix(t.serverName).includes(serverFilter)) {
        return false;
      }
      // Keyword match against name + description
      const haystack = `${t.originalName} ${t.prefixedName} ${t.description ?? ""}`.toLowerCase();
      // Support multi-word queries: all words must match
      const words = query.split(/\s+/).filter(Boolean);
      return words.every((w) => haystack.includes(w));
    })
    .slice(0, limit);

  if (matches.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No tools found matching "${query}"${serverFilter ? ` on server "${serverFilter}"` : ""}. Try broader keywords or use gateway__list_servers to see available servers.`,
        },
      ],
    };
  }

  const results = matches.map((t) => ({
    tool_name: t.prefixedName,
    server: t.serverName,
    description: t.description ?? "(no description)",
    input_schema: t.inputSchema ?? { type: "object", properties: {} },
  }));

  return {
    content: [
      {
        type: "text",
        text: `Found ${matches.length} tool(s) matching "${query}":\n\n${JSON.stringify(results, null, 2)}`,
      },
    ],
  };
}

function handleListServers(
  gateway: Gateway
): { content: Array<{ type: "text"; text: string }> } {
  const statuses = gateway.getAllServerStatuses();

  const servers = statuses.map((s) => ({
    name: s.name,
    prefix: normalizePrefix(s.name),
    status: s.status,
    transport: s.transport,
    tools: s.tools.length,
    resources: s.resources.length,
    prompts: s.prompts.length,
  }));

  const connected = servers.filter((s) => s.status === "connected");
  const summary =
    `${connected.length} of ${servers.length} server(s) connected.\n\n` +
    `Use gateway__search_tools to find tools by keyword, or ` +
    `gateway__get_server_tools with a server prefix to explore a specific server.`;

  return {
    content: [
      {
        type: "text",
        text: `${summary}\n\n${JSON.stringify(servers, null, 2)}`,
      },
    ],
  };
}

function handleGetServerTools(
  gateway: Gateway,
  args: Record<string, unknown>
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  const serverFilter = String(args.server ?? "").toLowerCase();

  if (!serverFilter) {
    return {
      content: [
        {
          type: "text",
          text: "Error: 'server' parameter is required. Use gateway__list_servers to see available servers.",
        },
      ],
      isError: true,
    };
  }

  const allTools = aggregateTools(gateway);
  const matches = allTools.filter((t) =>
    normalizePrefix(t.serverName).includes(serverFilter)
  );

  if (matches.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No tools found for server "${serverFilter}". Use gateway__list_servers to see available servers.`,
        },
      ],
    };
  }

  // Group by server name for clarity (in case partial match hits multiple)
  const grouped: Record<string, Array<{ tool_name: string; description: string; input_schema: unknown }>> = {};
  for (const t of matches) {
    const key = t.serverName;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      tool_name: t.prefixedName,
      description: t.description ?? "(no description)",
      input_schema: t.inputSchema ?? { type: "object", properties: {} },
    });
  }

  return {
    content: [
      {
        type: "text",
        text: `Found ${matches.length} tool(s) for "${serverFilter}":\n\n${JSON.stringify(grouped, null, 2)}`,
      },
    ],
  };
}

// ─── MCP Proxy ─────────────────────────────────────────────────────────────────

/**
 * Creates an Express router that exposes all aggregated gateway capabilities
 * (tools, resources, prompts) as a Streamable HTTP MCP server.
 *
 * MCP clients (Claude Desktop, Cursor, etc.) can connect to this endpoint
 * using the Streamable HTTP transport.
 *
 * Key features:
 * - **Prefixed names** — All tool/prompt names are prefixed with a normalized
 *   server name (e.g. `atlassian__jira_search`) to prevent collisions and
 *   provide clear provenance.
 * - **Compact descriptions** — `tools/list` returns truncated descriptions to
 *   minimize context window usage. Full details are available via the
 *   `gateway__search_tools` meta-tool.
 * - **Gateway meta-tools** — `gateway__search_tools`, `gateway__list_servers`,
 *   and `gateway__get_server_tools` enable LLMs to discover capabilities
 *   efficiently without processing hundreds of tool schemas.
 * - **Live notifications** — When upstream servers connect/disconnect, all
 *   active MCP client sessions receive `list_changed` notifications.
 */
export function createMcpProxyRouter(gateway: Gateway): Router {
  const router = Router();
  const sessions = new Map<string, SessionEntry>();
  const requestLog = getRequestLogStore();

  // ─── Helpers ───────────────────────────────────────────────────────────

  /**
   * Find a prefixed tool and resolve it to the upstream server + original name.
   */
  function resolveToolCall(prefixedName: string): {
    serverId: string;
    originalName: string;
  } | undefined {
    // Check if it's a gateway meta-tool (no prefix parsing needed)
    if (prefixedName in GATEWAY_META_TOOLS) return undefined;

    const parsed = parsePrefixedName(prefixedName);
    if (!parsed) return undefined;

    // Find the matching upstream tool
    // Compare using sanitizedName since the prefixed name contains the sanitized version
    const allTools = aggregateTools(gateway);
    const match = allTools.find(
      (t) =>
        normalizePrefix(t.serverName) === parsed.prefix &&
        t.sanitizedName === parsed.originalName
    );

    if (!match) return undefined;
    // Return the actual originalName (not sanitized) to call the upstream server correctly
    return { serverId: match.serverId, originalName: match.originalName };
  }

  /**
   * Get server info for a given server ID.
   */
  function getServerInfo(serverId: string): { id: string; name: string } {
    const status = gateway.getServerStatus(serverId);
    return { id: serverId, name: status?.name ?? serverId };
  }

  /**
   * Create a new MCP Server instance wired up to proxy requests through
   * the gateway to upstream MCP servers, with prefixed names and meta-tools.
   */
  function createProxyServer(): Server {
    const server = new Server(
      {
        name: "mcp-gateway",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true },
          prompts: { listChanged: true },
        },
      }
    );

    // ── tools/list ─────────────────────────────────────────────────────
    //
    // Returns gateway meta-tools (with full descriptions) + all upstream
    // tools (with prefixed names and compact descriptions to save context).

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const upstreamTools = aggregateTools(gateway);

      // Gateway meta-tools first (always present, full descriptions)
      const metaToolDefs = Object.values(GATEWAY_META_TOOLS).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

      // Upstream tools with prefixed names, compact descriptions, and compact schemas.
      // Full details are available via gateway__search_tools and gateway__get_server_tools.
      const upstreamToolDefs = upstreamTools.map((t) => ({
        name: t.prefixedName,
        description: compactDescription(
          t.description
            ? `[${t.serverName}] ${t.description}`
            : `[${t.serverName}]`
        ),
        inputSchema: compactInputSchema(t.inputSchema as Record<string, unknown>),
      }));

      return {
        tools: [...metaToolDefs, ...upstreamToolDefs],
      };
    });

    // ── tools/call ─────────────────────────────────────────────────────

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Handle gateway meta-tools (not logged as they are internal)
      if (name === "gateway__search_tools") {
        return handleSearchTools(gateway, args ?? {});
      }
      if (name === "gateway__list_servers") {
        return handleListServers(gateway);
      }
      if (name === "gateway__get_server_tools") {
        return handleGetServerTools(gateway, args ?? {});
      }

      // Resolve prefixed name to upstream server + original tool name
      const resolved = resolveToolCall(name);
      if (!resolved) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Error: Tool "${name}" not found. Tool names use the format ` +
                `"serverprefix__toolname". Use gateway__search_tools to discover tools.`,
            },
          ],
          isError: true,
        };
      }

      // Start logging the request
      const logId = requestLog.start({
        type: "tool",
        method: name,
        originalMethod: resolved.originalName,
        server: getServerInfo(resolved.serverId),
        request: (args ?? {}) as Record<string, unknown>,
      });

      try {
        const result = await gateway.callTool(
          resolved.serverId,
          resolved.originalName,
          args ?? {}
        );
        const r = result as Record<string, unknown>;
        const response = {
          content: (r.content as Array<Record<string, unknown>>) ?? [
            { type: "text", text: JSON.stringify(result) },
          ],
          isError: r.isError as boolean | undefined,
        };

        // Log the successful response
        requestLog.complete(logId, {
          content: response.content,
          isError: response.isError,
        });

        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Log the error
        requestLog.fail(logId, message);

        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    });

    // ── resources/list ─────────────────────────────────────────────────
    //
    // Resources use their original URIs (already globally unique), but
    // descriptions are annotated with the server name.

    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = aggregateResources(gateway);

      return {
        resources: resources.map((r) => ({
          uri: r.originalUri,
          name: r.name,
          description: compactDescription(
            r.description
              ? `[${r.serverName}] ${r.description}`
              : `[${r.serverName}]`
          ),
          mimeType: r.mimeType,
        })),
      };
    });

    // ── resources/read ─────────────────────────────────────────────────

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      const allResources = aggregateResources(gateway);
      const match = allResources.find((r) => r.originalUri === uri);

      if (!match) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Resource not found: ${uri}`
        );
      }

      // Start logging the request
      const logId = requestLog.start({
        type: "resource",
        method: uri,
        server: getServerInfo(match.serverId),
        request: { uri },
      });

      try {
        const result = await gateway.readResource(match.serverId, uri);
        const typedResult = result as { contents: Array<Record<string, unknown>> };

        // Log the successful response
        requestLog.complete(logId, {
          content: typedResult.contents,
          isError: false,
        });

        return typedResult;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Log the error
        requestLog.fail(logId, message);

        throw new McpError(
          ErrorCode.InternalError,
          `Failed to read resource "${uri}": ${message}`
        );
      }
    });

    // ── prompts/list ───────────────────────────────────────────────────
    //
    // Prompts use prefixed names (same pattern as tools) since prompt
    // names can also collide across servers.

    server.setRequestHandler(ListPromptsRequestSchema, async () => {
      const prompts = aggregatePrompts(gateway);

      return {
        prompts: prompts.map((p) => ({
          name: p.prefixedName,
          description: compactDescription(
            p.description
              ? `[${p.serverName}] ${p.description}`
              : `[${p.serverName}]`
          ),
          arguments: p.arguments?.map((a) => ({
            name: a.name,
            description: a.description,
            required: a.required,
          })),
        })),
      };
    });

    // ── prompts/get ────────────────────────────────────────────────────

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Resolve prefixed prompt name
      const parsed = parsePrefixedName(name);
      if (!parsed) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Prompt "${name}" not found. Prompt names use the format "serverprefix__promptname".`
        );
      }

      // Compare using sanitizedName since the prefixed name contains the sanitized version
      const allPrompts = aggregatePrompts(gateway);
      const match = allPrompts.find(
        (p) =>
          normalizePrefix(p.serverName) === parsed.prefix &&
          p.sanitizedName === parsed.originalName
      );

      if (!match) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Prompt "${name}" not found.`
        );
      }

      // Start logging the request
      const logId = requestLog.start({
        type: "prompt",
        method: name,
        originalMethod: match.originalName,
        server: getServerInfo(match.serverId),
        request: (args ?? {}) as Record<string, unknown>,
      });

      try {
        const result = await gateway.getPrompt(
          match.serverId,
          match.originalName,
          args as Record<string, string> | undefined
        );
        const typedResult = result as {
          description?: string;
          messages: Array<Record<string, unknown>>;
        };

        // Log the successful response
        requestLog.complete(logId, {
          content: typedResult,
          isError: false,
        });

        return typedResult;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Log the error
        requestLog.fail(logId, message);

        throw new McpError(
          ErrorCode.InternalError,
          `Failed to get prompt "${name}": ${message}`
        );
      }
    });

    return server;
  }

  /**
   * Look up an existing session by the mcp-session-id header.
   */
  function getSession(req: Request): SessionEntry | undefined {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) return undefined;
    return sessions.get(sessionId);
  }

  // ─── Notify connected MCP clients of capability changes ──────────────

  gateway.on("event", (event: { type: string }) => {
    if (
      event.type === "server:connected" ||
      event.type === "server:disconnected"
    ) {
      for (const entry of sessions.values()) {
        try {
          entry.server
            .sendToolListChanged()
            .catch(() => {
              /* session may be closed */
            });
          entry.server
            .sendResourceListChanged()
            .catch(() => {
              /* session may be closed */
            });
          entry.server
            .sendPromptListChanged()
            .catch(() => {
              /* session may be closed */
            });
        } catch {
          // Ignore errors for closed sessions
        }
      }
    }
  });

  // ─── POST /mcp — JSON-RPC messages (including initialization) ────────

  router.post("/", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let entry = sessionId ? sessions.get(sessionId) : undefined;

    // If this is an initialize request (no session yet), create a new session
    if (!entry) {
      const server = createProxyServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Let the SDK generate one
      });

      entry = {
        transport,
        server,
        createdAt: Date.now(),
      };

      // When the transport closes, clean up
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          sessions.delete(sid);
          console.log(`[MCP Proxy] Session ${sid} closed.`);
        }
      };

      // Connect the server to the transport (sets up message routing)
      await server.connect(transport);

      // Store the session after connect so sessionId is available
      if (transport.sessionId) {
        sessions.set(transport.sessionId, entry);
        console.log(
          `[MCP Proxy] New session created: ${transport.sessionId}`
        );
      }
    }

    // Delegate the request to the transport
    await entry.transport.handleRequest(req, res, req.body);
  });

  // ─── GET /mcp — SSE stream for server-initiated messages ─────────────

  router.get("/", async (req: Request, res: Response) => {
    const entry = getSession(req);
    if (!entry) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "No active session. Send an initialize request first via POST.",
        },
        id: null,
      });
      return;
    }

    await entry.transport.handleRequest(req, res);
  });

  // ─── DELETE /mcp — Terminate session ─────────────────────────────────

  router.delete("/", async (req: Request, res: Response) => {
    const entry = getSession(req);
    if (!entry) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "No active session to terminate.",
        },
        id: null,
      });
      return;
    }

    const sid = entry.transport.sessionId;
    await entry.transport.close();
    await entry.server.close();
    if (sid) {
      sessions.delete(sid);
    }

    console.log(`[MCP Proxy] Session ${sid} terminated by client.`);
    res.status(200).json({ ok: true });
  });

  return router;
}