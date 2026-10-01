/** 设置页：外观、刷新间隔、关窗是否进托盘、关于。 */
import type { CloseBehavior, ThemeMode } from '@/stores/settings'
import { Icon } from '@iconify/react'
import { useNavigate } from '@tanstack/react-router'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { APP_VERSION } from '@/lib/app-version'
import { cn } from '@/lib/utils'
import {
  applyThemeFromStore,
  useSettingsStore,
} from '@/stores/settings'

type SectionId = 'appearance' | 'about'

const SECTIONS: { id: SectionId, label: string }[] = [
  { id: 'appearance', label: '外观' },
  { id: 'about', label: '关于' },
]

export function SettingsPage() {
  const navigate = useNavigate()
  const [section, setSection] = useState<SectionId>('appearance')
  const [query, setQuery] = useState('')

  const autoIntervalSec = useSettingsStore(s => s.autoIntervalSec)
  const themeMode = useSettingsStore(s => s.themeMode)
  const closeBehavior = useSettingsStore(s => s.closeBehavior)
  const launchAtLogin = useSettingsStore(s => s.launchAtLogin)
  const setAutoIntervalSec = useSettingsStore(s => s.setAutoIntervalSec)
  const setThemeMode = useSettingsStore(s => s.setThemeMode)
  const setCloseBehavior = useSettingsStore(s => s.setCloseBehavior)
  const setLaunchAtLogin = useSettingsStore(s => s.setLaunchAtLogin)
  const reset = useSettingsStore(s => s.reset)

  // 与系统开机自启状态对齐一次
  useEffect(() => {
    void isEnabled()
      .then((on) => {
        if (on !== useSettingsStore.getState().launchAtLogin)
          setLaunchAtLogin(on)
      })
      .catch(() => {})
  }, [setLaunchAtLogin])

  const visibleSections = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q)
      return SECTIONS
    return SECTIONS.filter(s => s.label.toLowerCase().includes(q))
  }, [query])

  const close = () => {
    void navigate({ to: '/' })
  }

  return (
    <div className="bg-background flex min-h-0 flex-1">
      <aside className="bg-card/40 w-[168px] shrink-0 overflow-auto border-r border-border p-3">
        {visibleSections.map(s => (
          <button
            key={s.id}
            type="button"
            className={cn(
              'mb-1 w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
              section === s.id
                ? 'bg-primary text-primary-foreground font-semibold'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative mx-4 mt-4">
          <Icon
            icon="mdi:magnify"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索设置"
            aria-label="搜索设置"
            className="pl-9"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {section === 'appearance'
            ? (
                <AppearancePanel
                  autoIntervalSec={autoIntervalSec}
                  themeMode={themeMode}
                  closeBehavior={closeBehavior}
                  launchAtLogin={launchAtLogin}
                  onAutoIntervalSecChange={setAutoIntervalSec}
                  onThemeModeChange={(mode) => {
                    setThemeMode(mode)
                    applyThemeFromStore(mode)
                  }}
                  onCloseBehaviorChange={setCloseBehavior}
                  onLaunchAtLoginChange={async (on) => {
                    try {
                      if (on)
                        await enable()
                      else
                        await disable()
                      setLaunchAtLogin(on)
                    }
                    catch (e) {
                      console.error('开机自启切换失败', e)
                    }
                  }}
                />
              )
            : (
                <AboutPanel />
              )}
        </div>

        <Separator />

        <footer className="bg-card/30 flex items-center justify-between gap-3 px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              void (async () => {
                try {
                  await disable()
                }
                catch {
                  // ignore
                }
                reset()
                applyThemeFromStore()
              })()
            }}
          >
            恢复默认
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              关闭
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function AppearancePanel({
  autoIntervalSec,
  themeMode,
  closeBehavior,
  launchAtLogin,
  onAutoIntervalSecChange,
  onThemeModeChange,
  onCloseBehaviorChange,
  onLaunchAtLoginChange,
}: {
  autoIntervalSec: number
  themeMode: ThemeMode
  closeBehavior: CloseBehavior
  launchAtLogin: boolean
  onAutoIntervalSecChange: (sec: number) => void
  onThemeModeChange: (mode: ThemeMode) => void
  onCloseBehaviorChange: (behavior: CloseBehavior) => void
  onLaunchAtLoginChange: (on: boolean) => void
}) {
  const closeToTray = (closeBehavior ?? 'tray') === 'tray'

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">外观</h2>
      <div className="flex flex-col flex-wrap gap-5">
        <div className="flex w-fit min-w-[240px] flex-1 flex-col gap-2">
          <span className="text-muted-foreground text-xs">主题</span>
          <div className="bg-card inline-flex overflow-hidden rounded-lg border border-border">
            {(
              [
                ['light', 'mdi:white-balance-sunny', '浅色'],
                ['dark', 'mdi:moon-waning-crescent', '深色'],
                ['system', 'mdi:monitor', '跟随系统'],
              ] as const
            ).map(([mode, icon, label]) => (
              <button
                key={mode}
                type="button"
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-2 text-sm',
                  themeMode === mode
                    ? 'bg-primary/20 text-foreground'
                    : 'text-muted-foreground hover:bg-accent',
                )}
                onClick={() => onThemeModeChange(mode)}
              >
                <Icon icon={icon} className="size-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex w-fit min-w-[240px] flex-1 flex-col gap-2">
          <span className="text-muted-foreground text-xs">自动刷新间隔（秒）</span>
          <Input
            type="number"
            min={3}
            max={60}
            step={1}
            className="w-36"
            value={autoIntervalSec}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n))
                return
              onAutoIntervalSecChange(n)
            }}
          />
          <p className="text-muted-foreground text-xs">
            由 `@tauri-store/zustand` 持久化，主页自动刷新会立刻跟随。
          </p>
        </div>

        <div className="flex w-fit min-w-[240px] flex-1 flex-col gap-2">
          <span className="text-muted-foreground text-xs">关闭窗口时</span>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={closeToTray}
              onCheckedChange={(checked) => {
                onCloseBehaviorChange(checked === true ? 'tray' : 'quit')
              }}
              aria-label="关闭时隐藏到托盘"
            />
            <span>关闭时隐藏到托盘</span>
          </label>
          <p className="text-muted-foreground text-xs">
            勾选后关闭窗口会进托盘；不勾选则直接退出。托盘可打开或退出。
          </p>

        <div className="flex w-fit min-w-[240px] flex-1 flex-col gap-2">
          <span className="text-muted-foreground text-xs">开机自启</span>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={launchAtLogin}
              onCheckedChange={(checked) => {
                onLaunchAtLoginChange(checked === true)
              }}
              aria-label="开机自启"
            />
            <span>开机时后台启动（不打开窗口）</span>
          </label>
          <p className="text-muted-foreground text-xs">
            勾选后随系统启动，只进托盘；双击托盘图标再打开窗口。
          </p>
        </div>
        </div>
      </div>
    </div>
  )
}

function AboutPanel() {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">关于</h2>
      <p className="text-sm">鼠标工具 · 显示雷柏 VT9 AIR 电量</p>
      <p className="text-muted-foreground text-sm">
        版本
        {' '}
        {APP_VERSION}
      </p>
      <button
        type="button"
        className="text-primary text-sm hover:underline"
        onClick={() => void openUrl('https://github.com/wjyugutou/mouse_tool')}
      >
        github.com/wjyugutou/mouse_tool
      </button>
    </div>
  )
}
