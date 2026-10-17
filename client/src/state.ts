import { create } from "zustand";
import type {
  ChatMessage,
  Difficulty,
  Health,
  Proposal,
  SceneFile,
  SessionListItem,
  SessionMeta,
  StreamEvent,
} from "@sdp/shared";
import { api, readStream, streams } from "./api";
import { useUsage } from "./usage-state";

/** What the Canvas component exposes. The scene lives in Excalidraw, never in this store. */
export type CanvasHandle = {
  getScene(): SceneFile;
  exportPng(): Promise<Blob | null>;
  /** Saves now if anything changed since the last save. */
  flushSave(): Promise<void>;
  applyProposal(p: Proposal): void;
  resolveProposal(proposalId: string, decision: "accept" | "discard"): void;
};

let canvas: CanvasHandle | null = null;
export const setCanvasHandle = (h: CanvasHandle | null) => {
  canvas = h;
};

type Streaming = { kind: "chat" | "review" | "question"; text: string; status?: string } | null;

export type StreamFailure = { message: string; retry: () => void };

/** The dashboard, diagram practice, or the multiple choice quiz. */
export type View = "home" | "practice" | "quiz";

type AppState = {
  view: View;
  sessions: SessionListItem[];
  currentId: string | null;
  meta: SessionMeta | null;
  question: string;
  messages: ChatMessage[];
  /** Scene to hand Excalidraw as initial data when the current session opens. */
  loadedScene: SceneFile | null;
  /** Bumped every time a session is opened, so the canvas remounts. */
  loadKey: number;
  streaming: Streaming;
  streamError: StreamFailure | null;
  pendingProposal: { id: string; messageId: string; count: number } | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  health: Health | null;
  loadingSession: boolean;
};

type Actions = {
  init(): Promise<void>;
  /** Saves the canvas, then shows the dashboard. */
  goHome(): Promise<void>;
  /** Shows diagram practice with the open session reloaded, or the newest one. */
  enterPractice(): Promise<void>;
  enterQuiz(): void;
  checkHealth(refresh?: boolean): Promise<void>;
  refreshSessions(): Promise<void>;
  openSession(id: string): Promise<void>;
  newSession(body: { topic?: string; difficulty?: Difficulty }): Promise<void>;
  deleteSession(id: string): Promise<void>;
  sendMessage(text: string): Promise<void>;
  checkWork(): Promise<void>;
  decideProposal(decision: "accept" | "discard"): Promise<void>;
  setSaveStatus(s: AppState["saveStatus"]): void;
};

const localId = () => `local_${Math.random().toString(36).slice(2)}`;
const nowIso = () => new Date().toISOString();

function pendingFrom(messages: ChatMessage[]): AppState["pendingProposal"] {
  const m = [...messages].reverse().find((m) => m.proposal?.status === "pending");
  return m?.proposal ? { id: m.proposal.id, messageId: m.id, count: m.proposal.ops.length } : null;
}

