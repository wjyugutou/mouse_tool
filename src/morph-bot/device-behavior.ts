/** MorphBot 行为策展：保留原版随机轮播形态/配色/表情，并联动当前设备的读取/电量/充电状态。 */
import type { Battery } from "yugutou/native";
import { levelFromInfo } from "../status";
import { MORPH_BOT_SHAPES, type MorphShape, type MorphState } from "./catalog";

/** 体色：避开可能看不清眼睛的实心深色。 */
export const BODY_COLORS = [
  "#705cff",
  "#3c82f6",
  "#f9705c",
  "#27b98b",
  "#e06ca8",
  "#f08a3e",
  "#38bdf8",
  "#a78bfa",
  "#2dd4bf",
  "#fb7185",
] as const;

export const HOLD_MIN_MS = 1500;
export const HOLD_MAX_MS = 4000;

export type DeviceMood =
  | "loading"
  | "error"
  | "charging"
  | "low"
  | "mid"
  | "high"
  | "empty"
  | "unknown"
  | "unsupported";

const LOADING_STATES: readonly MorphState[] = ["radar", "searching", "loading", "orbit"];

const MOOD_POOLS: Readonly<Record<Exclude<DeviceMood, "loading">, { primary: readonly MorphState[]; fallback: readonly MorphState[] }>> = {
  error: {
    primary: ["alerting", "confused", "suspicious", "sad", "scared"],
    fallback: ["idle", "thinking", "searching"],
  },
  charging: {
    primary: ["humming", "progress", "spawning", "receiving", "working", "happy", "excited", "proud"],
    fallback: ["playful", "curious", "bouncing", "idle"],
  },
  low: {
    primary: ["drowsy", "sad", "bored", "notifying", "powering-down", "shy"],
    fallback: ["idle", "thinking", "curious"],
  },
  mid: {
    primary: [
      "idle", "happy", "curious", "listening", "thinking", "working", "playful",
      "bored", "confused", "humming", "orbit", "bouncing", "writing", "dictating",
    ],
    fallback: ["proud", "shy", "surprised"],
  },
  high: {
    primary: [
      "idle", "listening", "thinking", "searching", "working", "excited", "surprised",
      "happy", "curious", "proud", "shy", "laughing", "playful", "celebrate",
      "orbit", "progress", "spawning", "humming", "dictating", "writing",
      "sending", "receiving", "uploading", "notifying", "bouncing",
    ],
    fallback: ["waking", "confused", "bored"],
  },
  empty: {
    primary: ["sleeping", "powering-down", "drowsy", "searching", "radar", "bored"],
    fallback: ["idle", "curious", "confused"],
  },
  unknown: {
    primary: ["searching", "radar", "listening", "curious", "thinking", "drowsy"],
    fallback: ["idle", "confused"],
  },
  unsupported: {
    primary: ["confused", "suspicious", "shy", "bored", "sad"],
    fallback: ["idle", "thinking"],
  },
};

const CHARGING_ACCENT_COLORS = ["#38bdf8", "#3c82f6", "#2dd4bf", "#27b98b"] as const;
const ALERT_ACCENT_COLORS = ["#f9705c", "#f08a3e", "#fb7185"] as const;

export function deriveDeviceMood(info: Battery | null, loading: boolean, error: string | null): DeviceMood {
  if (loading) return "loading";
  if (error) return "error";
  return levelFromInfo(info);
}

export function randomHold(): number {
  return HOLD_MIN_MS + Math.random() * (HOLD_MAX_MS - HOLD_MIN_MS);
}

/** 从列表挑一个尽量不同于 current 的项；列表只剩一项时退回该项。 */
export function pickOther<T extends string>(items: readonly T[], current: string): T {
  const pool = items.filter((item) => item !== current);
  const source = pool.length > 0 ? pool : items;
  const index = Math.floor(Math.random() * source.length);
  return source[index] ?? source[0];
}

export function pickNextShape(current: string): MorphShape {
  return pickOther(MORPH_BOT_SHAPES, current);
}

export function pickNextColor(current: string, mood?: DeviceMood): string {
  if (mood === "charging" && Math.random() < 0.6) return pickOther(CHARGING_ACCENT_COLORS, current);
  if ((mood === "error" || mood === "low") && Math.random() < 0.6) return pickOther(ALERT_ACCENT_COLORS, current);
  return pickOther(BODY_COLORS, current);
}

export function pickStateForMood(mood: DeviceMood, current: MorphState): MorphState {
  if (mood === "loading") return pickOther(LOADING_STATES, current);
  const entry = MOOD_POOLS[mood];
  const pool = Math.random() < 0.78 ? entry.primary : entry.fallback;
  return pickOther(pool, current);
}

export interface TransitionReaction {
  state: MorphState;
  hold: number;
  burst?: boolean;
  color?: string;
}

/** 根据设备情景变化决定是否立即给予一次语义化反馈。 */
export function reactionForMoodChange(
  prevMood: DeviceMood | null,
  nextMood: DeviceMood,
  sameDevice: boolean,
  currentColor: string,
): TransitionReaction | null {
  if (nextMood === "loading") {
    return { state: pickOther(LOADING_STATES, ""), hold: 2200 };
  }
  if (prevMood === null) return null;

  if (nextMood === "error" && prevMood !== "error") {
    return { state: "alerting", hold: 2400, color: pickOther(ALERT_ACCENT_COLORS, currentColor) };
  }
  if (nextMood === "charging" && prevMood !== "charging") {
    return {
      state: sameDevice ? "excited" : "humming",
      hold: 2300,
      burst: sameDevice,
      color: pickOther(CHARGING_ACCENT_COLORS, currentColor),
    };
  }
  if (nextMood === "low" && prevMood !== "low") {
    return {
      state: sameDevice ? "notifying" : "drowsy",
      hold: 2200,
      color: pickOther(ALERT_ACCENT_COLORS, currentColor),
    };
  }
  if (nextMood === "high" && (prevMood === "charging" || prevMood === "empty")) {
    return {
      state: prevMood === "charging" ? "celebrate" : "waking",
      hold: 2200,
      burst: true,
    };
  }
  if (nextMood === "empty" && prevMood !== "empty") {
    return { state: "powering-down", hold: 2200 };
  }
  if (prevMood === "loading" || !sameDevice) {
    return { state: pickStateForMood(nextMood, "idle"), hold: randomHold() };
  }
  return null;
}
