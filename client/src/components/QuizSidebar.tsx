import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { QuizMeta } from "@sdp/shared";
import { HomeButton } from "@/components/Dashboard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { LEVEL_LABEL, useQuiz } from "@/quiz-state";

function when(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function QuizSidebar() {
  const quizzes = useQuiz((s) => s.quizzes);
  const currentId = useQuiz((s) => s.currentId);
  const busy = useQuiz((s) => s.streaming !== null);
  const open = useQuiz((s) => s.open);
  const close = useQuiz((s) => s.close);
  const remove = useQuiz((s) => s.remove);
  const [confirm, setConfirm] = useState<QuizMeta | null>(null);
  const [deleting, setDeleting] = useState(false);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="box-content flex h-11 items-center gap-1 border-b bg-background px-2">
        <HomeButton />
        <span className="text-sm font-semibold">Quizzes</span>
      </div>
      <div className="px-3 pt-3 pb-2">
        <Button variant="outline" className="w-full justify-start" onClick={close} disabled={busy}>
          <Plus /> New quiz
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <ul className="px-2 pb-3">
          {quizzes.map((q) => (
            <li key={q.id} className="group relative">
              <button
                className={cn(
                  "w-full rounded-md px-2 py-1.5 pr-8 text-left text-sm hover:bg-sidebar-accent disabled:opacity-60",
                  q.id === currentId && "bg-sidebar-accent font-medium",
                )}
                disabled={busy && q.id !== currentId}
                onClick={() => q.id !== currentId && void open(q.id)}
              >
                <div>{LEVEL_LABEL[q.level]} quiz</div>
                <div className="text-xs text-muted-foreground">
                  {when(q.createdAt)} · Score {q.score}/{q.answered}
                </div>
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                className={cn(
                  "absolute top-1.5 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                  q.id === currentId && "opacity-100",
                )}
                aria-label="Delete quiz"
                disabled={busy}
                onClick={() => setConfirm(q)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </ScrollArea>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this quiz?</DialogTitle>
            <DialogDescription>
              It moves to the trash folder in your data directory. You can restore it from there by hand.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={async () => {
                if (!confirm) return;
                setDeleting(true);
                try {
                  await remove(confirm.id);
                } finally {
                  setDeleting(false);
                  setConfirm(null);
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
