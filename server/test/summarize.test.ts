import { describe, expect, it } from "vitest";
import { summarizeScene, summaryToText } from "@sdp/shared";

// Small hand-written Excalidraw elements with only the fields the summarizer reads.
type Extra = Record<string, unknown>;
const shape = (type: string, id: string, x: number, y: number, w = 160, h = 70, extra: Extra = {}) => ({
  id, type, x, y, width: w, height: h, isDeleted: false, ...extra,
});
const rect = (id: string, x: number, y: number, w?: number, h?: number, extra?: Extra) => shape("rectangle", id, x, y, w, h, extra);
const text = (id: string, t: string, x: number, y: number, containerId: string | null = null, extra: Extra = {}) => ({
  id, type: "text", text: t, originalText: t, x, y, width: t.length * 8, height: 20, containerId, isDeleted: false, ...extra,
});
const arrow = (id: string, start: string | null, end: string | null, extra: Extra = {}) => ({
  id, type: "arrow", x: 0, y: 0, width: 100, height: 0, isDeleted: false,
  startBinding: start ? { elementId: start, focus: 0, gap: 1 } : null,
  endBinding: end ? { elementId: end, focus: 0, gap: 1 } : null,
  startArrowhead: null, endArrowhead: "arrow", ...extra,
});

const summarize = (els: unknown[]) => summarizeScene(els);

describe("summarizeScene", () => {
  it("uses bound text as a component label", () => {
    const s = summarize([rect("a", 0, 0), text("ta", "API Gateway", 40, 25, "a")]);
    expect(s.components).toEqual([{ id: "a", label: "API Gateway", shape: "rectangle" }]);
    expect(s.looseText).toEqual([]);
  });

  it("uses the nearest unbound text inside a shape as its label", () => {
    const s = summarize([
      rect("a", 0, 0, 200, 100),
      text("far", "corner note", 5, 5),
      text("near", "Cache", 80, 40),
      text("out", "outside", 500, 500),
    ]);
    expect(s.components[0].label).toBe("Cache");
    expect(s.looseText).toEqual(["corner note", "outside"]);
  });

  it("labels shapes with no text as unlabeled <shape>", () => {
    const s = summarize([shape("diamond", "d", 0, 0)]);
    expect(s.components[0].label).toBe("unlabeled diamond");
  });

  it("reads connections with arrow labels", () => {
    const s = summarize([
      rect("a", 0, 0), text("ta", "Client", 40, 25, "a"),
      rect("b", 300, 0), text("tb", "API", 340, 25, "b"),
      arrow("ar", "a", "b"), text("tl", "HTTPS", 200, 10, "ar"),
    ]);
    expect(s.connections).toEqual([{ from: "Client", to: "API", label: "HTTPS", bidirectional: false }]);
  });

  it("marks arrows with heads at both ends as bidirectional", () => {
    const s = summarize([
      rect("a", 0, 0), text("ta", "Service", 40, 25, "a"),
      rect("b", 300, 0), text("tb", "DB", 340, 25, "b"),
      arrow("ar", "a", "b", { startArrowhead: "arrow", endArrowhead: "arrow" }),
    ]);
    expect(s.connections[0]).toMatchObject({ from: "Service", to: "DB", bidirectional: true });
  });

  it("reverses an arrow whose only head is at the start", () => {
    const s = summarize([
      rect("a", 0, 0), text("ta", "A", 40, 25, "a"),
      rect("b", 300, 0), text("tb", "B", 340, 25, "b"),
      arrow("ar", "a", "b", { startArrowhead: "arrow", endArrowhead: null }),
    ]);
    expect(s.connections[0]).toMatchObject({ from: "B", to: "A" });
  });

  it("lists arrows with an unbound end as dangling, keeping the end that resolved", () => {
    const s = summarize([
      rect("a", 0, 0), text("ta", "Order Service", 40, 25, "a"),
      arrow("ar", "a", null), text("tl", "events", 200, 10, "ar"),
      arrow("free", null, null),
    ]);
    expect(s.connections).toEqual([]);
    expect(s.danglingArrows).toEqual([{ from: "Order Service", label: "events" }, {}]);
  });

  it("treats a labeled shape around two or more components as a group", () => {
    const s = summarize([
      rect("region", 0, 0, 600, 300), text("rl", "us-east-1", 10, 10),
      rect("svc", 50, 100), text("ts", "Order Service", 90, 125, "svc"),
      rect("db", 300, 100), text("td", "Orders DB", 340, 125, "db"),
      rect("client", 0, -200), text("tc", "Client", 40, -175, "client"),
    ]);
    expect(s.components).toEqual([
      { id: "client", label: "Client", shape: "rectangle" },
      { id: "region", label: "us-east-1", shape: "group" },
      { id: "svc", label: "Order Service", shape: "rectangle", group: "us-east-1" },
      { id: "db", label: "Orders DB", shape: "rectangle", group: "us-east-1" },
    ]);
  });

  it("does not treat a shape around a single component as a group", () => {
    const s = summarize([rect("outer", 0, 0, 400, 300), text("ol", "Outer", 10, 10), rect("in", 50, 50), text("il", "Inner", 90, 75, "in")]);
    expect(s.components.map((c) => c.shape)).toEqual(["rectangle", "rectangle"]);
  });

  it("drops deleted elements", () => {
    const s = summarize([
      rect("a", 0, 0, 160, 70, { isDeleted: true }), text("ta", "Gone", 40, 25, "a", { isDeleted: true }),
      text("t", "deleted note", 0, 300, null, { isDeleted: true }),
      rect("b", 300, 0), text("tb", "Kept", 340, 25, "b"),
    ]);
    expect(s.components.map((c) => c.label)).toEqual(["Kept"]);
    expect(s.looseText).toEqual([]);
  });

  it("numbers duplicate labels in reading order and uses them in connections", () => {
    const s = summarize([
      rect("c2", 0, 200), text("t2", "Cache", 40, 225, "c2"),
      rect("c1", 0, 0), text("t1", "Cache", 40, 25, "c1"),
      rect("api", 300, 100), text("ta", "API", 340, 125, "api"),
      arrow("ar", "api", "c2"),
    ]);
    expect(s.components.map((c) => c.label)).toEqual(["Cache (1)", "API", "Cache (2)"]);
    expect(s.connections[0]).toMatchObject({ from: "API", to: "Cache (2)" });
  });

  it("skips pending Claude sketches and tags kept ones", () => {
    const pending = { customData: { source: "claude", proposalId: "p1", status: "pending" } };
    const kept = { customData: { source: "claude", proposalId: "p0", status: "accepted" } };
    const s = summarize([
      rect("a", 0, 0), text("ta", "API", 40, 25, "a"),
      rect("p", 300, 0, 160, 70, pending), text("tp", "Queue", 340, 25, "p", pending),
      rect("k", 0, 200, 160, 70, kept), text("tk", "Cache", 40, 225, "k", kept),
      arrow("ka", "a", "k", kept),
    ]);
    expect(s.components.map((c) => c.label)).toEqual(["API", "Cache"]);
    const text_ = summaryToText(s);
    expect(text_).toContain("- Cache [from Claude's sketch]");
    expect(text_).toContain("- API -> Cache [from Claude's sketch]");
    expect(text_).not.toContain("Queue");
  });

  it("says the canvas is empty when nothing is drawn", () => {
    expect(summaryToText(summarize([]))).toBe("The canvas is empty.");
    expect(summaryToText(summarize([rect("a", 0, 0, 160, 70, { isDeleted: true })]))).toBe("The canvas is empty.");
  });
});

