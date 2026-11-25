/** 窗口内全局鼠标位置追踪（普通对象，不触发组件重渲染）。 */

export interface WindowPointerState {
  active: boolean;
  x: number;
  y: number;
}

export const windowPointer: WindowPointerState = {
  active: false,
  x: 0,
  y: 0,
};

const listeners = new Set<() => void>();

export function subscribeWindowPointer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyPointerListeners(): void {
  for (const listener of listeners) listener();
}

export function setWindowPointer(x: number, y: number): void {
  windowPointer.active = true;
  windowPointer.x = x;
  windowPointer.y = y;
  notifyPointerListeners();
}

export function clearWindowPointer(): void {
  if (!windowPointer.active) return;
  windowPointer.active = false;
  notifyPointerListeners();
}
