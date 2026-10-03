import { describe, expect, it } from "vitest";
import { CanvasOpsFilter, SKETCH_FAILED_NOTE, extractSketch, reviewText } from "../src/proposal.js";

const labels = new Set(["Order Service", "Orders DB", "API Gateway"]);
const REVIEW = "**Overall:** Getting there.\n\n**Next step:** What happens when the DB is down?";
const block = (json: string) => `${REVIEW}\n\n<canvas-ops>\n${json}\n</canvas-ops>`;

describe("extractSketch", () => {
  it("cuts a valid block out of the reply and keeps its operations", () => {
    const ops = [
      { op: "add_component", ref: "c1", label: "Cache", shape: "rectangle", near: "Order Service", side: "right" },
      { op: "add_connection", from: "Order Service", to: "c1", label: "read" },
      { op: "add_note", text: "what if this is down?", near: "c1", side: "below" },
    ];
    const r = extractSketch(block(JSON.stringify(ops)), labels);
    expect(r).toEqual({ text: REVIEW, ops, hadBlock: true });
    expect(reviewText(r)).toBe(REVIEW);
  });

  it("returns no operations for malformed JSON, and the review notes the failed sketch", () => {
    const r = extractSketch(block('[{"op": "add_component", "ref": '), labels);
    expect(r).toEqual({ text: REVIEW, ops: null, hadBlock: true });
    expect(reviewText(r)).toBe(`${REVIEW}\n\n${SKETCH_FAILED_NOTE}`);
  });

  it("drops operations naming a label missing from the summary, and ones that depend on them", () => {
    const r = extractSketch(
      block(
        JSON.stringify([
          { op: "add_component", ref: "c1", label: "Queue", shape: "rectangle", near: "Payment Service" },
          { op: "add_connection", from: "c1", to: "Orders DB" },
          { op: "add_connection", from: "API Gateway", to: "Orders DB", label: "read" },
          { op: "add_note", text: "hmm", near: "Nowhere" },
        ]),
      ),
      labels,
    );
    expect(r.ops).toEqual([{ op: "add_connection", from: "API Gateway", to: "Orders DB", label: "read" }]);
  });

  it("keeps at most five operations", () => {
    const ops = Array.from({ length: 7 }, (_, i) => ({ op: "add_note", text: `note ${i}` }));
    const r = extractSketch(block(JSON.stringify(ops)), labels);
    expect(r.ops?.map((o) => (o.op === "add_note" ? o.text : ""))).toEqual(["note 0", "note 1", "note 2", "note 3", "note 4"]);
  });

  it("leaves a reply with no block unchanged", () => {
    expect(extractSketch(REVIEW, labels)).toEqual({ text: REVIEW, ops: null, hadBlock: false });
    expect(reviewText(extractSketch(REVIEW, labels))).toBe(REVIEW);
  });

  it("drops schema-invalid operations and a block with no closing tag still parses", () => {
    const r = extractSketch(
      `${REVIEW}\n<canvas-ops>[{"op":"add_component","ref":"c1","label":"X","shape":"hexagon"},{"op":"add_note","text":"ok"}]`,
      labels,
    );
    expect(r.ops).toEqual([{ op: "add_note", text: "ok" }]);
    expect(r.text).toBe(REVIEW);
  });

  it("rejects a component whose ref collides with an existing label", () => {
    const r = extractSketch(block(JSON.stringify([{ op: "add_component", ref: "Orders DB", label: "X", shape: "ellipse" }])), labels);
    expect(r.ops).toBeNull();
  });
});

describe("CanvasOpsFilter", () => {
  const run = (chunks: string[]) => {
    const f = new CanvasOpsFilter();
    let out = "";
    let started = 0;
    for (const c of chunks) {
      const r = f.feed(c);
      out += r.forward;
      if (r.startedSketch) started++;
    }
    return { out: out + f.flush(), started };
  };

  it("never forwards the block, even when the tag is split across deltas", () => {
    const r = run(["Review text. ", "<can", "vas-o", 'ps>\n[{"op":"add_note","text":"x"}]', "\n</canvas-ops>"]);
    expect(r.out).toBe("Review text. ");
    expect(r.started).toBe(1);
  });

  it("forwards held characters that turn out not to be the tag", () => {
    expect(run(["a <", "b> and <canv", "ass"]).out).toBe("a <b> and <canvass");
    expect(run(["ends with <canvas"]).out).toBe("ends with <canvas");
  });
});
