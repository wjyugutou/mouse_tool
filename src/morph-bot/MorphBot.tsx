/** 首页装饰用形态组件：NSH Canvas 2D 驱动，支持随机表情/形态轮播、设备状态联动、跟手视线与悬停暂停。 */
import {
  Canvas,
  cleanup,
  colorScheme,
  effect,
  lifecycle,
  reduceMotion,
  signal,
  View,
  windowSize,
  type CanvasRenderingContext2D,
  type CanvasSize,
  type ViewRef,
} from "nsh";
import { currentWindow } from "nsh/desktop";
import type { Battery } from "yugutou/native";
import {
  deriveDeviceMood,
  pickNextColor,
  pickNextShape,
  pickOther,
  pickStateForMood,
  randomHold,
  reactionForMoodChange,
  type DeviceMood,
  type TransitionReaction,
} from "./device-behavior";
import { MorphBotEngine } from "./engine";
import { clearWindowPointer, subscribeWindowPointer, windowPointer } from "./pointer";
import type { HostBounds } from "./types";

export interface MorphBotProps {
  /** 机器人主体视觉大小（点）；默认 52。 */
  size?: number;
  /** 外层容器（同时作为粒子防裁切画布尺寸）大小（点）；默认 64。 */
  containerSize?: number;
  /** 当前选中设备 id。 */
  deviceId: string;
  /** 当前设备电量采样快照。 */
  info: Battery | null;
  /** 是否正在主动读取 HID。 */
  loading: boolean;
  /** 最近一次读取错误。 */
  error: string | null;
}

const HOVER_PAD = 6;
const FRAME_INTERVAL_MS = 15;
const REDUCED_FRAME_INTERVAL_MS = 90;

function isPointInBounds(bounds: HostBounds | null, x: number, y: number, pad = HOVER_PAD): boolean {
  if (!bounds) return false;
  return (
    x >= bounds.x - pad &&
    x <= bounds.x + bounds.width + pad &&
    y >= bounds.y - pad &&
    y <= bounds.y + bounds.height + pad
  );
}

