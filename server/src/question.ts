import { randomUUID } from "node:crypto";
import type { ChatMessage, Difficulty, SessionMeta } from "@sdp/shared";
import { store } from "./app-store.js";
import { askClaude } from "./claude.js";
import { localIso } from "./fsutil.js";
import { questionPrompt } from "./prompts.js";
import type { Emit } from "./sse.js";

const cleanTitle = (t: string) =>
  t
    .replace(/[*_`#"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

const firstWords = (text: string, n: number) => cleanTitle(text.split(/\s+/).filter(Boolean).slice(0, n).join(" "));

/**
 * Splits a reply into its TITLE: line and the question. Returns null while more text is needed
 * to decide (streaming); pass `final` once the reply is complete.
 */
export function parseQuestion(text: string, final = false): { title: string; body: string } | null {
  const start = text.replace(/^\s+/, "");
  const m = /^\**TITLE:\**[ \t]*(.*?)\r?\n/i.exec(start);
  if (m) {
    const title = cleanTitle(m[1]);
    const body = start.slice(m[0].length).replace(/^\s+/, "");
    return { title: title || firstWords(body, 6) || "System design question", body };
  }
  // Still possibly the start of a TITLE line.
  if (!final && /^\**t(i(t(l(e(:.*)?)?)?)?)?$/i.test(start.split("\n")[0])) return null;
  // No title line: use the first six words of the reply.
  if (!final && start.split(/\s+/).filter(Boolean).length < 7) return null;
  if (final && /^\**TITLE:/i.test(start)) {
    // Title with no question after it.
    return { title: cleanTitle(start.replace(/^\**TITLE:\**/i, "")) || "System design question", body: "" };
  }
  return { title: firstWords(start, 6) || "System design question", body: start };
}

/**
 * Asks Claude for a question and creates the session once the title is known, so the folder
 * name carries the title's slug. Streams the question text after the `session` event.
 */
export async function createSessionWithQuestion(
  input: { topic?: string; difficulty?: Difficulty },
  emit: Emit,
): Promise<void> {
  const recentTitles = (await store.list())
    .filter((s): s is SessionMeta => !("unreadable" in s))
    .slice(0, 10)
    .map((s) => s.title);
  const difficulty = input.difficulty ?? "medium";
  const prompt = questionPrompt({ topic: input.topic, difficulty, recentTitles });

  let raw = "";
  let claudeSessionId: string | undefined;
  let meta: SessionMeta | null = null;
  let sentBody = 0;

  const ensureSession = async (final: boolean) => {
    if (meta) return;
    const parsed = parseQuestion(raw, final);
    if (!parsed) return;
    meta = await store.create({ title: parsed.title, difficulty });
    if (claudeSessionId) meta = await store.updateMeta(meta.id, { claudeSessionId });
    emit("session", { meta });
  };

  const flushBody = () => {
    const parsed = meta && parseQuestion(raw, true);
    if (!parsed || parsed.body.length <= sentBody) return;
    emit("delta", { text: parsed.body.slice(sentBody) });
    sentBody = parsed.body.length;
  };

  try {
    for await (const ev of askClaude({ prompt, cwd: store.sessionsDir, sessionDir: store.sessionsDir, tools: [], maxTurns: 1 })) {
      if (ev.type === "session") {
        claudeSessionId = ev.id;
        if (meta) meta = await store.updateMeta((meta as SessionMeta).id, { claudeSessionId });
      } else if (ev.type === "delta") {
        raw += ev.text;
        await ensureSession(false);
        flushBody();
      } else if (ev.type === "done") {
        raw = ev.text || raw;
        claudeSessionId = ev.sessionId || claudeSessionId;
      }
    }
    await ensureSession(true);
    flushBody();
  } catch (err) {
    // A half-made session with no question is useless; move it to the trash.
    if (meta) await store.remove((meta as SessionMeta).id).catch(() => undefined);
    throw err;
  }

  const created = meta as SessionMeta | null;
  if (!created) throw new Error("Claude returned an empty question.");
  const { body } = parseQuestion(raw, true)!;
  const message: ChatMessage = { id: randomUUID(), role: "assistant", kind: "question", text: body, createdAt: localIso() };
  await store.setQuestion(created.id, body);
  await store.appendMessages(created.id, message);
  const finalMeta = await store.updateMeta(created.id, { claudeSessionId });
  emit("done", { message, meta: finalMeta });
}
