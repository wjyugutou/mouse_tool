/** 变形特效状态机与过渡调度。 */
import { MORPH_BOT_EFFECTS, type MorphEffect } from "./catalog";
import { clamp } from "./math";
import type { BotConfig, BotEngineContext } from "./types";

export function getMorphPhase(ctx: BotEngineContext): "RESET" | "ENTER" | "HOLD" | "EXIT" | "DONE" | "REST" | "IDLE" {
  if (ctx.morphPreview) {
    const phase = ctx.morphPreview.phase;
    if (phase === "reset") return "RESET";
    if (phase === "enter") return "ENTER";
    if (phase === "hold") return "HOLD";
    if (phase === "exit") return "EXIT";
    return "DONE";
  }
  if (ctx.oneShotResting) return "REST";
  if (ctx.morph.target > 0.5) return ctx.morph.x < 0.996 ? "ENTER" : "HOLD";
  if (ctx.morph.x > 0.004) return "EXIT";
  return "IDLE";
}

export function triggerMorphPreview(ctx: BotEngineContext, effect: MorphEffect, duration = 2500): boolean {
  if (!MORPH_BOT_EFFECTS.includes(effect)) return false;
  ctx.morphPreview = {
    effect,
    duration: clamp(Number(duration) || 2500, 100, 20000),
    phase: "reset",
    phaseStartedAt: ctx.clockTime,
  };
  ctx.oneShotResting = false;
  return true;
}

export function clearMorphPreview(ctx: BotEngineContext): void {
  ctx.morphPreview = null;
}

export function updateMorph(ctx: BotEngineContext, now: number, config: BotConfig): void {
  let requestedEffect: MorphEffect | null = config.morph === "none" ? null : config.morph;
  if (ctx.morphPreview) {
    const preview = ctx.morphPreview;
    if (preview.phase === "reset") {
      requestedEffect = null;
      if (ctx.morph.x < 0.004) {
        preview.phase = "enter";
        preview.phaseStartedAt = now;
        requestedEffect = preview.effect;
      }
    } else if (preview.phase === "enter") {
      requestedEffect = preview.effect;
      if (ctx.morph.x > 0.996) {
        preview.phase = "hold";
        preview.phaseStartedAt = now;
      }
    } else if (preview.phase === "hold") {
      requestedEffect = preview.effect;
      if (now - preview.phaseStartedAt >= preview.duration) {
        preview.phase = "exit";
        preview.phaseStartedAt = now;
        requestedEffect = null;
      }
    } else if (preview.phase === "exit") {
      requestedEffect = null;
      if (ctx.morph.x < 0.004) {
        preview.phase = "done";
        preview.phaseStartedAt = now;
      }
    } else {
      requestedEffect = null;
    }
  }

  if (requestedEffect !== ctx.requestedMorphEffect) {
    ctx.requestedMorphEffect = requestedEffect;
    ctx.morphShotStartedAt = now;
    ctx.oneShotResting = false;
  }

  let visible = Boolean(requestedEffect);
  if (!ctx.morphPreview && (ctx.state === "progress" || ctx.state === "spawning") && requestedEffect) {
    const shot = ctx.state === "progress" ? 2500 : 2000;
    if (!ctx.oneShotResting && now - ctx.morphShotStartedAt > shot) {
      ctx.oneShotResting = true;
      ctx.morphRestStartedAt = now;
    } else if (ctx.oneShotResting && now - ctx.morphRestStartedAt > 1500) {
      ctx.oneShotResting = false;
      ctx.morphShotStartedAt = now;
    }
    visible = !ctx.oneShotResting;
  }
  ctx.morph.target = visible ? 1 : 0;

  if (requestedEffect && requestedEffect !== ctx.morphEffect) {
    if (ctx.morphEffect && ctx.morph.x > 0.02) {
      ctx.previousMorphEffect = ctx.morphEffect;
      ctx.morphBlend.x = 0;
      ctx.morphBlend.v = 0;
      ctx.morphBlend.target = 1;
    } else {
      ctx.previousMorphEffect = null;
      ctx.morphBlend.x = 1;
      ctx.morphBlend.v = 0;
      ctx.morphBlend.target = 1;
    }
    ctx.morphEffect = requestedEffect;
    ctx.morphStartedAt = now;
  }

  // 在弹簧完全回到基础形态前保留离开中的几何特效，避免突然消失。
  if (!requestedEffect && ctx.morph.x < 0.004) {
    ctx.morphEffect = null;
    ctx.previousMorphEffect = null;
    ctx.morphBlend.x = 1;
    ctx.morphBlend.v = 0;
    ctx.morphBlend.target = 1;
  }
  if (ctx.previousMorphEffect && ctx.morphBlend.x > 0.996) {
    ctx.previousMorphEffect = null;
  }

  if (visible !== ctx.morphVisible) {
    if (visible && !ctx.reducedMotion) ctx.turnDirection = Math.random() < 0.5 ? 1 : -1;
    if (!ctx.reducedMotion) ctx.turn.target += Math.PI * ctx.turnDirection;
    ctx.morphVisible = visible;
  }
}
