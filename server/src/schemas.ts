import { z } from "zod";
import { EFFORT_LEVELS } from "@sdp/shared";

export const DifficultySchema = z.enum(["easy", "medium", "hard"]);

export const SessionMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  difficulty: DifficultySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  claudeSessionId: z.string().optional(),
  reviewCount: z.number().int().nonnegative(),
  sketchFeedback: z.enum(["kept", "discarded"]).optional(),
});

const SideSchema = z.enum(["left", "right", "above", "below"]);

export const CanvasOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_component"),
    ref: z.string().min(1),
    label: z.string().min(1),
    shape: z.enum(["rectangle", "ellipse", "diamond"]),
    near: z.string().optional(),
    side: SideSchema.optional(),
  }),
  z.object({
    op: z.literal("add_connection"),
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().optional(),
    bidirectional: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("add_note"),
    text: z.string().min(1),
    near: z.string().optional(),
    side: SideSchema.optional(),
  }),
]);

export const ProposalSchema = z.object({
  id: z.string(),
  ops: z.array(CanvasOpSchema),
  status: z.enum(["pending", "accepted", "discarded"]),
});

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  kind: z.enum(["question", "chat", "review-request", "review"]),
  text: z.string(),
  createdAt: z.string(),
  reviewImage: z.string().optional(),
  proposal: ProposalSchema.optional(),
});

export const ChatSchema = z.array(ChatMessageSchema);

export const SceneSchema = z.looseObject({
  type: z.literal("excalidraw"),
  version: z.number(),
  source: z.string().optional(),
  elements: z.array(z.record(z.string(), z.unknown())),
  appState: z.record(z.string(), z.unknown()).default({}),
  files: z.record(z.string(), z.unknown()).default({}),
});

export const NewSessionBodySchema = z.object({
  topic: z.string().max(200).optional(),
  difficulty: DifficultySchema.optional(),
});

export const MessageBodySchema = z.object({ text: z.string().trim().min(1).max(8000) });

export const ProposalDecisionSchema = z.object({ decision: z.enum(["accept", "discard"]) });

export const SettingsSchema = z.object({
  model: z.string().trim().max(100).optional(),
  effort: z.enum(EFFORT_LEVELS).optional(),
});
