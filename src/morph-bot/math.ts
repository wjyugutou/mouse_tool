/** 物理步进与缓动数学工具。 */

export const FIXED_STEP = 1 / 120;

export interface SpringValue {
  x: number;
  v: number;
  target: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function random(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function cubicInOut(value: number): number {
  return value < 0.5 ? 4 * value ** 3 : 1 - ((-2 * value + 2) ** 3) / 2;
}

export function cubicOut(value: number): number {
  return 1 - (1 - value) ** 3;
}

export function backOut(value: number): number {
  return 1 + 2.70158 * (value - 1) ** 3 + 1.70158 * (value - 1) ** 2;
}

export function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

export function springValue(value: number): SpringValue {
  return { x: value, v: 0, target: value };
}

export function stepSpring(spring: SpringValue, frequency: number, damping: number, delta: number): void {
  spring.v += (-2 * damping * frequency * spring.v - frequency ** 2 * (spring.x - spring.target)) * delta;
  spring.x += spring.v * delta;
  if (!Number.isFinite(spring.x) || !Number.isFinite(spring.v)) {
    spring.x = spring.target;
    spring.v = 0;
  }
}
