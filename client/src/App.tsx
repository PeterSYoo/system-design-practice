import { useEffect, useState } from "react";
import { Loader2, Plus, RotateCcw, TerminalSquare } from "lucide-react";
import Canvas from "@/components/Canvas";
import ChatPanel from "@/components/ChatPanel";
import NewSessionDialog from "@/components/NewSessionDialog";
import ProposalBar from "@/components/ProposalBar";
import QuestionBar from "@/components/QuestionBar";
import SessionSidebar from "@/components/SessionSidebar";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/state";
import { useSystemTheme } from "@/theme";

const SIDEBAR_KEY = "sdp.sidebarCollapsed";

function HealthBanner() {
  const health = useApp((s) => s.health);
  const checkHealth = useApp((s) => s.checkHealth);
  const [checking, setChecking] = useState(false);
  if (!health || health.claudeReady) return null;
  const serverDown = !health.ok;
  return (
    <div className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <TerminalSquare className="size-4 shrink-0" />
      <p className="flex-1">
        {serverDown ? (
          health.error
        ) : (
          <>
            Claude Code is not logged in. Run <code className="rounded bg-amber-100 px-1 font-mono dark:bg-amber-900">claude</code> in
            a terminal and log in, then retry.
            {health.error && <span className="ml-1 opacity-70">({health.error})</span>}
          </>
        )}
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={checking}
        onClick={async () => {
          setChecking(true);
          await checkHealth(true);
          setChecking(false);
        }}
      >
        {checking ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry
      </Button>
    </div>
  );
}

function EmptyState({ onNew }: { onNew(): void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <h2 className="text-xl font-semibold">Practice a system design interview</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Claude asks a question, you draw your design, and Claude reviews it when you click Check my work.
      </p>
      <Button size="lg" onClick={onNew}>
        <Plus /> Start your first session
      </Button>
    </div>
  );
}

export default function App() {
  const theme = useSystemTheme();
  const init = useApp((s) => s.init);
  const currentId = useApp((s) => s.currentId);
  const meta = useApp((s) => s.meta);
  const sessions = useApp((s) => s.sessions);
  const loadedScene = useApp((s) => s.loadedScene);
  const loadKey = useApp((s) => s.loadKey);
  const loading = useApp((s) => s.loadingSession);
  const streaming = useApp((s) => s.streaming);
  const [ready, setReady] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    void init().finally(() => setReady(true));
  }, [init]);

  const toggleSidebar = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? "0" : "1");
      } catch {
        // storage unavailable
      }
      return !c;
    });

  const creating = streaming?.kind === "question" && !meta;
  const showCanvas = meta && currentId && !loading;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <HealthBanner />
        <div className="flex min-h-0 flex-1">
          <SessionSidebar collapsed={collapsed} onToggle={toggleSidebar} onNew={() => setNewOpen(true)} />
          <main className="flex min-w-0 flex-1 flex-col">
            {showCanvas || creating ? (
              <>
                <QuestionBar />
                <div className="relative min-h-0 flex-1">
                  <ProposalBar />
                  {showCanvas && (
                    <Canvas key={`${currentId}:${loadKey}`} sessionId={currentId} initialScene={loadedScene} theme={theme} />
                  )}
                </div>
              </>
            ) : !ready || loading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="animate-spin" />
              </div>
            ) : sessions.length === 0 ? (
              <EmptyState onNew={() => setNewOpen(true)} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Pick a session on the left or start a new one.
              </div>
            )}
          </main>
          <ChatPanel />
        </div>
        <NewSessionDialog open={newOpen} onOpenChange={setNewOpen} />
      </div>
    </TooltipProvider>
  );
}
