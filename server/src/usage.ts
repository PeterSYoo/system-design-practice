import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PlanUsage, UsageWindow } from "@sdp/shared";
import { cliEnv } from "./claude.js";

/** The dashboard refetches on every visit; this keeps quick back-and-forth from spawning the CLI each time. */
const CACHE_MS = 30_000;
const TIMEOUT_MS = 15_000;

let cached: { at: number; value: Promise<PlanUsage> } | null = null;

/**
 * Asks the CLI for the data behind its `/usage` screen. This is a status request, not a prompt,
 * so it costs no plan usage. The SDK marks the method experimental, so any failure (including the
 * method disappearing in a later SDK) just hides the dashboard panel.
 */
async function fetchUsage(): Promise<PlanUsage> {
  // Streaming input keeps the CLI open for control requests without sending a prompt.
  let release!: () => void;
  const idle = new Promise<void>((resolve) => (release = resolve));
  async function* noPrompt(): AsyncGenerator<SDKUserMessage> {
    await idle;
  }

  const q = query({
    prompt: noPrompt(),
    options: { settingSources: [], tools: [], persistSession: false, env: cliEnv() },
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), TIMEOUT_MS);
    });
    const res = await Promise.race([q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }), timeout]);
    const limits = res.rate_limits;
    if (!res.rate_limits_available || !limits) return { available: false };

    const toWindow = (label: string, w: { utilization: number | null; resets_at: string | null } | null | undefined): UsageWindow | null =>
      w && w.utilization != null ? { label, percent: Math.round(w.utilization), resetsAt: w.resets_at } : null;

    const weekly = [
      toWindow("All models", limits.seven_day),
      ...(limits.model_scoped ?? []).map((m) => toWindow(m.display_name, m)),
    ].filter((w): w is UsageWindow => w !== null);
    return { available: true, plan: res.subscription_type, session: toWindow("Current session", limits.five_hour), weekly };
  } catch (err) {
    console.error(`[usage] Could not read plan usage: ${err instanceof Error ? err.message : String(err)}`);
    return { available: false };
  } finally {
    clearTimeout(timer);
    release();
    q.close();
  }
}

/** `refresh` skips the cache, for right after Claude answers. */
export function getUsage(refresh = false): Promise<PlanUsage> {
  if (!cached || refresh || Date.now() - cached.at > CACHE_MS) cached = { at: Date.now(), value: fetchUsage() };
  return cached.value;
}
