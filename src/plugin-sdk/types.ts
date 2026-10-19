/** 设备插件契约：前端适配器与 Rust `plugin_sdk` 使用同一套字段。 */

export interface BatteryInfo {
  percent: number | null
  charging: boolean | null
  connected: boolean
  device: string
  detail: string
  /**
   * 已连接但**这只设备本身不受支持**（例如插的是同系列其它型号）。
   *
   * 与「读不到电量」区分开：那种情况用户该检查鼠标是否开机、重插接收器；
   * 而这种情况用户做什么都没用，界面不能给误导性的排障提示。
   * 缺省（undefined / null）等同 false，旧插件不用改。
   */
  unsupported?: boolean
  /**
   * 已连接、电量也能读，但**具体型号认不出来**（例如 2.4G 接收器 PID
   * 被同系列多型号共用）。主界面要如实说明，不能把型号说死。
   * 缺省（undefined / null）等同 false。
   */
  model_uncertain?: boolean
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
   * `fresh` 为真时绕过缓存再读一次；否则返回这只设备最近一次采样（和托盘提示同一份）。
   */
  readBattery: (options?: { fresh?: boolean }) => Promise<BatteryInfo>
}