describe("summaryToText", () => {
  it("matches the design doc's example layout", () => {
    const s = summarize([
      rect("client", 0, 0), text("t1", "Client", 40, 25, "client"),
      rect("gw", 0, 150), text("t2", "API Gateway", 40, 175, "gw"),
      rect("auth", -250, 300), text("t3", "Auth Service", -210, 325, "auth"),
      rect("region", 0, 280, 600, 260), text("t4", "us-east-1", 10, 290),
      rect("orders", 50, 350), text("t5", "Order Service", 90, 375, "orders"),
      rect("db", 50, 450, 200, 70), text("t6", "Orders DB (Postgres)", 60, 475, "db"),
      arrow("a1", "client", "gw"), text("l1", "HTTPS", 0, 100, "a1"),
      arrow("a2", "gw", "auth"),
      arrow("a3", "gw", "orders"),
      arrow("a4", "orders", "db", { startArrowhead: "arrow", endArrowhead: "arrow" }),
      arrow("a5", "orders", null), text("l5", "events", 0, 0, "a5"),
      text("loose", "cache here?", 700, 700),
    ]);
    expect(summaryToText(s)).toBe(
      [
        "Components (6):",
        "- Client",
        "- API Gateway",
        "- us-east-1 [group box]",
        "- Auth Service",
        "- Order Service [group: us-east-1]",
        "- Orders DB (Postgres) [group: us-east-1]",
        "",
        "Connections (4):",
        "- Client -> API Gateway [HTTPS]",
        "- API Gateway -> Auth Service",
        "- API Gateway -> Order Service",
        "- Order Service <-> Orders DB (Postgres)",
        "",
        "Arrows not attached at both ends (1):",
        "- Order Service -> ? [events]",
        "",
        "Loose text (1):",
        '- "cache here?"',
      ].join("\n"),
    );
  });
});
