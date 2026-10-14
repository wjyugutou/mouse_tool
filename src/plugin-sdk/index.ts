/** 把共享 manifest 变成适配器。电量命令由壳层按 id 分发，插件不必各注册一条 IPC。 */
import type { BatteryInfo, DeviceAdapter, DeviceMeta } from './types'
import { invoke } from '@tauri-apps/api/core'

export type { BatteryInfo, DeviceAdapter, DeviceCategory, DeviceMeta } from './types'
export { DEVICE_CATEGORIES, DEVICE_CATEGORY_LABEL } from './types'

/**
 * 用 manifest 生成适配器。
 * `deviceId` 必须来自该文件，以便和 Rust `include_str!` 的同一份元数据对齐。
 */
export function createDeviceAdapter(meta: DeviceMeta): DeviceAdapter {
  const deviceId = meta.id
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    category: meta.category,
    async detect() {
      try {
        const info = await invoke<BatteryInfo>('get_battery', { deviceId })
        return info.connected
      }
      catch {
        return false
      }
    },
    readBattery() {
      return invoke<BatteryInfo>('get_battery', { deviceId })
    },
  }
}
