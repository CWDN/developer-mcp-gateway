import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CliToolDefinition } from "./types.js";

const execFileAsync = promisify(execFile);

/** Default timeout for discovery commands */
const DISCOVERY_TIMEOUT_MS = 10_000;

/** Commands to skip during auto-discovery (not useful as MCP tools) */
const SKIP_COMMANDS = new Set([
  "help",
  "completion",
  "version",
  "__complete",
  "__completeNoDesc",
]);

// ─── Parsed structures ─────────────────────────────────────────────────────────

export interface DiscoveredFlag {
  long: string;
  short?: string;
  description: string;
  type: "string" | "boolean" | "number";
  defaultValue?: string;
}

export interface DiscoveredCommand {
  name: string;
  description: string;
  usage?: string;
  positionalArgs: DiscoveredPositionalArg[];
  flags: DiscoveredFlag[];
}

export interface DiscoveredPositionalArg {
  name: string;
  required: boolean;
  variadic: boolean;
}

export interface DiscoveryResult {
  commands: DiscoveredCommand[];
  globalFlags: DiscoveredFlag[];
  globalDescription: string;
  tools: CliToolDefinition[];
  globalArgs: string[];
}

// ─── Help text execution ────────────────────────────────────────────────────────

/**
 * Run a command with the given arguments and return combined stdout+stderr.
 * Many CLIs print help to stderr, so we capture both.
 */
async function runHelp(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }
): Promise<string> {
  const cwd = options?.cwd;
  const env = options?.env
    ? ({ ...process.env, ...options.env } as Record<string, string>)
    : (process.env as Record<string, string>);
  const timeout = options?.timeoutMs ?? DISCOVERY_TIMEOUT_MS;

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      env,
      timeout,
      maxBuffer: 1024 * 1024,
    });
    // Prefer stdout, fall back to stderr (some CLIs print help to stderr)
    const output = stdout.trim() || stderr.trim();
    return output;
  } catch (err: unknown) {
    // Many CLIs exit with code 0 for --help, but some exit with 1 or 2.
    // The execFile error still contains stdout/stderr in that case.
    const execErr = err as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message?: string;
    };
    const output =
      (execErr.stdout?.trim() || "") + "\n" + (execErr.stderr?.trim() || "");
    if (output.trim().length > 20) {
      return output.trim();
    }
    throw new Error(
      `Failed to run "${command} ${args.join(" ")}": ${execErr.message ?? String(err)}`
    );
  }
}

// ─── Help text parsing ──────────────────────────────────────────────────────────

/**
 * Parse the top-level `--help` output to extract available subcommands
 * and global flags.
 */
function parseTopLevelHelp(helpText: string): {
  commands: Array<{ name: string; description: string }>;
  globalFlags: DiscoveredFlag[];
  globalDescription: string;
} {
  const lines = helpText.split("\n");
  const commands: Array<{ name: string; description: string }> = [];
  const globalFlags: DiscoveredFlag[] = [];
  let globalDescription = "";

  // Extract description: everything before the first section header
  const descLines: string[] = [];
  for (const line of lines) {
    if (/^(Usage|Available Commands|Commands|Flags|Global Flags|Options|Aliases):/i.test(line.trim())) {
      break;
    }
    descLines.push(line);
  }
  globalDescription = descLines.join("\n").trim();

  // Detect which section we're in
  let section: "none" | "commands" | "flags" | "global_flags" = "none";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Section headers
    if (/^Available Commands:/i.test(trimmed) || /^Commands:/i.test(trimmed)) {
      section = "commands";
      continue;
    }
    if (/^Global Flags:/i.test(trimmed) || /^Global Options:/i.test(trimmed)) {
      section = "global_flags";
      continue;
    }
    if (/^Flags:/i.test(trimmed) || /^Options:/i.test(trimmed)) {
      // Top-level flags (before any command) are effectively global
      section = "flags";
      continue;
    }
    if (/^(Usage|Aliases|Examples|Use "):/i.test(trimmed) || /^Use "/i.test(trimmed)) {
      section = "none";
      continue;
    }

    // Empty line can end a section (if followed by a new section header)
    if (trimmed === "") continue;

    if (section === "commands") {
      // Match command lines with 2+ spaces between name and description,
      // OR single space when the line is indented (Cobra aligns descriptions
      // so long command names like "investigate" may have only one space).
      const cmdMatch = trimmed.match(/^(\S+)\s{2,}(.+)$/) ??
        trimmed.match(/^(\S+)\s(.+)$/);
      if (cmdMatch) {
        commands.push({
          name: cmdMatch[1],
          description: cmdMatch[2].trim(),
        });
      }
    }

    if (section === "flags" || section === "global_flags") {
      const flag = parseFlagLine(trimmed);
      if (flag && section === "global_flags") {
        globalFlags.push(flag);
      }
      // Top-level "Flags:" section: we treat these as global flags too
      if (flag && section === "flags") {
        globalFlags.push(flag);
      }
    }
  }

  return { commands, globalFlags, globalDescription };
}

