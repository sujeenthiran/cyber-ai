import * as THREE from "three";

// Sculpture procédurale d'un visage humain stylisé à partir d'une sphère.
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const g = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) =>
  Math.exp(-(((x - cx) * (x - cx)) / (sx * sx) + ((y - cy) * (y - cy)) / (sy * sy)));

export function sculpt(px: number, py: number, pz: number, out = new THREE.Vector3()) {
  let x = px * 0.79, y = py * 1.0, z = pz * 0.88;
  const jaw = smooth(0.05, -0.95, py);
  x *= 1 - 0.24 * jaw;
  z *= pz < 0 ? 1 - 0.3 * jaw : 1 - 0.1 * jaw;
  if (pz < 0 && py > -0.2) z *= 1.07;              // arrière du crâne
  if (py > 0.55) { x *= 1 - (py - 0.55) * 0.12; }  // sommet plus étroit
  const front = smooth(0.25, 0.75, pz);
  let dz = 0;
  dz += 0.19 * g(px, py, 0, -0.08, 0.075, 0.2) * front;           // arête du nez
  dz += 0.06 * g(px, py, 0, -0.21, 0.07, 0.06) * front;           // bout du nez
  dz += 0.03 * (g(px, py, 0.07, -0.24, 0.04, 0.03) + g(px, py, -0.07, -0.24, 0.04, 0.03)) * front; // ailes du nez
  dz -= 0.075 * (g(px, py, 0.33, 0.12, 0.14, 0.085) + g(px, py, -0.33, 0.12, 0.14, 0.085)) * front; // orbites
  dz += 0.045 * g(px, py, 0, 0.27, 0.5, 0.06) * front;            // arcade sourcilière
  dz += 0.035 * (g(px, py, 0.42, -0.1, 0.12, 0.13) + g(px, py, -0.42, -0.1, 0.12, 0.13)) * front; // pommettes
  dz += 0.035 * g(px, py, 0, -0.41, 0.2, 0.05) * front;           // lèvre supérieure
  dz += 0.03 * g(px, py, 0, -0.5, 0.17, 0.045) * front;           // lèvre inférieure
  dz -= 0.02 * g(px, py, 0, -0.58, 0.14, 0.035) * front;          // creux du menton
  dz += 0.06 * g(px, py, 0, -0.76, 0.16, 0.11) * front;           // menton
  dz -= 0.02 * g(px, py, 0, -0.31, 0.05, 0.05) * front;           // philtrum
  // oreilles discrètes
  const ear = g(py, Math.abs(px), 0.0, 0.98, 0.16, 0.06) * smooth(0.25, -0.05, Math.abs(pz));
  x += Math.sign(px) * 0.05 * ear;
  return out.set(x, y, z + dz);
}

/** Point de la surface du visage pour une direction (sx, sy) sur la face avant. */
export function surfacePoint(sx: number, sy: number) {
  const sz = Math.sqrt(Math.max(0, 1 - sx * sx - sy * sy));
  return sculpt(sx, sy, sz);
}

export function makeHeadGeometry(segments = 160) {
  const geo = new THREE.SphereGeometry(1, segments, segments);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    sculpt(v.x, v.y, v.z, v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function makeBustGeometry() {
  const pts = [
    [0.0, -0.62], [0.27, -0.66], [0.29, -0.9], [0.31, -1.12], [0.42, -1.28], [0.8, -1.4],
    [1.2, -1.5], [1.45, -1.66], [1.58, -1.95], [1.64, -2.5],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, 96);
  geo.scale(1, 1, 0.56);
  geo.computeVertexNormals();
  return geo;
}
