/** 雷柏 VT9 AIR。元数据只写在 manifest.json；HID 实现在 `src-tauri/src/devices/vt9_air.rs`。 */
import { createDeviceAdapter } from '@/plugin-sdk'
import manifest from './manifest.json'

export const vt9Air = createDeviceAdapter(manifest)
