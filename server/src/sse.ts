import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { StreamEvent } from "@sdp/shared";

type AnyEvent = { event: string; data: unknown };

/** Sends one event. The quiz routes pass their own event union. */
export type Emit<S extends AnyEvent = StreamEvent> = <E extends S["event"]>(
  event: E,
  data: Extract<S, { event: E }>["data"],
) => void;

/**
 * Streams events from `run` as server-sent events. If the browser disconnects, `run` keeps going
 * so the reply is still saved; events are just no longer delivered.
 */
export function sseJob<S extends AnyEvent = StreamEvent>(
  c: Context,
  run: (emit: Emit<S>) => Promise<void>,
): Response {
  return streamSSE(c, async (stream) => {
    let open = true;
    let chain = Promise.resolve();
    stream.onAbort(() => {
      open = false;
    });
    const send = (event: string, data: unknown) => {
      if (!open) return;
      chain = chain
        .then(() => stream.writeSSE({ event, data: JSON.stringify(data) }))
        .catch(() => {
          open = false;
        });
    };
    try {
      await run(send as Emit<S>);
    } catch (err) {
      console.error(err);
      send("error", { message: err instanceof Error ? err.message : String(err), code: "claude_failed" });
    }
    await chain;
  });
}

/** Sessions with a Claude request in flight. A second request for the same session gets HTTP 409. */
const busy = new Set<string>();

export function tryLock(id: string): boolean {
  if (busy.has(id)) return false;
  busy.add(id);
  return true;
}

export function unlock(id: string) {
  busy.delete(id);
}
