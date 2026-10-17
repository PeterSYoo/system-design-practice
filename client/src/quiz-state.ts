import { create } from "zustand";
import type { QuizChoice, QuizDetail, QuizLevel, QuizMeta, QuizStreamEvent } from "@sdp/shared";
import { api, quizStreams, readStream } from "./api";
import { useApp, type StreamFailure } from "./state";

/** A request in flight. `sent` is what the student just did, shown until the reply is saved. */
type QuizStreaming = {
  kind: "question" | "reply";
  text: string;
  status?: string;
  sent?: { choice?: QuizChoice; text: string };
} | null;

type QuizState = {
  quizzes: QuizMeta[];
  currentId: string | null;
  quiz: QuizDetail | null;
  loading: boolean;
  streaming: QuizStreaming;
  error: StreamFailure | null;
};

type QuizActions = {
  refresh(): Promise<void>;
  /** Called when the quiz view opens: reloads the open quiz, if any. */
  enter(): Promise<void>;
  open(id: string): Promise<void>;
  /** Clears the open quiz, which shows the level picker. */
  close(): void;
  create(level: QuizLevel): Promise<void>;
  next(): Promise<void>;
  answer(choice: QuizChoice): Promise<void>;
  send(text: string): Promise<void>;
  remove(id: string): Promise<void>;
};

export const LEVEL_LABEL: Record<QuizLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/** The question the student is on: the last one. */
export const currentQuestion = (quiz: QuizDetail | null) => quiz?.questions.at(-1) ?? null;

export const useQuiz = create<QuizState & QuizActions>((set, get) => {
  async function runStream(
    kind: NonNullable<QuizStreaming>["kind"],
    req: [string, RequestInit],
    sent: NonNullable<QuizStreaming>["sent"],
    retry: () => void,
  ) {
    const quizAtStart = get().currentId;
    set({ streaming: { kind, text: "", sent }, error: null });
    let failed: string | null = null;
    await readStream<QuizStreamEvent>(req, (e) => {
      switch (e.event) {
        case "quiz":
          set((s) => ({
            currentId: e.data.meta.id,
            quiz: { meta: e.data.meta, questions: [] },
            quizzes: [e.data.meta, ...s.quizzes.filter((q) => q.id !== e.data.meta.id)],
          }));
          break;
        case "delta":
          set((s) => ({ streaming: s.streaming && { ...s.streaming, text: s.streaming.text + e.data.text, status: undefined } }));
          break;
        case "status":
          set((s) => ({ streaming: s.streaming && { ...s.streaming, status: e.data.text } }));
          break;
        case "done": {
          const { quiz } = e.data;
          set((s) => ({
            quiz: s.currentId === quiz.meta.id ? quiz : s.quiz,
            quizzes: s.quizzes.map((q) => (q.id === quiz.meta.id ? quiz.meta : q)),
          }));
          break;
        }
        case "error":
          failed = e.data.message;
          if (e.data.code === "claude_auth") void useApp.getState().checkHealth(true);
          break;
      }
    });
    // A quiz whose first question failed is moved to the trash by the server.
    if (failed && kind === "question" && quizAtStart === null) {
      set({ currentId: null, quiz: null });
      void get().refresh();
    }
    set({ streaming: null, error: failed ? { message: failed, retry } : null });
  }

  return {
    quizzes: [],
    currentId: null,
    quiz: null,
    loading: false,
    streaming: null,
    error: null,

    async refresh() {
      try {
        set({ quizzes: await api.listQuizzes() });
      } catch {
        // keep the old list
      }
    },

    async enter() {
      await get().refresh();
      const id = get().currentId;
      if (id && !get().streaming) await get().open(id).catch(() => undefined);
    },

    async open(id) {
      if (get().streaming) return;
      set({ loading: true, currentId: id, error: null });
      try {
        const quiz = await api.getQuiz(id);
        if (get().currentId === id) set({ quiz, loading: false });
      } catch (err) {
        set({ loading: false, currentId: null, quiz: null });
        await get().refresh();
        throw err;
      }
    },

    close() {
      if (get().streaming) return;
      set({ currentId: null, quiz: null, error: null });
    },

    async create(level) {
      if (get().streaming) return;
      set({ currentId: null, quiz: null });
      await runStream("question", quizStreams.create({ level }), undefined, () => void get().create(level));
    },

    async next() {
      const id = get().currentId;
      if (!id || get().streaming) return;
      await runStream("question", quizStreams.next(id), undefined, () => void get().next());
    },

    async answer(choice) {
      const id = get().currentId;
      if (!id || get().streaming) return;
      await runStream("reply", quizStreams.answer(id, choice), { choice, text: `Picked ${choice}` }, () => void get().answer(choice));
    },

    async send(text) {
      const id = get().currentId;
      if (!id || get().streaming) return;
      if (/^next[.!]?$/i.test(text.trim()) && currentQuestion(get().quiz)?.phase === "done") return get().next();
      await runStream("reply", quizStreams.message(id, text), { text }, () => void get().send(text));
    },

    async remove(id) {
      await api.deleteQuiz(id);
      if (get().currentId === id) set({ currentId: null, quiz: null, error: null });
      await get().refresh();
    },
  };
});
