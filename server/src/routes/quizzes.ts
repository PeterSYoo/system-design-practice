import { Hono, type Context } from "hono";
import type { QuizChoice, QuizStreamEvent } from "@sdp/shared";
import { quizStore } from "../app-store.js";
import { claudeErrorEvent } from "../claude.js";
import { parseRecall, quizMessage, RecallFilter, tutorTurn, writeQuestion } from "../quiz.js";
import { quizChatPrompt, quizHintPrompt, quizRecallPrompt } from "../quiz-prompts.js";
import { publicQuiz, type QuizFile, type SavedQuestion } from "../quiz-store.js";
import { MessageBodySchema, NewQuizBodySchema, QuizAnswerBodySchema } from "../schemas.js";
import { sseJob, tryLock, unlock, type Emit } from "../sse.js";
import { StoreError } from "../store.js";
import { errorResponse } from "./errors.js";

export const quizzes = new Hono();

type QuizEmit = Emit<QuizStreamEvent>;

const lockKey = (id: string) => `quiz:${id}`;

/** Checks the quiz exists and takes its Claude lock. Returns an error response, or null to go ahead. */
async function begin(c: Context, id: string): Promise<Response | null> {
  try {
    await quizStore.read(id);
  } catch (err) {
    return errorResponse(c, err);
  }
  if (!tryLock(lockKey(id))) return c.json({ message: "Claude is still answering the previous request.", code: "bad_request" }, 409);
  return null;
}

/** Runs a quiz job under the quiz's lock, which `begin` took. */
function job(c: Context, id: string, run: (emit: QuizEmit) => Promise<void>): Response {
  return sseJob<QuizStreamEvent>(c, async (emit) => {
    try {
      await run(emit);
    } finally {
      unlock(lockKey(id));
    }
  });
}

const current = (quiz: QuizFile): SavedQuestion | undefined => quiz.questions.at(-1);

/** Applies `fn` to the question with this ID and saves the quiz. */
function updateQuestion(id: string, questionId: string, fn: (q: SavedQuestion) => void): Promise<QuizFile> {
  return quizStore.update(id, (quiz) => {
    const q = quiz.questions.find((x) => x.id === questionId);
    if (!q) throw new StoreError("not_found", "Question not found");
    fn(q);
  });
}

/** Streams one tutor reply and returns its text, or null after sending an error event. */
async function streamTutor(prompt: string, emit: QuizEmit, filter?: RecallFilter): Promise<string | null> {
  try {
    let text = "";
    for await (const ev of tutorTurn(quizStore.quizzesDir, prompt)) {
      if (ev.type === "delta") {
        const forward = filter ? filter.feed(ev.text) : ev.text;
        if (forward) emit("delta", { text: forward });
      } else if (ev.type === "done") {
        text = ev.text;
      }
    }
    return text;
  } catch (err) {
    emit("error", claudeErrorEvent(err));
    return null;
  }
}

/** Writes a question and appends it to the quiz. */
async function addQuestion(id: string, emit: QuizEmit): Promise<void> {
  emit("status", { text: "Writing a question…" });
  const [quiz, all] = await Promise.all([quizStore.read(id), quizStore.list()]);
  const recentTopics = all
    .filter((q) => q.meta.id !== id)
    .flatMap((q) => q.questions.map((x) => x.topic).reverse())
    .slice(0, 15);
  const question = await writeQuestion(quizStore.quizzesDir, {
    level: quiz.meta.level,
    questions: quiz.questions,
    recentTopics,
  });
  const updated = await quizStore.update(id, (q) => {
    q.questions.push(question);
  });
  emit("done", { quiz: publicQuiz(updated) });
}

quizzes.get("/", async (c) => {
  try {
    return c.json((await quizStore.list()).map((q) => q.meta));
  } catch (err) {
    return errorResponse(c, err);
  }
});

quizzes.post("/", async (c) => {
  let level: QuizFile["meta"]["level"];
  try {
    level = NewQuizBodySchema.parse(await c.req.json()).level;
  } catch (err) {
    return errorResponse(c, err);
  }
  return sseJob<QuizStreamEvent>(c, async (emit) => {
    const quiz = await quizStore.create(level);
    const id = quiz.meta.id;
    tryLock(lockKey(id));
    try {
      emit("quiz", { meta: quiz.meta });
      await addQuestion(id, emit);
    } catch (err) {
      // A quiz with no question is useless; move it to the trash.
      await quizStore.remove(id).catch(() => undefined);
      emit("error", claudeErrorEvent(err));
    } finally {
      unlock(lockKey(id));
    }
  });
});

