import { dataDir } from "./config.js";
import { SessionStore } from "./store.js";

/** The store the routes use, rooted at SDP_DATA_DIR or the default data folder. */
export const store = new SessionStore(dataDir());
