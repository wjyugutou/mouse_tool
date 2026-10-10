/**
 * 壳层使用的设备入口。
 * 实现在 `@/plugins`，类型与适配器工厂在 `@/plugin-sdk`。
 * 新增鼠标不要改首页，只注册插件。
 */
export type { BatteryInfo, DeviceAdapter, DeviceMeta } from '@/plugin-sdk'
export { deviceRegistry, getDeviceById } from '@/plugins'
