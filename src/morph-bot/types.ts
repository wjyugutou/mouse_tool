/** MorphBot 引擎内部共享状态类型。 */
import type { MorphEffect, MorphShape, MorphState } from "./catalog";
import type { MutablePoint } from "./geometry";
import type { SpringValue } from "./math";
import type { FaceTransform, Ring, ShapeDefinition } from "./original-data";
import type { ParticleSystem } from "./particle-system";

export interface BotConfig {
  color: string;
  eyeColor: string;
  badgeColor: string;
  badgeScale: number;
  size: number;
  flipX: boolean;
  pointer: boolean;
  particlesEnabled: boolean;
  shape: MorphShape;
  expressionPool: readonly number[];
  expressionWeights: Readonly<Record<number, number>>;
  expressionCadence: readonly [number, number];
  blinkCadence: readonly [number, number] | null;
  morph: MorphEffect | "none";
  headX: number;
  headY: number;
  headRotation: number;
  scaleX: number;
  scaleY: number;
  eyeOpen: number;
  eyeScale: number;
  gazeScale: number;
  motionScale: number;
  tempo: number;
}

export interface GestureOutput {
  turn: number;
  rotation: number;
  x: number;
  y: number;
  bounceY: number;
  gazeX: number;
  gazeY: number;
  eyeOpen: number | null;
  eyeScale: number | null;
}

export interface ActiveGesture {
  kind: "spinBounce" | "spinDizzy";
  startedAt: number;
  direction: number;
  turns: number;
}

export interface MorphPreviewState {
  effect: MorphEffect;
  duration: number;
  phase: "reset" | "enter" | "hold" | "exit" | "done";
  phaseStartedAt: number;
}

export interface BlinkKeyframe {
  at: number;
  value: number;
}

export interface PointerSmoothState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
}

export interface HostBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResolvedShapeGeometry {
  shape: ShapeDefinition;
  transitioning: boolean;
  ring: Ring;
  face: FaceTransform;
  tiltScale: number;
  beltRadius: number;
}

export interface BotEngineContext {
  readonly particles: ParticleSystem;
  readonly reducedMotion: boolean;
  readonly pointerActive: boolean;
  state: MorphState;
  startedAt: number;
  stateStartedAt: number;
  lastTime: number;
  clockTime: number;
  delta: number;
  playbackRate: number;
  paused: boolean;
  pendingStep: number;
  expressionFrom: [Ring, Ring];
  expressionTo: [Ring, Ring];
  expressionIndex: number;
  expressionSpring: SpringValue;
  expressionFrequency: number;
  rotation: SpringValue;
  headX: SpringValue;
  headY: SpringValue;
  scaleY: SpringValue;
  eyeOpen: SpringValue;
  eyeScale: SpringValue;
  aimX: SpringValue;
  aimY: SpringValue;
  morph: SpringValue;
  morphBlend: SpringValue;
  shapeBlend: SpringValue;
  turn: SpringValue;
  notify: SpringValue;
  humming: SpringValue;
  stateVersion: number;
  requestedMorphEffect: MorphEffect | null;
  morphEffect: MorphEffect | null;
  previousMorphEffect: MorphEffect | null;
  morphVisible: boolean;
  morphStartedAt: number;
  morphShotStartedAt: number;
  morphRestStartedAt: number;
  oneShotResting: boolean;
  morphPreview: MorphPreviewState | null;
  turnDirection: number;
  spinAngle: number;
  expressionCursor: number;
  expressionNext: number;
  blinkNext: number;
  gazeNext: number;
  blinkQueue: BlinkKeyframe[];
  blinkTarget: number | null;
  wakeBurst: boolean;
  drowsyStartedAt: number;
  listenNodUntil: number;
  listenNodNext: number;
  impulseNext: number;
  impulseUntil: number;
  behaviorNext: number;
  winkAt: number;
  winkEye: number;
  winkNext: number;
  dragCycle: number;
  notifyTriggered: boolean;
  receiveCycle: number;
  receiveAngle: number;
  writingTrail: MutablePoint[];
  shapeId: MorphShape;
  shapeFromRing: Ring;
  shapeFromFace: FaceTransform;
  shapeFromTiltScale: number;
  shapeFromBeltRadius: number;
  shapeChangeCycle: number;
  shapeChangeWide: boolean;
  spinSpring: SpringValue | null;
  gesture: ActiveGesture | null;
  bounceStartedAt: number;
  ambientNext: number;
  celebrateCycle: number;
  celebrateWildActive: boolean;
  directTurn: number;
  directRotation: number;
  directX: number;
  directY: number;
  directGazeX: number;
  directGazeY: number;
  currentBeltRadius: number;
  particleSpinAngle: number;
  pointer: PointerSmoothState;
  setExpression(index: number, frequency?: number): void;
  scheduleBlink(now: number): void;
}
