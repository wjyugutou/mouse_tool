/** 电量卡片的文案、档位与精密能量光谱配色；业务判断规则保持单一真源语义。 */
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

/** 有效电量档位的圆环起止渐变色与发光基色。 */
export const LEVEL_STROKE: Record<
  "high" | "mid" | "low" | "charging",
  { light: string; lightEnd: string; dark: string; darkEnd: string; rgb: string }
> = {
  high: { light: "#059669", lightEnd: "#34d399", dark: "#10b981", darkEnd: "#6ee7b7", rgb: "16, 185, 129" },
  mid: { light: "#d97706", lightEnd: "#fbbf24", dark: "#f59e0b", darkEnd: "#fcd34d", rgb: "245, 158, 11" },
  low: { light: "#e11d48", lightEnd: "#fb7185", dark: "#f43f5e", darkEnd: "#fda4af", rgb: "244, 63, 94" },
  charging: { light: "#0284c7", lightEnd: "#38bdf8", dark: "#0ea5e9", darkEnd: "#7dd3fc", rgb: "56, 189, 248" },
};

export interface LevelPalette {
  /** 语义主色（文本、图标、刻度点亮）。 */
  accent: string;
  /** 渐变弧尾端高光色。 */
  accentEnd: string;
  /** RGB 三元组（环境光晕与微透材质）。 */
  rgb: string;
  /** 胶囊/微标柔和背景。 */
  softBg: string;
  /** 胶囊/微标柔和边框。 */
  softBorder: string;
}

/** 根据电量档位与深浅色返回整套协调色板，供环境光、仪表环、侧栏徽标与能量格共用。 */
export function levelPalette(level: BatteryLevel, dark: boolean): LevelPalette {
  if (level === "high" || level === "mid" || level === "low" || level === "charging") {
    const tone = LEVEL_STROKE[level];
    return {
      accent: dark ? tone.darkEnd : tone.light,
      accentEnd: dark ? tone.dark : tone.lightEnd,
      rgb: tone.rgb,
      softBg: `rgba(${tone.rgb}, ${dark ? 0.14 : 0.1})`,
      softBorder: `rgba(${tone.rgb}, ${dark ? 0.3 : 0.24})`,
    };
  }
  if (level === "unsupported") {
    const rgb = "245, 158, 11";
    return {
      accent: dark ? "#fbbf24" : "#b45309",
      accentEnd: dark ? "#f59e0b" : "#d97706",
      rgb,
      softBg: `rgba(${rgb}, ${dark ? 0.12 : 0.09})`,
      softBorder: `rgba(${rgb}, ${dark ? 0.26 : 0.22})`,
    };
  }
  if (level === "unknown") {
    const rgb = dark ? "125, 211, 252" : "37, 99, 235";
    return {
      accent: dark ? "#93c5fd" : "#2563eb",
      accentEnd: dark ? "#60a5fa" : "#3b82f6",
      rgb,
      softBg: `rgba(${rgb}, ${dark ? 0.12 : 0.08})`,
      softBorder: `rgba(${rgb}, ${dark ? 0.24 : 0.18})`,
    };
  }
  const rgb = dark ? "148, 163, 184" : "100, 116, 139";
  return {
    accent: dark ? "#94a3b8" : "#64748b",
    accentEnd: dark ? "#64748b" : "#94a3b8",
    rgb,
    softBg: `rgba(${rgb}, ${dark ? 0.12 : 0.09})`,
    softBorder: `rgba(${rgb}, ${dark ? 0.2 : 0.18})`,
  };
}

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

export function percentNumber(info: Battery | null): number | null {
  if (!info || !info.connected || info.percent == null) return null;
  return Math.max(0, Math.min(100, Math.round(info.percent)));
}

export function percentText(info: Battery | null): string {
  const n = percentNumber(info);
  return n == null ? "--" : `${n}%`;
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
