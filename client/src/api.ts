import type {
  ClaudeSettings,
  Health,
  NewSessionBody,
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
export async function readStream(
  [url, init]: [string, RequestInit],
  onEvent: (e: StreamEvent) => void,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    onEvent({ event: "error", data: { message: "Could not reach the server.", code: "claude_failed" } });
    return;
  }
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    const message =
      res.status === 409 ? "Claude is still answering the previous request." : (body.message ?? `HTTP ${res.status}`);
    onEvent({ event: "error", data: { message, code: body.code ?? "bad_request" } });
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
        const parsed = { event, data: JSON.parse(data.join("\n")) } as StreamEvent;
        if (parsed.event === "done" || parsed.event === "error") sawEnd = true;
        onEvent(parsed);
      } catch {
        // ignore a malformed event
      }
    }
  }
  if (!sawEnd) {
    onEvent({ event: "error", data: { message: "The connection closed before Claude finished.", code: "claude_failed" } });
  }
}
