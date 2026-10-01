export type BatteryInfo = {
  percent: number | null;
  charging: boolean | null;
  connected: boolean;
  device: string;
  detail: string;
};

/** Adapter for a mouse (or other HID) device frontend. */
export interface DeviceAdapter {
  /** Stable id used as React key / selection value */
  id: string;
  /** Display name (Chinese UI) */
  name: string;
  /** Short description shown in the device list */
  description: string;
  /** Whether this adapter can attempt a battery read right now */
  detect(): Promise<boolean>;
  /** Read battery via Tauri invoke (or mock) */
  readBattery(): Promise<BatteryInfo>;
}
