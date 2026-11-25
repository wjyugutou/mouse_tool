/** 纯物理粒子系统：维护 3D 轨道丝带粒子与爆发碎片状态，无任何 DOM 依赖。 */
import { clamp, random } from "./math";
import { HEAD_C, STAR_GOLD } from "./original-data";

const COLORS = ["#f9705c", "#5b95f0", "#3fbe86", "#f5b13f", "#9a72ee", "#35c3bd"] as const;

export interface OrbitLayout {
  tilt: number;
  roll: number;
}

export interface OrbitState {
  angle: number;
  angularVelocity: number;
  tilt: number;
  roll: number;
  radius: number;
  radiusVelocity: number;
  follow: number;
  carry: number;
  arc: number;
}

export interface TrailSample {
  x: number;
  y: number;
  angle: number;
  z: number;
}

export interface OrbitParticle {
  x: number;
  y: number;
  life: number;
  max: number;
  radius: number;
  returnAmount: number;
  opacity: number;
  width: number;
  hue: number;
  hueSpan: number;
  hueVelocity: number;
  orbit: OrbitState;
  history: TrailSample[];
}

export interface BurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  radius: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  curl: number;
  color: string;
  isStar: boolean;
  round: boolean;
  opacity: number;
}

interface QueuedEmission {
  at: number;
  index: number;
}

export class ParticleSystem {
  orbitParticles: OrbitParticle[] = [];
  burstParticles: BurstParticle[] = [];

  private readonly reduceMotion: () => boolean;
  private readonly radius: () => number;
  private spinAngle = random(0, Math.PI * 2);
  private lastSpinAngle = 0;
  private angularVelocity = 0;
  private trailActive = false;
  private emissionQueue: QueuedEmission[] = [];
  private orbitLayouts: OrbitLayout[] = [];
  private hue = 0;
  private orbitCount = 4;
  private sizeScale = 1;
  private wideStyle = false;

  constructor(options: { reduceMotion: () => boolean; radius: () => number }) {
    this.reduceMotion = options.reduceMotion;
    this.radius = options.radius;
  }

  clear(): void {
    this.orbitParticles = [];
    this.burstParticles = [];
  }

  private get totalCount(): number {
    return this.orbitParticles.length + this.burstParticles.length;
  }

  private resetOrbitStyle(layoutCount = 1): void {
    const roll = random(-0.85, 0.85);
    this.orbitLayouts = Array.from({ length: layoutCount }, (_, index) => ({
      tilt: random(0.16, 0.5),
      roll: roll + (index * Math.PI) / layoutCount + random(-0.12, 0.12),
    }));
    this.orbitCount = layoutCount > 1 ? 3 * layoutCount : Math.round(random(3, 5));
    this.hue = random(0, 360);
  }

  private spawnOrbitParticle(angle: number, direction: number, index: number): void {
    if (this.totalCount > 110) return;
    if (!this.orbitLayouts.length) this.resetOrbitStyle();
    const layout = this.orbitLayouts[index % this.orbitLayouts.length];
    const countPerLayout = Math.max(Math.ceil(this.orbitCount / this.orbitLayouts.length) - 1, 1);
    const baseRadius = 116 * (this.radius() / HEAD_C);
    const radius =
      this.orbitCount <= 3
        ? random(8, 10.5)
        : this.orbitCount === 4
          ? random(6.6, 8.6)
          : random(5.6, 7.4);

    this.orbitParticles.push({
      x: HEAD_C,
      y: HEAD_C,
      life: 0,
      max: 9,
      radius,
      returnAmount: 0,
      opacity: 0,
      width: 0.5,
      hue: this.hue + (360 * index) / Math.max(this.orbitCount, 1) + random(-14, 14),
      hueSpan: random(45, 95) * (Math.random() < 0.5 ? 1 : -1),
      hueVelocity: random(18, 42) * (Math.random() < 0.5 ? 1 : -1),
      orbit: {
        angle,
        angularVelocity: direction * random(0.5, 1.1),
        tilt: layout.tilt + random(-0.04, 0.04),
        roll: layout.roll + random(-0.05, 0.05),
        radius:
          baseRadius +
          Math.floor(index / this.orbitLayouts.length) * (38 / countPerLayout) +
          random(-1.5, 1.5),
        radiusVelocity: random(0, 2.5),
        follow: random(0.74, 0.94),
        carry: 0,
        arc: random(2.2, 3.4),
      },
      history: [],
    });
  }

