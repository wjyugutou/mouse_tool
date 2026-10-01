import { create } from "zustand"
import { createTauriStore } from "@tauri-store/zustand"

export type ThemeMode = "light" | "dark" | "system"

type SettingsState = {
  autoIntervalSec: number
  themeMode: ThemeMode
  setAutoIntervalSec: (sec: number) => void
  setThemeMode: (mode: ThemeMode) => void
  reset: () => void
}

const DEFAULT_AUTO_INTERVAL_SEC = 5
const DEFAULT_THEME_MODE: ThemeMode = "dark"

function clampInterval(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_AUTO_INTERVAL_SEC
  return Math.min(60, Math.max(3, Math.round(n)))
}

export const useSettingsStore = create<SettingsState>((set) => ({
  autoIntervalSec: DEFAULT_AUTO_INTERVAL_SEC,
  themeMode: DEFAULT_THEME_MODE,
  setAutoIntervalSec: (sec) => set({ autoIntervalSec: clampInterval(sec) }),
  setThemeMode: (themeMode) => set({ themeMode }),
  reset: () =>
    set({
      autoIntervalSec: DEFAULT_AUTO_INTERVAL_SEC,
      themeMode: DEFAULT_THEME_MODE,
    }),
}))

export const settingsTauriStore = createTauriStore(
  "settings",
  useSettingsStore,
  {
    autoStart: true,
    saveOnChange: true,
    filterKeys: ["autoIntervalSec", "themeMode"],
    filterKeysStrategy: "pick",
  },
)

export function applyThemeFromStore(themeMode?: ThemeMode) {
  const mode = themeMode ?? useSettingsStore.getState().themeMode
  const dark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", dark)
}
