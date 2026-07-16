import { useEffect, useState } from "react";

type Theme = "light" | "dark";

// Persist the theme and reflect it on <html data-theme> so the brand tokens
// (and Tailwind `dark:` variant) flip. Defaults to the OS preference.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    // URL override (?theme=dark|light) — handy for demos and screenshots.
    const forced = new URLSearchParams(window.location.search).get("theme");
    if (forced === "dark" || forced === "light") return forced;
    const saved = localStorage.getItem("pse-theme") as Theme | null;
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("pse-theme", theme);
  }, [theme]);

  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}
