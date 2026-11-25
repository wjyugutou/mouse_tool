/** MorphBot 引擎控制器：统筹时钟、物理、状态序列与 Canvas 渲染，无 DOM 依赖。 */
import type { CanvasRenderingContext2D, CanvasSize } from "nsh";
import { MORPH_BOT_EFFECTS, MORPH_BOT_SHAPES, MORPH_BOT_STATES, MORPH_BY_STATE, type MorphEffect, type MorphShape, type MorphState } from "./catalog";
import { pencilPose, renderBotCanvas } from "./canvas-renderer";
import { lerpRing } from "./geometry";
import { clamp, random, springValue } from "./math";
import { updateMorph } from "./morph-system";
import { EXPRESSIONS, HEAD_C, ORIGINAL_STATE_DATA, SHAPES, type FaceTransform, type Ring } from "./original-data";
import { ParticleSystem } from "./particle-system";
import { stepPhysics } from "./physics-system";
import { windowPointer } from "./pointer";
import { resolveShape, updateStateTargets } from "./state-behavior-system";
import type {
  ActiveGesture,
  BlinkKeyframe,
  BotConfig,
  BotEngineContext,
  HostBounds,
  MorphPreviewState,
  PointerSmoothState,
} from "./types";

export interface MorphSequenceStep {
  state: MorphState;
  hold?: number;
  morph?: MorphEffect | "none" | null;
  morphHold?: number;
}

export interface MorphSequenceResult {
  cancelled: boolean;
  cycles?: number;
  cycle?: number;
  index?: number;
}

interface PendingWait {
  remainingMs: number;
  resolve: (ok: boolean) => void;
}

interface PendingMorphMonitor {
  token: number;
  restore: MorphState | "default" | null;
  resolve: (result: { cancelled?: boolean; effect?: MorphEffect; restored?: MorphState | "default" | null }) => void;
}

const DEFAULT_GAZE_SCALE = 2.25;

export class MorphBotEngine implements BotEngineContext {
  readonly particles: ParticleSystem;
  state: MorphState = "idle";
  startedAt: number;
  stateStartedAt: number;
  lastTime: number;
  clockTime: number;
  delta = 1 / 60;
  playbackRate = 1;
  paused = false;
  pendingStep = 0;

  expressionFrom: [Ring, Ring] = [EXPRESSIONS[0][0], EXPRESSIONS[0][1]];
  expressionTo: [Ring, Ring] = [EXPRESSIONS[0][0], EXPRESSIONS[0][1]];
  expressionIndex = 0;
  expressionSpring = springValue(1);
  expressionFrequency = 7;

  rotation = springValue(0);
  headX = springValue(0);
  headY = springValue(0);
  scaleY = springValue(1);
  eyeOpen = springValue(1);
  eyeScale = springValue(1);
  aimX = springValue(0);
  aimY = springValue(0);
  morph = springValue(0);
  morphBlend = springValue(1);
  shapeBlend = springValue(1);
  turn = springValue(0);
  notify = springValue(0);
  humming = springValue(0);

  stateVersion = 0;
  requestedMorphEffect: MorphEffect | null = null;
  morphEffect: MorphEffect | null = null;
  previousMorphEffect: MorphEffect | null = null;
  morphVisible = false;
  morphStartedAt: number;
  morphShotStartedAt: number;
  morphRestStartedAt = 0;
  oneShotResting = false;
  morphPreview: MorphPreviewState | null = null;

  turnDirection = 1;
  spinAngle = 0;
  expressionCursor = 0;
  expressionNext = 0;
  blinkNext = 0;
  gazeNext = 0;
  blinkQueue: BlinkKeyframe[] = [];
  blinkTarget: number | null = null;
  wakeBurst = false;
  drowsyStartedAt = 0;
  listenNodUntil = 0;
  listenNodNext = 0;
  impulseNext = 0;
  impulseUntil = 0;
  behaviorNext = 0;
  winkAt = -Infinity;
  winkEye = 0;
  winkNext: number;
  dragCycle = -1;
  notifyTriggered = false;
  receiveCycle = -1;
  receiveAngle = -0.7;
  writingTrail: [number, number][] = [];

