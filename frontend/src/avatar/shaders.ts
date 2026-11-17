export const holoVert = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vL;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vL = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = viewMatrix * w;
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

export const holoFrag = /* glsl */ `
uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uPulse; uniform float uGlitch; uniform float uFade;
varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vL;
float hash(float n){ return fract(sin(n)*43758.5453); }
void main(){
  vec3 n = normalize(vN);
  float fres = pow(1.0 - abs(dot(n, normalize(vV))), 2.2);
  float diff = max(dot(n, normalize(vec3(0.35, 0.55, 1.0))), 0.0);
  float scan = pow(0.5 + 0.5 * sin(vW.y * 140.0 - uTime * 4.0), 8.0) * 0.28;
  float sweepY = mod(uTime * 0.55, 4.5) - 2.5;
  float sweep = exp(-pow(vW.y - sweepY, 2.0) * 40.0) * 0.9;
  vec2 gp = vL.xy * 16.0;
  float grid = (smoothstep(0.93, 1.0, fract(gp.x)) + smoothstep(0.93, 1.0, fract(gp.y))) * 0.07;
  float flick = 1.0 - uGlitch * step(0.92, hash(floor(uTime * 24.0) + floor(vW.y * 30.0))) * 0.6;
  float fade = smoothstep(uFade - 0.5, uFade + 0.2, vW.y);
  float spec = pow(max(dot(reflect(-normalize(vec3(0.35, 0.55, 1.0)), n), normalize(vV)), 0.0), 18.0);
  vec3 col = uColor * (0.03 + diff * 0.16 + fres * 1.0 + scan * 0.7 + sweep * 0.7 + grid) + vec3(0.75, 0.97, 1.0) * (pow(fres, 5.0) * 0.6 + spec * 0.25);
  float a = clamp(0.03 + diff * 0.07 + fres * 0.7 + scan * 0.35 + sweep * 0.35 + grid + spec * 0.2, 0.0, 1.0) * uOpacity * flick * fade;
  gl_FragColor = vec4(col * (1.0 + uPulse * 0.8), a);
}`;

export const pointsVert = /* glsl */ `
uniform float uTime; uniform float uSize;
varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  float fres = 1.0 - abs(dot(n, normalize(-mv.xyz)));
  vA = 0.25 + fres * 0.75;
  gl_PointSize = uSize * (0.6 + fres) / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

export const pointsFrag = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity;
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d) * vA * uOpacity;
  gl_FragColor = vec4(uColor * 1.6, a);
}`;

export const eyeVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export const eyeFrag = /* glsl */ `
uniform vec3 uColor; uniform float uTime; uniform vec2 uGaze; uniform float uOpen; uniform float uSquint; uniform float uDilate;
varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;
  // paupières : la supérieure descend, l'inférieure remonte un peu (sourire)
  float top = mix(-0.08, 0.95 - 0.12 * p.x * p.x, uOpen);
  float bot = mix(-0.08, -0.92 + 0.12 * p.x * p.x + uSquint * 0.45, uOpen);
  float inside = smoothstep(top + 0.02, top - 0.03, p.y) * smoothstep(bot - 0.02, bot + 0.03, p.y);
  vec2 c = uGaze * 0.38;
  float d = length(p - c);
  float irisR = 0.47;
  float ang = atan(p.y - c.y, p.x - c.x);
  float striae = 0.65 + 0.35 * sin(ang * 28.0 + uTime * 0.6) * sin(d * 30.0 - uTime * 1.5);
  float iris = smoothstep(irisR, irisR - 0.03, d);
  float pupilR = 0.15 + uDilate * 0.06;
  float pupil = smoothstep(pupilR, pupilR - 0.03, d);
  float irisEdge = exp(-abs(d - irisR) * 38.0);
  float pupilEdge = exp(-abs(d - pupilR) * 45.0);
  float spark = smoothstep(0.08, 0.0, length(p - c - vec2(-0.13, 0.15)));
  vec3 sclera = vec3(0.01, 0.04, 0.09) + uColor * 0.06 * (1.0 - r);
  vec3 col = sclera;
  col = mix(col, uColor * (0.55 + 0.9 * striae) * (0.5 + d * 1.2), iris);
  col = mix(col, vec3(0.0, 0.01, 0.03), pupil);
  col += uColor * (irisEdge * 1.6 + pupilEdge * 1.2) + vec3(1.0) * spark * 1.6;
  float lidLine = (exp(-abs(p.y - top) * 30.0) + 0.5 * exp(-abs(p.y - bot) * 40.0)) * smoothstep(1.0, 0.6, abs(p.x));
  float rim = exp(-abs(r - 0.97) * 22.0) * 0.5;
  vec3 outCol = col * inside + uColor * (lidLine * 1.4 + rim * (1.0 - inside));
  float a = max(inside * 0.97, (lidLine * 0.9 + rim * 0.5) * smoothstep(1.0, 0.92, r));
  gl_FragColor = vec4(outCol, a);
}`;

export const mouthFrag = /* glsl */ `
uniform vec3 uColor; uniform float uOpen; uniform float uSmile; uniform float uWidth; uniform float uTime;
varying vec2 vUv;
void main(){
  vec2 p = vec2((vUv.x - 0.5) * 2.0, (vUv.y - 0.5) * 2.0);
  float w = 0.82 * uWidth;
  float t = clamp(p.x / w, -1.0, 1.0);
  float edge = smoothstep(1.0, 0.92, abs(p.x / w));
  float center = uSmile * 0.32 * (t * t) - 0.08 - uSmile * 0.06;
  float h = (uOpen * 1.15) * pow(max(0.0, 1.0 - t * t), 0.7) + 0.02;
  float up = center + h * 0.32;
  float lo = center - h * 0.68;
  float inside = smoothstep(up + 0.015, up - 0.02, p.y) * smoothstep(lo - 0.015, lo + 0.02, p.y) * edge;
  float upperLip = exp(-pow((p.y - up - 0.05) / 0.06, 2.0)) * edge;
  float lowerLip = exp(-pow((p.y - lo + 0.07) / 0.08, 2.0)) * edge;
  float line = exp(-abs(p.y - up) * 55.0) * edge + exp(-abs(p.y - lo) * 55.0) * edge;
  float teeth = smoothstep(0.08, 0.0, abs(p.y - (up - 0.07))) * inside * step(0.25, uOpen) * 0.35;
  vec3 col = vec3(0.0, 0.015, 0.04) * inside + uColor * (line * 1.5 + (upperLip + lowerLip) * 0.45) + vec3(0.7, 0.9, 1.0) * teeth;
  float a = clamp(inside * 0.95 + line * 0.95 + (upperLip + lowerLip) * 0.35, 0.0, 1.0);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}`;

export const floorFrag = /* glsl */ `
uniform vec3 uColor; uniform float uTime;
varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;
  float rings = pow(0.5 + 0.5 * sin(r * 60.0 - uTime * 2.0), 12.0) * 0.5;
  float a = atan(p.y, p.x);
  float spokes = pow(0.5 + 0.5 * sin(a * 36.0), 30.0) * 0.25 * smoothstep(0.3, 0.9, r);
  float edge = exp(-abs(r - 0.96) * 40.0) + exp(-abs(r - 0.62) * 60.0) * 0.6;
  float glow = smoothstep(1.0, 0.0, r) * 0.18;
  float intensity = (rings + spokes + edge + glow) * smoothstep(1.0, 0.85, r);
  gl_FragColor = vec4(uColor * intensity * 1.4, intensity);
}`;
