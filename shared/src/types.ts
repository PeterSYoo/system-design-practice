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

/** Models offered in the picker. An empty string means Claude Code's default (or SDP_MODEL). */
export const CLAUDE_MODELS = [
  { id: "", label: "Default" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
] as const;

/** Models that take no effort setting. */
export const MODELS_WITHOUT_EFFORT: readonly string[] = ["claude-haiku-4-5"];

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** The model and effort every Claude call uses. Unset fields fall back to Claude Code's defaults. */
export type ClaudeSettings = { model?: string; effort?: EffortLevel };

// Multiple choice quiz.

export const QUIZ_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type QuizLevel = (typeof QUIZ_LEVELS)[number];

export const QUIZ_CHOICES = ["A", "B", "C"] as const;
export type QuizChoice = (typeof QUIZ_CHOICES)[number];

/** answer: picking A, B, or C. explain: free recall after the right pick. done: waiting for "next". */
export type QuizPhase = "answer" | "explain" | "done";

export type QuizMessageKind = "pick" | "hint" | "correct" | "explanation" | "feedback" | "chat";

export type QuizMessage = {
  id: string;
  role: "user" | "assistant";
  kind: QuizMessageKind;
  text: string;
  createdAt: string;
  /** The letter picked, on `pick` messages. */
  choice?: QuizChoice;
};

export type QuizQuestion = {
  id: string;
  topic: string;
  level: QuizLevel;
  question: string;
  /** Choice texts for A, B, and C. */
  choices: [string, string, string];
  /** The right letter. The server leaves it out of what it sends until the student picks it. */
  answer?: QuizChoice;
  /** Number of picks so far. A point needs a right pick on attempt 1. */
  attempts: number;
  phase: QuizPhase;
  messages: QuizMessage[];
  createdAt: string;
};

export type QuizMeta = {
  id: string;
  /** The level picked at setup. Questions drift up or down from it. */
  level: QuizLevel;
  createdAt: string;
  updatedAt: string;
  /** Questions answered right on the first pick. */
  score: number;
  /** Questions with at least one pick. */
  answered: number;
};

export type QuizDetail = { meta: QuizMeta; questions: QuizQuestion[] };

export type NewQuizBody = { level: QuizLevel };

export type QuizStreamEvent =
  | { event: "quiz"; data: { meta: QuizMeta } }
  | { event: "delta"; data: { text: string } }
  | { event: "status"; data: { text: string } }
  | { event: "done"; data: { quiz: QuizDetail } }
  | { event: "error"; data: { message: string; code: ErrorCode } };
