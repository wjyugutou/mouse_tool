/** 弹簧物理系统步进。 */
import { FIXED_STEP, stepSpring } from "./math";
import type { BotEngineContext } from "./types";

export function stepPhysics(ctx: BotEngineContext, delta: number): void {
  const steps = Math.max(1, Math.ceil(delta / FIXED_STEP));
  const step = delta / steps;
  for (let index = 0; index < steps; index += 1) {
    stepSpring(ctx.expressionSpring, ctx.expressionFrequency, 1, step);
    stepSpring(ctx.rotation, 5, 0.9, step);
    stepSpring(ctx.headX, 3.5, 1, step);
    stepSpring(ctx.headY, 4, 1, step);
    stepSpring(ctx.scaleY, 10, 0.8, step);
    stepSpring(ctx.eyeOpen, 26, 1, step);
    stepSpring(ctx.eyeScale, 9, 0.85, step);
    stepSpring(ctx.aimX, 13, 1, step);
    stepSpring(ctx.aimY, 13, 1, step);
    stepSpring(ctx.morph, 14, 1, step);
    stepSpring(ctx.morphBlend, 11, 1, step);
    stepSpring(ctx.shapeBlend, 10, 1, step);
    stepSpring(ctx.turn, 14, 1, step);
    stepSpring(ctx.notify, 9, 0.55, step);
    stepSpring(ctx.humming, 6, 1, step);
    if (ctx.spinSpring) stepSpring(ctx.spinSpring, 6.2, 1, step);
  }
  if (ctx.reducedMotion) {
    ctx.expressionSpring.x = 1;
    ctx.morph.x = ctx.morph.target;
    ctx.morphBlend.x = ctx.morphBlend.target;
    ctx.shapeBlend.x = ctx.shapeBlend.target;
    ctx.turn.x = ctx.turn.target;
  }
}
