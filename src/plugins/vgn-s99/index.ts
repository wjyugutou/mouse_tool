/** VGN S99。元数据只写在 manifest.json；HID 实现在 `src-tauri/src/devices/vgn_s99.rs`。 */
import { createDeviceAdapter } from '@/plugin-sdk'
import manifest from './manifest.json'

export const vgnS99 = createDeviceAdapter(manifest)
