import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/state";
import CheckWorkButton from "./CheckWorkButton";
import ModelPicker from "./ModelPicker";
import { ErrorBubble, MessageBubble } from "./MessageBubble";

const MIN_W = 320;
const MAX_W = 640;
const WIDTH_KEY = "sdp.chatWidth";

function storedWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (n >= MIN_W && n <= MAX_W) return n;
  } catch {
    // storage unavailable
  }
  return 380;
}

export default function ChatPanel() {
  const sessionId = useApp((s) => s.currentId);
  const messages = useApp((s) => s.messages);
  const streaming = useApp((s) => s.streaming);
  const streamError = useApp((s) => s.streamError);
  const sendMessage = useApp((s) => s.sendMessage);
  const [width, setWidth] = useState(storedWidth);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Auto-scroll to the bottom unless the user has scrolled up.
  const onScroll = () => {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, streamError]);
  useEffect(() => {
    stickToBottom.current = true;
  }, [sessionId]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => setWidth(Math.min(MAX_W, Math.max(MIN_W, startW + startX - ev.clientX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setWidth((w) => {
        try {
          localStorage.setItem(WIDTH_KEY, String(w));
        } catch {
          // storage unavailable
        }
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const send = () => {
    const text = draft.trim();
    if (!text || streaming || !sessionId) return;
    stickToBottom.current = true;
    setDraft("");
    void sendMessage(text);
  };

  return (
    <aside className="relative flex shrink-0 flex-col border-l bg-background" style={{ width }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat"
        onPointerDown={startResize}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-ring/30"
      />
      <div className="flex h-11 items-center gap-2 border-b px-4">
        <span className="flex-1 text-sm font-semibold">Chat</span>
        <ModelPicker />
      </div>
      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {sessionId &&
          messages.map((m) => <MessageBubble key={m.id} sessionId={sessionId} message={m} />)}
        {streaming && sessionId && streaming.text && (
          <MessageBubble
            sessionId={sessionId}
            message={{ role: "assistant", kind: streaming.kind === "review" ? "review" : "chat", text: streaming.text }}
            streaming
          />
        )}
        {streaming && (streaming.status || !streaming.text) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <Loader2 className="size-3.5 animate-spin" />
            {streaming.status ?? (streaming.kind === "question" ? "Writing your question…" : "Claude is thinking…")}
          </div>
        )}
        {streamError && <ErrorBubble message={streamError.message} onRetry={streamError.retry} />}
      </div>
      <div className="space-y-2 border-t p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            disabled={!sessionId}
            placeholder={sessionId ? "Ask about requirements, scale, trade-offs…" : "Start a session first"}
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <Button size="icon" variant="outline" onClick={send} disabled={!draft.trim() || !!streaming || !sessionId} aria-label="Send">
            <SendHorizontal />
          </Button>
        </div>
        <CheckWorkButton />
      </div>
    </aside>
  );
}
