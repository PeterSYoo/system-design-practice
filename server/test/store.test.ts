import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage, SceneFile } from "@sdp/shared";
import { SessionStore, StoreError, slugify } from "../src/store.js";

let root: string;
let store: SessionStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "sdp-store-"));
  store = new SessionStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const scene = (n: number): SceneFile => ({
  type: "excalidraw",
  version: 2,
  source: "test",
  elements: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, type: "rectangle", version: 1 })),
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

const msg = (id: string, text: string): ChatMessage => ({
  id,
  role: "user",
  kind: "chat",
  text,
  createdAt: new Date().toISOString(),
});

describe("slugify", () => {
  it("makes a lowercase dash slug", () => {
    expect(slugify("Design a URL Shortener!")).toBe("design-a-url-shortener");
    expect(slugify("???")).toBe("session");
  });
});

describe("SessionStore", () => {
  it("creates a session folder with the expected files", async () => {
    const meta = await store.create({ title: "Design a URL shortener", difficulty: "medium", question: "Q?" });
    expect(meta.id).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}_design-a-url-shortener$/);
    const dir = store.dir(meta.id);
    for (const f of ["meta.json", "chat.json", "question.md"]) expect(existsSync(path.join(dir, f))).toBe(true);
    expect(await readFile(path.join(dir, "question.md"), "utf8")).toBe("Q?");
  });

  it("appends -2, -3 when the ID is taken", async () => {
    const a = await store.create({ title: "Same", difficulty: "easy" });
    const b = await store.create({ title: "Same", difficulty: "easy" });
    const c = await store.create({ title: "Same", difficulty: "easy" });
    expect(b.id).toBe(`${a.id}-2`);
    expect(c.id).toBe(`${a.id}-3`);
  });

  it("lists sessions newest first and marks unreadable ones", async () => {
    const a = await store.create({ title: "First", difficulty: "easy" });
    await store.updateMeta(a.id, { createdAt: "2026-01-01T10:00:00+00:00" });
    const b = await store.create({ title: "Second", difficulty: "hard" });
    await mkdir(path.join(store.sessionsDir, "broken"));
    await writeFile(path.join(store.sessionsDir, "broken", "meta.json"), "{not json");

    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual([b.id, a.id, "broken"]);
    expect(list[2]).toMatchObject({ unreadable: true });
  });

  it("loads a session with null scene before the first save", async () => {
    const meta = await store.create({ title: "Load me", difficulty: "medium", question: "Text" });
    const detail = await store.load(meta.id);
    expect(detail).toMatchObject({ meta: { id: meta.id }, question: "Text", scene: null, chat: [] });
  });

  it("saves and reloads a scene in Excalidraw file format", async () => {
    const meta = await store.create({ title: "Scene", difficulty: "medium" });
    await store.saveScene(meta.id, scene(3));
    const raw = JSON.parse(await readFile(path.join(store.dir(meta.id), "scene.excalidraw"), "utf8"));
    expect(raw.type).toBe("excalidraw");
    expect(raw.elements).toHaveLength(3);
    expect((await store.load(meta.id)).scene?.elements).toHaveLength(3);
    expect(existsSync(path.join(store.dir(meta.id), "scene.excalidraw.tmp"))).toBe(false);
  });

  it("serializes concurrent writes so none are lost", async () => {
    const meta = await store.create({ title: "Busy", difficulty: "medium" });
    await Promise.all([
      store.saveScene(meta.id, scene(1)),
      ...Array.from({ length: 10 }, (_, i) => store.appendMessages(meta.id, msg(`m${i}`, `hi ${i}`))),
      store.saveScene(meta.id, scene(2)),
    ]);
    const detail = await store.load(meta.id);
    expect(detail.chat.map((m) => m.id)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i}`));
    expect(detail.scene?.elements).toHaveLength(2);
  });

  it("updates one message", async () => {
    const meta = await store.create({ title: "Upd", difficulty: "medium" });
    await store.appendMessages(meta.id, msg("a", "one"), msg("b", "two"));
    await store.updateMessage(meta.id, "b", (m) => ({ ...m, text: "TWO" }));
    expect((await store.readChat(meta.id)).map((m) => m.text)).toEqual(["one", "TWO"]);
  });

  it("moves a deleted session to trash", async () => {
    const meta = await store.create({ title: "Bye", difficulty: "medium" });
    await store.remove(meta.id);
    expect(existsSync(store.dir(meta.id))).toBe(false);
    expect(existsSync(path.join(store.trashDir, meta.id, "meta.json"))).toBe(true);
    expect(await store.list()).toEqual([]);
  });

  it("reports missing sessions as not_found", async () => {
    await expect(store.load("nope")).rejects.toMatchObject({ code: "not_found" });
    await expect(store.remove("nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it.each(["../etc", "..", "a/b", "a\\b", "UPPER", "with space", "", "a.b", "%2e%2e"])(
    "rejects bad ID %j",
    async (id) => {
      expect(() => store.dir(id)).toThrow(StoreError);
      await expect(store.load(id)).rejects.toMatchObject({ code: "bad_request" });
    },
  );

  it("rejects invalid chat.json on load", async () => {
    const meta = await store.create({ title: "Bad chat", difficulty: "medium" });
    await writeFile(path.join(store.dir(meta.id), "chat.json"), JSON.stringify([{ id: 1 }]));
    await expect(store.load(meta.id)).rejects.toThrow();
  });
});
