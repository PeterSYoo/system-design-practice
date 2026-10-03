import path from "node:path";
import { query, type HookCallback, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ErrorCode } from "@sdp/shared";
import { claudeModel, isInside } from "./config.js";
import { INTERVIEWER_SYSTEM_PROMPT } from "./prompts.js";

export type ClaudeEvent =
  | { type: "session"; id: string }
  | { type: "delta"; text: string }
  /** A Read call started, for the "Looking at your diagram" status line. */
  | { type: "reading" }
  | { type: "done"; text: string; sessionId: string };

export class ClaudeError extends Error {
  constructor(
    public code: Extract<ErrorCode, "claude_auth" | "claude_limit" | "claude_failed">,
    message: string,
    /** True when `resume` failed because the CLI no longer has that conversation. */
    public lostSession = false,
  ) {
    super(message);
  }
}

// Variables removed from the CLI's environment:
// - API keys and tokens, so a key in the user's shell never bills an API account instead of the plan.
// - A base URL override, so requests go to Anthropic with the plan login.
// - Session plumbing a parent Claude Code process sets (CLAUDECODE, CLAUDE_CODE_*), so running this
//   app from inside Claude Code behaves like running it from start.bat.
const KEEP_CLAUDE_CODE_VARS = new Set(["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_GIT_BASH_PATH"]);

export function cliEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    const k = key.toUpperCase();
    if (k === "ANTHROPIC_API_KEY" || k === "ANTHROPIC_AUTH_TOKEN" || k === "ANTHROPIC_BASE_URL") continue;
    if (k === "CLAUDECODE") continue;
    if (k.startsWith("CLAUDE_CODE_") && !KEEP_CLAUDE_CODE_VARS.has(k)) continue;
    env[key] = value;
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "system-design-practice/0.1";
  return env;
}

/**
 * Decides whether Claude may use a tool: only Read, and only for files inside the session folder.
 * Returns a reason string when the call must be denied.
 */
export function toolDenial(toolName: string, input: unknown, cwd: string, sessionDir: string): string | null {
  if (toolName !== "Read") return `The ${toolName} tool is not available in this app.`;
  const filePath = (input as { file_path?: unknown })?.file_path;
  if (typeof filePath !== "string" || !filePath) return "Read needs a file path.";
  const resolved = path.resolve(cwd, filePath);
  if (!isInside(resolved, sessionDir)) return "Reading files outside this session's folder is not allowed.";
  return null;
}

function classify(text: string): ClaudeError["code"] {
  if (/auth|log ?in|credential|oauth|unauthori[sz]ed|invalid api key|401/i.test(text)) return "claude_auth";
  if (/usage limit|rate.?limit|limit reached|quota|429|billing/i.test(text)) return "claude_limit";
  return "claude_failed";
}

const FRIENDLY: Record<ClaudeError["code"], string> = {
  claude_auth: "Claude Code is not logged in. Run `claude` in a terminal and log in, then try again.",
  claude_limit: "Your Claude plan's usage limit has been reached. Try again when it resets.",
  claude_failed: "Claude could not answer.",
};

export type AskOptions = {
  prompt: string;
  /** Claude's working folder: the sessions root, so resume works from the first call. */
  cwd: string;
  /** The one folder Claude may read from. */
  sessionDir: string;
  /** Undefined on the first call of a session. */
  claudeSessionId?: string;
  /** Tools to offer. Health checks and question generation pass none. */
  tools?: string[];
  maxTurns?: number;
  /** False keeps the conversation off disk (health checks). */
  persist?: boolean;
  abortController?: AbortController;
};

