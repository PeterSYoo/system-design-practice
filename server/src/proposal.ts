import { MAX_SKETCH_OPS, type CanvasOp } from "@sdp/shared";
import { CanvasOpSchema } from "./schemas.js";

const OPEN = "<canvas-ops>";
const CLOSE = "</canvas-ops>";
export const SKETCH_FAILED_NOTE = "Claude's sketch could not be drawn.";

/**
 * Filters streamed text so the raw <canvas-ops> block never reaches the browser. Stops forwarding at
 * the opening tag, and holds back trailing characters that could be the start of the tag until the
 * next delta settles it.
 */
export class CanvasOpsFilter {
  private held = "";
  private cut = false;

  /** Returns the text safe to forward, and whether this chunk started the sketch block. */
  feed(chunk: string): { forward: string; startedSketch: boolean } {
    if (this.cut) return { forward: "", startedSketch: false };
    const buf = this.held + chunk;
    const at = buf.indexOf(OPEN);
    if (at >= 0) {
      this.cut = true;
      this.held = "";
      return { forward: buf.slice(0, at), startedSketch: true };
    }
    let keep = 0;
    for (let n = Math.min(OPEN.length - 1, buf.length); n > 0; n--) {
      if (OPEN.startsWith(buf.slice(-n))) {
        keep = n;
        break;
      }
    }
    this.held = buf.slice(buf.length - keep);
    return { forward: buf.slice(0, buf.length - keep), startedSketch: false };
  }

  /** Text still held back when the stream ends without a block. */
  flush(): string {
    const rest = this.cut ? "" : this.held;
    this.held = "";
    return rest;
  }
}

export type ExtractedSketch = {
  /** The reply with the block cut out. */
  text: string;
  /** Valid operations, or null when there are none. */
  ops: CanvasOp[] | null;
  /** True when the reply contained a block, valid or not. */
  hadBlock: boolean;
};

/**
 * Cuts the <canvas-ops> block out of a finished reply and validates it. Drops operations past the
 * fifth, operations that fail the schema, and operations that name a label missing from `labels`
 * (the summary sent with the review) and not added earlier in the same block.
 */
export function extractSketch(reply: string, labels: ReadonlySet<string>): ExtractedSketch {
  const start = reply.indexOf(OPEN);
  if (start < 0) return { text: reply.trim(), ops: null, hadBlock: false };
  const end = reply.indexOf(CLOSE, start);
  const inner = reply.slice(start + OPEN.length, end < 0 ? undefined : end);
  const after = end < 0 ? "" : reply.slice(end + CLOSE.length);
  const text = `${reply.slice(0, start)}${after}`.trim();

  let raw: unknown;
  try {
    raw = JSON.parse(inner.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { text, ops: null, hadBlock: true };
  }
  if (!Array.isArray(raw)) return { text, ops: null, hadBlock: true };

  const refs = new Set<string>();
  const known = (name: string | undefined) => name === undefined || labels.has(name) || refs.has(name);
  const ops: CanvasOp[] = [];
  for (const item of raw.slice(0, MAX_SKETCH_OPS)) {
    const parsed = CanvasOpSchema.safeParse(item);
    if (!parsed.success) continue;
    const op = parsed.data as CanvasOp;
    if (op.op === "add_component") {
      if (!known(op.near) || labels.has(op.ref) || refs.has(op.ref)) continue;
      refs.add(op.ref);
    } else if (op.op === "add_connection") {
      if (!known(op.from) || !known(op.to) || op.from === op.to) continue;
    } else if (!known(op.near)) {
      continue;
    }
    ops.push(op);
  }
  return { text, ops: ops.length ? ops : null, hadBlock: true };
}

/** The saved review text: the block removed, plus a note when a block was there but nothing survived. */
export function reviewText(extracted: ExtractedSketch): string {
  return extracted.hadBlock && !extracted.ops ? `${extracted.text}\n\n${SKETCH_FAILED_NOTE}` : extracted.text;
}
