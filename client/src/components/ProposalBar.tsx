import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/state";

/** Floats over the top edge of the canvas while a sketch from Claude is pending. */
export default function ProposalBar() {
  const pending = useApp((s) => s.pendingProposal);
  const decide = useApp((s) => s.decideProposal);
  const [busy, setBusy] = useState(false);
  if (!pending) return null;

  const run = async (d: "accept" | "discard") => {
    setBusy(true);
    try {
      await decide(d);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-violet-300 bg-background/95 py-1.5 pr-1.5 pl-4 text-sm shadow-md dark:border-violet-700">
        <span className="size-2.5 rounded-full bg-[#6741d9]" aria-hidden />
        <span>
          Claude sketched {pending.count} addition{pending.count === 1 ? "" : "s"}
        </span>
        <Button size="sm" onClick={() => void run("accept")} disabled={busy}>
          <Check /> Keep
        </Button>
        <Button size="sm" variant="outline" onClick={() => void run("discard")} disabled={busy}>
          <X /> Discard
        </Button>
      </div>
    </div>
  );
}