export function MorphBot(props: MorphBotProps) {
  const botSize = () => props.size ?? 52;
  const boxSize = () => props.containerSize ?? 64;
  const tick = signal(0);

  let hostRef: ViewRef | null = null;
  let hostBounds: HostBounds | null = null;
  let cancelled = false;
  let hoverPaused = false;
  let pointerInsideHost = false;
  let rafId: number | null = null;
  let lastRenderAt = 0;

  let currentMood: DeviceMood = deriveDeviceMood(props.info, props.loading, props.error);
  let prevMood: DeviceMood | null = null;
  let prevDeviceId: string | null = null;
  let pendingReaction: TransitionReaction | null = null;
  let hoverWaiters: (() => void)[] = [];

  const engine = new MorphBotEngine({
    size: botSize(),
    shape: pickNextShape(""),
    color: pickNextColor("", currentMood),
    getReducedMotion: () => reduceMotion(),
    getHostBounds: () => hostBounds,
  });

  let win: ReturnType<typeof currentWindow> | null = null;
  try {
    win = currentWindow();
  } catch {
    win = null;
  }

  function flushHoverWaiters(): void {
    const waiters = hoverWaiters;
    hoverWaiters = [];
    for (const wake of waiters) wake();
  }

  function setHoverPaused(next: boolean): void {
    if (hoverPaused === next) return;
    hoverPaused = next;
    if (next) {
      engine.stopSequence();
    } else {
      flushHoverWaiters();
    }
  }

  function syncHoverState(): void {
    if (cancelled) return;
    const hit =
      pointerInsideHost ||
      (windowPointer.active && isPointInBounds(hostBounds, windowPointer.x, windowPointer.y));
    setHoverPaused(hit);
  }

  function measureHost(): void {
    const ref = hostRef;
    if (!ref || cancelled) return;
    void ref
      .measure()
      .then((measured) => {
        if (cancelled || !measured) return;
        hostBounds = {
          x: measured.pagePosition.x,
          y: measured.pagePosition.y,
          width: measured.bounds.size.width,
          height: measured.bounds.size.height,
        };
        syncHoverState();
      })
      .catch(() => {});
  }

  function isActive(): boolean {
    if (cancelled) return false;
    if (lifecycle() === "background") return false;
    const winState = win?.state() ?? null;
    if (winState && !winState.visible) return false;
    return true;
  }

  function stopLoop(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function scheduleLoop(): void {
    if (rafId !== null || !isActive()) return;
    engine.resetClockBase(performance.now());
    lastRenderAt = 0;
    const frame = (now: number) => {
      rafId = null;
      if (!isActive()) return;
      const minInterval = reduceMotion() ? REDUCED_FRAME_INTERVAL_MS : FRAME_INTERVAL_MS;
      if (lastRenderAt === 0 || now - lastRenderAt >= minInterval) {
        lastRenderAt = now;
        engine.step(now);
        tick.update((v) => (v + 1) & 0x3fffffff);
      }
      if (isActive()) {
        rafId = requestAnimationFrame(frame);
      }
    };
    rafId = requestAnimationFrame(frame);
  }

  function waitWhileHoverPaused(): Promise<void> {
    if (!hoverPaused || cancelled) return Promise.resolve();
    return new Promise((resolve) => {
      hoverWaiters.push(resolve);
    });
  }

  const unsubPointer = subscribeWindowPointer(syncHoverState);
  const unsubFocus = win?.on("focusChange", ({ focused }) => {
    if (!focused) {
      pointerInsideHost = false;
      clearWindowPointer();
      setHoverPaused(false);
    }
  });

  // 窗口可见性 / 前后台变化时暂停或恢复动画，进托盘后 0 CPU 占用。
  effect(() => {
    const active = isActive();
    engine.setPaused(!active);
    if (active) scheduleLoop();
    else stopLoop();
  });

  // 尺寸跟随 props 更新。
  effect(() => {
    engine.size = botSize();
  });

  // 窗口尺寸变动时重新测量宿主的根视图位置。
  effect(() => {
    windowSize();
    measureHost();
  });

  // 联动当前设备读取、充电与电量档位，但不因同情景内百分比微调打断演出。
  effect(() => {
    const nextDeviceId = props.deviceId;
    const nextMood = deriveDeviceMood(props.info, props.loading, props.error);
    currentMood = nextMood;

    if (prevMood === null) {
      prevMood = nextMood;
      prevDeviceId = nextDeviceId;
      if (nextMood === "loading") {
        pendingReaction = { state: pickStateForMood("loading", engine.state), hold: 2200 };
        engine.stopSequence();
      }
      return;
    }

    const sameDevice = nextDeviceId === prevDeviceId;
    if (nextMood !== prevMood || !sameDevice) {
      const reaction = reactionForMoodChange(prevMood, nextMood, sameDevice, engine.color);
      prevMood = nextMood;
      prevDeviceId = nextDeviceId;
      if (reaction) {
        if (reaction.color) engine.setColor(reaction.color);
        if (reaction.burst) engine.particles.burst(14, 0.85, 0.25);
        pendingReaction = reaction;
        engine.stopSequence();
      }
    }
  });

  async function runSequenceLoop(): Promise<void> {
    let nextState = pickStateForMood(currentMood, "idle");
    while (!cancelled) {
      if (!pendingReaction) {
        await waitWhileHoverPaused();
        if (cancelled) return;
      }

      const reaction = pendingReaction;
      pendingReaction = null;
      const targetState = reaction?.state ?? nextState;
      const hold = currentMood === "loading" ? 3600 : (reaction?.hold ?? randomHold());

      let result: { cancelled: boolean };
      try {
        result = await engine.playSequence([{ state: targetState, hold }], { loop: false });
      } catch {
        return;
      }
      if (cancelled) return;

      if (pendingReaction) continue;
      if (result.cancelled || hoverPaused) {
        await waitWhileHoverPaused();
        if (cancelled) return;
        continue;
      }

      if (currentMood !== "loading" && Math.random() < 0.5) {
        engine.setShape(pickNextShape(engine.shapeId));
        engine.setColor(pickNextColor(engine.color, currentMood));
      }
      nextState = pickStateForMood(currentMood, engine.state);
    }
  }

  void runSequenceLoop();

  cleanup(() => {
    cancelled = true;
    hoverPaused = false;
    pointerInsideHost = false;
    stopLoop();
    flushHoverWaiters();
    unsubPointer();
    unsubFocus?.();
    engine.destroy();
  });

  function draw(cx: CanvasRenderingContext2D, canvasSize: CanvasSize): void {
    tick();
    engine.render(cx, canvasSize);
  }

  function triggerInteraction(): void {
    if (currentMood === "loading") return;
    engine.setShape(pickNextShape(engine.shapeId));
    engine.setColor(pickNextColor(engine.color, currentMood));
    engine.particles.burst(16, 0.9, 0.28);
    pendingReaction = {
      state: pickOther(["happy", "playful", "bouncing", "excited", "curious"], engine.state),
      hold: randomHold(),
    };
    engine.stopSequence();
  }

  const dark = () => colorScheme() === "dark";

  return (
    <View
      ref={(node) => {
        hostRef = node;
        measureHost();
      }}
      onLayout={measureHost}
      onMouseEnter={() => {
        pointerInsideHost = true;
        syncHoverState();
      }}
      onMouseLeave={() => {
        pointerInsideHost = false;
        syncHoverState();
      }}
      onPress={triggerInteraction}
      tooltip="点一下互动"
      class="cursor-pointer relative shrink-0 items-center justify-center rounded-[18px]"
      style={{
        width: boxSize(),
        height: boxSize(),
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: dark() ? "rgba(255, 255, 255, 0.10)" : "rgba(15, 23, 42, 0.09)",
        backgroundColor: dark() ? "rgba(10, 14, 22, 0.65)" : "rgba(255, 255, 255, 0.92)",
        backgroundImage: dark()
          ? "radial-gradient(circle at 50% 20%, rgba(125, 211, 252, 0.16) 0%, rgba(125, 211, 252, 0) 70%)"
          : "radial-gradient(circle at 50% 20%, rgba(37, 99, 235, 0.10) 0%, rgba(37, 99, 235, 0) 70%)",
        boxShadow: dark()
          ? "inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -6px 14px rgba(0, 0, 0, 0.45), 0 8px 20px -10px rgba(0, 0, 0, 0.7)"
          : "inset 0 1px 0 rgba(255, 255, 255, 1), 0 6px 16px -8px rgba(15, 23, 42, 0.16)",
      }}
      hoverStyle={{
        borderColor: dark() ? "rgba(125, 211, 252, 0.34)" : "rgba(37, 99, 235, 0.28)",
      }}
      activeStyle={{ scale: 0.96 }}
    >
      <Canvas class="absolute inset-0" draw={draw} />
    </View>
  );
}
