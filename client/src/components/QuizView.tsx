import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, SendHorizontal, X } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { QUIZ_CHOICES, QUIZ_LEVELS, type QuizChoice, type QuizLevel, type QuizQuestion } from "@sdp/shared";
import { ErrorBubble } from "@/components/MessageBubble";
import ModelPicker from "@/components/ModelPicker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { currentQuestion, LEVEL_LABEL, useQuiz } from "@/quiz-state";

const LEVEL_BLURB: Record<QuizLevel, string> = {
  beginner: "Core building blocks: caching, load balancers, SQL vs NoSQL.",
  intermediate: "Trade-offs: replication, sharding, queues, consistency.",
  advanced: "Edge cases: consensus, distributed transactions, failure modes.",
};

/** Setup: the student picks a level before the first question. */
function LevelPicker() {
  const create = useQuiz((s) => s.create);
  const error = useQuiz((s) => s.error);
  const busy = useQuiz((s) => s.streaming !== null);
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-4 py-10">
      <div className="w-full max-w-xl space-y-6">
        <div className="space-y-2 text-center">
          <h2 className="text-xl font-semibold">Which level do you want to start at?</h2>
          <p className="text-sm text-muted-foreground">
            Questions stay near this level and shift up or down as you go. Only a right answer on the first try scores
            a point.
          </p>
        </div>
        <div className="grid gap-3">
          {QUIZ_LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => void create(level)}
              disabled={busy}
              className="group flex items-center gap-4 rounded-xl border bg-card px-4 py-3 text-left shadow-xs transition-colors outline-none hover:border-primary/50 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60"
            >
              <div className="flex-1">
                <div className="text-sm font-semibold">{LEVEL_LABEL[level]}</div>
                <div className="text-sm text-muted-foreground">{LEVEL_BLURB[level]}</div>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
        {error && <ErrorBubble message={error.message} onRetry={error.retry} />}
      </div>
    </div>
  );
}

const TutorBubble = memo(function TutorBubble({
  role,
  text,
  tone,
  streaming,
}: {
  role: "user" | "assistant";
  text: string;
  tone?: "correct";
  streaming?: boolean;
}) {
  const mine = role === "user";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3 py-2 text-sm",
          mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
          tone === "correct" && "border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/40",
        )}
      >
        {mine ? (
          <p className="whitespace-pre-wrap">{text}</p>
        ) : (
          <div className={cn("markdown", streaming && "streaming-cursor")}>
            <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
});

function resultLabel(q: QuizQuestion): string | null {
  if (q.phase === "answer") return q.attempts ? `${q.attempts} wrong so far` : null;
  return q.attempts === 1 ? "Right first try" : `Right on attempt ${q.attempts}`;
}