  shapeId: MorphShape;
  shapeFromRing: Ring;
  shapeFromFace: FaceTransform;
  shapeFromTiltScale: number;
  shapeFromBeltRadius: number;
  shapeChangeCycle = Math.floor(random(0, 5));
  shapeChangeWide = false;
  spinSpring = null as BotEngineContext["spinSpring"];
  gesture: ActiveGesture | null = null;
  bounceStartedAt = -1;
  ambientNext: number;
  celebrateCycle = -1;
  celebrateWildActive = false;

  directTurn = 0;
  directRotation = 0;
  directX = 0;
  directY = 0;
  directGazeX = 0;
  directGazeY = 0;
  currentBeltRadius: number;
  particleSpinAngle = 0;
  pointer: PointerSmoothState = { x: 0, y: 0, targetX: 0, targetY: 0 };

  color = "#3c82f6";
  eyeColor = "#f4f7fb";
  size: number;
  gazeScale = DEFAULT_GAZE_SCALE;
  followPointer = true;
  particlesEnabled = true;

  private readonly getReducedMotion: () => boolean;
  private readonly getHostBounds: () => HostBounds | null;
  private sequenceToken = 0;
  private morphMonitorToken = 0;
  private pendingWait: PendingWait | null = null;
  private pendingMorph: PendingMorphMonitor | null = null;
  private lastGeometry;

  constructor(options: {
    size: number;
    shape?: MorphShape;
    color?: string;
    getReducedMotion: () => boolean;
    getHostBounds: () => HostBounds | null;
  }) {
    const now = performance.now();
    this.startedAt = now;
    this.stateStartedAt = now;
    this.lastTime = now;
    this.clockTime = now;
    this.morphStartedAt = now;
    this.morphShotStartedAt = now;
    this.winkNext = now + random(3000, 8000);
    this.ambientNext = now + random(2500, 5000);
    this.size = options.size;
    if (options.color) this.color = options.color;
    this.getReducedMotion = options.getReducedMotion;
    this.getHostBounds = options.getHostBounds;

    const initialShape = options.shape && MORPH_BOT_SHAPES.includes(options.shape) ? options.shape : "blob";
    this.shapeId = initialShape;
    this.shapeFromRing = SHAPES[initialShape].ring;
    this.shapeFromFace = SHAPES[initialShape].face;
    this.shapeFromTiltScale = SHAPES[initialShape].tiltScale;
    this.shapeFromBeltRadius = SHAPES[initialShape].beltRadius;
    this.currentBeltRadius = SHAPES[initialShape].beltRadius;

    this.particles = new ParticleSystem({
      reduceMotion: () => this.reducedMotion,
      radius: () => this.currentBeltRadius,
    });

    this.lastGeometry = resolveShape(this, this.shapeId);
    this.setState("idle", true);
  }

  get reducedMotion(): boolean {
    return this.getReducedMotion();
  }

  get pointerActive(): boolean {
    return windowPointer.active && this.getHostBounds() !== null;
  }

  private buildConfig(): BotConfig {
    const id = MORPH_BOT_STATES.includes(this.state) ? this.state : "idle";
    const blink = ORIGINAL_STATE_DATA.BLINK_CADENCE[id];
    const pool = ORIGINAL_STATE_DATA.EXPRESSION_POOLS[id] ?? [0, 8];
    const cadence = ORIGINAL_STATE_DATA.EXPRESSION_CADENCE[id] ?? [4000, 8000];
    return {
      color: this.color,
      eyeColor: this.eyeColor,
      badgeColor: "#1d9bf0",
      badgeScale: 1,
      size: this.size,
      flipX: false,
      pointer: this.followPointer,
      particlesEnabled: this.particlesEnabled,
      shape: this.shapeId,
      expressionPool: pool,
      expressionWeights: {},
      expressionCadence: cadence,
      blinkCadence: blink ? [Math.min(blink[0], blink[1]), Math.max(blink[0], blink[1])] : null,
      morph: MORPH_BY_STATE[id] ?? "none",
      headX: 0,
      headY: 0,
      headRotation: 0,
      scaleX: 1,
      scaleY: 1,
      eyeOpen: 1,
      eyeScale: 1,
      gazeScale: this.gazeScale,
      motionScale: 1,
      tempo: 1,
    };
  }

