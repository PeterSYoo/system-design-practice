import type { DiagramSummary } from "./types";

/** The Excalidraw element fields the summarizer reads. Everything else is ignored. */
type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  text?: string;
  originalText?: string;
  containerId?: string | null;
  startBinding?: { elementId?: string } | null;
  endBinding?: { elementId?: string } | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  customData?: { source?: string; status?: string } | null;
};

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const LINKS = new Set(["arrow", "line"]);
const CLAUDE_TAG = "[from Claude's sketch]";

type Shape = {
  el: El;
  label: string | null;
  group?: string;
  isGroup: boolean;
  fromClaude: boolean;
  finalLabel?: string;
};

const fromClaude = (e: El) => e.customData?.source === "claude";
const textOf = (e: El) => (e.text ?? e.originalText ?? "").replace(/\s+/g, " ").trim();
const center = (e: El) => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });

/** Normalized bounds; Excalidraw allows negative width and height. */
function box(e: El) {
  const x1 = Math.min(e.x, e.x + e.width);
  const y1 = Math.min(e.y, e.y + e.height);
  return { x1, y1, x2: x1 + Math.abs(e.width), y2: y1 + Math.abs(e.height) };
}

function pointInside(p: { x: number; y: number }, e: El) {
  const b = box(e);
  return p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2;
}

function fullyContains(outer: El, inner: El) {
  const o = box(outer);
  const i = box(inner);
  return i.x1 >= o.x1 && i.y1 >= o.y1 && i.x2 <= o.x2 && i.y2 <= o.y2 && outer.id !== inner.id;
}

const area = (e: El) => Math.abs(e.width * e.height);