/**
 * Parse a subcommand's `--help` output to extract its usage pattern,
 * positional arguments, and flags.
 */
function parseSubcommandHelp(helpText: string): {
  description: string;
  usage?: string;
  positionalArgs: DiscoveredPositionalArg[];
  flags: DiscoveredFlag[];
} {
  const lines = helpText.split("\n");
  let description = "";
  let usage: string | undefined;
  const positionalArgs: DiscoveredPositionalArg[] = [];
  const flags: DiscoveredFlag[] = [];

  // Extract description: everything before the first section header
  const descLines: string[] = [];
  for (const line of lines) {
    if (/^(Usage|Flags|Global Flags|Options|Examples|Aliases|Available Commands):/i.test(line.trim())) {
      break;
    }
    descLines.push(line);
  }
  description = descLines.join("\n").trim();
  // Take just the first paragraph for a concise description
  const firstParagraph = description.split(/\n\s*\n/)[0];
  if (firstParagraph) {
    description = firstParagraph.trim();
  }

  // Parse sections
  let section: "none" | "flags" | "global_flags" = "none";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Usage line
    if (/^Usage:/i.test(trimmed)) {
      section = "none";
      // The usage pattern may be on the same line: "Usage: tool <arg> [flags]"
      const usageMatch = trimmed.match(/^Usage:\s*(.+)$/i);
      if (usageMatch) {
        usage = usageMatch[1].trim();
      } else {
        // Cobra-style: "Usage:\n  tool <arg> [flags]" — look at the next non-empty line
        for (let j = i + 1; j < lines.length; j++) {
          const nextTrimmed = lines[j].trim();
          if (nextTrimmed === "") continue;
          // Stop if we hit another section header
          if (/^(Flags|Global Flags|Options|Examples|Aliases|Available Commands|Use "):/i.test(nextTrimmed) || /^Use "/i.test(nextTrimmed)) break;
          usage = nextTrimmed;
          break;
        }
      }
      continue;
    }

    if (/^Flags:/i.test(trimmed) || /^Options:/i.test(trimmed)) {
      section = "flags";
      continue;
    }
    if (/^Global Flags:/i.test(trimmed) || /^Global Options:/i.test(trimmed)) {
      section = "global_flags";
      continue;
    }
    if (/^(Examples|Aliases|Available Commands|Use "):/i.test(trimmed) || /^Use "/i.test(trimmed)) {
      section = "none";
      continue;
    }

    if (trimmed === "") continue;

    if (section === "flags") {
      const flag = parseFlagLine(trimmed);
      if (flag) {
        flags.push(flag);
      }
    }
    // Intentionally skip global flags for subcommands — they're captured at the top level
  }

  // Extract positional args from usage pattern
  if (usage) {
    positionalArgs.push(...parseUsagePositionals(usage));
  }

  return { description, usage, positionalArgs, flags };
}

/**
 * Parse a single flag definition line.
 *
 * Handles common patterns:
 *   -s, --long string   description
 *   --long string       description
 *   -s, --long          description (boolean)
 *   -s, --long int      description
 *       --long          description
 *   -n, --limit int     max results (default 20)
 */
function parseFlagLine(line: string): DiscoveredFlag | null {
  // Skip help flags
  if (/--help\b/.test(line) && !/--help-/.test(line)) return null;

  // Pattern: optional short flag, long flag, optional type, description
  // Matches:  "-s, --long-name type   description text"
  //           "    --long-name type   description text"
  //           "-s, --long-name        description text"
  const match = line.match(
    /^\s*(?:(-\w),?\s+)?(--[\w-]+)(?:\s+(string|int|float|number|duration|uint|int64|uint64|float64|stringArray|intSlice|stringSlice)\b)?\s{2,}(.+)$/
  );

  if (!match) {
    // Try simpler pattern for flags without type annotation
    const simpleMatch = line.match(
      /^\s*(?:(-\w),?\s+)?(--[\w-]+)\s{2,}(.+)$/
    );
    if (simpleMatch) {
      const [, short, long, desc] = simpleMatch;
      return {
        long: long.replace(/^--/, ""),
        short: short?.replace(/^-/, ""),
        description: desc.trim(),
        type: "boolean",
      };
    }
    return null;
  }

  const [, short, long, typeHint, desc] = match;
  let type: "string" | "boolean" | "number" = "string";

  if (!typeHint) {
    type = "boolean";
  } else if (
    typeHint === "int" ||
    typeHint === "float" ||
    typeHint === "number" ||
    typeHint === "uint" ||
    typeHint === "int64" ||
    typeHint === "uint64" ||
    typeHint === "float64"
  ) {
    type = "number";
  }

  // Extract default value from description
  let defaultValue: string | undefined;
  const defaultMatch = desc.match(/\(default[:\s]+([^)]+)\)/i);
  if (defaultMatch) {
    defaultValue = defaultMatch[1].trim();
  }

  return {
    long: long.replace(/^--/, ""),
    short: short?.replace(/^-/, ""),
    description: desc.trim(),
    type,
    defaultValue,
  };
}

