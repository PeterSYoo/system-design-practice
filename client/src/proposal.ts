import { SKETCH_COLOR, summarizeScene, type CanvasOp, type Proposal, type Side } from "@sdp/shared";

// Placement rules from the design doc.
export const COMPONENT_W = 160;
export const COMPONENT_H = 70;
export const GAP = 80;
export const STEP = 90;
export const MAX_MOVES = 10;
/** Sideways shift for a sketched arrow that parallels another arrow between the same components. */
export const PARALLEL_OFFSET = 28;

/** The element fields placement reads. Real Excalidraw elements satisfy this. */
export type SceneElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  boundElements?: readonly { id: string; type: string }[] | null;
  version?: number;
  [key: string]: unknown;
};

type Box = { x: number; y: number; w: number; h: number };

/** An element skeleton for Excalidraw's convertToExcalidrawElements. */
export type Skeleton = Record<string, unknown> & { id: string; type: string };

export type ArrowBinding = { arrowId: string; startId: string; endId: string };

const LINEAR = new Set(["arrow", "line"]);

function boxOf(e: SceneElement): Box {
  return {
    x: Math.min(e.x, e.x + e.width),
    y: Math.min(e.y, e.y + e.height),
    w: Math.abs(e.width),
    h: Math.abs(e.height),
  };
}

const overlaps = (a: Box, b: Box, margin = 10) =>
  a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y;

const DIRECTION: Record<Side, [number, number]> = { right: [1, 0], left: [-1, 0], above: [0, -1], below: [0, 1] };

/** Where a box of size w×h goes on `side` of `anchor`, GAP pixels away. */
function besideAnchor(anchor: Box, side: Side, w: number, h: number): { x: number; y: number } {
  const cx = anchor.x + anchor.w / 2 - w / 2;
  const cy = anchor.y + anchor.h / 2 - h / 2;
  switch (side) {
    case "right":
      return { x: anchor.x + anchor.w + GAP, y: cy };
    case "left":
      return { x: anchor.x - GAP - w, y: cy };
    case "above":
      return { x: cx, y: anchor.y - GAP - h };
    case "below":
      return { x: cx, y: anchor.y + anchor.h + GAP };
  }
}

