export interface Theme {
  id: string;
  name: string;
  bg: string;
  surface: string;
  surfaceAlt: string;
  elevated: string;
  border: string;
  text: string;
  textMuted: string;
  textDim: string;
  codeBg: string;
}

export const THEMES: Theme[] = [
  {
    id: "tokyo",
    name: "Tokyo Night",
    bg: "#0f111a",
    surface: "#1a1b26",
    surfaceAlt: "#24283b",
    elevated: "#2f3549",
    border: "#414868",
    text: "#c0caf5",
    textMuted: "#9aa5ce",
    textDim: "#565f89",
    codeBg: "#090a10",
  },
  {
    id: "everforest",
    name: "Everforest",
    bg: "#1e2326",
    surface: "#272e33",
    surfaceAlt: "#2e383c",
    elevated: "#374145",
    border: "#4a555b",
    text: "#d3c6aa",
    textMuted: "#9da9a0",
    textDim: "#5c6a72",
    codeBg: "#15191c",
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    bg: "#181825",
    surface: "#1e1e2e",
    surfaceAlt: "#313244",
    elevated: "#45475a",
    border: "#45475a",
    text: "#cdd6f4",
    textMuted: "#bac2de",
    textDim: "#585b70",
    codeBg: "#11111b",
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    bg: "#1d2021",
    surface: "#282828",
    surfaceAlt: "#32302f",
    elevated: "#3c3836",
    border: "#504945",
    text: "#ebdbb2",
    textMuted: "#d5c4a1",
    textDim: "#928374",
    codeBg: "#121212",
  },
];

export const DEFAULT_THEME = "tokyo";

export function applyTheme(id: string) {
  const t = THEMES.find(x => x.id === id) ?? THEMES[0];
  const root = document.documentElement;
  root.setAttribute("data-theme", t.id);
  root.style.setProperty("--bg", t.bg);
  root.style.setProperty("--surface", t.surface);
  root.style.setProperty("--surface-alt", t.surfaceAlt);
  root.style.setProperty("--elevated", t.elevated);
  root.style.setProperty("--border", t.border);
  root.style.setProperty("--text", t.text);
  root.style.setProperty("--text-secondary", t.textMuted);
  root.style.setProperty("--text-muted", t.textDim);
  root.style.setProperty("--code-bg", (t as any).codeBg ?? t.bg);
  localStorage.setItem("mi-theme", t.id);
}

export function getInitialTheme(): string {
  if (typeof window === "undefined") return DEFAULT_THEME;
  return localStorage.getItem("mi-theme") || DEFAULT_THEME;
}
