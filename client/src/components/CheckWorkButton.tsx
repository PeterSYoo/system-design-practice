import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApp } from "@/state";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export default function CheckWorkButton() {
  const checkWork = useApp((s) => s.checkWork);
  const streaming = useApp((s) => s.streaming !== null);
  const pending = useApp((s) => s.pendingProposal !== null);
  const hasSession = useApp((s) => s.meta !== null);
  const disabled = streaming || pending || !hasSession;

  const reason = pending ? "Keep or discard Claude's sketch first" : `${isMac ? "⌘" : "Ctrl"}+Enter on the canvas`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* The span keeps the tooltip working while the button is disabled. */}
        <span className="block">
          <Button className="w-full" onClick={() => void checkWork()} disabled={disabled}>
            <ClipboardCheck /> Check my work
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
