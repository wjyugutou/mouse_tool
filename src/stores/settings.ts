/** 应用设置（主题 / 刷新间隔 / 关窗行为），经 @tauri-store/zustand 落盘。 */
import { createTauriStore } from '@tauri-store/zustand'
import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'
export type CloseBehavior = 'quit' | 'tray'

interface SettingsState {
  autoIntervalSec: number
  themeMode: ThemeMode
  closeBehavior: CloseBehavior
  setAutoIntervalSec: (sec: number) => void
  setThemeMode: (mode: ThemeMode) => void
  setCloseBehavior: (behavior: CloseBehavior) => void
  reset: () => void
}

const DEFAULT_AUTO_INTERVAL_SEC = 5
const DEFAULT_THEME_MODE: ThemeMode = 'dark'
const DEFAULT_CLOSE_BEHAVIOR: CloseBehavior = 'tray'

/** 刷新间隔限制在 3–60 秒。 */
function clampInterval(n: number): number {
  if (!Number.isFinite(n))
    return DEFAULT_AUTO_INTERVAL_SEC
  return Math.min(60, Math.max(3, Math.round(n)))
}

export const useSettingsStore = create<SettingsState>(set => ({
  autoIntervalSec: DEFAULT_AUTO_INTERVAL_SEC,
  themeMode: DEFAULT_THEME_MODE,
  closeBehavior: DEFAULT_CLOSE_BEHAVIOR,
  setAutoIntervalSec: sec => set({ autoIntervalSec: clampInterval(sec) }),
  setThemeMode: themeMode => set({ themeMode }),
  setCloseBehavior: closeBehavior => set({ closeBehavior }),
  reset: () =>
    set({
      autoIntervalSec: DEFAULT_AUTO_INTERVAL_SEC,
      themeMode: DEFAULT_THEME_MODE,
      closeBehavior: DEFAULT_CLOSE_BEHAVIOR,
    }),
}))

/** 只持久化数据字段，不存 setter。 */
export const settingsTauriStore = createTauriStore(
  'settings',
  // create() 返回 UseBoundStore；插件类型要 StoreApi + 字符串索引，故断言
  useSettingsStore as unknown as import('zustand').StoreApi<SettingsState & Record<string, unknown>>,
  {
    autoStart: true,
    filterKeys: ['autoIntervalSec', 'themeMode', 'closeBehavior'],
    filterKeysStrategy: 'pick',
    saveOnChange: true,
    saveInterval: 500,
    saveStrategy: 'debounce',

  },
)

/** 根据主题模式切换 `html.dark`。 */
export function applyThemeFromStore(themeMode?: ThemeMode) {
  const mode = themeMode ?? useSettingsStore.getState().themeMode
  const dark
    = mode === 'dark'
      || (mode === 'system'
        && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}