/**
 * Extract positional arguments from a usage string like:
 *   "cymbal search <query> [flags]"
 *   "cymbal diff <symbol> [base] [flags]"
 *   "cymbal show <symbol|file[:L1-L2]> [flags]"
 *   "cymbal investigate <symbol> [flags]"
 *   "tool <required> [optional...] [flags]"
 */
function parseUsagePositionals(usage: string): DiscoveredPositionalArg[] {
  const args: DiscoveredPositionalArg[] = [];
  // Remove the command prefix (everything up to the first < or [)
  // and [flags] / [options] suffix
  const cleaned = usage
    .replace(/\[flags\]/gi, "")
    .replace(/\[options\]/gi, "")
    .trim();

  // Match angle-bracket (required) and square-bracket (optional) args
  const argPattern = /(<[^>]+>|\[[^\]]+\])/g;
  let match: RegExpExecArray | null;
  while ((match = argPattern.exec(cleaned)) !== null) {
    const raw = match[1];
    const isRequired = raw.startsWith("<");
    let name = raw.replace(/^[<\[]|[>\]]$/g, "");

    // Handle variadic: "args..." or "symbol..."
    const variadic = name.endsWith("...");
    if (variadic) {
      name = name.replace(/\.{3}$/, "");
    }

    // Clean up: "symbol|file[:L1-L2]" → "symbol"
    // Take the first word/option for the name
    name = name.split("|")[0].split(/[\s:]/)[0].trim();

    if (name && name.toLowerCase() !== "flags" && name.toLowerCase() !== "options") {
      args.push({
        name,
        required: isRequired,
        variadic,
      });
    }
  }

  return args;
}

// ─── Tool generation ────────────────────────────────────────────────────────────

/**
 * Convert a discovered command into a CliToolDefinition.
 *
 * Positional args become {{placeholder}} templates.
 * Subcommand-specific flags become properties in the inputSchema.
 * Global flags (like --json) are handled separately via globalArgs.
 */
