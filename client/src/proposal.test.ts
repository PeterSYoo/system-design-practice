import { describe, expect, it } from "vitest";
import { SKETCH_COLOR, type CanvasOp } from "@sdp/shared";
import {
  buildProposalElements,
  COMPONENT_H,
  COMPONENT_W,
  GAP,
  PARALLEL_OFFSET,
  placeOps,
  STEP,
  type SceneElement,
  type Skeleton,
} from "./proposal";

// A user's box "Order Service" at (0,0), 200×100, labeled with bound text.
const box = (id: string, label: string, x: number, y: number, w = 200, h = 100): SceneElement[] => [
  { id, type: "rectangle", x, y, width: w, height: h, version: 1, boundElements: [{ id: `${id}_t`, type: "text" }] },
  { id: `${id}_t`, type: "text", x: x + 20, y: y + 40, width: 100, height: 20, text: label, containerId: id, version: 1 },
];
const scene = box("svc", "Order Service", 0, 0);
const proposal = (ops: CanvasOp[]) => ({ id: "prop-1234-abcd", ops });
const component = (side?: "left" | "right" | "above" | "below"): CanvasOp => ({
  op: "add_component", ref: "c1", label: "Cache", shape: "rectangle", near: "Order Service", ...(side ? { side } : {}),
});
const only = (sk: Skeleton[]) => {
  expect(sk).toHaveLength(1);
  return sk[0] as Skeleton & { x: number; y: number; width: number; height: number };
};

describe("placeOps", () => {
  it.each([
    ["right", GAP + 200, 50 - COMPONENT_H / 2],
    ["left", -GAP - COMPONENT_W, 50 - COMPONENT_H / 2],
    ["above", 100 - COMPONENT_W / 2, -GAP - COMPONENT_H],
    ["below", 100 - COMPONENT_W / 2, 100 + GAP],
  ] as const)("places a component %s of its near component, 80 px away", (side, x, y) => {
    const c = only(placeOps(scene, proposal([component(side)])).skeletons);
    expect([c.x, c.y, c.width, c.height]).toEqual([x, y, COMPONENT_W, COMPONENT_H]);
  });

  it("defaults to the right side", () => {
    expect(only(placeOps(scene, proposal([component()])).skeletons).x).toBe(200 + GAP);
  });

  it("moves 90 px further along the side while it overlaps something", () => {
    // Something already sits where the cache would go, and one step further too.
    const blocked = [...scene, ...box("x1", "Other", 280, 0, 160, 100), ...box("x2", "Other 2", 370, 0, 160, 100)];
    const c = only(placeOps(blocked, proposal([component("right")])).skeletons);
    // The blockers span x 280..530; three steps clear them and the 10 px margin.
    expect(c.x).toBe(200 + GAP + 3 * STEP);
  });

  it("gives up moving after 10 steps", () => {
    const wall = { id: "wall", type: "rectangle", x: 250, y: -500, width: 5000, height: 1000, version: 1 };
    const c = only(placeOps([...scene, wall], proposal([component("right")])).skeletons);
    expect(c.x).toBe(200 + GAP + 10 * STEP);
  });

  it("places a component with no near 80 px right of the whole scene", () => {
    const wide = [...scene, ...box("db", "Orders DB", 500, 300)];
    const c = only(placeOps(wide, proposal([{ op: "add_component", ref: "q", label: "Queue", shape: "ellipse" }])).skeletons);
    expect([c.x, c.y]).toEqual([700 + GAP, 0]);
    expect(c.type).toBe("ellipse");
  });

  it("places notes by the same rules, as text", () => {
    const { skeletons } = placeOps(scene, proposal([{ op: "add_note", text: "what if this is down?", near: "Order Service", side: "below" }]));
    const note = only(skeletons);
    expect(note.type).toBe("text");
    expect(note.text).toBe("what if this is down?");
    expect(note.y).toBe(100 + GAP);
  });

  it("connects to a component added earlier in the same sketch by its ref", () => {
    const { skeletons, bindings } = placeOps(
      scene,
      proposal([component("right"), { op: "add_connection", from: "Order Service", to: "c1", label: "read" }]),
    );
    const [cache, arrow] = skeletons;
    expect(arrow.type).toBe("arrow");
    expect(arrow.label).toMatchObject({ text: "read" });
    expect(bindings).toEqual([{ arrowId: arrow.id, startId: "svc", endId: cache.id }]);
    // Starts at the right edge of Order Service and ends at the left edge of the cache.
    expect(arrow.x).toBeGreaterThanOrEqual(200);
    const [, [dx]] = arrow.points as number[][];
    expect((arrow.x as number) + dx).toBeLessThanOrEqual(cache.x as number);
  });

  it("runs a connection beside an existing arrow between the same components", () => {
    const withArrow = [
      ...scene,
      ...box("db", "Orders DB", 0, 300),
      { id: "a1", type: "arrow", x: 100, y: 106, width: 0, height: 188, version: 1,
        startBinding: { elementId: "svc" }, endBinding: { elementId: "db" } },
    ];
    const { skeletons } = placeOps(withArrow, proposal([{ op: "add_connection", from: "Order Service", to: "Orders DB" }]));
    const arrow = only(skeletons);
    // The existing arrow runs straight down at x=100; the new one is shifted sideways by the offset.
    expect(Math.abs((arrow.x as number) - 100)).toBe(PARALLEL_OFFSET);
  });

  it("skips a connection whose ends cannot be found", () => {
    expect(placeOps(scene, proposal([{ op: "add_connection", from: "Order Service", to: "nope" }])).skeletons).toEqual([]);
  });

  it("makes every skeleton violet, locked, and tagged with the proposal", () => {
    const { skeletons } = placeOps(
      scene,
      proposal([component(), { op: "add_connection", from: "c1", to: "Order Service" }, { op: "add_note", text: "hi" }]),
    );
    expect(skeletons).toHaveLength(3);
    for (const s of skeletons) {
      expect(s).toMatchObject({
        strokeColor: SKETCH_COLOR,
        locked: true,
        customData: { source: "claude", proposalId: "prop-1234-abcd", status: "pending" },
      });
    }
  });
});