  burst(count = 20, force = 1, curl = 0): void {
    if (this.reduceMotion() || this.totalCount > 120) return;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + random(-0.35, 0.35);
      const distance = random(96, 116) * (this.radius() / HEAD_C);
      const speed = random(170, 360) * force;
      const tangentX = -Math.sin(angle);
      const tangentY = Math.cos(angle);
      const curlVelocity = curl * speed * 0.2;
      const isStar = Math.random() < 0.18;
      const round = !isStar && Math.random() < 0.3;
      const radius = isStar ? random(4, 7) : random(3.5, 8);
      this.burstParticles.push({
        x: HEAD_C + Math.cos(angle) * distance,
        y: HEAD_C + Math.sin(angle) * distance,
        vx: Math.cos(angle) * speed + tangentX * curlVelocity,
        vy: Math.sin(angle) * speed + tangentY * curlVelocity - random(20, 75),
        life: 0,
        max: random(0.45, 0.85),
        radius,
        size: radius,
        rotation: random(0, 360),
        rotationSpeed: random(-260, 260),
        curl: 0,
        color: isStar ? STAR_GOLD : COLORS[Math.floor(Math.random() * COLORS.length)],
        isStar,
        round,
        opacity: 0,
      });
    }
  }

  private projectOrbit(orbit: OrbitState, angle: number): { x: number; y: number } {
    const horizontal = orbit.radius * Math.sin(angle);
    const vertical = -orbit.radius * Math.cos(angle) * Math.sin(orbit.tilt);
    const cosine = Math.cos(orbit.roll);
    const sine = Math.sin(orbit.roll);
    return {
      x: HEAD_C + horizontal * cosine - vertical * sine,
      y: HEAD_C + horizontal * sine + vertical * cosine,
    };
  }

  private orbitDepth(orbit: OrbitState, angle: number): number {
    return Math.cos(angle) * Math.cos(orbit.tilt);
  }

  update(
    now: number,
    delta: number,
    options: { spinAngle: number; sizeScale: number; wideStyle: boolean; enabled?: boolean },
  ): void {
    this.sizeScale = options.sizeScale;
    this.spinAngle = options.spinAngle;
    this.wideStyle = options.wideStyle;

    if (options.enabled === false) {
      if (this.totalCount > 0) this.clear();
      this.emissionQueue = [];
      this.trailActive = false;
      this.angularVelocity = 0;
      this.lastSpinAngle = this.spinAngle;
      return;
    }

    let difference = this.spinAngle - this.lastSpinAngle;
    if (!Number.isFinite(difference) || Math.abs(difference) > 1.2) difference = 0;
    this.lastSpinAngle = this.spinAngle;

    const wasSpinning = Math.abs(this.angularVelocity) >= 0.9;
    this.angularVelocity = delta > 0 ? difference / delta : 0;
    const isSpinning = Math.abs(this.angularVelocity) >= 0.9;

    if (!wasSpinning && isSpinning) {
      this.resetOrbitStyle(this.wideStyle ? 3 : 1);
      this.trailActive = false;
    }
    if (wasSpinning && !isSpinning) this.emissionQueue = [];

    if (!this.reduceMotion()) {
      if (!this.trailActive && Math.abs(this.angularVelocity) >= 5) {
        this.trailActive = true;
        this.emissionQueue = Array.from({ length: this.orbitCount }, (_, index) => ({
          at: now + index * random(55, 105),
          index,
        }));
      }
      while (this.emissionQueue.length && now >= this.emissionQueue[0].at) {
        const queued = this.emissionQueue.shift();
        if (queued) {
          this.spawnOrbitParticle(
            this.spinAngle - random(0, 0.18),
            Math.sign(this.angularVelocity) || 1,
            queued.index,
          );
        }
      }
    }

    const aliveOrbits: OrbitParticle[] = [];
    for (const particle of this.orbitParticles) {
      particle.life += delta;
      const progress = clamp(particle.life / particle.max, 0, 1);
      const shouldReturn = !isSpinning || progress > 0.55;
      particle.returnAmount = clamp(
        particle.returnAmount + (shouldReturn ? delta / 0.5 : -delta / 0.35),
        0,
        1,
      );
      if (particle.returnAmount >= 1) continue;

      particle.opacity = Math.min(1, particle.life / 0.26);
      const orbit = particle.orbit;
      if (isSpinning) {
        orbit.carry = this.angularVelocity * orbit.follow;
        orbit.angle += this.angularVelocity * delta * orbit.follow + orbit.angularVelocity * delta;
      } else {
        orbit.angle += (orbit.carry + orbit.angularVelocity) * delta;
        orbit.carry *= Math.exp(-2.6 * delta);
        orbit.angularVelocity *= Math.exp(-2.6 * delta);
      }
      orbit.radius += orbit.radiusVelocity * delta;

      const position = this.projectOrbit(orbit, orbit.angle);
      particle.x = position.x;
      particle.y = position.y;
      const depth = this.orbitDepth(orbit, orbit.angle);
      const depthScale = 0.72 + 0.28 * clamp(depth, 0, 1);
      const enter = Math.min(particle.life / 0.34, 1);
      const smoothEnter = enter * enter * (3 - 2 * enter);
      particle.width = Math.max(
        particle.radius *
          depthScale *
          1.7 *
          this.sizeScale *
          smoothEnter *
          (1 - 0.72 * particle.returnAmount ** 2),
        0.5,
      );

      const history = particle.history;
      const previousAngle = history.length ? history[history.length - 1].angle : orbit.angle;
      const angleChange = orbit.angle - previousAngle;
      const subdivisions = Math.min(Math.ceil(Math.abs(angleChange) / 0.09), 24);
      for (let index = 1; index <= subdivisions; index += 1) {
        const angle = previousAngle + (angleChange * index) / subdivisions;
        const point = this.projectOrbit(orbit, angle);
        history.push({ x: point.x, y: point.y, angle, z: this.orbitDepth(orbit, angle) });
      }
      if (!history.length) history.push({ x: particle.x, y: particle.y, angle: orbit.angle, z: depth });

      const arc = orbit.arc * (1 - particle.returnAmount ** 2 * (3 - 2 * particle.returnAmount));
      while (history.length > 2 && Math.abs(orbit.angle - history[0].angle) > arc) {
        history.shift();
      }
      const excess = Math.abs(orbit.angle - history[0].angle) - arc;
      if (history.length >= 2 && excess > 0) {
        const angle = history[0].angle + Math.sign(orbit.angle - history[0].angle) * excess;
        const point = this.projectOrbit(orbit, angle);
        history[0] = { x: point.x, y: point.y, angle, z: this.orbitDepth(orbit, angle) };
      }
      if (history.length > 48) history.splice(0, history.length - 48);

      aliveOrbits.push(particle);
    }
    this.orbitParticles = aliveOrbits;

    const aliveBursts: BurstParticle[] = [];
    for (const particle of this.burstParticles) {
      particle.life += delta;
      if (particle.life >= particle.max) continue;

      const progress = clamp(particle.life / particle.max, 0, 1);
      particle.opacity =
        progress < 0.1 ? progress / 0.1 : (1 - (progress - 0.1) / 0.9) ** 1.7;

      if (particle.curl) {
        const cosine = Math.cos(particle.curl * delta);
        const sine = Math.sin(particle.curl * delta);
        const vx = particle.vx * cosine - particle.vy * sine;
        const vy = particle.vx * sine + particle.vy * cosine;
        particle.vx = vx;
        particle.vy = vy;
      }
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      const drag = 0.94 ** (60 * delta);
      particle.vx *= drag;
      particle.vy = particle.vy * drag + 40 * delta;
      particle.size = Math.max(particle.radius * (1 - 0.4 * progress), 0.5);
      if (particle.isStar) {
        particle.rotation += particle.rotationSpeed * delta;
      }
      aliveBursts.push(particle);
    }
    this.burstParticles = aliveBursts;
  }
}
