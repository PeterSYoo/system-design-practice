import { memo } from "react";
import { RotateCcw } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@sdp/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SKETCH_TAG = { pending: "Sketch pending", accepted: "Sketch kept", discarded: "Sketch discarded" } as const;

function imageUrl(sessionId: string, name: string) {
  return name.startsWith("blob:") ? name : `/api/sessions/${encodeURIComponent(sessionId)}/images/${encodeURIComponent(name)}`;
}

type Props = {
  sessionId: string;
  message: Pick<ChatMessage, "role" | "kind" | "text" | "reviewImage" | "proposal">;
  streaming?: boolean;
};

export const MessageBubble = memo(function MessageBubble({ sessionId, message, streaming }: Props) {
  const mine = message.role === "user";
  return (
    <div className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[92%] rounded-xl px-3 py-2 text-sm",
          mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
          message.kind === "review" && "w-full max-w-full",
        )}
      >
        {message.kind === "review-request" ? (
          <div className="flex items-center gap-2">
            {message.reviewImage ? (
              <a href={imageUrl(sessionId, message.reviewImage)} target="_blank" rel="noreferrer">
                <img
                  src={imageUrl(sessionId, message.reviewImage)}
                  alt="Diagram sent for review"
                  className="h-14 w-20 rounded bg-white object-contain"
                />
              </a>
            ) : null}
            <span>{message.text}</span>
          </div>
        ) : mine ? (
          <p className="whitespace-pre-wrap">{message.text}</p>
        ) : (
          <div className={cn("markdown", streaming && "streaming-cursor")}>
            <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
          </div>
        )}
      </div>
      {message.proposal && (
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px]",
            message.proposal.status === "pending" ? "border-violet-400 text-violet-600 dark:text-violet-300" : "text-muted-foreground",
          )}
        >
          {SKETCH_TAG[message.proposal.status]}
        </span>
      )}
    </div>
  );
});

export function ErrorBubble({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
      <p className="flex-1 text-destructive">{message}</p>
      <Button size="xs" variant="outline" onClick={onRetry}>
        <RotateCcw /> Retry
      </Button>
    </div>
  );
}
