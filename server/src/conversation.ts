import { askClaude, ClaudeError, type ClaudeEvent } from "./claude.js";
import { store } from "./app-store.js";
import { reseedPrompt } from "./prompts.js";

const HISTORY_ON_RESEED = 20;

/**
 * One Claude turn inside a practice session. Resumes the session's Claude conversation, and when
 * the CLI no longer has it, starts a new one seeded with the question and recent chat.
 * Saves the Claude session ID to meta.json when a turn completes on a new one.
 */
export async function* converse(sessionId: string, prompt: string, tools?: string[]): AsyncGenerator<ClaudeEvent> {
  const meta = await store.getMeta(sessionId);
  const base = { cwd: store.sessionsDir, sessionDir: store.dir(sessionId), tools };

  async function* run(p: string, resume?: string): AsyncGenerator<ClaudeEvent> {
    for await (const ev of askClaude({ ...base, prompt: p, claudeSessionId: resume })) {
      // Save the ID only once a turn completes, so a failed attempt never replaces a working conversation.
      if (ev.type === "done" && ev.sessionId && ev.sessionId !== meta.claudeSessionId) {
        meta.claudeSessionId = ev.sessionId;
        await store.updateMeta(sessionId, { claudeSessionId: ev.sessionId });
      }
      yield ev;
    }
  }

  if (!meta.claudeSessionId) {
    yield* run(await seeded(sessionId, prompt));
    return;
  }
  try {
    yield* run(prompt, meta.claudeSessionId);
  } catch (err) {
    if (!(err instanceof ClaudeError && err.lostSession)) throw err;
    console.warn(`[claude] conversation ${meta.claudeSessionId} is gone; starting a new one for ${sessionId}`);
    yield* run(await seeded(sessionId, prompt));
  }
}

async function seeded(sessionId: string, prompt: string): Promise<string> {
  const [question, chat] = await Promise.all([store.readQuestion(sessionId), store.readChat(sessionId)]);
  const history = chat.filter((m) => m.kind !== "question").slice(-HISTORY_ON_RESEED);
  return `${reseedPrompt({ question, history })}\n\n${prompt}`;
}
