/** NSH Canvas 2D 渲染器：纯读引擎快照并在 Direct2D 画布上完成全量绘制。 */
import { Path2D, type CanvasRenderingContext2D, type CanvasSize } from "nsh";
import { MORPH_BOT_EFFECTS, type MorphEffect } from "./catalog";
import { centroid, lerpRing, PENCIL_RING, shapeSpanAt, spanAt, turnedShapeRing } from "./geometry";
import { backOut, clamp, cubicInOut, cubicOut, smoothstep } from "./math";
import { CIRCLE_RING, EYE_HALF, HEAD_C, type Point2D, type Ring, type ShapeDefinition } from "./original-data";
import type { OrbitParticle, TrailSample } from "./particle-system";
import type { BotConfig, BotEngineContext, ResolvedShapeGeometry } from "./types";

export const MORPH_SIZES: Readonly<Record<MorphEffect, number>> = {
  dots: 22,
  orbit: 19,
  radar: 19,
  progress: 19,
  gather: 19,
  wave: 16,
  send: 20,
  receive: 20,
  dock: 20,
  ball: 18,
  whirl: 15,
  pencil: 17,
  bang: 13,
  standby: 13,
};

const MORPH_VIEWBOX: Readonly<Record<MorphEffect, number>> = {
  dots: 1.5,
  orbit: 1.14,
  radar: 1.14,
  progress: 1.32,
  gather: 1.15,
  wave: 1.42,
  send: 1.12,
  receive: 1.12,
  dock: 1.3,
  ball: 1.22,
  whirl: 1.45,
  pencil: 1.18,
  bang: 1.28,
  standby: 1.75,
};

const STAR_POINTS: readonly Point2D[] = [
  [0.0, -1.0],
  [0.247, -0.34],
  [0.951, -0.309],
  [0.399, 0.13],
  [0.588, 0.809],
  [0.0, 0.42],
  [-0.588, 0.809],
  [-0.399, 0.13],
  [-0.951, -0.309],
  [-0.247, -0.34],
];

const cachedShapePaths = new Map<string, Path2D>();

function getShapePath2D(shapeId: string, svgPath: string): Path2D {
  let path = cachedShapePaths.get(shapeId);
  if (!path) {
    path = new Path2D(svgPath);
    cachedShapePaths.set(shapeId, path);
  }
  return path;
}

function hslToRgb(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = clamp(s / 100, 0, 1);
  const light = clamp(l / 100, 0, 1);
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t: number): number => {
    const wrapped = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
    if (wrapped < 1 / 2) return q;
    if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
    return p;
  };
  const r = Math.round(channel(hue + 1 / 3) * 255);
  const g = Math.round(channel(hue) * 255);
  const b = Math.round(channel(hue - 1 / 3) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function withAlpha(cx: CanvasRenderingContext2D, alpha: number, draw: () => void): void {
  const prev = typeof cx.globalAlpha === "number" ? cx.globalAlpha : 1;
  const next = prev * clamp(alpha, 0, 1);
  if (next <= 0.002) return;
  cx.globalAlpha = next;
  draw();
  cx.globalAlpha = prev;
}

function traceRingPath(cx: CanvasRenderingContext2D, ring: Ring): void {
  if (ring.length === 0) return;
  cx.beginPath();
  cx.moveTo(ring[0][0], ring[0][1]);
  for (let index = 1; index < ring.length; index += 1) {
    cx.lineTo(ring[index][0], ring[index][1]);
  }
  cx.closePath();
}

function traceRingOutline(cx: CanvasRenderingContext2D, ring: Ring): void {
  const length = ring.length;
  if (length === 0) return;
  cx.beginPath();
  cx.moveTo(ring[0][0], ring[0][1]);
  for (let index = 0; index < length; index += 1) {
    const previous = ring[(index - 1 + length) % length];
    const point = ring[index];
    const next = ring[(index + 1) % length];
    const after = ring[(index + 2) % length];
    cx.bezierCurveTo(
      point[0] + (next[0] - previous[0]) / 6,
      point[1] + (next[1] - previous[1]) / 6,
      next[0] - (after[0] - point[0]) / 6,
      next[1] - (after[1] - point[1]) / 6,
      next[0],
      next[1],
    );
  }
  cx.closePath();
}

function drawOrbitTrails(cx: CanvasRenderingContext2D, particles: readonly OrbitParticle[], frontLayer: boolean): void {
  for (const particle of particles) {
    const points: readonly TrailSample[] = particle.history;
    if (points.length < 2 || particle.opacity <= 0.002) continue;

    let totalLength = 0;
    for (let index = 1; index < points.length; index += 1) {
      totalLength += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    }
    if (totalLength < 2) continue;

    const actualWidth = Math.min(particle.width, 0.34 * totalLength);
    const normalX: number[] = [];
    const normalY: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const previous = points[index > 0 ? index - 1 : 0];
      const next = points[index < points.length - 1 ? index + 1 : points.length - 1];
      let dx = next.x - previous.x;
      let dy = next.y - previous.y;
      const magnitude = Math.hypot(dx, dy) || 1;
      dx /= magnitude;
      dy /= magnitude;
      const halfWidth = (actualWidth * (0.5 + (index / (points.length - 1)) * 0.5)) / 2;
      normalX.push(-dy * halfWidth);
      normalY.push(dx * halfWidth);
    }

    const first = points[0];
    const last = points[points.length - 1];
    const gradient = cx.createLinearGradient(first.x, first.y, last.x, last.y);
    const hue = particle.hue + particle.hueVelocity * particle.life;
    for (let index = 0; index < 5; index += 1) {
      const position = index / 4;
      gradient.addColorStop(position, hslToRgb(hue + position * particle.hueSpan, 56, 56 + 11 * position));
    }

    withAlpha(cx, particle.opacity, () => {
      cx.fillStyle = gradient;
      let cursor = 0;
      while (cursor < points.length) {
        const isFront = points[cursor].z >= 0;
        let end = cursor;
        while (end + 1 < points.length && (points[end + 1].z >= 0) === isFront) end += 1;
        const segmentStart = Math.max(cursor - 1, 0);
        const segmentEnd = Math.min(end + 1, points.length - 1);
        if (isFront === frontLayer && segmentEnd > segmentStart) {
          cx.beginPath();
          cx.moveTo(points[segmentStart].x + normalX[segmentStart], points[segmentStart].y + normalY[segmentStart]);
          for (let i = segmentStart + 1; i <= segmentEnd; i += 1) {
            cx.lineTo(points[i].x + normalX[i], points[i].y + normalY[i]);
          }
          if (segmentEnd === points.length - 1) {
            const r = Math.max(Math.hypot(normalX[segmentEnd], normalY[segmentEnd]), 0.2);
            const a1 = Math.atan2(normalY[segmentEnd], normalX[segmentEnd]);
            const a2 = Math.atan2(-normalY[segmentEnd], -normalX[segmentEnd]);
            cx.arc(points[segmentEnd].x, points[segmentEnd].y, r, a1, a2, true);
          } else {
            cx.lineTo(points[segmentEnd].x - normalX[segmentEnd], points[segmentEnd].y - normalY[segmentEnd]);
          }
          for (let i = segmentEnd - 1; i >= segmentStart; i -= 1) {
            cx.lineTo(points[i].x - normalX[i], points[i].y - normalY[i]);
          }
          if (segmentStart === 0) {
            const r = Math.max(Math.hypot(normalX[0], normalY[0]), 0.2);
            const a1 = Math.atan2(-normalY[0], -normalX[0]);
            const a2 = Math.atan2(normalY[0], normalX[0]);
            cx.arc(points[0].x, points[0].y, r, a1, a2, true);
          }
          cx.closePath();
          cx.fill();
        }
        cursor = end + 1;
      }
    });
  }
}

