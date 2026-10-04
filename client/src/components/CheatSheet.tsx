import { Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const SECTIONS: { title: string; rows: [string, string][]; note?: string }[] = [
  {
    title: "Traffic",
    rows: [
      ["1 million req/day", "~10 req/s"],
      ["10 million req/day", "~100 req/s"],
      ["100 million req/day", "~1,000 req/s"],
      ["1 billion req/day", "~10,000 req/s"],
    ],
    note: "Peak traffic is about 2–3× the daily average.",
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
    note: "A cross-continent round trip is about a million RAM accesses.",
  },
  {
    title: "Availability (downtime per year)",
    rows: [
      ["99.9% (3 nines)", "~8.76 hours"],
      ["99.99% (4 nines)", "~52.6 minutes"],
      ["99.999% (5 nines)", "~5.26 minutes"],
    ],
  },
];

function Sections() {
  return (
    <div className="space-y-3">
      {SECTIONS.map((s) => (
        <section key={s.title}>
          <h4 className="mb-1 font-semibold">{s.title}</h4>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
            {s.rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="opacity-80">{k}</dt>
                <dd className="text-right font-mono tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {s.note && <p className="mt-1 opacity-70">{s.note}</p>}
        </section>
      ))}
    </div>
  );
}

/** Always-visible panel for the expanded sidebar. */
export function CheatSheetPanel() {
  return (
    <div className="border-t px-3 py-3 text-xs">
      <h3 className="mb-2 flex items-center gap-1.5 font-medium text-muted-foreground">
        <Gauge className="size-3.5" /> Numbers to know
      </h3>
      <Sections />
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
        <Sections />
      </TooltipContent>
    </Tooltip>
  );
}
