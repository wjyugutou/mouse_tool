/**
 * 前行者 S9 Pro。元数据只写在 manifest.json；
 * HID 实现在 `src-tauri/src/devices/qianxingzhe_s9_pro.rs`。
 */
import { createDeviceAdapter } from '@/plugin-sdk'
import manifest from './manifest.json'

export const qianxingzheS9Pro = createDeviceAdapter(manifest)
