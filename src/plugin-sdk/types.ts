/** 设备插件契约：前端适配器与 Rust `plugin_sdk` 使用同一套字段。 */

export interface BatteryInfo {
  percent: number | null
  charging: boolean | null
  connected: boolean
  device: string
  detail: string
}

/** 与 `manifest.json` / Rust `DeviceMeta` 同一份字段。 */
export interface DeviceMeta {
  id: string
  name: string
  description: string
}

export interface DeviceAdapter {
  /** 稳定 id，与 Rust 插件 manifest 的 `id` 相同 */
  id: string
  /** 界面显示名称 */
  name: string
  /** 列表里的短说明 */
  description: string
  /** 当前是否值得尝试读电量 */
  detect: () => Promise<boolean>
  /** 读电量。默认走壳层命令 `get_battery(deviceId)` */
  readBattery: () => Promise<BatteryInfo>
}
