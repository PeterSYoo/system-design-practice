import { useState } from "react";
import { AlertTriangle, PanelLeftClose, PanelLeftOpen, Plus, Trash2 } from "lucide-react";
import type { SessionListItem, SessionMeta } from "@sdp/shared";
import { CheatSheetButton, CheatSheetPanel } from "@/components/CheatSheet";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import UsagePanel from "@/components/UsagePanel";
import { cn } from "@/lib/utils";
import { useApp } from "@/state";

type Props = { collapsed: boolean; onToggle(): void; onNew(): void };

const MIN_W = 200;
const MAX_W = 480;
const WIDTH_KEY = "sdp.sidebarWidth";

function storedWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (n >= MIN_W && n <= MAX_W) return n;
  } catch {
    // storage unavailable
  }
  return 256;
}

function groupOf(meta: SessionMeta, now: Date): "Today" | "This week" | "Earlier" {
  const created = new Date(meta.createdAt);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (created >= startOfToday) return "Today";
  if (now.getTime() - created.getTime() < 7 * 24 * 3600 * 1000) return "This week";
  return "Earlier";
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function SessionSidebar({ collapsed, onToggle, onNew }: Props) {
  const sessions = useApp((s) => s.sessions);
  const currentId = useApp((s) => s.currentId);
  const busy = useApp((s) => s.streaming !== null);
  const openSession = useApp((s) => s.openSession);
  const deleteSession = useApp((s) => s.deleteSession);
  const [confirm, setConfirm] = useState<SessionListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [width, setWidth] = useState(storedWidth);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => setWidth(Math.min(MAX_W, Math.max(MIN_W, startW + ev.clientX - startX)));
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

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-2 border-r bg-sidebar pb-3">
        <div className="box-content flex h-11 w-full items-center justify-center border-b bg-background">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label="Expand sessions">
                <PanelLeftOpen />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Show sessions</TooltipContent>
          </Tooltip>
        </div>
        <HomeButton disabled={busy} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onNew} disabled={busy} aria-label="New session">
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">New session</TooltipContent>
        </Tooltip>
        <div className="mt-auto">
          <CheatSheetButton />
        </div>
      </aside>
    );
  }

  const now = new Date();
  const groups = new Map<string, SessionListItem[]>();
  for (const s of sessions) {
    const g = "unreadable" in s ? "Unreadable" : groupOf(s, now);
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  const order = ["Today", "This week", "Earlier", "Unreadable"].filter((g) => groups.has(g));

  return (
    <aside className="relative flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground" style={{ width }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sessions"
        onPointerDown={startResize}
        className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-ring/30"
      />
      <div className="box-content flex h-11 items-center gap-1 border-b bg-background px-2">
        <HomeButton disabled={busy} />
        <span className="flex-1 text-sm font-semibold">Sessions</span>
        <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label="Collapse sessions">
          <PanelLeftClose />
        </Button>
      </div>
      <div className="px-3 pt-3 pb-2">
        <Button variant="outline" className="w-full justify-start" onClick={onNew} disabled={busy}>
          <Plus /> New session
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <nav className="px-2 pb-3">
          {order.map((g) => (
            <section key={g} className="mt-3">
              <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{g}</h3>
              <ul>
                {groups.get(g)!.map((s) => (
                  <li key={s.id} className="group relative">
                    {"unreadable" in s ? (
                      <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground" title={s.error}>
                        <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                        <span className="truncate">{s.id}</span>
                      </div>
                    ) : (
                      <button
                        className={cn(
                          "w-full rounded-md px-2 py-1.5 pr-8 text-left text-sm hover:bg-sidebar-accent disabled:opacity-60",
                          s.id === currentId && "bg-sidebar-accent font-medium",
                        )}
                        disabled={busy && s.id !== currentId}
                        onClick={() => s.id !== currentId && void openSession(s.id)}
                      >
                        <div className="break-words">{s.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {shortDate(s.createdAt)} · {s.difficulty}
                          {s.reviewCount > 0 && ` · ${s.reviewCount} review${s.reviewCount === 1 ? "" : "s"}`}
                        </div>
                      </button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className={cn(
                        "absolute top-1.5 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                        s.id === currentId && "opacity-100",
                      )}
                      aria-label="Delete session"
                      disabled={busy}
                      onClick={() => setConfirm(s)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
      </ScrollArea>
      <UsagePanel variant="sidebar" />
      <CheatSheetPanel />

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this session?</DialogTitle>
            <DialogDescription>
              {confirm && ("unreadable" in confirm ? confirm.id : confirm.title)} moves to the trash folder in your
              data directory. You can restore it from there by hand.
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
                  await deleteSession(confirm.id);
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
