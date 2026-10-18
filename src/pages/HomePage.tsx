/** 首页：左侧设备侧栏，右侧电量 hero 卡，按设置间隔自动刷新。 */
import type { BatteryInfo } from '@/devices'
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BatteryCard } from '@/components/BatteryCard'
import { DeviceList } from '@/components/DeviceList'
import {
  deviceRegistry,
  getDeviceById,
} from '@/devices'
import { resolveSelectedByCategory, useSettingsStore } from '@/stores/settings'

export function HomePage() {
  const autoIntervalSec = useSettingsStore(s => s.autoIntervalSec)
  const trayDeviceId = useSettingsStore(s => s.trayDeviceId)
  const storedSelection = useSettingsStore(s => s.selectedByCategory)
  const setTrayDeviceId = useSettingsStore(s => s.setTrayDeviceId)
  const selectedByCategory = useMemo(
    () => resolveSelectedByCategory(trayDeviceId, storedSelection),
    [trayDeviceId, storedSelection],
  )
  const [info, setInfo] = useState<BatteryInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [auto, setAuto] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  // 防止并发刷新；token 用于丢弃过期响应
  const inflightRef = useRef(false)
  const ignoreTokenRef = useRef(0)

  const selected = useMemo(
    () => getDeviceById(trayDeviceId) ?? deviceRegistry[0],
    [trayDeviceId],
  )

  const refresh = useCallback(async () => {
    if (!selected || inflightRef.current)
      return
    inflightRef.current = true
    const token = ++ignoreTokenRef.current
    setLoading(true)
    setError(null)
    try {
      const next = await selected.readBattery()
      if (token !== ignoreTokenRef.current)
        return
      setInfo(next)
      setLastUpdated(new Date())
    }
    catch (e) {
      if (token !== ignoreTokenRef.current)
        return
      setInfo(null)
      setError(String(e))
      setLastUpdated(new Date())
    }
    finally {
      if (token === ignoreTokenRef.current) {
        setLoading(false)
        inflightRef.current = false
      }
    }
  }, [selected])

  // 自动刷新：间隔来自设置 store
  useEffect(() => {
    if (!auto || !selected)
      return
    void refresh()
    const id = window.setInterval(() => {
      void refresh()
    }, autoIntervalSec * 1000)
    return () => window.clearInterval(id)
  }, [auto, selected, refresh, autoIntervalSec])

  const stopRefresh = useCallback(() => {
    setAuto(false)
    ignoreTokenRef.current += 1
    inflightRef.current = false
    setLoading(false)
  }, [])

  const startRefresh = useCallback(() => {
    setAuto(true)
    void refresh()
  }, [refresh])

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <DeviceList
        devices={deviceRegistry}
        activeId={selected.id}
        selectedByCategory={selectedByCategory}
        onSelect={(id) => {
          setTrayDeviceId(id)
          const next = useSettingsStore.getState().selectedByCategory
          void invoke('set_tray_device', {
            deviceId: id,
            selectedByCategory: next,
          }).catch(() => {})
          setInfo(null)
          setError(null)
          setLastUpdated(null)
          setAuto(true)
        }}
        auto={auto}
        autoIntervalSec={autoIntervalSec}
      />

      <main className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="bg-primary/10 pointer-events-none absolute -top-40 right-[-12%] size-[520px] rounded-full blur-[120px]" />
        <div className="relative mx-auto flex min-h-full w-full max-w-[860px] flex-col justify-start px-5 py-6 lg:justify-center lg:px-10 lg:py-8">
          {selected
            ? (
                <BatteryCard
                  deviceName={selected.name}
                  info={info}
                  loading={loading}
                  auto={auto}
                  autoIntervalSec={autoIntervalSec}
                  error={error}
                  lastUpdated={lastUpdated}
                  onRefresh={refresh}
                  onStartRefresh={startRefresh}
                  onStopRefresh={stopRefresh}
                />
              )
            : (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-muted-foreground">尚未注册任何设备</p>
                </div>
              )}
        </div>
      </main>
    </div>
  )
}
