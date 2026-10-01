import type { BatteryInfo } from '../devices'

interface Props {
  deviceName: string
  info: BatteryInfo | null
  loading: boolean
  auto: boolean
  error: string | null
  onRefresh: () => void
  onStopRefresh: () => void
}

function levelFromInfo(info: BatteryInfo | null): string {
  if (!info || !info.connected)
    return 'empty'
  if (info.percent == null)
    return 'unknown'
  const p = info.percent
  if (p <= 15)
    return 'low'
  if (p <= 40)
    return 'mid'
  return 'high'
}

function widthFromInfo(info: BatteryInfo | null): string {
  if (!info || !info.connected)
    return '0%'
  if (info.percent == null)
    return '100%'
  const p = Math.max(0, Math.min(100, Math.round(info.percent)))
  return `${p}%`
}

function percentText(info: BatteryInfo | null): string {
  if (!info || !info.connected)
    return '--'
  if (info.percent == null)
    return '?'
  return `${Math.max(0, Math.min(100, Math.round(info.percent)))}%`
}

function statusText(info: BatteryInfo | null, loading: boolean, error: string | null, auto: boolean): string {
  if (error)
    return '读取失败'
  if (loading && !info)
    return '读取中…'
  if (!info || !info.connected)
    return `未找到 ${info?.device ?? '设备'}`
  if (info.percent == null)
    return auto ? '已连接 · 自动等待电量报告' : '已连接 · 等待电量报告'
  if (info.charging)
    return auto ? '充电中 · 自动刷新' : '充电中'
  if (info.percent <= 15)
    return auto ? '电量低 · 自动刷新' : '电量低'
  return auto ? '无线连接 · 自动刷新' : '无线连接'
}

export function BatteryCard({ deviceName, info, loading, auto, error, onRefresh, onStopRefresh }: Props) {
  const level = levelFromInfo(info)
  const width = widthFromInfo(info)
  const detail
    = error
      ?? (info
        ? info.connected
          ? `${info.device}\n${info.detail}`
          : info.detail
        : '')

  return (
    <main className="card">
      <p className="label">{deviceName}</p>
      <div className="battery">
        <div className="shell">
          <div className="fill" data-level={level} style={{ width }} />
        </div>
        <div className="cap" />
      </div>
      <p className="percent">{percentText(info)}</p>
      <p className="status">{statusText(info, loading, error, auto)}</p>
      <p className="detail">{detail}</p>
      <div className="flex justify-around  mt-2">
        <button type="button" onClick={onRefresh} disabled={loading && auto}>
          {loading ? '刷新中…' : auto ? '刷新' : '开始自动刷新'}
        </button>
        <button type="button" onClick={onStopRefresh} disabled={!auto && !loading}>
          停止刷新
        </button>
      </div>
    </main>
  )
}