function sceneBounds(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Wraps note text at about 32 characters a line. */
function wrap(text: string, width = 32): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && (line + " " + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Point where the ray from a box's center toward `toward` leaves the box, pushed out by `pad`. */
function edgePoint(b: Box, toward: { x: number; y: number }, pad = 6) {
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const t = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
  const len = Math.hypot(dx, dy);
  return { x: c.x + dx * t + (dx / len) * pad, y: c.y + dy * t + (dy / len) * pad };
}

/**
 * Lays out Claude's operations next to the existing drawing. Returns element skeletons (every one
 * violet, locked, and tagged with the proposal) and the arrow bindings to apply after conversion.
 */
export function placeOps(
  elements: readonly SceneElement[],
  proposal: Pick<Proposal, "id" | "ops">,
): { skeletons: Skeleton[]; bindings: ArrowBinding[] } {
  const live = elements.filter((e) => !e.isDeleted);
  const labelToId = new Map(summarizeScene(live).components.map((c) => [c.label, c.id]));
  const byId = new Map(live.map((e) => [e.id, e]));
  const obstacles: Box[] = live.filter((e) => !LINEAR.has(e.type)).map(boxOf);
  const refs = new Map<string, { id: string; box: Box }>();
  // Arrows already joining each pair of elements, so a new one can run beside them instead of on top.
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairCount = new Map<string, number>();
  // Widest label on the arrows between each pair, to keep side-by-side labels apart.
  const pairLabelW = new Map<string, number>();
  const labelWidth = new Map(
    live.filter((e) => e.type === "text" && e.containerId).map((e) => [e.containerId as string, Math.abs(e.width)]),
  );
  for (const e of live) {
    const s = (e.startBinding as { elementId?: string } | null | undefined)?.elementId;
    const t = (e.endBinding as { elementId?: string } | null | undefined)?.elementId;
    if (!LINEAR.has(e.type) || !s || !t) continue;
    const key = pairKey(s, t);
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    pairLabelW.set(key, Math.max(pairLabelW.get(key) ?? 0, labelWidth.get(e.id) ?? 0));
  }
  const skeletons: Skeleton[] = [];
  const bindings: ArrowBinding[] = [];
  const tag = { source: "claude", proposalId: proposal.id, status: "pending" };
  const style = { strokeColor: SKETCH_COLOR, locked: true, customData: tag };
  const short = proposal.id.replace(/[^a-z0-9]/gi, "").slice(0, 8);
  let n = 0;
  const newId = () => `sk_${short}_${++n}`;

  const resolve = (name: string | undefined): { id: string; box: Box } | null => {
    if (name === undefined) return null;
    const ref = refs.get(name);
    if (ref) return ref;
    const id = labelToId.get(name);
    const el = id ? byId.get(id) : undefined;
    return el ? { id: el.id, box: boxOf(el) } : null;
  };

  /** Finds a free spot: start beside the anchor (or right of everything), then step away up to 10 times. */
  const place = (near: string | undefined, side: Side | undefined, w: number, h: number): Box => {
    const anchor = resolve(near);
    const dir = anchor ? (side ?? "right") : "right";
    let pos: { x: number; y: number };
    if (anchor) {
      pos = besideAnchor(anchor.box, dir, w, h);
    } else {
      const bounds = sceneBounds(obstacles);
      pos = bounds ? { x: bounds.x + bounds.w + GAP, y: bounds.y } : { x: 0, y: 0 };
    }
    const [dx, dy] = DIRECTION[dir];
    let box = { ...pos, w, h };
    for (let i = 0; i < MAX_MOVES && obstacles.some((o) => overlaps(box, o)); i++) {
      box = { ...box, x: box.x + dx * STEP, y: box.y + dy * STEP };
    }
    obstacles.push(box);
    return box;
  };

  for (const op of proposal.ops as CanvasOp[]) {
    if (op.op === "add_component") {
      const box = place(op.near, op.side, COMPONENT_W, COMPONENT_H);
      const id = newId();
      refs.set(op.ref, { id, box });
      skeletons.push({
        type: op.shape,
        id,
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        label: { text: op.label, strokeColor: SKETCH_COLOR },
        ...style,
      });
    } else if (op.op === "add_note") {
      const lines = wrap(op.text);
      const w = Math.max(...lines.map((l) => l.length)) * 9 + 10;
      const h = lines.length * 25;
      const box = place(op.near, op.side, w, h);
      skeletons.push({ type: "text", id: newId(), x: box.x, y: box.y, text: lines.join("\n"), fontSize: 16, ...style });
    } else {
      const from = resolve(op.from);
      const to = resolve(op.to);
      if (!from || !to) continue;
      const fc = { x: from.box.x + from.box.w / 2, y: from.box.y + from.box.h / 2 };
      const tc = { x: to.box.x + to.box.w / 2, y: to.box.y + to.box.h / 2 };
      let start = edgePoint(from.box, tc);
      let end = edgePoint(to.box, fc);
      const key = pairKey(from.id, to.id);
      const k = pairCount.get(key) ?? 0;
      const newLabelW = (op.label?.length ?? 0) * 9;
      const existingLabelW = pairLabelW.get(key) ?? 0;
      pairCount.set(key, k + 1);
      pairLabelW.set(key, Math.max(existingLabelW, newLabelW));
      if (k > 0) {
        // Alternate sides: +1, -1, +2, -2 offsets along the arrow's normal. Labels sit at the
        // midpoint, so mostly vertical arrows also need room for the labels' width.
        const len = Math.hypot(end.x - start.x, end.y - start.y) || 1;
        const vertical = Math.abs(end.y - start.y) > Math.abs(end.x - start.x);
        const room = vertical ? (existingLabelW + newLabelW) / 2 + 12 : 0;
        const shift = Math.max(PARALLEL_OFFSET, room) * Math.ceil(k / 2) * (k % 2 ? 1 : -1);
        const nx = (-(end.y - start.y) / len) * shift;
        const ny = ((end.x - start.x) / len) * shift;
        start = { x: start.x + nx, y: start.y + ny };
        end = { x: end.x + nx, y: end.y + ny };
      }
      const id = newId();
      skeletons.push({
        type: "arrow",
        id,
        x: start.x,
        y: start.y,
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
        points: [
          [0, 0],
          [end.x - start.x, end.y - start.y],
        ],
        startArrowhead: op.bidirectional ? "arrow" : null,
        endArrowhead: "arrow",
        ...(op.label ? { label: { text: op.label, strokeColor: SKETCH_COLOR } } : {}),
        ...style,
      });
      bindings.push({ arrowId: id, startId: from.id, endId: to.id });
    }
  }
  return { skeletons, bindings };
}

/**
 * Converts placed skeletons into elements, stamps every element (labels included) as a pending
 * violet sketch, and binds arrows at both ends. Returns the new elements plus copies of the user's
 * elements whose bound-element lists gained an arrow; nothing else about them changes.
 */
export function buildProposalElements<E extends SceneElement>(
  existing: readonly E[],
  proposal: Pick<Proposal, "id" | "ops">,
  convert: (skeletons: Skeleton[]) => readonly E[],
): { added: E[]; updated: E[] } {
  const { skeletons, bindings } = placeOps(existing, proposal);
  if (!skeletons.length) return { added: [], updated: [] };
  const customData = { source: "claude", proposalId: proposal.id, status: "pending" };
  const added = convert(skeletons).map((e) => ({ ...e, strokeColor: SKETCH_COLOR, locked: true, customData }) as E);
  const addedById = new Map(added.map((e) => [e.id, e]));
  const updatedById = new Map<string, E>();

  const addBound = (targetId: string, arrowId: string) => {
    const fresh = addedById.get(targetId);
    const base = fresh ?? updatedById.get(targetId) ?? existing.find((e) => e.id === targetId);
    if (!base) return;
    const bound = [...(base.boundElements ?? []), { id: arrowId, type: "arrow" }];
    const next = { ...base, boundElements: bound, ...(fresh ? {} : { version: (base.version ?? 1) + 1 }) } as E;
    if (fresh) addedById.set(targetId, next);
    else updatedById.set(targetId, next);
  };

  for (const b of bindings) {
    const arrow = addedById.get(b.arrowId);
    if (!arrow) continue;
    addedById.set(b.arrowId, {
      ...arrow,
      startBinding: { elementId: b.startId, focus: 0, gap: 6 },
      endBinding: { elementId: b.endId, focus: 0, gap: 6 },
    });
    addBound(b.startId, b.arrowId);
    addBound(b.endId, b.arrowId);
  }
  return { added: added.map((e) => addedById.get(e.id)!), updated: [...updatedById.values()] };
}
