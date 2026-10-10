/** 雷蛇毒蝰终极版。元数据只写在 manifest.json；HID 实现在 `src-tauri/src/devices/razer_viper_ultimate.rs`。 */
import { createDeviceAdapter } from '@/plugin-sdk'
import manifest from './manifest.json'

export const razerViperUltimate = createDeviceAdapter(manifest)
