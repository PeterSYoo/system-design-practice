import { dataDir } from "./config.js";
import { QuizStore } from "./quiz-store.js";
import { SessionStore } from "./store.js";

/** The store the routes use, rooted at SDP_DATA_DIR or the default data folder. */
export const store = new SessionStore(dataDir());

export const quizStore = new QuizStore(dataDir());