  setState(state: MorphState, immediate = false): void {
    if (!immediate && state === this.state) return;
    const now = this.clockTime;
    this.state = state;
    this.stateStartedAt = now;
    this.stateVersion += 1;
    const config = this.buildConfig();
    this.expressionCursor = 0;
    this.expressionNext = now + random(config.expressionCadence[0], config.expressionCadence[1]) * config.tempo;
    this.blinkNext = now + random(1500, 7000);
    this.gazeNext = now + random(500, 1400);
    this.listenNodNext = now + random(1200, 2200);
    this.impulseNext = now + random(500, 1200);
    this.behaviorNext =
      now +
      (state === "excited"
        ? random(400, 1100)
        : state === "searching"
          ? random(800, 1600)
          : state === "working"
            ? random(1200, 2400)
            : random(6000, 10000));
    this.winkNext = now + random(3000, 8000);
    this.blinkQueue = [];
    this.blinkTarget = null;
    this.wakeBurst = false;
    this.drowsyStartedAt = 0;
    this.dragCycle = -1;
    this.notifyTriggered = false;
    this.receiveCycle = -1;
    this.writingTrail = [];
    this.oneShotResting = false;
    this.morphPreview = null;
    this.celebrateWildActive = false;
    this.morphShotStartedAt = now;
    if (state === "celebrate") {
      this.turnDirection = Math.random() < 0.5 ? 1 : -1;
      this.celebrateCycle = -1;
    }
    const firstExpression = config.expressionPool[0] ?? 0;
    if (state !== "waking" && state !== "sleeping") {
      if (state !== "drowsy") this.scheduleBlink(now);
      this.setExpression(firstExpression, state === "excited" ? 10 : 8);
    }
  }

  setShape(shape: MorphShape): void {
    if (!MORPH_BOT_SHAPES.includes(shape)) return;
    if (shape === this.shapeId) return;
    resolveShape(this, shape);
  }

