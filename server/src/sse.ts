import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { StreamEvent } from "@sdp/shared";

export type Emit = <E extends StreamEvent["event"]>(
  event: E,
  data: Extract<StreamEvent, { event: E }>["data"],
) => void;

/**
 * Streams events from `run` as server-sent events. If the browser disconnects, `run` keeps going
 * so the reply is still saved; events are just no longer delivered.
 */
export function sseJob(c: Context, run: (emit: Emit) => Promise<void>): Response {
  return streamSSE(c, async (stream) => {
    let open = true;
    let chain = Promise.resolve();
    stream.onAbort(() => {
      open = false;
    });
    const emit: Emit = (event, data) => {
      if (!open) return;
      chain = chain
        .then(() => stream.writeSSE({ event, data: JSON.stringify(data) }))
        .catch(() => {
          open = false;
        });
    };
    try {
      await run(emit);
    } catch (err) {
      console.error(err);
      emit("error", { message: err instanceof Error ? err.message : String(err), code: "claude_failed" });
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
