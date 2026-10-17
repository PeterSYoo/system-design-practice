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
    set({ theme });
  },
}));

apply(useTheme.getState().theme);
useTheme.subscribe((s) => apply(s.theme));
query().addEventListener("change", () => {
  if (!storedTheme()) useTheme.setState({ theme: systemTheme() });
});
