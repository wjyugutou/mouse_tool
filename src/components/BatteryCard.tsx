/** 电量展示卡片：百分比、刷新/停止、错误提示。 */
import type { BatteryInfo } from '@/devices'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

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
  if (info.percent <= 15)
    return 'low'
  if (info.percent <= 40)
    return 'mid'
  return 'high'
}

function widthFromInfo(info: BatteryInfo | null): string {
  if (!info || !info.connected)
    return '0%'
  if (info.percent == null)
    return '100%'
  return `${Math.max(0, Math.min(100, Math.round(info.percent)))}%`
}

function percentText(info: BatteryInfo | null): string {
  if (!info || !info.connected)
    return '--'
  if (info.percent == null)
    return '?'
  return `${Math.max(0, Math.min(100, Math.round(info.percent)))}%`
}

function statusText(
  info: BatteryInfo | null,
  loading: boolean,
  error: string | null,
  auto: boolean,
): string {
  if (error)
    return '读取失败'
  if (loading && !info)
    return '读取中…'
  if (!info || !info.connected)
    return `未找到 ${info?.device ?? '设备'}`
  if (info.percent == null) {
    return auto ? '已连接 · 自动等待电量报告' : '已连接 · 等待电量报告'
  }
  if (info.charging)
    return auto ? '充电中 · 自动刷新' : '充电中'
  if (info.percent <= 15)
    return auto ? '电量低 · 自动刷新' : '电量低'
  return auto ? '无线连接 · 自动刷新' : '无线连接'
}

const fillClass: Record<string, string> = {
  high: 'bg-linear-to-r from-green-500 to-green-400',
  mid: 'bg-linear-to-r from-yellow-500 to-yellow-400',
  low: 'bg-linear-to-r from-red-500 to-red-400',
  unknown:
    'bg-[repeating-linear-gradient(135deg,#334155,#334155_8px,#475569_8px,#475569_16px)]',
  empty: 'bg-transparent',
}

export function BatteryCard({
  deviceName,
  info,
  loading,
  auto,
  error,
  onRefresh,
  onStopRefresh,
}: Props) {
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
    <Card className="w-[min(360px,92vw)] text-center">
      <CardHeader className="pb-0">
        <p className="text-muted-foreground text-xs tracking-[0.12em]">
          {deviceName}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3 pt-2">
        <div className="inline-flex items-center gap-1">
          <div className="border-foreground/70 bg-background h-16 w-[140px] rounded-[10px] border-[3px] p-[5px]">
            <div
              className={cn(
                'h-full rounded-[5px] transition-[width,background] duration-300',
                fillClass[level],
              )}
              style={{ width }}
            />
          </div>
          <div className="bg-foreground/70 h-6 w-2 rounded-r" />
        </div>
        <p className="text-4xl font-bold tracking-wide">{percentText(info)}</p>
        <p className="text-muted-foreground text-sm">
          {statusText(info, loading, error, auto)}
        </p>
        <p className="text-muted-foreground min-h-[2.4em] whitespace-pre-wrap break-all text-xs leading-relaxed">
          {detail}
        </p>
      </CardContent>
      <CardFooter className="justify-around gap-3">
        <Button
          type="button"
          onClick={onRefresh}
          disabled={loading && auto}
          className="rounded-full"
        >
          {loading ? '刷新中…' : auto ? '刷新' : '开始自动刷新'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onStopRefresh}
          disabled={!auto && !loading}
          className="rounded-full"
        >
          停止刷新
        </Button>
      </CardFooter>
    </Card>
  )
}
