import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CLAUDE_MODELS, EFFORT_LEVELS, MODELS_WITHOUT_EFFORT, type ClaudeSettings, type EffortLevel } from "@sdp/shared";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { useApp } from "@/state";

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** A native select with our own chevron, since the browser's caret ignores right padding. */
function Select({ fill, className, ...props }: React.ComponentProps<"select"> & { fill?: boolean }) {
  return (
    <div className={cn("relative", fill && "min-w-0 flex-1")}>
      <select
        className={cn(
          "w-full appearance-none rounded-md border bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
          fill ? "h-9 pr-9 pl-2.5 text-sm" : "h-7 pr-6 pl-1.5 text-xs",
          className,
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground",
          fill ? "right-3 size-4" : "right-1.5 size-3.5",
        )}
      />
    </div>
  );
}

/**
 * Model and effort dropdowns. The choice is saved on the server and applies to every Claude call.
 * `fill` stretches both dropdowns across the available width.
 */
export default function ModelPicker({ fill, className }: { fill?: boolean; className?: string }) {
  const busy = useApp((s) => s.streaming !== null);
  const [settings, setSettings] = useState<ClaudeSettings | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings, () => setSettings({}));
  }, []);

  const update = (next: ClaudeSettings) => {
    const prev = settings;
    setSettings(next);
    api.saveSettings(next).then(setSettings, () => setSettings(prev));
  };

  if (!settings) return null;
  const model = settings.model ?? "";
  const noEffort = MODELS_WITHOUT_EFFORT.includes(model);
  // Show a model saved in settings.json by hand even when the list doesn't include it.
  const models = CLAUDE_MODELS.some((m) => m.id === model) ? CLAUDE_MODELS : [...CLAUDE_MODELS, { id: model, label: model }];

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Select
        fill={fill}
        aria-label="Claude model"
        title="Claude model"
        value={model}
        disabled={busy}
        onChange={(e) => update({ ...settings, model: e.target.value || undefined })}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </Select>
      <Select
        fill={fill}
        aria-label="Effort level"
        title={noEffort ? "This model has no effort setting" : "Effort level"}
        value={noEffort ? "" : (settings.effort ?? "")}
        disabled={busy || noEffort}
        onChange={(e) => update({ ...settings, effort: (e.target.value || undefined) as EffortLevel | undefined })}
      >
        <option value="">Default effort</option>
        {EFFORT_LEVELS.map((level) => (
          <option key={level} value={level}>
            {EFFORT_LABELS[level]}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** A card with a title and blurb on the left and full-width dropdowns on the right, for the start screens. */
export function ModelCard({ description }: { description: string }) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-xl border bg-card p-5 shadow-xs">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Claude model</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <ModelPicker fill className="min-w-60 flex-1" />
    </section>
  );
}