  setColor(color: string): void {
    this.color = color;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  resetClockBase(realNow = performance.now()): void {
    this.lastTime = realNow;
  }

  setExpression(index: number, frequency = 7): void {
    if (index === this.expressionIndex && this.expressionSpring.target === 1) return;
    const amount = clamp(this.expressionSpring.x, 0, 1);
    this.expressionFrom = [
      lerpRing(this.expressionFrom[0], this.expressionTo[0], amount),
      lerpRing(this.expressionFrom[1], this.expressionTo[1], amount),
    ];
    this.expressionTo = [EXPRESSIONS[index][0], EXPRESSIONS[index][1]];
    this.expressionIndex = index;
    this.expressionSpring.x = 0;
    this.expressionSpring.v = 0;
    this.expressionSpring.target = 1;
    this.expressionFrequency = frequency;
  }

  scheduleBlink(now: number): void {
    this.blinkTarget = this.eyeOpen.target;
    this.blinkQueue.push(
      { at: now, value: 0.05 },
      { at: now + 70, value: 0.05 },
      { at: now + 150, value: 1.08 },
      { at: now + 300, value: 1 },
    );
    if (Math.random() < 0.14) {
      this.blinkQueue.push({ at: now + 370, value: 0.05 }, { at: now + 480, value: 1 });
    }
  }

  playMorph(
    effect: MorphEffect,
    options: { hold?: number; restore?: MorphState | "default" | null } = {},
  ): Promise<{ cancelled?: boolean; effect?: MorphEffect; restored?: MorphState | "default" | null }> {
    if (!MORPH_BOT_EFFECTS.includes(effect)) {
      return Promise.reject(new RangeError(`Unknown morph effect: ${effect}`));
    }
    this.cancelPendingMorph();
    const token = ++this.morphMonitorToken;
    this.morphPreview = {
      effect,
      duration: clamp(Number(options.hold ?? 2500) || 2500, 100, 20000),
      phase: "reset",
      phaseStartedAt: this.clockTime,
    };
    this.oneShotResting = false;
    return new Promise((resolve) => {
      this.pendingMorph = { token, restore: options.restore ?? null, resolve };
    });
  }

  async playSequence(
    steps: readonly MorphSequenceStep[],
    options: { loop?: boolean } = {},
  ): Promise<MorphSequenceResult> {
    if (steps.length === 0) throw new TypeError("Morph sequence requires at least one step");
    const sequence = steps.map((step) => ({
      state: step.state,
      hold: Number(step.hold ?? 1000),
      morph: step.morph === undefined || step.morph === null || step.morph === "none" ? null : step.morph,
      morphHold: Number(step.morphHold ?? 1200),
    }));

    this.stopSequence();
    const token = ++this.sequenceToken;
    let cycle = 0;

    do {
      for (let index = 0; index < sequence.length; index += 1) {
        if (token !== this.sequenceToken) return { cancelled: true, cycle, index };
        const step = sequence[index];
        this.setState(step.state, true);
        if (!(await this.waitSequence(step.hold, token))) return { cancelled: true, cycle, index };
        if (step.morph) {
          const result = await this.playMorph(step.morph, { hold: step.morphHold, restore: "default" });
          if (result.cancelled || token !== this.sequenceToken) return { cancelled: true, cycle, index };
        }
      }
      cycle += 1;
      if (options.loop && !(await this.waitSequence(16, token))) return { cancelled: true, cycle };
    } while (options.loop && token === this.sequenceToken);

    if (token !== this.sequenceToken) return { cancelled: true, cycle };
    return { cancelled: false, cycles: cycle };
  }

  stopSequence(): void {
    this.sequenceToken += 1;
    if (this.pendingWait) {
      const wait = this.pendingWait;
      this.pendingWait = null;
      wait.resolve(false);
    }
    this.cancelPendingMorph();
    this.morphPreview = null;
  }

  private cancelPendingMorph(): void {
    this.morphMonitorToken += 1;
    if (this.pendingMorph) {
      const monitor = this.pendingMorph;
      this.pendingMorph = null;
      monitor.resolve({ cancelled: true });
    }
  }

  private waitSequence(durationMs: number, token: number): Promise<boolean> {
    if (durationMs <= 0) return Promise.resolve(token === this.sequenceToken);
    return new Promise((resolve) => {
      this.pendingWait = {
        remainingMs: durationMs,
        resolve: (ok) => resolve(ok && token === this.sequenceToken),
      };
    });
  }

  step(realNow: number): void {
    const realDelta = clamp((realNow - this.lastTime) / 1000, 0, 0.1);
    this.lastTime = realNow;
    let delta = this.paused ? 0 : realDelta * this.playbackRate;
    if (this.pendingStep > 0) {
      delta = this.pendingStep;
      this.pendingStep = 0;
    }
    this.clockTime += delta * 1000;
    this.delta = delta;
    const now = this.clockTime;

    const config = this.buildConfig();
    const geometry = resolveShape(this, config.shape);
    this.lastGeometry = geometry;

    updateMorph(this, now, config);
    updateStateTargets(this, now, config, delta);
    stepPhysics(this, delta);

    // 与渲染解耦的状态衍生更新（避免 Canvas 重绘幂等性问题）。
    const morphAmount = clamp(this.morph.x, 0, 1);
    this.currentBeltRadius =
      geometry.beltRadius + (this.state === "loading" ? (52 - geometry.beltRadius) * morphAmount : 0);

    if (this.spinSpring && Math.abs(this.spinSpring.target - this.spinSpring.x) < 0.004 && Math.abs(this.spinSpring.v) < 0.015) {
      this.spinSpring = null;
      this.shapeChangeWide = false;
    }
    if (this.spinSpring) this.particleSpinAngle = this.spinSpring.x;
    else if (Math.abs(this.directTurn) > 0.001) this.particleSpinAngle = this.directTurn;
    else if (this.state === "humming" || this.state === "loading") this.particleSpinAngle = this.spinAngle;

    const sizeScale = clamp((340 / Math.max(config.size, 16)) ** 0.7, 1, 2.6);
    this.particles.update(now, delta, {
      spinAngle: this.particleSpinAngle,
      sizeScale,
      wideStyle: this.state === "humming" || this.celebrateWildActive || this.shapeChangeWide,
      enabled: config.particlesEnabled,
    });

    // 更新指针目标并指数平滑。
    const bounds = this.getHostBounds();
    if (config.pointer && windowPointer.active && bounds && bounds.width > 0 && bounds.height > 0) {
      const flip = config.flipX ? -1 : 1;
      this.pointer.targetX =
        58 * clamp((windowPointer.x - (bounds.x + bounds.width / 2)) / bounds.width, -1, 1) * flip;
      this.pointer.targetY =
        40 * clamp((windowPointer.y - (bounds.y + bounds.height / 2)) / bounds.height, -1, 1);
    } else {
      this.pointer.targetX = 0;
      this.pointer.targetY = 0;
    }
    const smoothing = 1 - Math.exp(60 * Math.log(0.91) * (delta || 1 / 60) * 2);
    this.pointer.x += (this.pointer.targetX - this.pointer.x) * smoothing;
    this.pointer.y += (this.pointer.targetY - this.pointer.y) * smoothing;

    // 更新 receive 与 pencil 的有状态周期字段。
    if (this.morphEffect === "receive" && morphAmount > 0.004) {
      const cycle = Math.floor((now - this.stateStartedAt) / 1700);
      if (cycle !== this.receiveCycle) {
        this.receiveCycle = cycle;
        this.receiveAngle = random(-1.25 * Math.PI, 0.25 * Math.PI);
      }
    }
    if (this.morphEffect === "pencil" && morphAmount > 0.004) {
      const pose = pencilPose(this, now);
      if (morphAmount > 0.6 && !pose.lift) {
        const point: [number, number] = [HEAD_C + pose.x, HEAD_C + pose.y + pose.wiggle + 19];
        const last = this.writingTrail[this.writingTrail.length - 1];
        if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 2.4) {
          this.writingTrail.push(point);
          if (this.writingTrail.length > 64) this.writingTrail.shift();
        } else {
          last[0] = point[0];
          last[1] = point[1];
        }
      } else if (this.writingTrail.length) {
        this.writingTrail.splice(0, 2);
      }
    }

    // 推进序列等待计时器（暂停时不扣减）。
    if (!this.paused && this.pendingWait) {
      this.pendingWait.remainingMs -= delta * 1000;
      if (this.pendingWait.remainingMs <= 0) {
        const wait = this.pendingWait;
        this.pendingWait = null;
        wait.resolve(true);
      }
    }

    if (this.pendingMorph && this.morphPreview?.phase === "done") {
      const monitor = this.pendingMorph;
      const finishedEffect = this.morphPreview.effect;
      this.pendingMorph = null;
      if (monitor.restore === "default") this.morphPreview = null;
      else if (monitor.restore) this.setState(monitor.restore, true);
      monitor.resolve({ effect: finishedEffect, restored: monitor.restore });
    }
  }

  render(cx: CanvasRenderingContext2D, canvasSize: CanvasSize): void {
    const config = this.buildConfig();
    renderBotCanvas(cx, canvasSize, this, config, this.lastGeometry);
  }

  destroy(): void {
    this.stopSequence();
    this.particles.clear();
  }
}
