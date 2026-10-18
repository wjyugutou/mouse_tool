/** 迈从 A5 V3 Ultra+。元数据只写在 manifest.json；HID 实现在 `src-tauri/src/devices/mchose_a5_v3_ultra.rs`。 */
import { createDeviceAdapter } from '@/plugin-sdk'
import manifest from './manifest.json'

export const mchoseA5V3UltraPlus = createDeviceAdapter(manifest)
