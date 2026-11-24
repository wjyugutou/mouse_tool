/** 电量卡片的文案、档位与配色，从 Tauri 版 `src/components/BatteryCard.tsx` 迁来，规则不变。 */
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

/** 圆环填充色（Tailwind 的 *-500 / 深色下 *-400），与老版 LEVEL_STROKE 对应。 */
export const LEVEL_STROKE: Record<"high" | "mid" | "low" | "charging", { light: string; dark: string; rgb: string }> = {
  high: { light: "#10b981", dark: "#34d399", rgb: "16, 185, 129" },
  mid: { light: "#f59e0b", dark: "#fbbf24", rgb: "245, 158, 11" },
  low: { light: "#ef4444", dark: "#f87171", rgb: "239, 68, 68" },
  charging: { light: "#0ea5e9", dark: "#38bdf8", rgb: "14, 165, 233" },
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

export function connectionText(info: Battery | null, error: string | null): string {
  if (!info && !error) return "检测中";
  return info?.connected ? "已连接" : "未连接";
}

export function chargingText(info: Battery | null): string {
  if (info?.charging == null) return "—";
  return info.charging ? "充电中" : "未充电";
}

/** 2.4G 接收器 PID 被同系列多型号共用时，标题的型号可能不准。 */
export function modelUncertainText(info: Battery | null): string | null {
  if (!info || !info.connected || !info.modelUncertain) return null;
  return "型号按 S9 系列处理";
}

export function truncate(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function clockText(atMs: number | null): string {
  if (!atMs) return "—";
  const d = new Date(atMs);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}
