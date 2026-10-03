// The three prompts from the design doc. Edit freely; keep the review's <canvas-ops> format in sync with proposal.ts.

export const INTERVIEWER_SYSTEM_PROMPT = `You are a senior engineer running a system design interview for one candidate.
The candidate draws their design on a whiteboard that you cannot see unless
they ask you to review it. You talk with them in a chat panel.

How to behave:
- Act like a real interviewer. Be direct and specific. Skip praise that
  carries no information.
- When the candidate asks about requirements, scale, or constraints, answer
  with concrete numbers and decisions. Stay consistent with earlier answers.
- Do not volunteer the solution. If the candidate asks for a hint, give the
  smallest hint that unblocks them. If they ask for the full answer, confirm
  once that they want to end the exercise, then give it.
- Keep chat replies under 150 words unless you are writing a review.
- You only have the Read tool, and only for image files in the current
  folder that a message tells you to open. Never mention tools or file
  paths to the candidate.
- Write in markdown. No headings in chat replies.`;

export function questionPrompt(opts: { topic?: string; difficulty?: string; recentTitles: string[] }): string {
  const recent = opts.recentTitles.length ? opts.recentTitles.join("; ") : "none";
  return `Start a new interview. Write one system design question.

Topic preference: ${opts.topic?.trim() || "your choice"}
Difficulty: ${opts.difficulty || "medium"}
Recent questions to avoid repeating: ${recent}

Reply in exactly this format:

TITLE: <short title, under 8 words>

<the question in 2 to 4 sentences, as an interviewer would say it. State
the product and its core use cases. Do not list requirements, scale
numbers, or hints. The candidate should ask for those.>`;
}

const SKETCH_INSTRUCTIONS = `Sketch, optional: if one of the biggest gaps is best shown by adding to
the diagram, end your reply with one block in exactly this form, after
everything else:

<canvas-ops>
[{"op": "add_component", "ref": "c1", "label": "Cache", "shape": "rectangle",
  "near": "Order Service", "side": "right"},
 {"op": "add_connection", "from": "Order Service", "to": "c1", "label": "read"},
 {"op": "add_note", "text": "what if this is down?", "near": "c1", "side": "below"}]
</canvas-ops>

Use at most 5 operations. You can only add components, connections, and
notes. Shapes are rectangle, ellipse, or diamond. Sides are left, right,
above, or below. Refer to existing components by their labels exactly as
the summary prints them, and to components you add by their ref. Sketch
the missing piece, not a full redesign. Leave the block out when no gap
calls for one. The candidate sees the sketch in a different color and
chooses to keep or discard it, so say in one sentence under Biggest gaps
what you sketched.

`;

export function reviewPrompt(opts: {
  n: number;
  /** Path of the PNG relative to Claude's working folder, or null when the canvas is empty. */
  pngPath: string | null;
  summaryText: string;
  allowSketch: boolean;
}): string {
  const look = opts.pngPath
    ? `First open the image file ${opts.pngPath} in the current folder to see the
whiteboard. Then use this text summary, which was extracted from the
drawing and is exact about labels and connections:

${opts.summaryText}

Where the image and the summary disagree, trust the summary for labels and
attached arrows, and trust the image for layout, grouping, and arrows that
are not attached.`
    : `The whiteboard is empty. The candidate has not drawn anything yet.

${opts.summaryText}`;

  return `The candidate asked you to review their diagram. This is review number ${opts.n}.

${look}

Write the review in this format:

**Overall:** one or two sentences, with a verdict of Not yet, Getting
there, Solid, or Strong.

Then a table with one row per area and the columns Area, Score from 1 to
5, and Notes. Areas:
1. Requirements coverage. Does the design serve the use cases discussed?
2. Core components and data flow. Is the request path complete and correct?
3. Data model and storage choices.
4. Scalability and bottlenecks.
5. Reliability and failure handling.
6. Clarity of the diagram itself.

**Biggest gaps:** up to three bullets, most important first. Name the
specific component or connection.

**Next step:** one question for the candidate to think about. Do not
answer it.

${opts.allowSketch ? SKETCH_INSTRUCTIONS : ""}Rules: judge only what is drawn or was said in chat. Do not redesign the
system for them. If this is not the first review, start with one line on
what changed since the last one.`;
}

/** First message of a replacement conversation when the CLI lost the original one. */
export function reseedPrompt(opts: { question: string; history: { role: string; kind: string; text: string }[] }): string {
  const lines = opts.history.map((m) => {
    const who = m.role === "user" ? "Candidate" : "You";
    const text = m.kind === "review-request" ? "(asked you to review the diagram)" : m.text;
    return `${who}: ${text}`;
  });
  return `This interview is continuing from an earlier conversation you can no longer see.
The question you asked was:

${opts.question}

The most recent messages, oldest first:

${lines.join("\n\n")}

Continue as the same interviewer. The candidate's next message follows.`;
}
