# System Design Practice

A local web app for practicing system design interviews. Claude asks a question, you draw your design on an Excalidraw canvas, and Claude reviews it when you click **Check my work**. With a review, Claude can sketch suggested additions on the canvas in violet, and you keep or discard them.

Everything runs on your machine: a React page, a Node server on `127.0.0.1:3001`, and your Claude Code CLI login. There are no accounts and no database, and the app never asks for an API key.

## Prerequisites

- **Node.js 20 or later.** On Windows: `winget install OpenJS.NodeJS.LTS`.
- **Claude Code, installed and logged in** with a Claude Pro or Max plan. Run `claude` once in a terminal and finish the login. The app uses that login through the Claude Agent SDK and does not handle login itself.
- Each person who clones this repo uses their own Claude Code login. Nothing in the repo holds credentials.

Claude usage from this app counts toward the same plan limits as using Claude Code directly.

## Run it

**Windows:** double-click `start.bat`. On first run it installs dependencies and builds the app, then opens http://localhost:3001 in your browser. The console window shows server logs; closing it stops the app.

**Any platform:**

```bash
npm install
npm run build
npm start -- --open
```

After changing the code, run `npm run build` again (or delete `client/dist` and let `start.bat` rebuild it).

### Pin it to the Windows taskbar

Windows does not pin `.bat` files directly, so pin a shortcut instead:

1. Right-click the desktop, choose **New > Shortcut**.
2. For the location, enter `cmd.exe /c "C:\path\to\system-design-practice\start.bat"` with your real path.
3. Name it "System Design Practice" and finish.
4. Right-click the new shortcut and choose **Pin to taskbar**. Optionally use **Properties > Change Icon** first.

## Where your data lives

Each session is a folder of plain files under `<home>/system-design-practice-data/sessions/`, for example `C:\Users\<name>\system-design-practice-data\sessions\2026-10-03_1432_url-shortener\`:

| File | Contents |
| --- | --- |
| `meta.json` | Title, difficulty, timestamps, review count, Claude conversation ID |
| `question.md` | The question Claude wrote |
| `scene.excalidraw` | Your drawing, in the standard Excalidraw format (opens on excalidraw.com) |
| `chat.json` | The chat, in order |
| `review-<n>.png` | The image sent with each review |

Deleting a session moves its folder to `<data folder>/trash/`, so you can restore it by moving it back.

## Environment variables

Set these in your shell or system environment. The app does not read a `.env` file; `.env.example` lists them.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SDP_DATA_DIR` | `<home>/system-design-practice-data` | Folder that holds `sessions/` and `trash/` |
| `SDP_MODEL` | Claude Code's default | Model name passed to Claude, for example `claude-sonnet-5-5` |

The server refuses to start if `SDP_DATA_DIR` points inside this repo at a path `.gitignore` does not cover.

`ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are removed from the environment Claude runs in, so a key in your shell never bills an API account instead of your plan.

## Troubleshooting

- **"Claude Code is not logged in" banner.** Run `claude` in a terminal, log in, then click **Retry** in the banner.
- **"Port 3001 is already in use".** Another copy of the app (or another program) is running. Close it and start again.
- **Usage limit reached.** The chat shows an error with a Retry button. Try again when your plan's limit resets.

## Development

```bash
npm run dev        # Vite on :5173 with hot reload, server on :3001 with restart on change
npm test           # Vitest: summarizer, session store, sketch handling, Claude wrapper
npm run typecheck
```

The repo is an npm workspace with three packages:

- `client/`: React, Vite, Tailwind, shadcn/ui, Excalidraw, Zustand
- `server/`: Hono API, session store, Claude Agent SDK wrapper
- `shared/`: types plus the diagram summarizer, which both sides run so sketch labels match

### How a review works

1. The browser exports the canvas to a PNG and posts it with the scene JSON.
2. The server saves both, turns the scene into a short text summary of components and connections, and resumes the session's Claude conversation with a prompt that points Claude at the PNG.
3. Claude's reply streams back over server-sent events. If it ends with a `<canvas-ops>` block, the server cuts it out, validates it, and sends it to the browser as a sketch to keep or discard.

Claude only has the Read tool, and a permission hook limits it to files in the current session's folder.
