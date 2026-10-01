/** 设备适配器类型：前端统一用这套接口读电量。 */
export interface BatteryInfo {
  percent: number | null
  charging: boolean | null
  connected: boolean
  device: string
  detail: string
}

export interface DeviceAdapter {
  /** 稳定 id，用作列表 key / 选中值 */
  id: string
  /** 界面显示名称 */
  name: string
  /** 列表里的短说明 */
  description: string
  /** 当前是否值得尝试读电量 */
  detect: () => Promise<boolean>
  /** 读电量（Tauri invoke 或 mock） */
  readBattery: () => Promise<BatteryInfo>
}