function drawBurstParticles(cx: CanvasRenderingContext2D, ctx: BotEngineContext): void {
  for (const particle of ctx.particles.burstParticles) {
    if (particle.opacity <= 0.002) continue;
    withAlpha(cx, particle.opacity, () => {
      cx.fillStyle = particle.color;
      if (particle.isStar) {
        cx.save();
        cx.translate(particle.x, particle.y);
        cx.rotate((particle.rotation * Math.PI) / 180);
        cx.scale(particle.size, particle.size);
        cx.beginPath();
        cx.moveTo(STAR_POINTS[0][0], STAR_POINTS[0][1]);
        for (let i = 1; i < STAR_POINTS.length; i += 1) {
          cx.lineTo(STAR_POINTS[i][0], STAR_POINTS[i][1]);
        }
        cx.closePath();
        cx.fill();
        cx.restore();
      } else if (particle.round) {
        cx.beginPath();
        cx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        cx.fill();
      } else {
        const width = Math.max(2 * particle.size, Math.min(0.05 * Math.hypot(particle.vx, particle.vy), 30));
        const height = 1.5 * particle.size;
        cx.save();
        cx.translate(particle.x, particle.y);
        cx.rotate(Math.atan2(particle.vy, particle.vx));
        cx.beginPath();
        cx.roundRect(-width / 2, -height / 2, width, height, height / 2);
        cx.fill();
        cx.restore();
      }
    });
  }
}

export function pencilPose(ctx: BotEngineContext, now: number): {
  x: number;
  y: number;
  wiggle: number;
  rotation: number;
  lift: boolean;
} {
  const elapsed = now - ctx.stateStartedAt;
  const cycle = (((elapsed / 2500) % 1) + 1) % 1;
  if (cycle < 0.68) {
    const phase = cycle / 0.68;
    const envelope = clamp(phase / 0.08, 0, 1) * clamp((1 - phase) / 0.08, 0, 1);
    return {
      x: -54 + smoothstep(phase) * 118,
      y: 26,
      wiggle: 3.2 * Math.sin(24 * phase) * envelope,
      rotation: 17 + Math.sin(0.0006 * elapsed),
      lift: false,
    };
  }
  const phase = cubicInOut((cycle - 0.68) / 0.32);
  return {
    x: 64 - 118 * phase,
    y: 26 - 20 * Math.sin(phase * Math.PI),
    wiggle: 0,
    rotation: 17 - 2 * Math.sin(phase * Math.PI) + Math.sin(0.0006 * elapsed),
    lift: true,
  };
}

