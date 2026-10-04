import { useState } from "react";
import { ChevronRight, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const SECTIONS: { title: string; rows: [string, string][]; notes?: string[] }[] = [
  {
    title: "Traffic",
    rows: [
      ["1 million req/day", "~10 req/s"],
      ["10 million req/day", "~100 req/s"],
      ["100 million req/day", "~1,000 req/s"],
      ["1 billion req/day", "~10,000 req/s"],
    ],
    notes: ["Peak traffic is about 2–3× the daily average."],
  },
  {
    title: "Latency",
    rows: [
      ["RAM access", "~100 ns"],
      ["Read 1 MB from RAM", "~3 µs"],
      ["Read 1 MB from SSD", "~50 µs"],
      ["SSD access", "~100 µs"],
      ["Round trip within a datacenter", "~0.5 ms"],
      ["Read 1 MB from disk", "~5 ms"],
      ["Disk seek", "~10 ms"],
      ["California ↔ Netherlands round trip", "~150 ms"],
    ],
    notes: [
      "1 ms = 1,000 µs = 1,000,000 ns.",
      "A cross-continent round trip is about a million RAM accesses.",
    ],
  },
  {
    title: "Availability (downtime per year)",
    rows: [
      ["99.9% (3 nines)", "~8.76 hours"],
      ["99.99% (4 nines)", "~52.6 minutes"],
      ["99.999% (5 nines)", "~5.26 minutes"],
    ],
    notes: [
      "Availability is the share of time a service is up. \"Nines\" counts the 9s in that percentage.",
      "Each extra nine cuts the allowed downtime by 10×.",
    ],
  },
];

type Section = (typeof SECTIONS)[number];

const CLOSED_KEY = "sdp.cheatSheetClosed";

function storedClosed(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function SectionBody({ section }: { section: Section }) {
  return (
    <>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
        {section.rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="opacity-80">{k}</dt>
            <dd className="text-right font-mono tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {section.notes?.map((n) => (
        <p key={n} className="mt-1 opacity-70">
          {n}
        </p>
      ))}
    </>
  );
}

/** Always-visible panel for the expanded sidebar. Each section folds; the choice is remembered. */
export function CheatSheetPanel() {
  const [closed, setClosed] = useState(storedClosed);

  const toggle = (title: string) =>
    setClosed((c) => {
      const next = c.includes(title) ? c.filter((t) => t !== title) : [...c, title];
      try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable
      }
      return next;
    });

  return (
    <div className="border-t px-3 py-3 text-xs">
      <h3 className="mb-1.5 flex items-center gap-1.5 font-medium text-muted-foreground">
        <Gauge className="size-3.5" /> Numbers to know
      </h3>
      <div className="space-y-1">
        {SECTIONS.map((s) => {
          const open = !closed.includes(s.title);
          return (
            <section key={s.title}>
              <button
                className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-1 rounded px-1 py-0.5 text-left font-semibold hover:bg-sidebar-accent"
                aria-expanded={open}
                onClick={() => toggle(s.title)}
              >
                <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
                {s.title}
              </button>
              {open && (
                <div className="mt-0.5 mb-2 pl-[1.125rem]">
                  <SectionBody section={s} />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Icon with a hover card, for the collapsed sidebar where the panel doesn't fit. */
export function CheatSheetButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Numbers to know">
          <Gauge />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" align="end" sideOffset={6} className="w-80 max-w-[calc(100vw-2rem)] px-4 py-3 text-wrap">
        <div className="space-y-3">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h4 className="mb-1 font-semibold">{s.title}</h4>
              <SectionBody section={s} />
            </section>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
