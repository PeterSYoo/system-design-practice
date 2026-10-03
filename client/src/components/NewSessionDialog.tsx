import { useState } from "react";
import type { Difficulty } from "@sdp/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useApp } from "@/state";

const LEVELS: Difficulty[] = ["easy", "medium", "hard"];

export default function NewSessionDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const newSession = useApp((s) => s.newSession);
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onOpenChange(false);
    void newSession({ topic: topic.trim() || undefined, difficulty });
    setTopic("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New session</DialogTitle>
            <DialogDescription>Claude writes a system design question for you to answer on the canvas.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Topic (optional)</span>
            <input
              autoFocus
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={200}
              placeholder="e.g. payments, chat, rate limiting"
              className="h-9 rounded-md border bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </label>
          <fieldset className="grid gap-1.5 text-sm">
            <legend className="mb-1.5 font-medium">Difficulty</legend>
            <div className="inline-flex w-fit rounded-md border p-0.5">
              {LEVELS.map((l) => (
                <button
                  type="button"
                  key={l}
                  onClick={() => setDifficulty(l)}
                  aria-pressed={difficulty === l}
                  className={cn(
                    "rounded px-3 py-1 capitalize",
                    difficulty === l ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Start</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
