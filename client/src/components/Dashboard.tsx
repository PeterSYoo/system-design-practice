import { useEffect } from "react";
import { ArrowRight, Home, ListChecks, PenTool } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import UsagePanel from "@/components/UsagePanel";
import { useQuiz } from "@/quiz-state";
import { useApp } from "@/state";

const plural = (n: number, word: string, words = `${word}s`) => `${n} ${n === 1 ? word : words}`;

function ModeCard({
  icon,
  title,
  body,
  stat,
  onOpen,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  stat: string;
  onOpen(): void;
}) {
  return (
    <button
      onClick={onOpen}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-5 text-left shadow-xs transition-colors outline-none hover:border-primary/50 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      <div className="mt-auto flex items-center justify-between pt-2 text-xs text-muted-foreground">
        <span>{stat}</span>
        <span className="flex items-center gap-1 font-medium text-primary">
          Open <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}

/** The first screen: pick diagram practice or the multiple choice quiz. */
export default function Dashboard() {
  const sessions = useApp((s) => s.sessions);
  const enterPractice = useApp((s) => s.enterPractice);
  const enterQuiz = useApp((s) => s.enterQuiz);
  const quizzes = useQuiz((s) => s.quizzes);
  const refreshQuizzes = useQuiz((s) => s.refresh);

  useEffect(() => {
    void refreshQuizzes();
  }, [refreshQuizzes]);

  const sessionCount = sessions.filter((s) => !("unreadable" in s)).length;
  const score = quizzes.reduce((n, q) => n + q.score, 0);
  const answered = quizzes.reduce((n, q) => n + q.answered, 0);
  const quizStat = quizzes.length
    ? `${plural(quizzes.length, "quiz", "quizzes")}${answered ? ` · ${score}/${answered} right first try` : ""}`
    : "No quizzes yet";

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-4 py-10">
      <div className="w-full max-w-2xl space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">System Design Practice</h1>
          <p className="text-sm text-muted-foreground">Pick how you want to practice today.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <ModeCard
            icon={<PenTool className="size-5" />}
            title="Diagram practice"
            body="Claude asks an interview question, you draw your design on the canvas, and Claude reviews it."
            stat={sessionCount ? plural(sessionCount, "session") : "No sessions yet"}
            onOpen={() => void enterPractice()}
          />
          <ModeCard
            icon={<ListChecks className="size-5" />}
            title="Multiple choice quiz"
            body="Answer A, B, or C. Miss one and you get a hint, not the answer. Then explain the idea in your own words."
            stat={quizStat}
            onOpen={enterQuiz}
          />
        </div>
        <UsagePanel variant="card" />
      </div>
    </div>
  );
}

/** Back to the dashboard, for the top of each sidebar. */
export function HomeButton({ disabled }: { disabled?: boolean }) {
  const goHome = useApp((s) => s.goHome);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={() => void goHome()} disabled={disabled} aria-label="Home">
          <Home />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">Home</TooltipContent>
    </Tooltip>
  );
}
