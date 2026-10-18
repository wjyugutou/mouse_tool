//! 已安装的设备插件。
//!
//! 新增鼠标：加上模块，并在 [`PLUGINS`] 追加一行。
//! 托盘和 `get_battery` 都读这张表，不要再维护第二份设备列表。

mod mchose_a5_v3_ultra;
mod razer_viper_ultimate;
mod vt9_air;

use crate::plugin_sdk::{BatteryInfo, DeviceMeta, DevicePlugin};

/// 构建期设备表。顺序即默认设备的顺序。托盘菜单只显示各分类里选中的那一只。
static PLUGINS: &[&DevicePlugin] = &[&vt9_air::PLUGIN, &razer_viper_ultimate::PLUGIN, &mchose_a5_v3_ultra::PLUGIN];

pub fn find(device_id: &str) -> Option<&'static DevicePlugin> {
    PLUGINS
        .iter()
        .copied()
        .find(|plugin| plugin.meta().id == device_id)
}

pub fn default_device_id() -> String {
    PLUGINS
        .first()
        .map(|plugin| plugin.meta().id)
        .unwrap_or_default()
}

pub fn list_meta() -> Vec<DeviceMeta> {
    PLUGINS.iter().map(|plugin| plugin.meta()).collect()
}

pub fn device_name(device_id: &str) -> String {
    find(device_id)
        .map(|plugin| plugin.meta().name)
        .unwrap_or_else(|| device_id.to_string())
}

pub fn read_battery(device_id: &str) -> BatteryInfo {
    let Some(plugin) = find(device_id) else {
        return BatteryInfo::disconnected(device_id, format!("未知设备: {device_id}"));
    };
    let meta = plugin.meta();
    match (plugin.read_battery)() {
        Ok(info) => info,
        Err(detail) => BatteryInfo::disconnected(meta.name, detail),
    }
}

/// 壳层命令：返回已注册设备。元数据与前端 manifest 同源。
#[tauri::command]
pub fn list_devices() -> Vec<DeviceMeta> {
    list_meta()
}

/// 壳层命令：按设备 id 读电量。替换原先隐式只支持 VT9 的无参 `get_battery`。
#[tauri::command]
pub async fn get_battery(device_id: String) -> BatteryInfo {
    let label = device_name(&device_id);
    match tauri::async_runtime::spawn_blocking(move || read_battery(&device_id)).await {
        Ok(info) => info,
        Err(err) => BatteryInfo::disconnected(label, format!("读取任务失败: {err}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_sdk::DeviceCategory;

    #[test]
    fn plugin_ids_are_unique_and_match_shared_manifest() {
        let metas = list_meta();
        assert!(!metas.is_empty(), "至少注册一只鼠标");

        let mut ids: Vec<_> = metas.iter().map(|meta| meta.id.clone()).collect();
        let len = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), len, "插件 id 重复");

        assert_eq!(metas[0].id, "vt9-air");
        assert_eq!(metas[0].name, "VT9 AIR");
        assert_eq!(metas[0].description, "雷柏 VT9 AIR 无线鼠标");
        assert_eq!(metas[0].category, DeviceCategory::Mouse);
        assert_eq!(default_device_id(), "vt9-air");
        assert_eq!(metas[1].id, "razer-viper-ultimate");
        assert_eq!(metas[1].name, "毒蝰终极版 Viper Ultimate");
        assert_eq!(metas[1].category, DeviceCategory::Mouse);
        assert_eq!(metas[2].id, "mchose-a5-v3-ultra-plus");
        assert_eq!(metas[2].name, "迈从 A5 V3 Ultra+");
        assert_eq!(metas[2].category, DeviceCategory::Mouse);
        assert!(find("vt9-air").is_some());
        assert!(find("razer-viper-ultimate").is_some());
        assert!(find("mchose-a5-v3-ultra-plus").is_some());
        assert!(find("missing-mouse").is_none());
    }

    #[test]
    fn unknown_device_does_not_panic() {
        let info = read_battery("missing-mouse");
        assert!(!info.connected);
        assert_eq!(info.device, "missing-mouse");
        assert!(info.detail.contains("未知设备"));
        assert!(info.percent.is_none());
    }
}
