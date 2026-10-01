/** 设备注册表：后续新鼠标在此追加 adapter。 */
import type { DeviceAdapter } from './types'
import { vt9Air } from './vt9Air'

export type { BatteryInfo, DeviceAdapter } from './types'
export { vt9Air } from './vt9Air'

/** 已支持的鼠标列表。新增：实现 DeviceAdapter 后 push 进来。 */
export const deviceRegistry: DeviceAdapter[] = [vt9Air]

export function getDeviceById(id: string): DeviceAdapter | undefined {
  return deviceRegistry.find(d => d.id === id)
}
