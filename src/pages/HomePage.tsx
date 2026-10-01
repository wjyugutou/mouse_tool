/** 首页：设备列表 + 电量卡片，按设置间隔自动刷新。 */
import type { BatteryInfo } from '@/devices'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BatteryCard } from '@/components/BatteryCard'
import { DeviceList } from '@/components/DeviceList'
import {

  deviceRegistry,
  getDeviceById,
} from '@/devices'
import { useSettingsStore } from '@/stores/settings'

export function HomePage() {
  const autoIntervalSec = useSettingsStore(s => s.autoIntervalSec)
  const [selectedId, setSelectedId] = useState(
    () => deviceRegistry[0]?.id ?? '',
  )
  const [info, setInfo] = useState<BatteryInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [auto, setAuto] = useState(true)
  // 防止并发刷新；token 用于丢弃过期响应
  const inflightRef = useRef(false)
  const ignoreTokenRef = useRef(0)

  const selected = useMemo(
    () => getDeviceById(selectedId) ?? deviceRegistry[0],
    [selectedId],
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
    }
    catch (e) {
      if (token !== ignoreTokenRef.current)
        return
      setInfo(null)
      setError(String(e))
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

  if (!selected) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">尚未注册任何设备</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-wrap items-center justify-center gap-5 overflow-auto p-6">
      <DeviceList
        devices={deviceRegistry}
        selectedId={selected.id}
        onSelect={(id) => {
          setSelectedId(id)
          setInfo(null)
          setError(null)
          setAuto(true)
        }}
      />
      <BatteryCard
        deviceName={selected.name}
        info={info}
        loading={loading}
        auto={auto}
        error={error}
        onRefresh={startRefresh}
        onStopRefresh={stopRefresh}
      />
    </div>
  )
}
