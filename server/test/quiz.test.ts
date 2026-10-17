import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDraft, parseRecall, RecallFilter, shuffleDraft } from "../src/quiz.js";
import { publicQuiz, QuizStore, tally, type SavedQuestion } from "../src/quiz-store.js";

const draft = {
  topic: "Caching",
  level: "intermediate" as const,
  question: "Where should a read-heavy service cache?",
  choices: ["In front of the database", "Inside the load balancer", "On the client only"] as [string, string, string],
  answer: "A" as const,
};

const question = (over: Partial<SavedQuestion> = {}): SavedQuestion => ({
  id: "q1",
  ...draft,
  attempts: 0,
  phase: "answer",
  messages: [],
  createdAt: new Date().toISOString(),
  ...over,
});

describe("parseDraft", () => {
  it("reads plain JSON", () => {
    expect(parseDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it("tolerates code fences, letter labels, and a lowercase answer", () => {
    const text = "```json\n" + JSON.stringify({ ...draft, choices: draft.choices.map((c, i) => `${"ABC"[i]}. ${c}`), answer: "a" }) + "\n```";
    expect(parseDraft(text)).toEqual(draft);
  });

  it("rejects replies without a valid question", () => {
    expect(parseDraft("Sure! Here's a question about caching.")).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, choices: ["one", "two"] }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, answer: "D" }))).toBeNull();
  });
});

describe("shuffleDraft", () => {
  it("keeps the answer pointing at the same choice text", () => {
    for (let seed = 0; seed < 20; seed++) {
      let s = seed;
      const random = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
      const out = shuffleDraft(draft, random);
      expect([...out.choices].sort()).toEqual([...draft.choices].sort());
      expect(out.choices["ABC".indexOf(out.answer)]).toBe("In front of the database");
    }
  });
});

describe("parseRecall", () => {
  it("reads and strips the verdict", () => {
    expect(parseRecall("Solid explanation.\n<recall>accept</recall>")).toEqual({ verdict: "accept", text: "Solid explanation." });
    expect(parseRecall("Not quite.\n<recall> Retry </recall>")).toEqual({ verdict: "retry", text: "Not quite." });
  });

  it("treats a missing tag as retry", () => {
    expect(parseRecall("Hmm.").verdict).toBe("retry");
  });
});

describe("RecallFilter", () => {
  it("never forwards the tag, even split across chunks", () => {
    const f = new RecallFilter();
    const out = ["That's solid. ", "Next time <", "rec", "all>accept</recall>"].map((c) => f.feed(c)).join("");
    expect(out).toBe("That's solid. Next time ");
  });

  it("forwards a < that is not the tag", () => {
    const f = new RecallFilter();
    expect(f.feed("p99 <") + f.feed(" 100 ms")).toBe("p99 < 100 ms");
  });
});

describe("tally and publicQuiz", () => {
  it("scores only first-try right answers", () => {
    const qs = [
      question({ id: "a", attempts: 1, phase: "done" }),
      question({ id: "b", attempts: 3, phase: "explain" }),
      question({ id: "c", attempts: 1, phase: "answer" }),
      question({ id: "d" }),
    ];
    expect(tally(qs)).toEqual({ score: 1, answered: 3 });
  });

  it("hides the answer until the student picks it", () => {
    const meta = { id: "x", level: "beginner" as const, createdAt: "", updatedAt: "", score: 0, answered: 0 };
    const view = publicQuiz({ meta, questions: [question({ id: "a", phase: "explain", attempts: 1 }), question({ id: "b" })] });
    expect(view.questions[0].answer).toBe("A");
    expect(view.questions[1]).not.toHaveProperty("answer");
  });
});

describe("QuizStore", () => {
  let root: string;
  let store: QuizStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "sdp-quiz-"));
    store = new QuizStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates, updates, lists, and trashes a quiz", async () => {
    const a = await store.create("advanced");
    const b = await store.create("advanced");
    expect(a.meta.id).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}_advanced$/);
    expect(b.meta.id).toBe(`${a.meta.id}-2`);

    const updated = await store.update(a.meta.id, (q) => {
      q.questions.push(question({ attempts: 1, phase: "done" }));
    });
    expect(updated.meta).toMatchObject({ score: 1, answered: 1 });
    expect((await store.read(a.meta.id)).questions).toHaveLength(1);
    expect((await store.list()).map((q) => q.meta.id).sort()).toEqual([a.meta.id, b.meta.id].sort());

    await store.remove(a.meta.id);
    expect(existsSync(store.file(a.meta.id))).toBe(false);
    expect(existsSync(path.join(root, "trash", "quizzes", `${a.meta.id}.json`))).toBe(true);
  });

  it("rejects IDs that could escape the quizzes folder", () => {
    expect(() => store.file("../x")).toThrow(/Invalid quiz ID/);
  });
});
