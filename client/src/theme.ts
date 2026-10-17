import { flushSync } from "react-dom";
import { create } from "zustand";

export type Theme = "light" | "dark";

const KEY = "sdp.theme";
const query = () => window.matchMedia("(prefers-color-scheme: dark)");
const systemTheme = (): Theme => (query().matches ? "dark" : "light");

function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

const apply = (theme: Theme) => document.documentElement.classList.toggle("dark", theme === "dark");

/**
 * Runs a theme change as one crossfade of the whole page (see the view-transition
 * rules in index.css). Element transitions are switched off meanwhile, so hover
 * fades on buttons and cards don't run late against the background.
 */
function switchTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  const update = () => flushSync(() => useTheme.setState({ theme }));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduceMotion) {
    update();
    getComputedStyle(root).color; // commit the new colors before transitions come back
    requestAnimationFrame(() => root.classList.remove("theme-switching"));
    return;
  }
  document.startViewTransition(update).finished.finally(() => root.classList.remove("theme-switching"));
}

type ThemeState = { theme: Theme; toggle(): void };

/**
 * Light/dark theme, mirrored onto <html class="dark">. Follows the system setting
 * until the user picks one with the toggle; after that their choice is remembered.
 */
export const useTheme = create<ThemeState>((set, get) => ({
  theme: storedTheme() ?? systemTheme(),
  toggle() {
    const theme = get().theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // storage unavailable
    }
    switchTheme(theme);
  },
}));

apply(useTheme.getState().theme);
useTheme.subscribe((s) => apply(s.theme));
query().addEventListener("change", () => {
  if (!storedTheme()) switchTheme(systemTheme());
});
