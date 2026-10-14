/**
 * 壳层使用的设备入口。
 * 实现在 `@/plugins`，类型与适配器工厂在 `@/plugin-sdk`。
 * 新增鼠标不要改首页，只注册插件。
 */
export type { BatteryInfo, DeviceAdapter, DeviceCategory, DeviceMeta } from '@/plugin-sdk'
export { DEVICE_CATEGORIES, DEVICE_CATEGORY_LABEL, deviceRegistry, getDeviceById } from '@/plugins'
