import { useEffect } from "react";
import { Activity } from "lucide-react";
import type { UsageWindow } from "@sdp/shared";
import { cn } from "@/lib/utils";
import { useUsage } from "@/usage-state";

/** "Resets in 4 hr 22 min" within a day, otherwise "Resets Fri 10:00 PM". */
function resetText(iso: string | null): string | null {
  if (!iso) return null;
  // The API's reset times can land a second before the hour; round so they read 10:00, not 9:59.
  const at = new Date(Math.round(new Date(iso).getTime() / 60_000) * 60_000);
  const ms = at.getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "Resets soon";
  if (ms < 24 * 3600_000) {
    const hr = Math.floor(ms / 3600_000);
    const min = Math.max(1, Math.round((ms % 3600_000) / 60_000));
    return `Resets in ${hr ? `${hr} hr ` : ""}${min} min`;
  }
  const day = at.toLocaleDateString(undefined, { weekday: "short" });
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Resets ${day} ${time}`;
}

function Bar({ label, percent, className }: { label: string; percent: number; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={`${label} usage`}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-2 overflow-hidden rounded-full bg-primary/15", className)}
    >
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Label and reset time, bar, and percent, laid out like claude.ai's usage page. */
function WideRow({ window: w }: { window: UsageWindow }) {
  const reset = resetText(w.resetsAt);
  const percent = Math.min(100, Math.max(0, w.percent));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[10rem_minmax(0,1fr)_4.5rem]">
      <div>
        <div className="text-sm font-medium">{w.label}</div>
        {reset && <div className="text-xs text-muted-foreground">{reset}</div>}
      </div>
      <Bar label={w.label} percent={percent} className="order-last col-span-2 sm:order-none sm:col-span-1" />
      <div className="text-right text-sm text-muted-foreground">{percent}% used</div>
    </div>
  );
}

/** The same row stacked for the narrow sidebar. */
function CompactRow({ window: w }: { window: UsageWindow }) {
  const reset = resetText(w.resetsAt);
  const percent = Math.min(100, Math.max(0, w.percent));
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{w.label}</span>
        <span className="shrink-0 text-muted-foreground">{percent}% used</span>
      </div>
      <Bar label={w.label} percent={percent} className="h-1.5" />
      {reset && <div className="text-muted-foreground">{reset}</div>}
    </div>
  );
}

/**
 * Claude plan session and weekly limits. `card` is the dashboard panel, `sidebar` the compact
 * block above the cheat sheet. Renders nothing when the CLI can't report them.
 */
export default function UsagePanel({ variant }: { variant: "card" | "sidebar" }) {
  const usage = useUsage((s) => s.usage);
  const refresh = useUsage((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!usage?.available || (!usage.session && !usage.weekly.length)) return null;
  const plan = usage.plan ? usage.plan[0].toUpperCase() + usage.plan.slice(1) : null;

  if (variant === "sidebar") {
    const windows = [...(usage.session ? [usage.session] : []), ...usage.weekly.map((w) => ({ ...w, label: `Weekly · ${w.label}` }))];
    return (
      <div className="border-t px-3 py-3 text-xs">
        <h3 className="mb-2 flex items-center gap-1.5 font-medium text-muted-foreground">
          <Activity className="size-3.5" /> Plan usage{plan && ` · ${plan}`}
        </h3>
        <div className="space-y-2.5">
          {windows.map((w) => (
            <CompactRow key={w.label} window={w} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-5 rounded-xl border bg-card p-5 shadow-xs">
      <h2 className="flex items-baseline gap-2 text-base font-semibold">
        Plan usage limits {plan && <span className="text-sm font-normal text-muted-foreground">{plan}</span>}
      </h2>
      {usage.session && <WideRow window={usage.session} />}
      {usage.weekly.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Weekly limits</h3>
          {usage.weekly.map((w) => (
            <WideRow key={w.label} window={w} />
          ))}
        </div>
      )}
    </section>
  );
}
