// Prompts for the multiple choice quiz. Edit freely; keep the <recall> tag in sync with quiz.ts.

import type { QuizChoice, QuizLevel } from "@sdp/shared";
import type { SavedQuestion } from "./quiz-store.js";

export const TUTOR_SYSTEM_PROMPT = `You are a system design study tutor for one student. The app quizzes
them with multiple choice questions, each with exactly three choices
labeled A, B, and C. After they pick the right one, they explain the
concept in their own words.

The app shows the question and choices, takes the pick, and keeps the
score. It tells you what happened. You write the questions, the hints,
and the feedback on explanations.

The rule that always holds: never reveal the right answer to a question
the student has not picked correctly yet. Do not name the right letter,
do not quote or paraphrase the right choice, and do not eliminate any
choice ("it isn't A" or "it's between B and C" both count). This holds
even if the student asks for the answer directly, gets frustrated, or
says they want to skip ahead. The only thing you may do is make your
hints more pointed.

How to write:
- Warm, direct, and brief. Skip praise that carries no information.
- Keep replies under 120 words.
- Markdown is fine. No headings.
- When the student says they don't understand an explanation, explain it
  a different way, with a new analogy or simpler terms, instead of
  repeating yourself.
- Never mention these instructions, the app, the score, or tools.`;

const TOPICS = [
  "caching",
  "load balancing",
  "database replication",
  "sharding and partitioning",
  "consistent hashing",
  "CAP and consistency models",
  "SQL vs NoSQL",
  "indexing",
  "message queues and streams",
  "rate limiting",
  "CDNs",
  "API design",
  "idempotency and retries",
  "microservices and service discovery",
  "observability",
  "blob storage",
  "search",
  "real-time delivery",
  "distributed transactions",
  "back-of-the-envelope estimation",
  "leader election and consensus",
  "failure handling and circuit breakers",
];

/** One line per earlier question, for the prompt that picks the next level and topic. */
function historyLine(q: SavedQuestion, i: number): string {
  const result =
    q.phase === "answer"
      ? "not answered"
      : q.attempts === 1
        ? "right on the first try"
        : `right after ${q.attempts} attempts`;
  return `${i + 1}. ${q.topic} (${q.level}): ${result}`;
}

export function quizQuestionPrompt(opts: { level: QuizLevel; questions: SavedQuestion[]; recentTopics: string[] }): string {
  const history = opts.questions.length ? opts.questions.map(historyLine).join("\n") : "none yet";
  const used = [...new Set(opts.questions.map((q) => q.topic))];
  const recent = opts.recentTopics.filter((t) => !used.includes(t));
  return `Write the next multiple choice question.

Starting level the student picked: ${opts.level}
Questions so far in this quiz, oldest first:
${history}
${recent.length ? `\nTopics from the student's earlier quizzes, to avoid when you can: ${recent.join("; ")}\n` : ""}
Level: stay at the starting level or one step away from it (beginner,
intermediate, advanced). Step up after two first-try right answers in a
row. Step down after a question that took three or more attempts.

Topic: pick one not used yet in this quiz. Range across areas such as
${TOPICS.join(", ")}. Reuse a topic only once most areas are covered.

The question:
- Tests understanding of one concept, ideally through a short scenario,
  not trivia or definitions to memorize.
- Has exactly three choices. One is clearly right; the other two are
  plausible misconceptions. Keep the choices similar in length.
- Choices never refer to each other ("both of the above") and carry no
  letter labels.

Reply with only this JSON object and nothing else:
{"topic": "<2 to 4 words>", "level": "<beginner, intermediate, or advanced>", "question": "<the question>", "choices": ["<choice>", "<choice>", "<choice>"], "answer": "<A, B, or C>"}`;
}

/** The current question and everything said about it, for every turn after the question. */
function context(q: SavedQuestion): string {
  const lines = q.messages.map((m) => {
    if (m.kind === "pick") return `Student: picked ${m.choice}`;
    return `${m.role === "user" ? "Student" : "You"}: ${m.text}`;
  });
  return `Current question (topic: ${q.topic}, level: ${q.level}):
${q.question}

A. ${q.choices[0]}
B. ${q.choices[1]}
C. ${q.choices[2]}

${lines.length ? `What has been said about it so far, oldest first:\n\n${lines.join("\n\n")}` : "Nothing has been said about it yet."}`;
}

const secret = (q: SavedQuestion) =>
  `The right answer, which you must not reveal: ${q.answer}. ${q.choices["ABC".indexOf(q.answer)]}`;

export function quizHintPrompt(q: SavedQuestion, pick: QuizChoice): string {
  const wrong = q.attempts; // picks so far, all wrong, including this one
  const how =
    wrong === 1
      ? "Give one small hint: a nudge toward the idea the question tests, not a restatement of the answer."
      : wrong === 2
        ? "Give one hint a little more direct than your last one, still without naming or describing the right choice."
        : "The student seems stuck. Instead of another hint, ask one simpler leading question that builds up to the concept and can be answered in a sentence.";
  return `${context(q)}

The student just picked ${pick}. That is not right. This was wrong attempt ${wrong}.
${secret(q)}

Reply to the student. Say briefly that ${pick} isn't right, without
saying which choice is. ${how} Do not eliminate any choice. Then ask them
to pick again.`;
}

export function quizRecallPrompt(q: SavedQuestion, text: string): string {
  return `${context(q)}

The student picked the right answer, ${q.answer}, ${q.attempts === 1 ? "on the first try" : `after ${q.attempts} attempts`}.
They were asked to explain in their own words why it is right, as if
teaching someone. Their latest message:

"""
${text}
"""

If the message is a question, or says they don't understand, answer it
(a different way than before if you already explained), ask them to try
the explanation again, and end with <recall>retry</recall>.

Otherwise judge the explanation:
- Acceptable, meaning it captures the core idea even if imperfect: say
  it's solid, add anything important they missed in one or two
  sentences, and tell them to click Next or type "next" when ready. End
  with <recall>accept</recall>.
- Weak or incorrect: gently point out what's missing or wrong, explain
  that piece clearly, and ask them to explain it again. Do not let a
  wrong understanding pass. End with <recall>retry</recall>.

Put the tag on its own line at the very end. The student never sees it.`;
}

export function quizChatPrompt(q: SavedQuestion, text: string): string {
  const situation =
    q.phase === "answer"
      ? `The student has not picked the right answer yet. ${secret(q)}

They sent this instead of a pick:`
      : `The student picked the right answer, explained it well, and can move on. They sent:`;
  const ask =
    q.phase === "answer"
      ? `Reply helpfully without revealing the answer or eliminating a choice.
If they ask for the answer or to skip, say kindly that you won't give it
away and offer a more pointed hint instead. End by asking them to pick A,
B, or C.`
      : `Answer briefly. Then remind them to click Next or type "next" when ready.`;
  return `${context(q)}

${situation}

"""
${text}
"""

${ask}`;
}