describe("buildProposalElements", () => {
  // Stand-in for convertToExcalidrawElements: labels become separate text elements, as in Excalidraw.
  const fakeConvert = (sk: Skeleton[]): SceneElement[] =>
    sk.flatMap((s) => {
      const { label, ...rest } = s as Skeleton & { label?: { text: string } };
      const el = { width: 0, height: 0, x: 0, y: 0, version: 1, boundElements: null, ...rest } as SceneElement;
      return label ? [el, { id: `${s.id}_label`, type: "text", x: 0, y: 0, width: 0, height: 0, text: label.text, containerId: s.id }] : [el];
    });

  it("stamps color, lock, and customData on every element, labels included", () => {
    const { added } = buildProposalElements(
      scene,
      proposal([component(), { op: "add_connection", from: "Order Service", to: "c1", label: "read" }]),
      fakeConvert,
    );
    expect(added.length).toBe(4);
    for (const e of added) {
      expect(e).toMatchObject({ strokeColor: SKETCH_COLOR, locked: true, customData: { source: "claude", status: "pending" } });
    }
  });

  it("binds arrows at both ends and touches the user's shapes only to record the binding", () => {
    const { added, updated } = buildProposalElements(
      scene,
      proposal([component(), { op: "add_connection", from: "Order Service", to: "c1" }]),
      fakeConvert,
    );
    const arrow = added.find((e) => e.type === "arrow")!;
    const cache = added.find((e) => e.type === "rectangle")!;
    expect(arrow.startBinding).toMatchObject({ elementId: "svc" });
    expect(arrow.endBinding).toMatchObject({ elementId: cache.id });
    expect(cache.boundElements).toContainEqual({ id: arrow.id, type: "arrow" });

    expect(updated).toHaveLength(1);
    const svc = updated[0];
    const original = scene[0];
    expect(svc.boundElements).toEqual([...original.boundElements!, { id: arrow.id, type: "arrow" }]);
    expect({ ...svc, boundElements: original.boundElements, version: original.version }).toEqual(original);
  });
});