quizzes.get("/:id", async (c) => {
  try {
    return c.json(publicQuiz(await quizStore.read(c.req.param("id"))));
  } catch (err) {
    return errorResponse(c, err);
  }
});

quizzes.delete("/:id", async (c) => {
  try {
    await quizStore.remove(c.req.param("id"));
    return c.json({ ok: true });
  } catch (err) {
    return errorResponse(c, err);
  }
});

quizzes.post("/:id/next", async (c) => {
  const id = c.req.param("id");
  const blocked = await begin(c, id);
  if (blocked) return blocked;
  return job(c, id, async (emit) => {
    const q = current(await quizStore.read(id));
    if (q && q.phase !== "done") {
      emit("error", { message: "Finish this question before moving on.", code: "bad_request" });
      return;
    }
    try {
      await addQuestion(id, emit);
    } catch (err) {
      emit("error", claudeErrorEvent(err));
    }
  });
});

quizzes.post("/:id/answer", async (c) => {
  const id = c.req.param("id");
  let choice: QuizChoice;
  try {
    choice = QuizAnswerBodySchema.parse(await c.req.json()).choice;
  } catch (err) {
    return errorResponse(c, err);
  }
  const blocked = await begin(c, id);
  if (blocked) return blocked;

  return job(c, id, async (emit) => {
    const q = current(await quizStore.read(id));
    if (!q || q.phase !== "answer") {
      emit("error", { message: "There is no question waiting for an answer.", code: "bad_request" });
      return;
    }
    const attempts = q.attempts + 1;
    const pick = quizMessage("user", "pick", `Picked ${choice}`, choice);

    if (choice === q.answer) {
      const tries = attempts === 1 ? "" : ` It took ${attempts} attempts, so this one doesn't count toward your score.`;
      const reply = quizMessage(
        "assistant",
        "correct",
        `**Correct, it's ${choice}.**${tries}\n\nNow explain why that's the right answer, in your own words, as if teaching someone.`,
      );
      const updated = await updateQuestion(id, q.id, (x) => {
        x.attempts = attempts;
        x.phase = "explain";
        x.messages.push(pick, reply);
      });
      emit("done", { quiz: publicQuiz(updated) });
      return;
    }

    // Nothing is saved unless the hint arrives, so a retry after an error doesn't count twice.
    const hint = await streamTutor(quizHintPrompt({ ...q, attempts }, choice), emit);
    if (hint === null) return;
    const updated = await updateQuestion(id, q.id, (x) => {
      x.attempts = attempts;
      x.messages.push(pick, quizMessage("assistant", "hint", hint));
    });
    emit("done", { quiz: publicQuiz(updated) });
  });
});

quizzes.post("/:id/messages", async (c) => {
  const id = c.req.param("id");
  let text: string;
  try {
    text = MessageBodySchema.parse(await c.req.json()).text;
  } catch (err) {
    return errorResponse(c, err);
  }
  const blocked = await begin(c, id);
  if (blocked) return blocked;

  return job(c, id, async (emit) => {
    const q = current(await quizStore.read(id));
    if (!q) {
      emit("error", { message: "This quiz has no question yet.", code: "bad_request" });
      return;
    }

    if (q.phase === "explain") {
      const reply = await streamTutor(quizRecallPrompt(q, text), emit, new RecallFilter());
      if (reply === null) return;
      const { verdict, text: feedback } = parseRecall(reply);
      const updated = await updateQuestion(id, q.id, (x) => {
        x.messages.push(quizMessage("user", "explanation", text), quizMessage("assistant", "feedback", feedback));
        if (verdict === "accept") x.phase = "done";
      });
      emit("done", { quiz: publicQuiz(updated) });
      return;
    }

    const reply = await streamTutor(quizChatPrompt(q, text), emit);
    if (reply === null) return;
    const updated = await updateQuestion(id, q.id, (x) => {
      x.messages.push(quizMessage("user", "chat", text), quizMessage("assistant", "chat", reply));
    });
    emit("done", { quiz: publicQuiz(updated) });
  });
});
