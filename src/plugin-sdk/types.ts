/** 设备插件契约：前端适配器与 Rust `plugin_sdk` 使用同一套字段。 */

export interface BatteryInfo {
  percent: number | null
  charging: boolean | null
  connected: boolean
  device: string
  detail: string
}

/** 一级分类。顺序即首页分类栏顺序，与 Rust `DeviceCategory` 一致。 */
export const DEVICE_CATEGORIES = ['mouse', 'keyboard', 'headset'] as const

export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number]

export const DEVICE_CATEGORY_LABEL: Record<DeviceCategory, string> = {
  mouse: '鼠标',
  keyboard: '键盘',
  headset: '耳机',
}

/** 与 `manifest.json` / Rust `DeviceMeta` 同一份字段。 */
export interface DeviceMeta {
  id: string
  name: string
  description: string
  /** `mouse` | `keyboard` | `headset` */
  category: DeviceCategory
}

export interface DeviceAdapter {
  /** 稳定 id，与 Rust 插件 manifest 的 `id` 相同 */
  id: string
  /** 界面显示名称 */
  name: string
  /** 列表里的短说明 */
  description: string
  /** 一级分类，来自 manifest */
  category: DeviceCategory
  /** 当前是否值得尝试读电量 */
  detect: () => Promise<boolean>
  /**
   * 读电量。走壳层 `get_battery(deviceId)`。
   * `fresh` 为真时绕过缓存再读一次；否则返回托盘正在用的那一次采样。
   */
  readBattery: (options?: { fresh?: boolean }) => Promise<BatteryInfo>
}