function drawMorphEffect(
  cx: CanvasRenderingContext2D,
  ctx: BotEngineContext,
  effect: MorphEffect,
  amount: number,
  morphAmount: number,
  morphSize: number,
  now: number,
  fg: string,
  pose: { x: number; y: number; rotation: number; scale: number; opacity: number },
): void {
  const elapsed = now - ctx.stateStartedAt;

  switch (effect) {
    case "dots": {
      const anchors = [HEAD_C - 62, HEAD_C + 62];
      for (let index = 0; index < 2; index += 1) {
        const phase = clamp((amount - 0.12 * index) / (1 - 0.12 * index), 0, 1);
        if (phase <= 0.004) continue;
        const grow = cubicOut(phase);
        const enter = backOut(phase);
        const pulseDistance = Math.abs(
          ((((now - ctx.morphStartedAt) / 1400 + 0.119) % 1 + 1) % 1) - (index * 2) / 3,
        );
        const distance = Math.min(pulseDistance, 1 - pulseDistance);
        const pulse = ctx.reducedMotion ? 1 : Math.exp(-(distance ** 2) / 0.045);
        const lift = ctx.reducedMotion ? 0 : 9 * pulse * amount;
        const pop = ctx.reducedMotion ? 1 : 0.84 + 0.22 * pulse;
        const radius = 22 * grow * pop * 1.02;
        withAlpha(cx, grow * (1 - 0.5 * (1 - pulse)), () => {
          cx.fillStyle = fg;
          cx.beginPath();
          cx.arc(HEAD_C + (anchors[index] - HEAD_C) * enter, HEAD_C - lift, radius, 0, Math.PI * 2);
          cx.fill();
        });
      }
      const distance = Math.abs(((((now - ctx.morphStartedAt) / 1400 + 0.119) % 1 + 1) % 1) - 1 / 3);
      const pulseDistance = Math.min(distance, 1 - distance);
      const pulse = ctx.reducedMotion ? 1 : Math.exp(-(pulseDistance ** 2) / 0.045);
      const pop = ctx.reducedMotion ? 1 : 0.84 + 0.22 * pulse;
      pose.scale *= 1 + (pop - 1) * (amount / Math.max(morphAmount, 0.001));
      pose.y -= ctx.reducedMotion ? 0 : 9 * pulse * amount * morphAmount;
      pose.opacity *= 1 - (ctx.reducedMotion ? 0 : 0.5 * (1 - pulse)) * amount;
      break;
    }

    case "orbit": {
      const radius = 52 * backOut(amount);
      for (let index = 0; index < 5; index += 1) {
        const phase = 0.0017 * now + (index * Math.PI * 2) / 5;
        const cosine = Math.cos(phase);
        const depth = 0.5 + 0.5 * clamp(cosine, 0, 1);
        const r = Math.max(12 * depth * cubicOut(amount), 0.3);
        const alpha = clamp((cosine + 0.4) / 0.6, 0.18, 1) * cubicOut(amount);
        withAlpha(cx, alpha, () => {
          cx.fillStyle = fg;
          cx.beginPath();
          cx.arc(
            HEAD_C + radius * Math.sin(phase),
            HEAD_C - 0.42 * radius * Math.cos(phase),
            r,
            0,
            Math.PI * 2,
          );
          cx.fill();
        });
      }
      break;
    }

    case "radar": {
      for (let index = 0; index < 3; index += 1) {
        const phase = (((now / 1300 + index / 3) % 1) + 1) % 1;
        const r = morphSize + (104 - morphSize) * phase;
        const alpha = cubicOut(amount) * (1 - phase) * 0.9;
        withAlpha(cx, alpha, () => {
          cx.strokeStyle = fg;
          cx.lineWidth = 3.4 * (1 - 0.55 * phase);
          cx.setLineDash([]);
          cx.beginPath();
          cx.arc(HEAD_C, HEAD_C, r, 0, Math.PI * 2);
          cx.stroke();
        });
      }
      break;
    }

    case "progress": {
      const radius = 62 * backOut(amount);
      const out = cubicOut(amount);
      cx.lineWidth = 5;
      cx.lineCap = "butt";
      cx.setLineDash([]);
      withAlpha(cx, 0.16 * out, () => {
        cx.strokeStyle = fg;
        cx.beginPath();
        cx.arc(HEAD_C, HEAD_C, radius, 0, Math.PI * 2);
        cx.stroke();
      });
      const progress = clamp((now - ctx.morphShotStartedAt) / 2500 / 0.85, 0, 1);
      if (progress > 0) {
        withAlpha(cx, out, () => {
          cx.strokeStyle = fg;
          cx.beginPath();
          cx.arc(HEAD_C, HEAD_C, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
          cx.stroke();
        });
      }
      break;
    }

    case "gather": {
      for (let index = 0; index < 5; index += 1) {
        const phase = clamp(((now - ctx.morphShotStartedAt) / 2000 - 0.09 * index) / 0.62, 0, 1);
        if (phase >= 1) continue;
        const settle = 1 - (1 - phase) ** 3;
        const angle = 2.4 * index + 2.2 * phase;
        const radius = 96 * (1 - settle);
        const r = 9 * (0.5 + 0.5 * settle) * cubicOut(amount);
        const alpha = cubicOut(amount) * clamp(5 * phase, 0, 1) * (1 - 0.25 * settle);
        withAlpha(cx, alpha, () => {
          cx.fillStyle = fg;
          cx.beginPath();
          cx.arc(HEAD_C + radius * Math.cos(angle), HEAD_C + radius * Math.sin(angle) * 0.8, r, 0, Math.PI * 2);
          cx.fill();
        });
      }
      break;
    }

    case "wave": {
      const offsets = [-2, -1, 1, 2];
      for (let index = 0; index < 4; index += 1) {
        const offset = offsets[index];
        const phase = clamp((amount - 0.1 * Math.abs(offset)) / (1 - 0.1 * Math.abs(offset)), 0, 1);
        if (phase <= 0.004) continue;
        const energy =
          (0.42 +
            0.29 * Math.sin(0.0021 * now) * Math.sin(0.0034 * now) +
            0.29 * Math.sin(0.0013 * now + 1.7)) *
          (0.55 + 0.45 * Math.sin(0.012 * now - 1.05 * Math.abs(offset)));
        const size = (7 + 9 * clamp(energy, 0.08, 1)) * cubicOut(phase);
        const lift = 6 * clamp(energy, 0, 1) * phase;
        const r = index < 2 ? size * 1.02 : size;
        withAlpha(cx, phase, () => {
          cx.fillStyle = fg;
          cx.beginPath();
          cx.arc(HEAD_C + 44 * offset * backOut(phase), HEAD_C - lift, r, 0, Math.PI * 2);
          cx.fill();
        });
      }
      break;
    }

    case "send": {
      const phase = (((elapsed / 1500) % 1) + 1) % 1;
      const travel = clamp((phase - 0.18) / 0.55, 0, 1);
      const eased = travel ** 2 * (0.4 + 0.6 * travel);
      const distance = 108 * eased;
      if (travel > 0 && travel < 1) {
        withAlpha(cx, cubicOut(amount) * (1 - eased ** 2), () => {
          cx.fillStyle = fg;
          cx.beginPath();
          cx.arc(
            HEAD_C + 0.74 * distance,
            HEAD_C - 0.62 * distance,
            10 * (1 - 0.55 * eased) * cubicOut(amount),
            0,
            Math.PI * 2,
          );
          cx.fill();
        });
      }
      const secondTravel = clamp((phase - 0.26) / 0.55, 0, 1);
      const secondEase = secondTravel ** 2 * (0.4 + 0.6 * secondTravel);
      if (travel > 0 && secondTravel > 0 && secondTravel < 1) {
        const secondDistance = 108 * secondEase;
        withAlpha(cx, 0.3 * cubicOut(amount) * (1 - secondEase), () => {
          cx.fillStyle = fg;
          cx.beginPath();
          cx.arc(
            HEAD_C + 0.74 * secondDistance,
            HEAD_C - 0.62 * secondDistance,
            5 * (1 - 0.6 * secondEase) * cubicOut(amount),
            0,
            Math.PI * 2,
          );
          cx.fill();
        });
      }
      const ringPhase = clamp((phase - 0.18) / 0.3, 0, 1);
      if (ringPhase > 0 && ringPhase < 1) {
        withAlpha(cx, cubicOut(amount) * (1 - ringPhase) * 0.8, () => {
          cx.strokeStyle = fg;
          cx.lineWidth = 2.8 * (1 - ringPhase);
          cx.setLineDash([]);
          cx.beginPath();
          cx.arc(HEAD_C, HEAD_C, 20 + 34 * cubicOut(ringPhase), 0, Math.PI * 2);
          cx.stroke();
        });
      }
      pose.scale *=
        1 +
        (phase < 0.18
          ? -0.06 * Math.sin((phase / 0.18) * Math.PI)
          : phase < 0.42
            ? 0.05 * Math.sin(((phase - 0.18) / 0.24) * Math.PI)
            : 0) *
          amount;
      break;
    }

    case "receive": {
      const phase = (((elapsed / 1700) % 1) + 1) % 1;
      const travel = clamp(phase / 0.6, 0, 1);
      const eased = 1 - (1 - travel) ** 3;
      const radius = 108 * (1 - eased);
      const orbit = 18 * Math.sin(travel * Math.PI) * (1 - 0.7 * eased);
      const cosine = Math.cos(ctx.receiveAngle || 0);
      const sine = Math.sin(ctx.receiveAngle || 0);
      if (travel < 1) {
        withAlpha(cx, cubicOut(amount) * clamp(3.5 * travel, 0, 1) * (0.3 + 0.7 * eased), () => {
          cx.fillStyle = fg;
          cx.beginPath();
          cx.arc(
            HEAD_C + cosine * radius - sine * orbit,
            HEAD_C + sine * radius + cosine * orbit,
            3.5 + 6.5 * eased,
            0,
            Math.PI * 2,
          );
          cx.fill();
        });
      }
      const ringPhase = clamp((phase - 0.58) / 0.32, 0, 1);
      if (ringPhase > 0 && ringPhase < 1) {
        withAlpha(cx, cubicOut(amount) * (1 - ringPhase) * 0.8, () => {
          cx.strokeStyle = fg;
          cx.lineWidth = 2.8 * (1 - ringPhase);
          cx.setLineDash([]);
          cx.beginPath();
          cx.arc(HEAD_C, HEAD_C, 20 + 26 * cubicOut(ringPhase), 0, Math.PI * 2);
          cx.stroke();
        });
      }
      const scalePhase = clamp((phase - 0.58) / 0.34, 0, 1);
      pose.scale *= 1 + 0.11 * Math.sin(scalePhase * Math.PI) * amount;
      break;
    }

    case "dock": {
      const seconds = elapsed / 1000;
      for (let index = 0; index < 2; index += 1) {
        const phase = clamp((seconds - (0.2 + 1.3 * index)) / 0.9, 0, 1);
        if (phase <= 0) continue;
        const eased = 1 - (1 - phase) ** 3;
        const angle = 0.0011 * now + index * Math.PI;
        const targetX = HEAD_C + 42 * Math.sin(angle);
        const targetY = HEAD_C + 21 * Math.cos(angle) + 2 * Math.sin(0.003 * now + index);
        const startX = HEAD_C - 120 + 30 * index;
        const startY = HEAD_C + 95;
        withAlpha(cx, cubicOut(amount) * clamp(4 * phase, 0, 1), () => {
          cx.fillStyle = fg;
          cx.beginPath();
          cx.arc(
            startX + (targetX - startX) * eased,
            startY + (targetY - startY) * eased,
            (7 + 3 * eased) * cubicOut(amount),
            0,
            Math.PI * 2,
          );
          cx.fill();
        });
      }
      break;
    }

    case "pencil": {
      const p = pencilPose(ctx, now);
      const angle = ((p.rotation - 90) * Math.PI) / 180;
      const offsetX = 68 * Math.cos(angle);
      const offsetY = 68 * Math.sin(angle);

      withAlpha(cx, clamp(1.6 * amount - 0.3, 0, 1), () => {
        cx.save();
        cx.translate(HEAD_C + (p.x + offsetX) * amount, HEAD_C + (p.y + 0.15 * p.wiggle + offsetY) * amount);
        cx.rotate(((p.rotation * amount) * Math.PI) / 180);
        const s = cubicOut(amount);
        cx.scale(s, s);
        cx.translate(-HEAD_C, -HEAD_C);
        cx.fillStyle = fg;
        cx.beginPath();
        cx.roundRect(HEAD_C - 15, HEAD_C - 44, 30, 88, 15);
        cx.fill();
        cx.restore();
      });

      if (ctx.writingTrail.length >= 2) {
        const points = ctx.writingTrail;
        withAlpha(cx, clamp(1.2 * amount, 0, 1), () => {
          cx.strokeStyle = fg;
          cx.lineWidth = 6;
          cx.lineCap = "round";
          cx.lineJoin = "round";
          cx.setLineDash([]);
          cx.beginPath();
          cx.moveTo(points[0][0], points[0][1]);
          if (points.length === 2) {
            cx.lineTo(points[1][0], points[1][1]);
          } else {
            for (let index = 0; index < points.length - 1; index += 1) {
              const previous = points[Math.max(index - 1, 0)];
              const point = points[index];
              const next = points[index + 1];
              const after = points[Math.min(index + 2, points.length - 1)];
              cx.bezierCurveTo(
                point[0] + (next[0] - previous[0]) / 6,
                point[1] + (next[1] - previous[1]) / 6,
                next[0] - (after[0] - point[0]) / 6,
                next[1] - (after[1] - point[1]) / 6,
                next[0],
                next[1],
              );
            }
          }
          cx.stroke();
        });
      }

      pose.x += p.x * amount * morphAmount;
      pose.y += (p.y + 0.5 * p.wiggle) * amount * morphAmount;
      pose.rotation += p.rotation * amount * morphAmount;
      break;
    }

    case "bang": {
      const seconds = elapsed / 1000;
      const enter = cubicOut(clamp(1.1 * amount, 0, 1));
      const shake = 2.2 * Math.sin(42 * seconds) * Math.exp(-((seconds % 2.2) * 5.5));
      withAlpha(cx, clamp(1.5 * amount - 0.2, 0, 1), () => {
        cx.save();
        cx.translate(0, -26 - (1 - enter) * 70);
        cx.translate(HEAD_C, HEAD_C - 74);
        cx.rotate((shake * Math.PI) / 180);
        cx.translate(-HEAD_C, -(HEAD_C - 74));
        cx.translate(HEAD_C, HEAD_C);
        const s = clamp(1.2 * amount, 0, 1);
        cx.scale(s, s);
        cx.translate(-HEAD_C, -HEAD_C);
        cx.fillStyle = fg;
        cx.beginPath();
        cx.arc(HEAD_C, HEAD_C - 33, 15, Math.PI, 0, false);
        cx.lineTo(HEAD_C + 8.5, HEAD_C + 39.5);
        cx.arc(HEAD_C, HEAD_C + 39.5, 8.5, 0, Math.PI, false);
        cx.closePath();
        cx.fill();
        cx.restore();
      });
      pose.y += 58 * amount * morphAmount;
      pose.scale *= 1 + 0.04 * Math.exp(-(((seconds % 2.2) * 5.5))) * amount;
      break;
    }

    case "standby": {
      const pulse = 0.5 + 0.5 * Math.sin(0.0016 * now);
      withAlpha(cx, cubicOut(amount) * (0.06 + 0.1 * pulse), () => {
        cx.fillStyle = fg;
        cx.beginPath();
        cx.arc(HEAD_C, HEAD_C, 26 + 7 * pulse, 0, Math.PI * 2);
        cx.fill();
      });
      if (amount < 0.995) {
        withAlpha(cx, (1 - cubicOut(amount)) * 0.5, () => {
          cx.strokeStyle = fg;
          cx.lineWidth = 2.4;
          cx.setLineDash([]);
          cx.beginPath();
          cx.arc(HEAD_C, HEAD_C, 104 - 88 * cubicOut(amount), 0, Math.PI * 2);
          cx.stroke();
        });
      }
      pose.opacity *= 1 - (0.28 + 0.2 * Math.sin(0.0016 * now)) * amount;
      break;
    }

    case "whirl":
      pose.x += (2 * Math.sin(0.0009 * now) + 0.8 * Math.sin(0.0017 * now)) * amount * morphAmount;
      pose.y += (2.4 * Math.sin(0.0013 * now) + 1.2 * Math.sin(0.0006 * now)) * amount * morphAmount;
      break;

    case "ball": {
      const seconds = elapsed / 1000;
      const gravity = 416 / 0.3844;
      const fall = Math.sqrt(80 / gravity);
      const cycle = ((((seconds - fall) / 0.62) % 1) + 1) % 1;
      const height =
        seconds < fall ? 40 - 0.5 * gravity * seconds ** 2 : 208 * cycle * (1 - cycle);
      pose.y += (40 - height) * amount * morphAmount;
      break;
    }
  }
}

function drawEyes(
  cx: CanvasRenderingContext2D,
  ctx: BotEngineContext,
  config: BotConfig,
  shape: Omit<ShapeDefinition, "spanSamples"> & {
    face: ResolvedShapeGeometry["face"];
    tiltScale: number;
    beltRadius: number;
    spanSamples: readonly Point2D[] | null;
  },
  shapeRing: Ring,
  turnAngle: number,
  morphAmount: number,
  now: number,
): void {
  if (morphAmount >= 0.5) return;

  const amount = clamp(ctx.expressionSpring.x, 0, 1);
  const eyeRings = [
    lerpRing(ctx.expressionFrom[0], ctx.expressionTo[0], amount),
    lerpRing(ctx.expressionFrom[1], ctx.expressionTo[1], amount),
  ];
  const centers = [centroid(eyeRings[0]), centroid(eyeRings[1])];
  const face = shape.face;

  let top = shape.top;
  let bottom = shape.bottom;
  if (Math.abs(turnAngle) > 0.001) {
    top = Math.min(...shapeRing.map((point) => point[1]));
    bottom = Math.max(...shapeRing.map((point) => point[1]));
  }

  let leftHalf = 0;
  let rightHalf = 0;
  for (const point of eyeRings[0]) leftHalf = Math.max(leftHalf, Math.abs(point[0] - centers[0][0]));
  for (const point of eyeRings[1]) rightHalf = Math.max(rightHalf, Math.abs(point[0] - centers[1][0]));
  const distance = Math.abs(centers[1][0] - centers[0][0]) * face.sx;
  const fit = leftHalf + rightHalf > 0.5 ? clamp((distance - 5) / (leftHalf + rightHalf), 0.35, 4) : 4;

  cx.fillStyle = config.eyeColor;

  for (let index = 0; index < 2; index += 1) {
    const ring = eyeRings[index];
    const [centerX, centerY] = centers[index];
    let localCenter = HEAD_C + face.x;
    let offsetX = (centerX - HEAD_C) * face.sx;
    let perspectiveX = 1;
    let visible = true;
    let perspectiveFade = 1;

    if (Math.abs(turnAngle) > 0.001) {
      const [left, right] = spanAt(
        shapeRing,
        clamp(HEAD_C + face.y + (centerY - HEAD_C) * face.sy, top + 2, bottom - 2),
      );
      const radius = Math.max((right - left) / 2, 12);
      localCenter = (left + right) / 2;
      const initial = Math.asin(clamp(offsetX / radius, -1, 1));
      const turned = initial + turnAngle;
      const cosine = Math.cos(turned);
      const baseCosine = Math.max(Math.cos(initial), 0.02);
      visible = cosine > 0.02;
      perspectiveX = Math.max(cosine, 0.02) / baseCosine;
      offsetX = radius * Math.sin(turned);
      perspectiveFade = smoothstep(clamp(cosine / 0.5, 0, 1));
    }

    if (!visible) continue;

    const pulse = 1 + 0.07 * Math.sin(amount * Math.PI);
    let driftX = 1.4 * Math.sin(0.00042 * now + index) + 0.5 * Math.sin(0.001 * now + 2 * index);
    let driftY = 0.9 * Math.sin(0.00058 * now + index);
    const autonomousGazeWeight = config.pointer && ctx.pointerActive ? 0.2 : 1;
    driftX += ctx.pointer.x + ctx.aimX.x * autonomousGazeWeight + ctx.directGazeX;
    driftY += ctx.pointer.y + ctx.aimY.x * autonomousGazeWeight + ctx.directGazeY;

    const notification = clamp(ctx.notify.x, 0, 1);
    driftX -= 10 * notification;
    driftY += 7 * notification;

    const eyeScale = Math.min(clamp(ctx.eyeScale.x, 0.2, 2) * face.eye, fit / pulse);
    const scaleX = clamp(perspectiveX * eyeScale * pulse, 0.02, 2.4);

    let winkScale = 1;
    if (index === ctx.winkEye && now < ctx.winkAt + 320) {
      const phase = (now - ctx.winkAt) / 320;
      winkScale = Math.max(phase < 0.42 ? 1 - phase / 0.42 : (phase - 0.42) / 0.58, 0.04);
    }
    const scaleY = clamp(Math.max(ctx.eyeOpen.x * winkScale, 0.04) * eyeScale * pulse, 0.02, 2.4);

    const halfHeight = EYE_HALF * scaleY + 2;
    const y = clamp(HEAD_C + face.y + (centerY + driftY - HEAD_C) * face.sy, top + halfHeight, bottom - halfHeight);
    let maxLeft = -Infinity;
    let minRight = Infinity;
    for (let point = 0; point < ring.length; point += 2) {
      const scaledX = (ring[point][0] - centerX) * scaleX;
      const sampleY = y + (ring[point][1] - centerY) * scaleY;
      const [left, right] = Math.abs(turnAngle) > 0.001 ? spanAt(shapeRing, sampleY) : shapeSpanAt(shape, sampleY);
      maxLeft = Math.max(maxLeft, left - scaledX);
      minRight = Math.min(minRight, right - scaledX);
    }

    const desired = localCenter + offsetX + driftX * face.sx;
    const bounded = maxLeft <= minRight ? clamp(desired, maxLeft, minRight) : (maxLeft + minRight) / 2;
    let finalX = bounded + (desired - bounded) * (1 - perspectiveFade);
    let finalY = y;

    if (notification > 0.01) {
      const badgeAnchor = shapeRing[Math.round((7 * shapeRing.length) / 8) % shapeRing.length];
      const dx = finalX - badgeAnchor[0];
      const dy = finalY - badgeAnchor[1];
      const dist = Math.hypot(dx, dy) || 1;
      const dirX = dx / dist;
      const dirY = dy / dist;
      const eyeHalf = index === 0 ? leftHalf : rightHalf;
      const needed =
        20 * clamp(ctx.notify.x, 0, 1.4) +
        Math.hypot(eyeHalf * scaleX * dirX, EYE_HALF * scaleY * dirY) +
        5;
      if (dist < needed) {
        finalX += dirX * (needed - dist);
        finalY += dirY * (needed - dist);
      }
    }

    cx.save();
    cx.translate(finalX, finalY);
    cx.scale(scaleX, scaleY);
    cx.translate(-centerX, -centerY);
    traceRingPath(cx, ring);
    cx.fill();
    cx.restore();
  }
}

export function renderBotCanvas(
  cx: CanvasRenderingContext2D,
  canvasSize: CanvasSize,
  ctx: BotEngineContext & { readonly pointerActive: boolean },
  config: BotConfig,
  geometry: ResolvedShapeGeometry,
): void {
  const now = ctx.clockTime;
  const shape = geometry.shape;
  const effectiveShape = {
    ...shape,
    face: geometry.face,
    tiltScale: geometry.tiltScale,
    beltRadius: geometry.beltRadius,
    top: geometry.transitioning ? Math.min(...geometry.ring.map((point) => point[1])) : shape.top,
    bottom: geometry.transitioning ? Math.max(...geometry.ring.map((point) => point[1])) : shape.bottom,
    spanSamples: geometry.transitioning ? null : shape.spanSamples,
  };

  const morphAmount = clamp(ctx.morph.x, 0, 1);
  const morphBlend = clamp(ctx.morphBlend.x, 0, 1);
  const previousMorphEffect = morphBlend < 0.999 ? ctx.previousMorphEffect : null;
  const morphIsTurning = ctx.morph.x > 0.001 || Math.abs(ctx.turn.target - ctx.turn.x) > 0.01;
  const morphTurn = morphIsTurning ? ctx.turn.x : 0;
  const turnAngle = morphTurn + (ctx.spinSpring?.x ?? 0) + ctx.directTurn;
  const baseShapeRing = geometry.ring;
  const shapeRing =
    Math.abs(turnAngle) > 0.001 && !geometry.transitioning ? turnedShapeRing(shape, turnAngle) : baseShapeRing;

  const activeMorphRing = ctx.morphEffect === "pencil" ? PENCIL_RING : CIRCLE_RING;
  const previousMorphRing = previousMorphEffect === "pencil" ? PENCIL_RING : CIRCLE_RING;
  const morphRing = previousMorphEffect
    ? lerpRing(previousMorphRing, activeMorphRing, cubicInOut(morphBlend))
    : activeMorphRing;

  const morphPathAmount = clamp(morphAmount / 0.62, 0, 1);
  const headRing = morphPathAmount <= 0 ? shapeRing : lerpRing(shapeRing, morphRing, cubicInOut(morphPathAmount));
  const useStaticShapePath =
    morphPathAmount <= 0 &&
    !geometry.transitioning &&
    !(Math.abs(turnAngle) > 0.001 && Boolean(shape.solid || shape.sides));

  const effect = ctx.morphEffect;
  const activeMorphSize = effect ? MORPH_SIZES[effect] : 19;
  const previousMorphSize = previousMorphEffect ? MORPH_SIZES[previousMorphEffect] : activeMorphSize;
  const morphSize = activeMorphSize * morphBlend + previousMorphSize * (1 - morphBlend);
  const morphScale = morphSize / HEAD_C;

  // 计算响应式 viewBox 缩放，使小尺寸下变形特效不至过小。
  const botWidth = Math.min(config.size, canvasSize.width, canvasSize.height);
  const responsive = 1 - smoothstep(clamp((botWidth - 44) / 90, 0, 1));
  const activeExpansion = effect ? MORPH_VIEWBOX[effect] : 1;
  const previousExpansion = previousMorphEffect ? MORPH_VIEWBOX[previousMorphEffect] : activeExpansion;
  const expansion = activeExpansion * morphBlend + previousExpansion * (1 - morphBlend);
  const viewRadius = 129.5 / (1 + (expansion - 1) * morphAmount * responsive);
  const worldScale = botWidth / (2 * viewRadius);

  cx.save();
  cx.translate(canvasSize.width / 2, canvasSize.height / 2);
  if (config.flipX) cx.scale(-1, 1);
  cx.scale(worldScale, worldScale);
  cx.translate(-114.5, -114.5);

  // 1. 背景层粒子与背面轨道丝带。
  if (config.particlesEnabled) {
    drawBurstParticles(cx, ctx);
    drawOrbitTrails(cx, ctx.particles.orbitParticles, false);
  }

  // 2. 变形特效层与 humming 轨道点（位于主头部下方）。
  const effectPose = { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 };
  if (ctx.morphEffect && morphAmount > 0.004) {
    for (const candidate of MORPH_BOT_EFFECTS) {
      const amount =
        candidate === ctx.morphEffect
          ? morphAmount * morphBlend
          : candidate === previousMorphEffect
            ? morphAmount * (1 - morphBlend)
            : 0;
      if (amount <= 0.004) continue;
      drawMorphEffect(cx, ctx, candidate, amount, morphAmount, morphSize, now, config.color, effectPose);
    }
  }

  const hummingAmount = clamp(ctx.humming.x, 0, 1);
  if (hummingAmount > 0.01) {
    for (let index = 0; index < 2; index += 1) {
      const angle = 0.85 * ctx.spinAngle + index * Math.PI;
      const radius = 1.3 * effectiveShape.radius;
      const depth = 0.55 + 0.45 * clamp((Math.cos(angle) + 1) / 2, 0, 1);
      withAlpha(cx, (0.3 + 0.7 * depth) * hummingAmount, () => {
        cx.fillStyle = config.color;
        cx.beginPath();
        cx.arc(
          HEAD_C + radius * Math.sin(angle),
          HEAD_C - 0.38 * radius * Math.cos(angle) - 8,
          7.5 * depth * hummingAmount,
          0,
          Math.PI * 2,
        );
        cx.fill();
      });
    }
  }

  // 3. 主体变换组：头部轮廓 + 裁剪内双眼 + 通知角标。
  const normal = 1 - morphAmount;
  const translateX = ctx.headX.x * normal + ctx.directX * normal + effectPose.x;
  const translateY = ctx.headY.x * normal + ctx.directY * normal + effectPose.y;
  const rotation =
    ((ctx.rotation.x * 180) / Math.PI) * geometry.tiltScale * normal +
    ctx.directRotation * normal +
    effectPose.rotation;
  const scaleX = config.scaleX * normal + morphScale * effectPose.scale * morphAmount;
  const scaleY = ctx.scaleY.x * normal + morphScale * effectPose.scale * morphAmount;

  withAlpha(cx, effectPose.opacity, () => {
    cx.save();
    cx.translate(HEAD_C + translateX, HEAD_C + translateY);
    cx.rotate((rotation * Math.PI) / 180);
    cx.scale(scaleX, scaleY);
    cx.translate(-HEAD_C, -HEAD_C);

    cx.fillStyle = config.color;
    if (useStaticShapePath) {
      const headPath2d = getShapePath2D(ctx.shapeId, shape.path);
      cx.fill(headPath2d);
      cx.save();
      cx.clip(headPath2d);
      drawEyes(cx, ctx, config, effectiveShape, shapeRing, turnAngle, morphAmount, now);
      cx.restore();
    } else {
      traceRingOutline(cx, headRing);
      cx.fill();
      cx.save();
      traceRingOutline(cx, headRing);
      cx.clip();
      drawEyes(cx, ctx, config, effectiveShape, shapeRing, turnAngle, morphAmount, now);
      cx.restore();
    }

    const badgeAmount = clamp(ctx.notify.x, 0, 1.4);
    if (badgeAmount > 0.01) {
      const badgeAnchor = shapeRing[Math.round((7 * shapeRing.length) / 8) % shapeRing.length];
      cx.fillStyle = config.badgeColor;
      cx.strokeStyle = config.eyeColor;
      cx.lineWidth = 10;
      cx.setLineDash([]);
      cx.beginPath();
      cx.arc(badgeAnchor[0], badgeAnchor[1], 20 * config.badgeScale * badgeAmount, 0, Math.PI * 2);
      cx.fill();
      cx.stroke();
    }

    cx.restore();
  });

  // 4. 前景层轨道丝带。
  if (config.particlesEnabled) {
    drawOrbitTrails(cx, ctx.particles.orbitParticles, true);
  }

  cx.restore();
}