function commandToToolDef(
  cmd: DiscoveredCommand,
  globalFlags: DiscoveredFlag[]
): CliToolDefinition {
  // Build args template: [subcommand, ...positionals as placeholders]
  const argsTemplate: string[] = [cmd.name];

  for (const pos of cmd.positionalArgs) {
    argsTemplate.push(`{{${pos.name}}}`);
  }

  // Build JSON Schema from positional args + subcommand-specific flags
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  // Positional arguments
  for (const pos of cmd.positionalArgs) {
    properties[pos.name] = {
      type: "string",
      description: `Positional argument: ${pos.name}${pos.variadic ? " (can specify multiple, space-separated)" : ""}`,
    };
    if (pos.required) {
      required.push(pos.name);
    }
  }

  // Subcommand-specific flags (exclude flags that match global flags)
  const globalFlagNames = new Set(globalFlags.map((f) => f.long));
  for (const flag of cmd.flags) {
    if (globalFlagNames.has(flag.long)) continue;
    // Skip help flag
    if (flag.long === "help") continue;

    const propName = kebabToCamel(flag.long);
    const prop: Record<string, unknown> = {
      type: flag.type === "number" ? "number" : flag.type === "boolean" ? "boolean" : "string",
      description: flag.description,
    };
    if (flag.defaultValue !== undefined) {
      prop.default = flag.type === "number"
        ? Number(flag.defaultValue)
        : flag.type === "boolean"
          ? flag.defaultValue === "true"
          : flag.defaultValue;
    }
    properties[propName] = prop;
  }

  const inputSchema: Record<string, unknown> = {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };

  return {
    name: cmd.name,
    description: cmd.description,
    args: argsTemplate,
    inputSchema,
  };
}

/**
 * Determine which global flags should be auto-appended to every invocation.
 * For example, if --json is available, include it so output is machine-readable.
 */
function pickGlobalArgs(globalFlags: DiscoveredFlag[]): string[] {
  const args: string[] = [];
  for (const flag of globalFlags) {
    // Always prefer JSON output when available
    if (flag.long === "json" && flag.type === "boolean") {
      args.push("--json");
    }
  }
  return args;
}

/** Convert kebab-case to camelCase: "my-flag" → "myFlag" */
function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Convert camelCase to kebab-case: "myFlag" → "my-flag" */
export function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Auto-discover CLI tools by running `<command> --help` and parsing the output.
 *
 * For each discovered subcommand, runs `<command> <subcmd> --help` to extract
 * positional arguments and flags, then converts them into CliToolDefinition[].
 *
 * @param command  - Path to the CLI binary (e.g., "cymbal", "/usr/local/bin/mytool")
 * @param options  - Optional cwd, env, and timeout
 * @returns Discovery result with tools, global flags, and auto-generated globalArgs
 */
export async function discoverCliTools(
  command: string,
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  }
): Promise<DiscoveryResult> {
  // Step 1: Run top-level --help
  const topHelp = await runHelp(command, ["--help"], options);
  const { commands: rawCommands, globalFlags, globalDescription } =
    parseTopLevelHelp(topHelp);

  // Filter out commands we don't want as tools
  const commandsToDiscover = rawCommands.filter(
    (c) => !SKIP_COMMANDS.has(c.name.toLowerCase())
  );

  // Step 2: Run --help for each subcommand in parallel
  const commandDetails = await Promise.allSettled(
    commandsToDiscover.map(async (cmd) => {
      const subHelp = await runHelp(command, [cmd.name, "--help"], options);
      const parsed = parseSubcommandHelp(subHelp);
      return {
        name: cmd.name,
        // Use the subcommand help description if available, fall back to top-level
        description: parsed.description || cmd.description,
        usage: parsed.usage,
        positionalArgs: parsed.positionalArgs,
        flags: parsed.flags,
      } satisfies DiscoveredCommand;
    })
  );

  const commands: DiscoveredCommand[] = [];
  for (let i = 0; i < commandDetails.length; i++) {
    const result = commandDetails[i];
    if (result.status === "fulfilled") {
      commands.push(result.value);
    } else {
      // If subcommand help failed, use top-level info with no args/flags
      const fallback = commandsToDiscover[i];
      commands.push({
        name: fallback.name,
        description: fallback.description,
        positionalArgs: [],
        flags: [],
      });
    }
  }

  // Step 3: Convert to CliToolDefinition[]
  const tools = commands.map((cmd) => commandToToolDef(cmd, globalFlags));
  const globalArgs = pickGlobalArgs(globalFlags);

  return {
    commands,
    globalFlags,
    globalDescription,
    tools,
    globalArgs,
  };
}

// ─── Exported parsing utilities (for testing) ────────────────────────────────────

export {
  parseTopLevelHelp,
  parseSubcommandHelp,
  parseFlagLine,
  parseUsagePositionals,
  commandToToolDef,
  pickGlobalArgs,
};