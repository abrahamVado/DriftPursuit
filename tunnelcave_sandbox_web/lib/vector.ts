export type Vec3 = [number, number, number];

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}

export function copy(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

export function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len === 0) {
    return [0, 0, 0];
  }
  const inv = 1 / len;
  return [v[0] * inv, v[1] * inv, v[2] * inv];
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

export function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const k = normalize(axis);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const term1 = scale(v, cos);
  const term2 = scale(cross(k, v), sin);
  const term3 = scale(k, dot(k, v) * (1 - cos));
  return add(add(term1, term2), term3);
}

export function projectOnPlane(v: Vec3, normal: Vec3): Vec3 {
  const n = normalize(normal);
  return sub(v, scale(n, dot(v, n)));
}

export function angleBetween(a: Vec3, b: Vec3): number {
  const denom = length(a) * length(b);
  if (denom === 0) {
    return 0;
  }
  return Math.acos(Math.min(1, Math.max(-1, dot(a, b) / denom)));
}
