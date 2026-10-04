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
  },
  {
    title: "Latency",
    rows: [
      ["RAM access", "~100 ns"],
      ["SSD access", "~100 µs"],
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

type Props = { showLabel?: boolean };

export default function CheatSheet({ showLabel }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {showLabel ? (
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
            <Gauge /> Numbers to know
          </Button>
        ) : (
          <Button variant="ghost" size="icon-sm" aria-label="Numbers to know">
            <Gauge />
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" align="end" sideOffset={6} className="w-80 max-w-[calc(100vw-2rem)] px-4 py-3 text-wrap">
        <div className="space-y-3">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h4 className="mb-1 font-semibold">{s.title}</h4>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
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
      </TooltipContent>
    </Tooltip>
  );
}
