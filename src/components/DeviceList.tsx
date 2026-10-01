import type { DeviceAdapter } from "@/devices"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface Props {
  devices: DeviceAdapter[]
  selectedId: string
  onSelect: (id: string) => void
}

export function DeviceList({ devices, selectedId, onSelect }: Props) {
  return (
    <Card className="w-[min(220px,92vw)] py-4">
      <CardHeader className="px-4 pb-0">
        <CardTitle className="text-muted-foreground text-xs tracking-[0.12em]">
          设备
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pt-3">
        <ul className="flex flex-col gap-2">
          {devices.map((device) => {
            const selected = device.id === selectedId
            return (
              <li key={device.id}>
                <button
                  type="button"
                  onClick={() => onSelect(device.id)}
                  className={cn(
                    "hover:bg-accent flex w-full flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                    selected
                      ? "border-primary/55 bg-primary/15"
                      : "border-transparent bg-muted/40",
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
      </CardContent>
    </Card>
  )
}
