import { mkdir } from "node:fs/promises";
import type { Health } from "@sdp/shared";
import { askOnce, claudeErrorEvent } from "./claude.js";
import { sessionsDir } from "./config.js";

let cached: Promise<Health> | null = null;

/** Starts a trivial query to confirm the SDK can run Claude Code with the user's login. */
async function runCheck(): Promise<Health> {
  try {
    const dir = sessionsDir();
    await mkdir(dir, { recursive: true });
    await askOnce({ prompt: "Reply with the single word OK.", cwd: dir, sessionDir: dir, tools: [], maxTurns: 1, persist: false });
    return { ok: true, claudeReady: true };
  } catch (err) {
    const { message, code } = claudeErrorEvent(err);
    console.error(`[health] Claude check failed (${code}): ${message}`);
    return { ok: true, claudeReady: false, error: code === "claude_auth" ? undefined : message };
  }
}

/** Runs once at server start; `refresh` re-runs it for the banner's Retry button. */
export function getHealth(refresh = false): Promise<Health> {
  if (!cached || refresh) cached = runCheck();
  return cached;
}
