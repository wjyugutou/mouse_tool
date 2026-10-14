/** 已注册设备列表。左侧是一级分类，右侧是该分类下的设备。 */
import type { DeviceAdapter, DeviceCategory } from '@/devices'
import { Icon } from '@iconify/react'
import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { DEVICE_CATEGORIES, DEVICE_CATEGORY_LABEL } from '@/devices'
import { cn } from '@/lib/utils'

const CATEGORY_ICON: Record<DeviceCategory, string> = {
  mouse: 'mdi:mouse',
  keyboard: 'mdi:keyboard',
  headset: 'mdi:headphones',
}

interface Props {
  devices: DeviceAdapter[]
  /** 电量卡片 / 托盘图标当前跟着哪一只 */
  activeId: string
  /** 各分类里选中的那一只，用来画高亮 */
  selectedByCategory: Record<DeviceCategory, string | null>
  onSelect: (id: string) => void
}

export function DeviceList({ devices, activeId, selectedByCategory, onSelect }: Props) {
  const [category, setCategory] = useState<DeviceCategory>(() => {
    return devices.find(device => device.id === activeId)?.category ?? 'mouse'
  })
  const selectedId = selectedByCategory[category]
  const visible = devices.filter(device => device.category === category)

  return (
    <Card className="w-[min(320px,92vw)] py-3">
      <div className="flex min-h-56">
        <nav
          aria-label="设备分类"
          className="flex w-[4.75rem] shrink-0 flex-col gap-1 border-r border-border px-2"
        >
          {DEVICE_CATEGORIES.map((id) => {
            const active = id === category
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(id)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Icon icon={CATEGORY_ICON[id]} className="size-5" />
                {DEVICE_CATEGORY_LABEL[id]}
              </button>
            )
          })}
        </nav>
        <div className="min-w-0 flex-1 px-3">
          {visible.length === 0
            ? (
                <p className="text-muted-foreground flex h-full items-center justify-center px-2 text-center text-xs">
                  {`暂无${DEVICE_CATEGORY_LABEL[category]}`}
                </p>
              )
            : (
                <ul className="flex flex-col gap-2">
                  {visible.map((device) => {
                    const selected = device.id === selectedId
                    return (
                      <li key={device.id}>
                        <button
                          type="button"
                          onClick={() => onSelect(device.id)}
                          className={cn(
                            'hover:bg-accent flex w-full flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
                            selected
                              ? 'border-primary/55 bg-primary/15'
                              : 'border-transparent bg-muted/40',
                          )}
                        >
                          <span className="text-sm font-semibold">{device.name}</span>
                          <span className="text-muted-foreground text-[11px]">
                            {device.description}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
        </div>
      </div>
    </Card>
  )
}
