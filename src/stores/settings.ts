/** 应用设置（主题 / 刷新间隔 / 关窗行为 / 开机自启），经 @tauri-store/zustand 落盘 */
import type { DeviceCategory } from '@/devices'
import { createTauriStore } from '@tauri-store/zustand'
import { create } from 'zustand'

import { deviceRegistry, getDeviceById } from '@/devices'

export type ThemeMode = 'light' | 'dark' | 'system'
export type CloseBehavior = 'quit' | 'tray'

/** 每个分类至多一只选中设备。`null` 表示该分类还没选。 */
export interface SelectedByCategory {
  mouse: string | null
  keyboard: string | null
  headset: string | null
}

interface SettingsState {
  autoIntervalSec: number
  themeMode: ThemeMode
  closeBehavior: CloseBehavior
  /** 托盘图标当前显示哪一只的电量 */
  trayDeviceId: string
  /** 托盘菜单里出现的设备：鼠标 / 键盘 / 耳机各至多一只 */
  selectedByCategory: SelectedByCategory
  /** 是否开机自启（与系统注册表同步由设置页调用插件维护） */
  launchAtLogin: boolean
  /** 首页和托盘共用的自动采样开关 */
  autoRefresh: boolean
  setAutoIntervalSec: (sec: number) => void
  setThemeMode: (mode: ThemeMode) => void
  setCloseBehavior: (behavior: CloseBehavior) => void
  setTrayDeviceId: (id: string) => void
  setLaunchAtLogin: (on: boolean) => void
  setAutoRefresh: (on: boolean) => void
  reset: () => void
}

const DEFAULT_AUTO_INTERVAL_SEC = 300
const DEFAULT_THEME_MODE: ThemeMode = 'dark'
const DEFAULT_CLOSE_BEHAVIOR: CloseBehavior = 'tray'
/** 默认托盘设备取插件表第一项，避免再写一份设备 id。 */
const DEFAULT_TRAY_DEVICE_ID = deviceRegistry[0]?.id ?? ''
const DEFAULT_LAUNCH_AT_LOGIN = false

/** 缺省三个分类都空着。显示时再按当前电量设备补，和托盘菜单同一条规则。 */
function emptySelection(): SelectedByCategory {
  return { mouse: null, keyboard: null, headset: null }
}

function keptDeviceId(id: string | null | undefined, category: DeviceCategory): string | null {
  if (!id)
    return null
  const device = getDeviceById(id)
  if (!device || device.category !== category)
    return null
  return device.id
}

/**
 * 丢掉不存在或分类对不上的 id。
 * 当前电量设备所在分类还空着时，用它补上。
 * 缺省不预填第一只设备，否则旧设置里只有 `trayDeviceId` 时，鼠标槽会停在注册表第一项。
 */
export function resolveSelectedByCategory(
  trayDeviceId: string,
  selected: Partial<SelectedByCategory> | undefined,
): SelectedByCategory {
  const next: SelectedByCategory = {
    mouse: keptDeviceId(selected?.mouse, 'mouse'),
    keyboard: keptDeviceId(selected?.keyboard, 'keyboard'),
    headset: keptDeviceId(selected?.headset, 'headset'),
  }
  const active = getDeviceById(trayDeviceId)
  if (active && next[active.category] == null)
    next[active.category] = active.id
  return next
}

/** 刷新间隔限制在 3～300 秒 */
function clampInterval(n: number): number {
  if (!Number.isFinite(n))
    return DEFAULT_AUTO_INTERVAL_SEC
  return Math.min(300, Math.max(3, Math.round(n)))
}

export const useSettingsStore = create<SettingsState>(set => ({
  autoIntervalSec: DEFAULT_AUTO_INTERVAL_SEC,
  themeMode: DEFAULT_THEME_MODE,
  closeBehavior: DEFAULT_CLOSE_BEHAVIOR,
  trayDeviceId: DEFAULT_TRAY_DEVICE_ID,
  selectedByCategory: emptySelection(),
  launchAtLogin: DEFAULT_LAUNCH_AT_LOGIN,
  autoRefresh: true,
  setAutoIntervalSec: sec => set({ autoIntervalSec: clampInterval(sec) }),
  setThemeMode: themeMode => set({ themeMode }),
  setCloseBehavior: closeBehavior => set({ closeBehavior }),
  setTrayDeviceId: (id) => {
    const device = getDeviceById(id)
    if (!device)
      return
    set(state => ({
      trayDeviceId: device.id,
      selectedByCategory: {
        ...state.selectedByCategory,
        [device.category]: device.id,
      },
    }))
  },
  setLaunchAtLogin: launchAtLogin => set({ launchAtLogin }),
  setAutoRefresh: autoRefresh => set({ autoRefresh }),
  reset: () =>
    set({
      autoIntervalSec: DEFAULT_AUTO_INTERVAL_SEC,
      themeMode: DEFAULT_THEME_MODE,
      closeBehavior: DEFAULT_CLOSE_BEHAVIOR,
      trayDeviceId: DEFAULT_TRAY_DEVICE_ID,
      selectedByCategory: emptySelection(),
      launchAtLogin: DEFAULT_LAUNCH_AT_LOGIN,
      autoRefresh: true,
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
      'selectedByCategory',
      'launchAtLogin',
      'autoRefresh',
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
