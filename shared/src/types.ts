// Types shared by the client and the server.

export type Difficulty = "easy" | "medium" | "hard";

export type SessionMeta = {
  id: string;
  title: string;
  difficulty: Difficulty;
  createdAt: string;
  updatedAt: string;
  claudeSessionId?: string;
  reviewCount: number;
  /** Set when the candidate keeps or discards a sketch; the next prompt to Claude reports it once. */
  sketchFeedback?: "kept" | "discarded";
};

/** A session folder that failed validation. Shown in the sidebar as unreadable. */
export type BrokenSession = { id: string; unreadable: true; error: string };

export type SessionListItem = SessionMeta | BrokenSession;

export type ProposalStatus = "pending" | "accepted" | "discarded";

export type Proposal = {
  id: string;
  ops: CanvasOp[];
  status: ProposalStatus;
};

export type MessageKind = "question" | "chat" | "review-request" | "review";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  kind: MessageKind;
  text: string;
  createdAt: string;
  /** File name of the PNG sent with a review request, inside the session folder. */
  reviewImage?: string;
  proposal?: Proposal;
};

export type DiagramSummary = {
  /** `fromClaude` marks elements from a sketch the candidate kept. */
  components: { id: string; label: string; shape: string; group?: string; fromClaude?: boolean }[];
  connections: { from: string; to: string; label?: string; bidirectional: boolean; fromClaude?: boolean }[];
  danglingArrows: { from?: string; to?: string; label?: string }[];
  looseText: string[];
};

export type Side = "left" | "right" | "above" | "below";

export type CanvasOp =
  | {
      op: "add_component";
      ref: string;
      label: string;
      shape: "rectangle" | "ellipse" | "diamond";
      near?: string;
      side?: Side;
    }
  | { op: "add_connection"; from: string; to: string; label?: string; bidirectional?: boolean }
  | { op: "add_note"; text: string; near?: string; side?: Side };

/** Excalidraw file format as saved to scene.excalidraw. Elements stay loosely typed here. */
export type SceneFile = {
  type: "excalidraw";
  version: number;
  source?: string;
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

export type Health = { ok: boolean; claudeReady: boolean; error?: string };

export type SessionDetail = {
  meta: SessionMeta;
  question: string;
  scene: SceneFile | null;
  chat: ChatMessage[];
};

export type NewSessionBody = { topic?: string; difficulty?: Difficulty };

export type ErrorCode = "claude_auth" | "claude_limit" | "claude_failed" | "bad_request" | "not_found";

export type StreamEvent =
  | { event: "session"; data: { meta: SessionMeta } }
  | { event: "delta"; data: { text: string } }
  | { event: "status"; data: { text: string } }
  | {
      event: "done";
      /** `request` is the saved user message the reply answers; `meta` is the session after the call. */
      data: { message: ChatMessage; request?: ChatMessage; meta?: SessionMeta };
    }
  | { event: "error"; data: { message: string; code: ErrorCode } };

export const SKETCH_COLOR = "#6741d9";
export const MAX_SKETCH_OPS = 5;
