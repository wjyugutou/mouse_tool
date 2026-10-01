/** 雷柏 VT9 AIR：通过 Tauri `get_battery` 读电量。 */
import type { BatteryInfo, DeviceAdapter } from './types'
import { invoke } from '@tauri-apps/api/core'

export const vt9Air: DeviceAdapter = {
  id: 'vt9-air',
  name: 'VT9 AIR',
  description: '雷柏 VT9 AIR 无线鼠标',

  async detect(): Promise<boolean> {
    try {
      const info = await this.readBattery()
      return info.connected
    }
    catch {
      return false
    }
  },

  async readBattery(): Promise<BatteryInfo> {
    return invoke<BatteryInfo>('get_battery')
  },
}
