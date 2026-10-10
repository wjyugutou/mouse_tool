/** 已安装的前端设备插件。新增鼠标时在 `deviceRegistry` 追加一行。 */
import type { DeviceAdapter } from '@/plugin-sdk'
import { razerViperUltimate } from './razer-viper-ultimate'
import { vt9Air } from './vt9-air'

export type { BatteryInfo, DeviceAdapter, DeviceMeta } from '@/plugin-sdk'

/**
 * 首页与设置的设备列表。
 * 顺序应与 `src-tauri/src/devices/mod.rs` 的 `PLUGINS` 一致。
 * 元数据来自各插件的 `manifest.json`，不要在这里再写 id / 名称。
 */
export const deviceRegistry: DeviceAdapter[] = [
  vt9Air,
  razerViperUltimate,
]

export function getDeviceById(id: string): DeviceAdapter | undefined {
  return deviceRegistry.find(device => device.id === id)
}
