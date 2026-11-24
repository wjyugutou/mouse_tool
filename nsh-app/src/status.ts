/** 电量卡片的文案与档位，从 Tauri 版 `src/components/BatteryCard.tsx` 迁来，规则不变。 */
import type { Battery } from "yugutou/native";

export type BatteryLevel = "high" | "mid" | "low" | "unknown" | "empty" | "charging" | "unsupported";

export const LEVEL_LABEL: Record<BatteryLevel, string> = {
  high: "电量充足",
  mid: "电量正常",
  low: "电量偏低",
  unknown: "等待数据",
  empty: "未连接",
  charging: "充电中",
  unsupported: "型号不支持",
};

export const LEVEL_BAR: Record<BatteryLevel, string> = {
  high: "bg-emerald-500",
  mid: "bg-amber-500",
  low: "bg-red-500",
  unknown: "bg-muted-foreground",
  empty: "bg-border",
  charging: "bg-sky-500",
  unsupported: "bg-muted-foreground",
};

export function levelFromInfo(info: Battery | null): BatteryLevel {
  if (!info) return "unknown";
  // 型号不支持：设备插着、但本版读不了，显示「未连接」会让人以为没插。
  if (info.unsupported) return "unsupported";
  if (!info.connected) return "empty";
  // 充电中必须先判：部分设备充电时拿不到百分比。
  if (info.charging) return "charging";
  if (info.percent == null) return "unknown";
  if (info.percent <= 15) return "low";
  if (info.percent <= 40) return "mid";
  return "high";
}

export function percentText(info: Battery | null): string {
  if (!info || !info.connected || info.percent == null) return "--";
  return `${Math.max(0, Math.min(100, Math.round(info.percent)))}%`;
}

export function statusText(info: Battery | null, loading: boolean, error: string | null): string {
  if (error) return "读取失败";
  if (!info) return loading ? "正在读取…" : "等待读取";
  if (!info.connected) return "设备未连接";
  if (info.unsupported) return "该型号暂不支持";
  if (info.charging) return "充电中";
  if (info.percent == null) return "等待电量数据";
  if (info.percent <= 15) return "电量偏低";
  return "运行正常";
}

export function hintText(info: Battery | null, loading: boolean, error: string | null, auto: boolean): string {
  if (error) return "请检查设备连接后重试。";
  if (!info) return loading ? "正在从设备读取 HID 数据。" : "准备读取设备状态。";
  if (!info.connected) return "未检测到接收器或设备，请检查连接后重试。";
  if (info.unsupported) return info.detail || "检测到的设备型号不在本版支持范围内。";
  if (info.charging) {
    return info.percent == null
      ? "正在充电。该设备充电时不上报百分比，充满或拔线后会自动更新。"
      : "正在充电，充满后会自动更新。";
  }
  if (info.percent == null) return "接收器已连接，等待鼠标唤醒。动一下鼠标或重新插拔接收器。";
  if (info.percent <= 15) return "建议尽快充电。";
  return auto ? "自动刷新已开启，电量会按间隔更新。" : "自动刷新已暂停，可随时手动刷新。";
}

export function clockText(atMs: number | null): string {
  if (!atMs) return "—";
  const d = new Date(atMs);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}
