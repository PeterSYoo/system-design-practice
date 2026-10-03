import { readFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import type { NewSessionBody, SceneFile } from "@sdp/shared";
import { store } from "../app-store.js";
import { claudeErrorEvent } from "../claude.js";
import { createSessionWithQuestion } from "../question.js";
import { NewSessionBodySchema, SceneSchema } from "../schemas.js";
import { sseJob } from "../sse.js";
import { errorResponse } from "./errors.js";

export const sessions = new Hono();

sessions.get("/", async (c) => {
  try {
    return c.json(await store.list());
  } catch (err) {
    return errorResponse(c, err);
  }
});

sessions.post("/", async (c) => {
  let body: NewSessionBody;
  try {
    body = NewSessionBodySchema.parse(await c.req.json().catch(() => ({})));
  } catch (err) {
    return errorResponse(c, err);
  }
  return sseJob(c, async (emit) => {
    try {
      await createSessionWithQuestion(body, emit);
    } catch (err) {
      emit("error", claudeErrorEvent(err));
    }
  });
});

sessions.get("/:id", async (c) => {
  try {
    return c.json(await store.load(c.req.param("id")));
  } catch (err) {
    return errorResponse(c, err);
  }
});

// Review PNGs, for the thumbnails on review requests in the chat.
sessions.get("/:id/images/:name", async (c) => {
  const name = c.req.param("name");
  if (!/^review-\d+\.png$/.test(name)) return c.json({ message: "Not found", code: "not_found" }, 404);
  try {
    const data = await readFile(path.join(store.dir(c.req.param("id")), name));
    return c.body(data, 200, { "content-type": "image/png", "cache-control": "private, max-age=31536000, immutable" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return c.json({ message: "Not found", code: "not_found" }, 404);
    return errorResponse(c, err);
  }
});

sessions.put("/:id/scene", async (c) => {
  try {
    const scene = SceneSchema.parse(await c.req.json()) as SceneFile;
    const updatedAt = await store.saveScene(c.req.param("id"), scene);
    return c.json({ updatedAt });
  } catch (err) {
    return errorResponse(c, err);
  }
});

sessions.delete("/:id", async (c) => {
  try {
    await store.remove(c.req.param("id"));
    return c.json({ ok: true });
  } catch (err) {
    return errorResponse(c, err);
  }
});
