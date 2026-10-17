import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { QuizChoice, QuizDetail, QuizLevel, QuizMeta, QuizQuestion } from "@sdp/shared";
import { atomicWrite, localIso, withLockRetry } from "./fsutil.js";
import { QuizFileSchema } from "./schemas.js";
import { ID_RE, StoreError, datePrefix } from "./store.js";

const isNotFound = (err: unknown) => (err as NodeJS.ErrnoException).code === "ENOENT";

export type SavedQuestion = QuizQuestion & { answer: QuizChoice };

/** A quiz as saved, with every question's answer. */
export type QuizFile = { meta: QuizMeta; questions: SavedQuestion[] };

/** Score and answered count, from the questions. */
export function tally(questions: QuizQuestion[]): Pick<QuizMeta, "score" | "answered"> {
  return {
    score: questions.filter((q) => q.attempts === 1 && q.phase !== "answer").length,
    answered: questions.filter((q) => q.attempts > 0).length,
  };
}

/** The quiz as the browser may see it: answers stay hidden until the student picks them. */
export function publicQuiz(quiz: QuizFile): QuizDetail {
  return {
    meta: quiz.meta,
    questions: quiz.questions.map(({ answer, ...q }) => (q.phase === "answer" ? q : { ...q, answer })),
  };
}

/** Reads and writes quizzes as `<root>/quizzes/<id>.json`. All writes for one quiz run one at a time. */
export class QuizStore {
  readonly quizzesDir: string;
  readonly trashDir: string;
  private queues = new Map<string, Promise<unknown>>();

  constructor(root: string) {
    this.quizzesDir = path.join(root, "quizzes");
    this.trashDir = path.join(root, "trash", "quizzes");
  }

  file(id: string): string {
    if (!ID_RE.test(id)) throw new StoreError("bad_request", "Invalid quiz ID");
    return path.join(this.quizzesDir, `${id}.json`);
  }

  private enqueue<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const settled = next.catch(() => undefined);
    this.queues.set(id, settled);
    void settled.then(() => {
      if (this.queues.get(id) === settled) this.queues.delete(id);
    });
    return next;
  }

  async read(id: string): Promise<QuizFile> {
    let raw: string;
    try {
      raw = await readFile(this.file(id), "utf8");
    } catch (err) {
      if (isNotFound(err)) throw new StoreError("not_found", `Quiz ${id} not found`);
      throw err;
    }
    return QuizFileSchema.parse(JSON.parse(raw));
  }

  /** Newest first. Quizzes that fail to parse are left out with a warning. */
  async list(): Promise<QuizFile[]> {
    await mkdir(this.quizzesDir, { recursive: true });
    const names = (await readdir(this.quizzesDir)).filter((n) => n.endsWith(".json") && ID_RE.test(n.slice(0, -5)));
    const quizzes = await Promise.all(
      names.map((n) =>
        this.read(n.slice(0, -5)).catch((err) => {
          console.warn(`[quiz] skipping ${n}: ${err instanceof Error ? err.message : err}`);
          return null;
        }),
      ),
    );
    return quizzes
      .filter((q): q is QuizFile => q !== null)
      .sort((a, b) => Date.parse(b.meta.createdAt) - Date.parse(a.meta.createdAt));
  }

  async create(level: QuizLevel): Promise<QuizFile> {
    await mkdir(this.quizzesDir, { recursive: true });
    const now = new Date();
    const base = `${datePrefix(now)}_${level}`;
    const meta: QuizMeta = { id: base, level, createdAt: localIso(now), updatedAt: localIso(now), score: 0, answered: 0 };
    for (let n = 2; ; n++) {
      const quiz: QuizFile = { meta, questions: [] };
      try {
        // "wx" claims the name, so two quizzes started in the same minute get -2, -3.
        await writeFile(this.file(meta.id), JSON.stringify(quiz, null, 2), { flag: "wx" });
        return quiz;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        meta.id = `${base}-${n}`;
      }
    }
  }

  /** Applies `fn` to the saved quiz, then refreshes the score and saves it. */
  update(id: string, fn: (quiz: QuizFile) => QuizFile | void): Promise<QuizFile> {
    return this.enqueue(id, async () => {
      const current = await this.read(id);
      const next = fn(current) ?? current;
      next.meta = { ...next.meta, ...tally(next.questions), id, updatedAt: localIso() };
      await atomicWrite(this.file(id), JSON.stringify(next, null, 2));
      return next;
    });
  }

  /** Moves the quiz file into trash/quizzes/ instead of deleting it. */
  remove(id: string): Promise<void> {
    const from = this.file(id);
    return this.enqueue(id, async () => {
      await stat(from).catch((err) => {
        throw isNotFound(err) ? new StoreError("not_found", `Quiz ${id} not found`) : err;
      });
      await mkdir(this.trashDir, { recursive: true });
      let to = path.join(this.trashDir, `${id}.json`);
      if (await stat(to).then(() => true, () => false)) to = path.join(this.trashDir, `${id}-${Date.now()}.json`);
      await withLockRetry(() => rename(from, to));
    });
  }
}
