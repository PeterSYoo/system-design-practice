import { useEffect, useState } from "react";

const query = () => window.matchMedia("(prefers-color-scheme: dark)");

/** Follows the system light/dark setting and mirrors it onto <html class="dark">. */
export function useSystemTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() => (query().matches ? "dark" : "light"));
  useEffect(() => {
    const mq = query();
    const onChange = () => setTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  return theme;
}
