import { useState } from "react";
import { ChevronDown } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { useApp } from "@/state";

const SAVE_LABEL = { idle: "", saving: "Saving…", saved: "Saved", error: "Save failed" } as const;

export default function QuestionBar() {
  const meta = useApp((s) => s.meta);
  const question = useApp((s) => s.question);
  const streamingQuestion = useApp((s) => (s.streaming?.kind === "question" ? s.streaming.text : null));
  const saveStatus = useApp((s) => s.saveStatus);
  const [open, setOpen] = useState(false);

  const text = question || streamingQuestion || "";
  return (
    <div className="relative z-10 border-b bg-background">
      <div className="flex h-11 items-center gap-3 px-4">
        <button
          className="flex min-w-0 items-center gap-1.5 text-sm font-semibold disabled:cursor-default"
          onClick={() => setOpen((o) => !o)}
          disabled={!text}
          aria-expanded={open}
        >
          <span className="truncate">{meta?.title ?? "Writing your question…"}</span>
          {text && <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />}
        </button>
        <span
          className={cn(
            "ml-auto shrink-0 text-xs text-muted-foreground",
            saveStatus === "error" && "font-medium text-destructive",
          )}
          aria-live="polite"
        >
          {SAVE_LABEL[saveStatus]}
        </span>
      </div>
      {open && text && (
        <div className="markdown max-h-64 overflow-auto border-t px-4 py-3 text-sm">
          <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
        </div>
      )}
    </div>
  );
}
