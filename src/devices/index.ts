import type { DeviceAdapter } from "./types";
import { vt9Air } from "./vt9Air";

export type { BatteryInfo, DeviceAdapter } from "./types";
export { vt9Air } from "./vt9Air";

/**
 * Registry of supported mice.
 * To add another mouse: create src/devices/<id>.ts implementing DeviceAdapter,
 * then push it into this array.
 */
export const deviceRegistry: DeviceAdapter[] = [vt9Air];

export function getDeviceById(id: string): DeviceAdapter | undefined {
  return deviceRegistry.find((d) => d.id === id);
}
