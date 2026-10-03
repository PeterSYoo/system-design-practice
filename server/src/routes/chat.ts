import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { summarizeScene, summaryLabels, summaryToText, type ChatMessage, type SceneFile } from "@sdp/shared";
import { store } from "../app-store.js";
import { claudeErrorEvent } from "../claude.js";
import { converse } from "../conversation.js";
import { localIso } from "../fsutil.js";
import { reviewPrompt } from "../prompts.js";
import { CanvasOpsFilter, extractSketch, reviewText } from "../proposal.js";
import { MessageBodySchema, ProposalDecisionSchema, SceneSchema } from "../schemas.js";
import { sseJob, tryLock, unlock, type Emit } from "../sse.js";
import { StoreError } from "../store.js";
import { errorResponse } from "./errors.js";

export const chat = new Hono();

/** Checks the session exists and takes its Claude lock. Returns an error response, or null to go ahead. */
async function begin(c: Context, id: string): Promise<Response | null> {
  try {
    await store.getMeta(id);
  } catch (err) {
    return errorResponse(c, err);
  }
  if (!tryLock(id)) return c.json({ message: "Claude is still answering the previous request.", code: "bad_request" }, 409);
  return null;
}

/**
 * Streams one Claude turn and returns the full reply text, or null after sending an error event.
 * With a sketch filter, the raw <canvas-ops> block is held back from the browser.
 */
export async function streamTurn(
  id: string,
  prompt: string,
  emit: Emit,
  opts: { tools?: string[]; sketchFilter?: CanvasOpsFilter } = {},
): Promise<string | null> {
  // Tell Claude once what happened to its last sketch.
  const { sketchFeedback } = await store.getMeta(id);
  const note = sketchFeedback ? `The candidate ${sketchFeedback === "kept" ? "kept" : "discarded"} your last sketch.

` : "";
  try {
    let text = "";
    for await (const ev of converse(id, note + prompt, opts.tools)) {
      if (ev.type === "delta") {
        if (!opts.sketchFilter) {
          emit("delta", { text: ev.text });
          continue;
        }
        const { forward, startedSketch } = opts.sketchFilter.feed(ev.text);
        if (forward) emit("delta", { text: forward });
        if (startedSketch) emit("status", { text: "Sketching on your canvas" });
      } else if (ev.type === "reading") {
        emit("status", { text: "Looking at your diagram" });
      } else if (ev.type === "done") {
        text = ev.text;
      }
    }
    const held = opts.sketchFilter?.flush();
    if (held) emit("delta", { text: held });
    if (note) await store.updateMeta(id, { sketchFeedback: undefined });
    return text;
  } catch (err) {
    emit("error", claudeErrorEvent(err));
    return null;
  }
}

const MAX_PNG_BYTES = 5 * 1024 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Reads the review form: scene as JSON, image as an optional PNG of at most 5 MB. */
async function readReviewForm(c: Context): Promise<{ scene: SceneFile; png: Uint8Array | null }> {
  const form = await c.req.formData();
  const sceneField = form.get("scene");
  const sceneJson = typeof sceneField === "string" ? sceneField : sceneField ? await sceneField.text() : null;
  if (!sceneJson) throw new StoreError("bad_request", "Missing scene");
  const scene = SceneSchema.parse(JSON.parse(sceneJson)) as SceneFile;

  const image = form.get("image");
  if (image === null) return { scene, png: null };
  if (typeof image === "string" || image.type !== "image/png") throw new StoreError("bad_request", "The image must be a PNG");
  if (image.size > MAX_PNG_BYTES) throw new StoreError("bad_request", "The image is larger than 5 MB");
  const png = new Uint8Array(await image.arrayBuffer());
  if (!PNG_MAGIC.every((b, i) => png[i] === b)) throw new StoreError("bad_request", "The image is not a valid PNG");
  return { scene, png };
}

chat.post("/:id/review", async (c) => {
  const id = c.req.param("id");
  let form: Awaited<ReturnType<typeof readReviewForm>>;
  try {
    store.dir(id);
    form = await readReviewForm(c);
  } catch (err) {
    return errorResponse(c, err);
  }
  const blocked = await begin(c, id);
  if (blocked) return blocked;

  return sseJob(c, async (emit) => {
    try {
      const meta = await store.getMeta(id);
      const n = meta.reviewCount + 1;
      const pngName = form.png ? `review-${n}.png` : null;
      await store.saveScene(id, form.scene);
      if (form.png && pngName) await store.writeFile(id, pngName, form.png);

      const summary = summarizeScene(form.scene.elements);
      const prompt = reviewPrompt({
        n,
        pngPath: pngName ? `${id}/${pngName}` : null,
        summaryText: summaryToText(summary),
        allowSketch: true,
      });

      const request: ChatMessage = {
        id: randomUUID(),
        role: "user",
        kind: "review-request",
        text: "Check my work",
        createdAt: localIso(),
        ...(pngName ? { reviewImage: pngName } : {}),
      };
      const reply = await streamTurn(id, prompt, emit, { tools: ["Read"], sketchFilter: new CanvasOpsFilter() });
      if (reply === null) return;

      // A bad sketch never fails the review: the text is kept and a note says the sketch was dropped.
      const sketch = extractSketch(reply, summaryLabels(summary));
      const message: ChatMessage = {
        id: randomUUID(),
        role: "assistant",
        kind: "review",
        text: reviewText(sketch),
        createdAt: localIso(),
        ...(sketch.ops ? { proposal: { id: randomUUID(), ops: sketch.ops, status: "pending" as const } } : {}),
      };
      await store.appendMessages(id, request, message);
      const updated = await store.updateMeta(id, { reviewCount: n });
      emit("done", { message, request, meta: updated });
    } finally {
      unlock(id);
    }
  });
});

chat.post("/:id/messages", async (c) => {
  const id = c.req.param("id");
  let text: string;
  try {
    text = MessageBodySchema.parse(await c.req.json()).text;
  } catch (err) {
    return errorResponse(c, err);
  }
  const blocked = await begin(c, id);
  if (blocked) return blocked;

  return sseJob(c, async (emit) => {
    try {
      const request: ChatMessage = { id: randomUUID(), role: "user", kind: "chat", text, createdAt: localIso() };
      const reply = await streamTurn(id, text, emit, { tools: [] });
      if (reply === null) return;
      const message: ChatMessage = { id: randomUUID(), role: "assistant", kind: "chat", text: reply, createdAt: localIso() };
      await store.appendMessages(id, request, message);
      emit("done", { message, request, meta: await store.getMeta(id) });
    } finally {
      unlock(id);
    }
  });
});

chat.post("/:id/proposals/:proposalId", async (c) => {
  const id = c.req.param("id");
  const proposalId = c.req.param("proposalId");
  try {
    const { decision } = ProposalDecisionSchema.parse(await c.req.json());
    const chatLog = await store.readChat(id);
    const owner = chatLog.find((m) => m.proposal?.id === proposalId);
    if (!owner) throw new StoreError("not_found", "Sketch not found");
    if (owner.proposal!.status === "pending") {
      const status = decision === "accept" ? "accepted" : "discarded";
      await store.updateMessage(id, owner.id, (m) => ({ ...m, proposal: { ...m.proposal!, status } }));
      await store.updateMeta(id, { sketchFeedback: decision === "accept" ? "kept" : "discarded" });
    }
    return c.json({ ok: true });
  } catch (err) {
    return errorResponse(c, err);
  }
});
