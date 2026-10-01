import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { BatteryCard } from "@/components/BatteryCard"
import { DeviceList } from "@/components/DeviceList"
import {
  deviceRegistry,
  getDeviceById,
  type BatteryInfo,
} from "@/devices"
import { useSettingsStore } from "@/stores/settings"

export const Route = createFileRoute("/")({
  component: HomePage,
})

function HomePage() {
  const autoIntervalSec = useSettingsStore((s) => s.autoIntervalSec)
  const [selectedId, setSelectedId] = useState(
    () => deviceRegistry[0]?.id ?? "",
  )
  const [info, setInfo] = useState<BatteryInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [auto, setAuto] = useState(true)
  const inflight = useRef(false)
  const ignoreToken = useRef(0)

  const selected = useMemo(
    () => getDeviceById(selectedId) ?? deviceRegistry[0],
    [selectedId],
  )

  const refresh = useCallback(async () => {
    if (!selected || inflight.current) return
    inflight.current = true
    const token = ++ignoreToken.current
    setLoading(true)
    setError(null)
    try {
      const next = await selected.readBattery()
      if (token !== ignoreToken.current) return
      setInfo(next)
    } catch (e) {
      if (token !== ignoreToken.current) return
      setInfo(null)
      setError(String(e))
    } finally {
      if (token === ignoreToken.current) {
        setLoading(false)
        inflight.current = false
      }
    }
  }, [selected])

  useEffect(() => {
    if (!auto || !selected) return
    void refresh()
    const id = window.setInterval(() => {
      void refresh()
    }, autoIntervalSec * 1000)
    return () => window.clearInterval(id)
  }, [auto, selected, refresh, autoIntervalSec])

  const stopRefresh = useCallback(() => {
    setAuto(false)
    ignoreToken.current += 1
    inflight.current = false
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
