/**
 * 视图层的镜像：Rust（`yugutou/native` 的 `Mouse`）拥有电量、设备和设置，
 * 这里只存它们的快照，好让绑定跟着变。改动一律调用 `Mouse` 的函数，再 `pull()` 取回。
 */
import { signal } from "nsh";
import type { AppSettings, Battery, Device } from "yugutou/native";
import { Mouse } from "yugutou/native";

export type Category = "mouse" | "keyboard" | "headset";
export const CATEGORIES: Category[] = ["mouse", "keyboard", "headset"];
export const CATEGORY_LABEL: Record<Category, string> = {
  mouse: "鼠标",
  keyboard: "键盘",
  headset: "耳机",
};

export const devices: Device[] = Mouse.devices();
export const settings = signal<AppSettings>(Mouse.settings());
export const samples = signal<Battery[]>(Mouse.samples());
export const page = signal<"home" | "settings">("home");

let seen = -1;

/** Rust 侧版本号变了才重取快照；返回是否有变化。 */
export function pull(): boolean {
  const version = Mouse.version();
  if (version === seen) return false;
  seen = version;
  samples.set(Mouse.samples());
  settings.set(Mouse.settings());
  return true;
}

export function deviceById(id: string): Device | undefined {
  return devices.find((device) => device.id === id);
}

export function sampleFor(id: string): Battery | null {
  return samples().find((sample) => sample.deviceId === id) ?? null;
}

export function devicesIn(category: Category): Device[] {
  return devices.filter((device) => device.category === category);
}

export function selectedIn(s: AppSettings, category: Category): string | null {
  if (category === "mouse") return s.selectedMouse ?? null;
  if (category === "keyboard") return s.selectedKeyboard ?? null;
  return s.selectedHeadset ?? null;
}
