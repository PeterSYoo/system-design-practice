import { useEffect, useState } from "react";
import { CLAUDE_MODELS, EFFORT_LEVELS, MODELS_WITHOUT_EFFORT, type ClaudeSettings, type EffortLevel } from "@sdp/shared";
import { api } from "@/api";
import { useApp } from "@/state";

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

const selectClass =
  "h-7 rounded-md border bg-background px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";

/** Model and effort dropdowns. The choice is saved on the server and applies to every Claude call. */
export default function ModelPicker() {
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
    <div className="flex items-center gap-1.5">
      <select
        aria-label="Claude model"
        title="Claude model"
        className={selectClass}
        value={model}
        disabled={busy}
        onChange={(e) => update({ ...settings, model: e.target.value || undefined })}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Effort level"
        title={noEffort ? "This model has no effort setting" : "Effort level"}
        className={selectClass}
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
      </select>
    </div>
  );
}