/** Runs one Claude turn through the Agent SDK, yielding text deltas and the final text. */
export async function* askClaude(opts: AskOptions): AsyncGenerator<ClaudeEvent> {
  const tools = opts.tools ?? ["Read"];
  const stderr: string[] = [];

  // Hooks run for every tool call, including ones allowedTools pre-approves, so this is the real gate.
  const guard: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const reason = toolDenial(input.tool_name, input.tool_input, opts.cwd, opts.sessionDir);
    if (!reason) return {};
    return {
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    };
  };

  const stream = query({
    prompt: opts.prompt,
    options: {
      systemPrompt: INTERVIEWER_SYSTEM_PROMPT,
      resume: opts.claudeSessionId,
      cwd: opts.cwd,
      tools,
      allowedTools: [],
      permissionMode: "default",
      canUseTool: async (toolName, input) => {
        const reason = toolDenial(toolName, input, opts.cwd, opts.sessionDir);
        return reason ? { behavior: "deny", message: reason } : { behavior: "allow", updatedInput: input };
      },
      hooks: { PreToolUse: [{ hooks: [guard] }] },
      settingSources: [],
      includePartialMessages: true,
      maxTurns: opts.maxTurns ?? 4,
      env: cliEnv(),
      model: claudeModel(),
      abortController: opts.abortController,
      persistSession: opts.persist ?? true,
      stderr: (data) => {
        stderr.push(data);
        if (stderr.length > 50) stderr.shift();
      },
    },
  });

  let sessionId = opts.claudeSessionId ?? "";
  let text = "";
  let sentSession = false;
  let turnHadText = false;

  const fail = (raw: string): never => {
    const lost = /no conversation found|session.*not found|could not (find|resume)/i.test(raw);
    const code = lost ? "claude_failed" : classify(raw);
    console.error(`[claude] ${code}: ${raw}`);
    throw new ClaudeError(code, code === "claude_failed" ? `${FRIENDLY.claude_failed} ${raw}`.trim() : FRIENDLY[code], lost);
  };

  try {
    for await (const msg of stream as AsyncIterable<SDKMessage>) {
      if ("session_id" in msg && msg.session_id && !sentSession) {
        sessionId = msg.session_id;
        sentSession = true;
        yield { type: "session", id: sessionId };
      }
      switch (msg.type) {
        case "stream_event": {
          if (msg.parent_tool_use_id) break;
          const ev = msg.event;
          if (ev.type === "message_start") {
            // A new assistant turn after a tool call: separate it from the text before.
            if (turnHadText) {
              text += "\n\n";
              yield { type: "delta", text: "\n\n" };
              turnHadText = false;
            }
          } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            text += ev.delta.text;
            turnHadText = true;
            yield { type: "delta", text: ev.delta.text };
          } else if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
            if (ev.content_block.name === "Read") yield { type: "reading" };
          }
          break;
        }
        case "assistant":
          if (msg.error) fail(`${msg.error}: ${textOf(msg)}`);
          break;
        case "auth_status":
          if (msg.error) fail(`auth: ${msg.error}`);
          break;
        case "result":
          if (msg.subtype === "success" && !msg.is_error) {
            yield { type: "done", text: text.trim() || msg.result.trim(), sessionId };
            return;
          }
          fail(msg.subtype === "success" ? msg.result : [msg.subtype, ...(msg.errors ?? [])].join(": "));
      }
    }
    fail(stderr.join("").trim() || "Claude ended without a result.");
  } catch (err) {
    if (err instanceof ClaudeError) throw err;
    fail(`${err instanceof Error ? err.message : String(err)} ${stderr.join("").trim()}`.trim());
  }
}

function textOf(msg: Extract<SDKMessage, { type: "assistant" }>): string {
  return msg.message.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .slice(0, 300);
}

/** Collects a whole reply. Used by the health check. */
export async function askOnce(opts: AskOptions): Promise<string> {
  let out = "";
  for await (const ev of askClaude(opts)) if (ev.type === "done") out = ev.text;
  return out;
}

export function claudeErrorEvent(err: unknown): { message: string; code: ErrorCode } {
  if (err instanceof ClaudeError) return { message: err.message, code: err.code };
  return { message: err instanceof Error ? err.message : String(err), code: "claude_failed" };
}