/** Turns an Excalidraw scene into components, connections, dangling arrows, and loose text. */
export function summarizeScene(rawElements: readonly unknown[]): DiagramSummary {
  // 1. Drop deleted elements and Claude sketches the candidate has not kept.
  const elements = (rawElements as El[]).filter(
    (e) => e && typeof e.id === "string" && !e.isDeleted && !(fromClaude(e) && e.customData?.status === "pending"),
  );
  // 2. ID -> element.
  const byId = new Map(elements.map((e) => [e.id, e]));

  // 3. Bound labels: text with a containerId labels its shape or arrow.
  const boundLabel = new Map<string, string>();
  const usedText = new Set<string>();
  for (const t of elements) {
    if (t.type !== "text" || !t.containerId) continue;
    const container = byId.get(t.containerId);
    if (!container || !(SHAPES.has(container.type) || LINKS.has(container.type))) continue;
    const text = textOf(t);
    if (!text) continue;
    boundLabel.set(container.id, boundLabel.has(container.id) ? `${boundLabel.get(container.id)} ${text}` : text);
    usedText.add(t.id);
  }

  // 4. Components. Shapes without a bound label take the nearest unbound text inside them.
  // Smallest shapes go first so a group box never takes the label of a box inside it.
  const shapes: Shape[] = elements
    .filter((e) => SHAPES.has(e.type))
    .map((el) => ({ el, label: boundLabel.get(el.id) ?? null, isGroup: false, fromClaude: fromClaude(el) }));
  const freeTexts = elements.filter((e) => e.type === "text" && !usedText.has(e.id) && textOf(e));
  for (const s of [...shapes].sort((a, b) => area(a.el) - area(b.el))) {
    if (s.label) continue;
    const c = center(s.el);
    let best: El | null = null;
    let bestDist = Infinity;
    for (const t of freeTexts) {
      if (usedText.has(t.id) || !pointInside(center(t), s.el)) continue;
      const tc = center(t);
      const d = Math.hypot(tc.x - c.x, tc.y - c.y);
      if (d < bestDist) {
        best = t;
        bestDist = d;
      }
    }
    if (best) {
      s.label = textOf(best);
      usedText.add(best.id);
    }
  }

  // 5. Groups: a labeled shape that fully contains two or more other components.
  for (const s of shapes) {
    if (!s.label) continue;
    const inside = shapes.filter((o) => o !== s && fullyContains(s.el, o.el));
    if (inside.length >= 2) s.isGroup = true;
  }
  // Stable order: top to bottom, then left to right.
  shapes.sort((a, b) => box(a.el).y1 - box(b.el).y1 || box(a.el).x1 - box(b.el).x1);

  // Duplicate labels get (1), (2) in that order.
  const baseLabel = (s: Shape) => s.label ?? `unlabeled ${s.el.type}`;
  const counts = new Map<string, number>();
  for (const s of shapes) counts.set(baseLabel(s), (counts.get(baseLabel(s)) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const s of shapes) {
    const base = baseLabel(s);
    if (counts.get(base)! > 1) {
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      s.finalLabel = `${base} (${n})`;
    } else {
      s.finalLabel = base;
    }
  }
  // Each component belongs to the smallest group box around it, named by the group's final label.
  const finalById = new Map(shapes.map((s) => [s.el.id, s.finalLabel!]));
  for (const s of shapes) {
    const g = shapes
      .filter((x) => x.isGroup && x !== s && fullyContains(x.el, s.el))
      .sort((a, b) => area(a.el) - area(b.el))[0];
    s.group = g ? finalById.get(g.el.id) : undefined;
  }

  // 6–7. Connections and dangling arrows.
  const resolve = (id?: string) => {
    if (!id) return undefined;
    let e = byId.get(id);
    // An arrow bound to a shape's text resolves to the shape.
    if (e?.type === "text" && e.containerId) e = byId.get(e.containerId);
    return e ? finalById.get(e.id) : undefined;
  };
  const connections: DiagramSummary["connections"] = [];
  const danglingArrows: DiagramSummary["danglingArrows"] = [];
  const links = elements
    .filter((e) => LINKS.has(e.type))
    .sort((a, b) => box(a).y1 - box(b).y1 || box(a).x1 - box(b).x1);
  for (const a of links) {
    let from = resolve(a.startBinding?.elementId);
    let to = resolve(a.endBinding?.elementId);
    const label = boundLabel.get(a.id);
    const both = !!a.startArrowhead && !!a.endArrowhead;
    // Only a start arrowhead: the arrow points backwards.
    if (a.startArrowhead && !a.endArrowhead) [from, to] = [to, from];
    if (from && to) {
      connections.push({
        from,
        to,
        ...(label ? { label } : {}),
        bidirectional: both,
        ...(fromClaude(a) ? { fromClaude: true } : {}),
      });
    } else {
      danglingArrows.push({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(label ? { label } : {}) });
    }
  }

  // 8. Loose text.
  const looseText = elements
    .filter((e) => e.type === "text" && !usedText.has(e.id) && textOf(e))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(textOf);

  return {
    components: shapes.map((s) => ({
      id: s.el.id,
      label: s.finalLabel!,
      shape: s.isGroup ? "group" : s.el.type,
      ...(s.group ? { group: s.group } : {}),
      ...(s.fromClaude ? { fromClaude: true } : {}),
    })),
    connections,
    danglingArrows,
    looseText,
  };
}

/** Text form sent to Claude. */
export function summaryToText(s: DiagramSummary): string {
  if (!s.components.length && !s.connections.length && !s.danglingArrows.length && !s.looseText.length) {
    return "The canvas is empty.";
  }
  const tag = (fromClaudeSketch?: boolean) => (fromClaudeSketch ? ` ${CLAUDE_TAG}` : "");
  const out: string[] = [];
  out.push(`Components (${s.components.length}):`);
  for (const c of s.components) {
    const extra = c.shape === "group" ? " [group box]" : c.group ? ` [group: ${c.group}]` : "";
    out.push(`- ${c.label}${extra}${tag(c.fromClaude)}`);
  }
  if (s.connections.length) {
    out.push("", `Connections (${s.connections.length}):`);
    for (const c of s.connections) {
      out.push(`- ${c.from} ${c.bidirectional ? "<->" : "->"} ${c.to}${c.label ? ` [${c.label}]` : ""}${tag(c.fromClaude)}`);
    }
  }
  if (s.danglingArrows.length) {
    out.push("", `Arrows not attached at both ends (${s.danglingArrows.length}):`);
    for (const d of s.danglingArrows) out.push(`- ${d.from ?? "?"} -> ${d.to ?? "?"}${d.label ? ` [${d.label}]` : ""}`);
  }
  if (s.looseText.length) {
    out.push("", `Loose text (${s.looseText.length}):`);
    for (const t of s.looseText) out.push(`- "${t}"`);
  }
  return out.join("\n");
}

/** Labels Claude may name in a sketch: every component label exactly as the summary prints it. */
export function summaryLabels(s: DiagramSummary): Set<string> {
  return new Set(s.components.map((c) => c.label));
}