export const useApp = create<AppState & Actions>((set, get) => {
  /** Runs one streaming request, keeping `streaming` and `streamError` in sync. */
  async function runStream(
    kind: NonNullable<Streaming>["kind"],
    req: [string, RequestInit],
    handlers: { onSession?(meta: SessionMeta): void; onDone(e: Extract<StreamEvent, { event: "done" }>["data"]): void },
    retry: () => void,
  ) {
    const sessionAtStart = get().currentId;
    set({ streaming: { kind, text: "" }, streamError: null });
    let failed: string | null = null;
    await readStream(req, (e) => {
      // Ignore events for a session the user has navigated away from (the server still saves them).
      if (e.event !== "session" && get().currentId !== sessionAtStart && kind !== "question") return;
      switch (e.event) {
        case "session":
          handlers.onSession?.(e.data.meta);
          break;
        case "delta":
          set((s) => ({ streaming: s.streaming && { ...s.streaming, text: s.streaming.text + e.data.text, status: undefined } }));
          break;
        case "status":
          set((s) => ({ streaming: s.streaming && { ...s.streaming, status: e.data.text } }));
          break;
        case "done":
          handlers.onDone(e.data);
          break;
        case "error":
          failed = e.data.message;
          if (e.data.code === "claude_auth") void get().checkHealth(true);
          break;
      }
    });
    set({ streaming: null, streamError: failed ? { message: failed, retry } : null });
    void useUsage.getState().refresh(true);
  }

  return {
    view: "home",
    sessions: [],
    currentId: null,
    meta: null,
    question: "",
    messages: [],
    loadedScene: null,
    loadKey: 0,
    streaming: null,
    streamError: null,
    pendingProposal: null,
    saveStatus: "idle",
    health: null,
    loadingSession: false,

    async init() {
      void get().checkHealth();
      await get().refreshSessions();
    },

    async goHome() {
      if (get().view === "practice") {
        if (get().streaming) return;
        await canvas?.flushSave();
      }
      set({ view: "home" });
    },

    async enterPractice() {
      set({ view: "practice" });
      await get().refreshSessions();
      // Reopen even the current session: the canvas unmounted, and its scene must come from disk.
      const id = get().currentId ?? get().sessions.find((s) => !("unreadable" in s))?.id;
      if (id) await get().openSession(id).catch(() => undefined);
    },

    enterQuiz() {
      set({ view: "quiz" });
    },

    async checkHealth(refresh = false) {
      try {
        set({ health: await api.health(refresh) });
      } catch {
        set({ health: { ok: false, claudeReady: false, error: "The app server is not running." } });
      }
    },

    async refreshSessions() {
      try {
        set({ sessions: await api.listSessions() });
      } catch {
        // keep the old list
      }
    },

    async openSession(id) {
      if (get().streaming) return;
      await canvas?.flushSave();
      set({ loadingSession: true, currentId: id, streamError: null });
      try {
        const detail = await api.getSession(id);
        if (get().currentId !== id) return;
        set((s) => ({
          meta: detail.meta,
          question: detail.question,
          messages: detail.chat,
          loadedScene: detail.scene,
          loadKey: s.loadKey + 1,
          pendingProposal: pendingFrom(detail.chat),
          saveStatus: "idle",
          loadingSession: false,
        }));
      } catch (err) {
        set({ loadingSession: false, currentId: null, meta: null });
        await get().refreshSessions();
        throw err;
      }
    },

    async newSession(body) {
      if (get().streaming) return;
      await canvas?.flushSave();
      await runStream(
        "question",
        streams.newSession(body),
        {
          onSession(meta) {
            set((s) => ({
              currentId: meta.id,
              meta,
              question: "",
              messages: [],
              loadedScene: null,
              loadKey: s.loadKey + 1,
              pendingProposal: null,
              saveStatus: "idle",
              sessions: [meta, ...s.sessions.filter((x) => x.id !== meta.id)],
            }));
          },
          onDone({ message, meta }) {
            set((s) => ({
              messages: [...s.messages, message],
              question: message.text,
              meta: meta ?? s.meta,
            }));
          },
        },
        () => void get().newSession(body),
      );
      await get().refreshSessions();
    },

    async deleteSession(id) {
      await api.deleteSession(id);
      if (get().currentId === id) {
        set({ currentId: null, meta: null, messages: [], question: "", loadedScene: null, pendingProposal: null });
      }
      await get().refreshSessions();
    },

    async sendMessage(text) {
      const id = get().currentId;
      if (!id || get().streaming) return;
      const userMsg: ChatMessage = { id: localId(), role: "user", kind: "chat", text, createdAt: nowIso() };
      set((s) => ({ messages: [...s.messages, userMsg] }));
      const send = async () => {
        await runStream(
          "chat",
          streams.message(id, text),
          {
            onDone({ message, request }) {
              set((s) => ({
                messages: [...s.messages.map((m) => (m.id === userMsg.id && request ? request : m)), message],
              }));
            },
          },
          () => void send(),
        );
      };
      await send();
    },

    async checkWork() {
      const id = get().currentId;
      if (!id || !canvas || get().streaming || get().pendingProposal) return;
      await canvas.flushSave();
      const scene = canvas.getScene();
      const image = await canvas.exportPng();
      const thumb = image ? URL.createObjectURL(image) : undefined;
      const reqMsg: ChatMessage = {
        id: localId(),
        role: "user",
        kind: "review-request",
        text: "Check my work",
        createdAt: nowIso(),
        reviewImage: thumb,
      };
      set((s) => ({ messages: [...s.messages, reqMsg] }));
      const send = async () => {
        await runStream(
          "review",
          streams.review(id, scene, image),
          {
            onDone({ message, request, meta }) {
              set((s) => ({
                messages: [...s.messages.map((m) => (m.id === reqMsg.id && request ? request : m)), message],
                meta: meta ?? s.meta,
              }));
              if (message.proposal?.status === "pending") {
                canvas?.applyProposal(message.proposal);
                set({ pendingProposal: { id: message.proposal.id, messageId: message.id, count: message.proposal.ops.length } });
              }
            },
          },
          () => void send(),
        );
        await get().refreshSessions();
      };
      await send();
    },

    async decideProposal(decision) {
      const id = get().currentId;
      const pending = get().pendingProposal;
      if (!id || !pending || !canvas) return;
      canvas.resolveProposal(pending.id, decision);
      await canvas.flushSave();
      await api.decideProposal(id, pending.id, decision);
      const status = decision === "accept" ? "accepted" : "discarded";
      set((s) => ({
        pendingProposal: null,
        messages: s.messages.map((m) =>
          m.id === pending.messageId && m.proposal ? { ...m, proposal: { ...m.proposal, status } } : m,
        ),
      }));
    },

    setSaveStatus(saveStatus) {
      set({ saveStatus });
    },
  };
});
