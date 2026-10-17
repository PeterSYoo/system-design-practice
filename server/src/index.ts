import { spawn } from "node:child_process";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { ALLOWED_ORIGINS, HOST, PORT, PROD, dataDir, dataDirProblem } from "./config.js";
import { getHealth } from "./health.js";
import { chat } from "./routes/chat.js";
import { quizzes } from "./routes/quizzes.js";
import { sessions } from "./routes/sessions.js";
import { SettingsSchema } from "./schemas.js";
import { getSettings, saveSettings } from "./settings.js";
import { serveClient } from "./static.js";
import { errorResponse } from "./routes/errors.js";

const problem = dataDirProblem();
if (problem) {
  console.error(problem);
  process.exit(1);
}

const app = new Hono();

// Other websites open in the browser must not be able to call the API.
app.use("/api/*", async (c, next) => {
  const origin = c.req.header("origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return c.json({ message: "Origin not allowed", code: "bad_request" }, 403);
  }
  await next();
});

app.get("/api/health", async (c) => c.json(await getHealth(c.req.query("refresh") === "1")));
app.get("/api/settings", async (c) => c.json(await getSettings()));
app.put("/api/settings", async (c) => {
  try {
    const { model, effort } = SettingsSchema.parse(await c.req.json());
    return c.json(await saveSettings({ model: model || undefined, effort }));
  } catch (err) {
    return errorResponse(c, err);
  }
});
app.route("/api/sessions", sessions);
app.route("/api/sessions", chat);
app.route("/api/quizzes", quizzes);

app.all("/api/*", (c) => c.json({ message: "Not found", code: "not_found" }, 404));

if (PROD) app.get("*", serveClient);

const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, () => {
  const url = PROD ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`Server listening on ${url}`);
  console.log(`Session data: ${dataDir()}`);
  if (PROD && process.argv.includes("--open")) openBrowser(url);
  void getHealth();
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Close the other app using it (or another copy of this one) and try again.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
}
