import type {
  ClaudeSettings,
  Health,
  NewQuizBody,
  NewSessionBody,
  QuizChoice,
  QuizDetail,
  QuizMeta,
  SceneFile,
  SessionDetail,
  SessionListItem,
  StreamEvent,
} from "@sdp/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? res.statusText, body.code);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: (refresh = false) => fetch(`/api/health${refresh ? "?refresh=1" : ""}`).then(json<Health>),
  getSettings: () => fetch("/api/settings").then(json<ClaudeSettings>),
  saveSettings: (settings: ClaudeSettings) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    }).then(json<ClaudeSettings>),
  listSessions: () => fetch("/api/sessions").then(json<SessionListItem[]>),
  getSession: (id: string) => fetch(`/api/sessions/${encodeURIComponent(id)}`).then(json<SessionDetail>),
  deleteSession: (id: string) =>
    fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }).then(json<{ ok: true }>),
  saveScene: (id: string, scene: SceneFile, keepalive = false) =>
    fetch(`/api/sessions/${encodeURIComponent(id)}/scene`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scene),
      keepalive,
    }).then(json<{ updatedAt: string }>),
  decideProposal: (id: string, proposalId: string, decision: "accept" | "discard") =>
    fetch(`/api/sessions/${encodeURIComponent(id)}/proposals/${encodeURIComponent(proposalId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    }).then(json<{ ok: true }>),
  listQuizzes: () => fetch("/api/quizzes").then(json<QuizMeta[]>),
  getQuiz: (id: string) => fetch(`/api/quizzes/${encodeURIComponent(id)}`).then(json<QuizDetail>),
  deleteQuiz: (id: string) =>
    fetch(`/api/quizzes/${encodeURIComponent(id)}`, { method: "DELETE" }).then(json<{ ok: true }>),
};

const post = (url: string, body?: unknown): [string, RequestInit] => [
  url,
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) },
];

/** Builds the request for each quiz streaming route. */
export const quizStreams = {
  create: (body: NewQuizBody) => post("/api/quizzes", body),
  next: (id: string) => post(`/api/quizzes/${encodeURIComponent(id)}/next`),
  answer: (id: string, choice: QuizChoice) => post(`/api/quizzes/${encodeURIComponent(id)}/answer`, { choice }),
  message: (id: string, text: string) => post(`/api/quizzes/${encodeURIComponent(id)}/messages`, { text }),
};

/** Builds the request for each streaming route. */
export const streams = {
  newSession: (body: NewSessionBody): [string, RequestInit] => [
    "/api/sessions",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  ],
  message: (id: string, text: string): [string, RequestInit] => [
    `/api/sessions/${encodeURIComponent(id)}/messages`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) },
  ],
  review: (id: string, scene: SceneFile, image: Blob | null): [string, RequestInit] => {
    const form = new FormData();
    form.append("scene", new Blob([JSON.stringify(scene)], { type: "application/json" }), "scene.json");
    if (image) form.append("image", image, "review.png");
    return [`/api/sessions/${encodeURIComponent(id)}/review`, { method: "POST", body: form }];
  },
};

/**
 * POSTs and reads the server-sent event stream with fetch, since EventSource cannot send a body.
 * Resolves when the stream ends. A non-2xx response becomes a synthetic error event.
 */
export async function readStream<E extends { event: string; data: unknown } = StreamEvent>(
  [url, init]: [string, RequestInit],
  onEvent: (e: E) => void,
): Promise<void> {
  const fail = (message: string, code: string) => onEvent({ event: "error", data: { message, code } } as E);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    fail("Could not reach the server.", "claude_failed");
    return;
  }
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    const message =
      res.status === 409 ? "Claude is still answering the previous request." : (body.message ?? `HTTP ${res.status}`);
    fail(message, body.code ?? "bad_request");
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let sawEnd = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value.replace(/\r\n/g, "\n");
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (!data.length) continue;
      try {
        const parsed = { event, data: JSON.parse(data.join("\n")) } as E;
        if (parsed.event === "done" || parsed.event === "error") sawEnd = true;
        onEvent(parsed);
      } catch {
        // ignore a malformed event
      }
    }
  }
  if (!sawEnd) {
    fail("The connection closed before Claude finished.", "claude_failed");
  }
}
