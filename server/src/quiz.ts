import { randomUUID } from "node:crypto";
import { QUIZ_CHOICES, type QuizChoice, type QuizLevel } from "@sdp/shared";
import { askClaude, askOnce, type AskOptions, type ClaudeEvent } from "./claude.js";
import { localIso } from "./fsutil.js";
import { quizQuestionPrompt, TUTOR_SYSTEM_PROMPT } from "./quiz-prompts.js";
import type { SavedQuestion } from "./quiz-store.js";
import { DraftQuestionSchema } from "./schemas.js";

type Draft = Pick<SavedQuestion, "topic" | "level" | "question" | "choices" | "answer">;

/** Reads Claude's question JSON, tolerating code fences and stray "A." labels. Null when it doesn't parse. */
export function parseDraft(text: string): Draft | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (raw && typeof raw === "object" && "answer" in raw && typeof raw.answer === "string") {
    (raw as { answer: string }).answer = raw.answer.trim().toUpperCase().replace(/[^ABC]/g, "");
  }
  const parsed = DraftQuestionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const choices = parsed.data.choices.map((c) => c.replace(/^\(?[A-C][.):]\s+/, "")) as Draft["choices"];
  return { ...parsed.data, choices };
}

/** Puts the choices in a random order, so the right answer isn't always where Claude tends to put it. */
export function shuffleDraft(d: Draft, random = Math.random): Draft {
  const order = [0, 1, 2];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const right = QUIZ_CHOICES.indexOf(d.answer);
  return {
    ...d,
    choices: order.map((i) => d.choices[i]) as Draft["choices"],
    answer: QUIZ_CHOICES[order.indexOf(right)],
  };
}

/** One tutor call: no tools, no saved conversation. Each prompt carries the context it needs. */
const tutorOptions = (cwd: string, prompt: string): AskOptions => ({
  prompt,
  cwd,
  sessionDir: cwd,
  systemPrompt: TUTOR_SYSTEM_PROMPT,
  tools: [],
  maxTurns: 1,
  persist: false,
});

/** Asks Claude for the next question, trying once more if the reply isn't valid JSON. */
export async function writeQuestion(
  cwd: string,
  opts: { level: QuizLevel; questions: SavedQuestion[]; recentTopics: string[] },
): Promise<SavedQuestion> {
  const prompt = quizQuestionPrompt(opts);
  let draft: Draft | null = null;
  for (let attempt = 0; attempt < 2 && !draft; attempt++) {
    const text = await askOnce(tutorOptions(cwd, prompt));
    draft = parseDraft(text);
    if (!draft) console.warn(`[quiz] question reply did not parse: ${text.slice(0, 300)}`);
  }
  if (!draft) throw new Error("Claude did not return a usable question. Try again.");
  return { id: randomUUID(), ...shuffleDraft(draft), attempts: 0, phase: "answer", messages: [], createdAt: localIso() };
}

/** Streams one tutor reply. */
export function tutorTurn(cwd: string, prompt: string): AsyncGenerator<ClaudeEvent> {
  return askClaude(tutorOptions(cwd, prompt));
}

const RECALL_TAG = /<recall>\s*(accept|retry)\s*<\/recall>/gi;

/** Splits the hidden verdict off a recall reply. A missing tag counts as retry. */
export function parseRecall(text: string): { verdict: "accept" | "retry"; text: string } {
  const verdicts = [...text.matchAll(RECALL_TAG)].map((m) => m[1].toLowerCase());
  const verdict = verdicts.at(-1) === "accept" ? "accept" : "retry";
  return { verdict, text: text.replace(RECALL_TAG, "").replace(/<\/?recall[^>]*>?/gi, "").trim() };
}

/** Holds back a trailing <recall> tag while a reply streams, so the student never sees it. */
export class RecallFilter {
  private text = "";
  private sent = 0;

  feed(chunk: string): string {
    this.text += chunk;
    const tag = this.text.indexOf("<recall");
    let safe = this.text.length;
    if (tag >= 0) safe = tag;
    else {
      const lt = this.text.lastIndexOf("<");
      if (lt >= 0 && "<recall".startsWith(this.text.slice(lt))) safe = lt;
    }
    if (safe <= this.sent) return "";
    const out = this.text.slice(this.sent, safe);
    this.sent = safe;
    return out;
  }
}

export const quizMessage = (
  role: "user" | "assistant",
  kind: SavedQuestion["messages"][number]["kind"],
  text: string,
  choice?: QuizChoice,
): SavedQuestion["messages"][number] => ({
  id: randomUUID(),
  role,
  kind,
  text,
  createdAt: localIso(),
  ...(choice ? { choice } : {}),
});
