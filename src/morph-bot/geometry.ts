/** 轮廓环插值、3D 转身剖面与眼部边界查询。 */
import { clamp } from "./math";
import { HEAD_C, SHAPES, type FaceTransform, type Point2D, type Ring, type ShapeDefinition, type SolidSphere } from "./original-data";

export type MutablePoint = [number, number];

export function centroid(ring: Ring): MutablePoint {
  let x = 0;
  let y = 0;
  for (const point of ring) {
    x += point[0];
    y += point[1];
  }
  return [x / ring.length, y / ring.length];
}

export function lerpRing(from: Ring, to: Ring, amount: number): MutablePoint[] {
  return from.map(([x, y], index) => [
    x + (to[index][0] - x) * amount,
    y + (to[index][1] - y) * amount,
  ]);
}

export function spanAt(ring: Ring, y: number): [number, number] {
  let left = -Infinity;
  let right = Infinity;
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    if ((start[1] <= y) === (end[1] <= y)) continue;
    const x = start[0] + ((end[0] - start[0]) * (y - start[1])) / (end[1] - start[1]);
    if (x <= HEAD_C) left = Math.max(left, x);
    else right = Math.min(right, x);
  }
  return [Number.isFinite(left) ? left : HEAD_C, Number.isFinite(right) ? right : HEAD_C];
}

export function shapeSpanAt(shape: { ring: Ring; spanSamples: readonly Point2D[] | null; top: number; bottom: number }, y: number): [number, number] {
  if (!shape.spanSamples?.length) return spanAt(shape.ring, y);
  const count = shape.spanSamples.length;
  const position = clamp(((y - shape.top) / (shape.bottom - shape.top)) * count - 0.5, 0, count - 1);
  const start = Math.floor(position);
  const end = Math.min(start + 1, count - 1);
  const amount = position - start;
  return [
    shape.spanSamples[start][0] + (shape.spanSamples[end][0] - shape.spanSamples[start][0]) * amount,
    shape.spanSamples[start][1] + (shape.spanSamples[end][1] - shape.spanSamples[start][1]) * amount,
  ];
}

function radialSolidProfile(solid: readonly SolidSphere[], angle: number): number[] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const raw = Array.from({ length: 96 }, (_, index) => {
    const theta = (index / 96) * Math.PI * 2;
    const directionX = Math.cos(theta);
    const directionY = Math.sin(theta);
    let radius = 0;
    for (const [x, y, z, sphereRadius] of solid) {
      const rotatedX = x * cosine + z * sine;
      const projection = directionX * rotatedX + directionY * y;
      const discriminant = projection ** 2 - (rotatedX ** 2 + y ** 2) + sphereRadius ** 2;
      if (discriminant > 0) radius = Math.max(radius, projection + Math.sqrt(discriminant));
    }
    return radius;
  });
  return raw.map(
    (value, index, values) =>
      (values[(index - 2 + 96) % 96] +
        4 * values[(index - 1 + 96) % 96] +
        6 * value +
        4 * values[(index + 1) % 96] +
        values[(index + 2) % 96]) /
      16,
  );
}

const solidBaselines = new WeakMap<ShapeDefinition, number[]>();

export function turnedShapeRing(shape: ShapeDefinition, angle: number): Ring {
  if (shape.solid) {
    let baseline = solidBaselines.get(shape);
    if (!baseline) {
      baseline = radialSolidProfile(shape.solid, 0);
      solidBaselines.set(shape, baseline);
    }
    let profile = radialSolidProfile(shape.solid, angle).map((value, index) =>
      clamp((value + 12) / (baseline[index] + 12), 0.32, 1.5),
    );
    for (let pass = 0; pass < 3; pass += 1) {
      const source = profile;
      profile = source.map(
        (value, index) =>
          (source[(index - 2 + 96) % 96] +
            4 * source[(index - 1 + 96) % 96] +
            6 * value +
            4 * source[(index + 1) % 96] +
            source[(index + 2) % 96]) /
          16,
      );
    }
    return shape.ring.map(([x, y], index) => [
      HEAD_C + (x - HEAD_C) * profile[index],
      HEAD_C + (y - HEAD_C) * profile[index],
    ]);
  }
  if (shape.sides) {
    const segment = (Math.PI * 2) / shape.sides;
    const factor = 1 + (Math.cos((((angle % segment) + segment) % segment) - segment / 2) / Math.cos(segment / 2) - 1) * 0.45;
    return shape.ring.map(([x, y]) => [HEAD_C + (x - HEAD_C) * factor, y]);
  }
  return shape.ring;
}

export function lerpFace(from: FaceTransform, to: FaceTransform, amount: number): FaceTransform {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    sx: from.sx + (to.sx - from.sx) * amount,
    sy: from.sy + (to.sy - from.sy) * amount,
    eye: from.eye + (to.eye - from.eye) * amount,
  };
}

const teardrop = SHAPES.teardrop.ring;
const halfDrop = teardrop.length / 2;
const dropAngle = (halfDrop / teardrop.length) * Math.PI * 2;

export const PENCIL_RING: Ring = teardrop.map((_, index) => {
  const [x, y] = teardrop[((index - halfDrop) % teardrop.length + teardrop.length) % teardrop.length];
  const dx = x - HEAD_C;
  const dy = y - HEAD_C;
  return [
    HEAD_C + dx * Math.cos(dropAngle) - dy * Math.sin(dropAngle),
    HEAD_C + dx * Math.sin(dropAngle) + dy * Math.cos(dropAngle),
  ];
});