function QuestionCard({ q, n, live }: { q: QuizQuestion; n: number; live: boolean }) {
  const answer = useQuiz((s) => s.answer);
  const streaming = useQuiz((s) => (live ? s.streaming : null));
  const picked = new Set(q.messages.flatMap((m) => (m.kind === "pick" && m.choice ? [m.choice] : [])));
  const canPick = live && q.phase === "answer" && !streaming;
  const result = resultLabel(q);

  return (
    <section className="space-y-3">
      <div className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Question {n}</span>
          <span>·</span>
          <span>{q.topic}</span>
          <span>·</span>
          <span>{LEVEL_LABEL[q.level]}</span>
          {result && (
            <span
              className={cn(
                "ml-auto rounded-full border px-2 py-0.5",
                q.phase !== "answer" && q.attempts === 1 && "border-emerald-500/50 text-emerald-700 dark:text-emerald-300",
              )}
            >
              {result}
            </span>
          )}
        </div>
        <div className="markdown text-sm">
          <Markdown remarkPlugins={[remarkGfm]}>{q.question}</Markdown>
        </div>
        <div className="grid gap-2" role="group" aria-label={`Choices for question ${n}`}>
          {QUIZ_CHOICES.map((letter: QuizChoice, i) => {
            const right = q.answer === letter;
            const wrong = q.answer !== undefined && !right && picked.has(letter);
            const sending = streaming?.sent?.choice === letter;
            return (
              <button
                key={letter}
                disabled={!canPick}
                onClick={() => void answer(letter)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  canPick && "hover:border-primary/50 hover:bg-accent/50",
                  !canPick && "cursor-default",
                  right && "border-emerald-500/60 bg-emerald-50 dark:bg-emerald-950/40",
                  q.answer !== undefined && !right && "text-muted-foreground",
                  sending && "border-primary ring-2 ring-primary/30",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-semibold",
                    right && "border-emerald-600 bg-emerald-600 text-white",
                  )}
                >
                  {right ? <Check className="size-3.5" /> : wrong ? <X className="size-3.5" /> : letter}
                </span>
                <span className="pt-0.5">{q.choices[i]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {q.messages.map((m) =>
        m.kind === "pick" ? (
          <TutorBubble key={m.id} role="user" text={`${m.choice}. ${q.choices[QUIZ_CHOICES.indexOf(m.choice!)]}`} />
        ) : (
          <TutorBubble key={m.id} role={m.role} text={m.text} tone={m.kind === "correct" ? "correct" : undefined} />
        ),
      )}
      {streaming?.kind === "reply" && (
        <>
          {streaming.sent && (
            <TutorBubble
              role="user"
              text={
                streaming.sent.choice
                  ? `${streaming.sent.choice}. ${q.choices[QUIZ_CHOICES.indexOf(streaming.sent.choice)]}`
                  : streaming.sent.text
              }
            />
          )}
          {streaming.text ? (
            <TutorBubble role="assistant" text={streaming.text} streaming />
          ) : (
            <Thinking text="Thinking…" />
          )}
        </>
      )}
    </section>
  );
}

function Thinking({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
      <Loader2 className="size-3.5 animate-spin" />
      {text}
    </div>
  );
}

const PLACEHOLDER = {
  answer: "Pick A, B, or C above, or ask a question…",
  explain: "Explain why that's right, in your own words…",
  done: "Ask a follow-up, or type next…",
} as const;

export default function QuizView() {
  const quiz = useQuiz((s) => s.quiz);
  const loading = useQuiz((s) => s.loading);
  const streaming = useQuiz((s) => s.streaming);
  const error = useQuiz((s) => s.error);
  const send = useQuiz((s) => s.send);
  const next = useQuiz((s) => s.next);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const q = currentQuestion(quiz);
  const phase = q?.phase;

  const onScroll = () => {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [quiz, streaming, error]);
  useEffect(() => {
    stickToBottom.current = true;
  }, [quiz?.meta.id]);

  // Free recall comes right after the right pick: put the cursor in the box.
  useEffect(() => {
    if (phase === "explain") inputRef.current?.focus();
  }, [phase, q?.id]);

  if (loading && !quiz) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (!quiz) return <LevelPicker />;

  const submit = () => {
    const text = draft.trim();
    if (!text || streaming || !q) return;
    stickToBottom.current = true;
    setDraft("");
    void send(text);
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="box-content flex h-11 shrink-0 items-center gap-3 border-b px-4">
        <span className="text-sm font-semibold">{LEVEL_LABEL[quiz.meta.level]} quiz</span>
        {q && <span className="text-xs text-muted-foreground">Question {quiz.questions.length}</span>}
        <span className="ml-auto rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium" aria-live="polite">
          Score {quiz.meta.score}/{quiz.meta.answered}
        </span>
        <ModelPicker />
      </div>

      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-8 px-4 py-6">
          {quiz.questions.map((x, i) => (
            <QuestionCard key={x.id} q={x} n={i + 1} live={i === quiz.questions.length - 1} />
          ))}
          {streaming?.kind === "question" && <Thinking text={streaming.status ?? "Writing a question…"} />}
          {error && <ErrorBubble message={error.message} onRetry={error.retry} />}
        </div>
      </div>

      <div className="shrink-0 border-t">
        <div className="mx-auto max-w-2xl space-y-2 px-4 py-3">
          {phase === "done" && !streaming && (
            <Button className="w-full" onClick={() => void next()}>
              Next question <ArrowRight />
            </Button>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={2}
              disabled={!q}
              placeholder={phase ? PLACEHOLDER[phase] : "Waiting for the first question…"}
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
            <Button size="icon" variant="outline" onClick={submit} disabled={!draft.trim() || !!streaming || !q} aria-label="Send">
              <SendHorizontal />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
