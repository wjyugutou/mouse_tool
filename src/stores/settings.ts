/** 应用设置（主题 / 刷新间隔 / 关窗行为 / 开机自启），经 @tauri-store/zustand 落盘 */
import { createTauriStore } from '@tauri-store/zustand'
import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'
export type CloseBehavior = 'quit' | 'tray'

interface SettingsState {
  autoIntervalSec: number
  themeMode: ThemeMode
  closeBehavior: CloseBehavior
  trayDeviceId: string
  /** 是否开机自启（与系统注册表同步由设置页调用插件维护） */
  launchAtLogin: boolean
  setAutoIntervalSec: (sec: number) => void
  setThemeMode: (mode: ThemeMode) => void
  setCloseBehavior: (behavior: CloseBehavior) => void
  setTrayDeviceId: (id: string) => void
  setLaunchAtLogin: (on: boolean) => void
  reset: () => void
}

const DEFAULT_AUTO_INTERVAL_SEC = 5
const DEFAULT_THEME_MODE: ThemeMode = 'dark'
const DEFAULT_CLOSE_BEHAVIOR: CloseBehavior = 'tray'
const DEFAULT_TRAY_DEVICE_ID = 'vt9-air'
const DEFAULT_LAUNCH_AT_LOGIN = false

/** 刷新间隔限制在 3～60 秒 */
function clampInterval(n: number): number {
  if (!Number.isFinite(n))
    return DEFAULT_AUTO_INTERVAL_SEC
  return Math.min(60, Math.max(3, Math.round(n)))
}

export const useSettingsStore = create<SettingsState>(set => ({
  autoIntervalSec: DEFAULT_AUTO_INTERVAL_SEC,
  themeMode: DEFAULT_THEME_MODE,
  closeBehavior: DEFAULT_CLOSE_BEHAVIOR,
  trayDeviceId: DEFAULT_TRAY_DEVICE_ID,
  launchAtLogin: DEFAULT_LAUNCH_AT_LOGIN,
  setAutoIntervalSec: sec => set({ autoIntervalSec: clampInterval(sec) }),
  setThemeMode: themeMode => set({ themeMode }),
  setCloseBehavior: closeBehavior => set({ closeBehavior }),
  setTrayDeviceId: trayDeviceId => set({ trayDeviceId }),
  setLaunchAtLogin: launchAtLogin => set({ launchAtLogin }),
  reset: () =>
    set({
      autoIntervalSec: DEFAULT_AUTO_INTERVAL_SEC,
      themeMode: DEFAULT_THEME_MODE,
      closeBehavior: DEFAULT_CLOSE_BEHAVIOR,
      trayDeviceId: DEFAULT_TRAY_DEVICE_ID,
      launchAtLogin: DEFAULT_LAUNCH_AT_LOGIN,
    }),
}))

/** 只持久化数据字段，不含 setter */
export const settingsTauriStore = createTauriStore(
  'settings',
  // create() 返回 UseBoundStore；插件类型要 StoreApi + 字符串索引，故断言
  useSettingsStore as unknown as import('zustand').StoreApi<SettingsState & Record<string, unknown>>,
  {
    autoStart: true,
    filterKeys: [
      'autoIntervalSec',
      'themeMode',
      'closeBehavior',
      'trayDeviceId',
      'launchAtLogin',
    ],
    filterKeysStrategy: 'pick',
    saveOnChange: true,
    saveInterval: 500,
    saveStrategy: 'debounce',
  },
)

/** 根据主题模式切换 `html.dark` */
export function applyThemeFromStore(themeMode?: ThemeMode) {
  const mode = themeMode ?? useSettingsStore.getState().themeMode
  const dark
    = mode === 'dark'
      || (mode === 'system'
        && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}
