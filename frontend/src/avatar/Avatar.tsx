import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { live, type AIState, type Emotion } from "../lib/live";
import { makeBustGeometry, makeHeadGeometry, surfacePoint } from "./face";
import { eyeFrag, eyeVert, floorFrag, holoFrag, holoVert, mouthFrag, pointsFrag, pointsVert } from "./shaders";

const STATE_COLORS: Record<AIState, string> = {
  idle: "#00e5ff",
  listening: "#35ffc2",
  thinking: "#8a7bff",
  speaking: "#22d3ff",
  executing: "#ffb340",
  waiting: "#ffd23f",
  offline: "#ff4466",
};

type Expr = { smile: number; brow: number; browTilt: number; open: number; squint: number; mouth: number; width: number };
const EXPRESSIONS: Record<Emotion, Expr> = {
  neutral:   { smile: 0.12, brow: 0.0,   browTilt: 0.0,  open: 1.0,  squint: 0.05, mouth: 0.0,  width: 1.0 },
  happy:     { smile: 0.85, brow: 0.012, browTilt: 0.0,  open: 0.82, squint: 0.55, mouth: 0.06, width: 1.1 },
  concerned: { smile: -0.45, brow: 0.01, browTilt: 0.22, open: 0.95, squint: 0.1,  mouth: 0.0,  width: 0.9 },
  surprised: { smile: 0.0,  brow: 0.04,  browTilt: 0.05, open: 1.12, squint: 0.0,  mouth: 0.32, width: 0.85 },
  curious:   { smile: 0.25, brow: 0.025, browTilt: -0.1, open: 1.04, squint: 0.1,  mouth: 0.02, width: 1.0 },
  thinking:  { smile: -0.05, brow: 0.015, browTilt: 0.12, open: 0.9, squint: 0.2,  mouth: 0.0,  width: 0.92 },
};

const lerp = THREE.MathUtils.lerp;

function holoMaterial(opacity: number, fade = -10) {
  return new THREE.ShaderMaterial({
    vertexShader: holoVert,
    fragmentShader: holoFrag,
    uniforms: {
      uColor: { value: new THREE.Color("#00e5ff") }, uTime: { value: 0 }, uOpacity: { value: opacity },
      uPulse: { value: 0 }, uGlitch: { value: 0 }, uFade: { value: fade },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  });
}

function Eye({ side, mat }: { side: 1 | -1; mat: THREE.ShaderMaterial }) {
  const p = surfacePoint(0.33 * side, 0.12);
  return (
    <mesh position={[p.x, p.y, p.z + 0.012]} rotation={[0, side * 0.32, 0]} scale={[0.135, 0.075, 1]} material={mat} renderOrder={5}>
      <circleGeometry args={[1, 48]} />
    </mesh>
  );
}

export function Avatar() {
  const { pointer, size, viewport } = useThree();
  const group = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const rings = useRef<THREE.Group>(null!);
  const particles = useRef<THREE.Points>(null!);
  const browL = useRef<THREE.Mesh>(null!);
  const browR = useRef<THREE.Mesh>(null!);

  const headGeo = useMemo(() => makeHeadGeometry(160), []);
  const headPointsGeo = useMemo(() => makeHeadGeometry(52), []);
  const bustGeo = useMemo(() => makeBustGeometry(), []);
  const headMat = useMemo(() => holoMaterial(1.0), []);
  const bustMat = useMemo(() => holoMaterial(0.45, -2.1), []);
  const pointsMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: pointsVert, fragmentShader: pointsFrag,
    uniforms: { uColor: { value: new THREE.Color("#00e5ff") }, uTime: { value: 0 }, uSize: { value: 10 }, uOpacity: { value: 0.32 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), []);
  const eyeMats = useMemo(() => [0, 1].map(() => new THREE.ShaderMaterial({
    vertexShader: eyeVert, fragmentShader: eyeFrag, transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color("#00e5ff") }, uTime: { value: 0 }, uGaze: { value: new THREE.Vector2() },
      uOpen: { value: 1 }, uSquint: { value: 0 }, uDilate: { value: 0 } },
  })), []);
  const mouthMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: eyeVert, fragmentShader: mouthFrag, transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color("#00e5ff") }, uOpen: { value: 0 }, uSmile: { value: 0.1 }, uWidth: { value: 1 }, uTime: { value: 0 } },
  }), []);
  const floorMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: eyeVert, fragmentShader: floorFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color("#00e5ff") }, uTime: { value: 0 } },
  }), []);
  const browMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color("#00e5ff").multiplyScalar(2), toneMapped: false, transparent: true, opacity: 0.9 }), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#00e5ff", transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);

  const browGeo = useMemo(() => {
    const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.1, -0.012, 0), new THREE.Vector3(0, 0.03, 0.01), new THREE.Vector3(0.1, -0.002, -0.01));
    return new THREE.TubeGeometry(c, 24, 0.009, 6, false);
  }, []);

  const particleGeo = useMemo(() => {
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 1.5 + Math.random() * 1.6;
      const th = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * 3.4;
      pos.set([Math.cos(th) * r, y, Math.sin(th) * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 3).fill(0), 3));
    return g;
  }, []);
  const particleMat = useMemo(() => new THREE.PointsMaterial({ size: 0.022, color: "#00e5ff", transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }), []);

  const eyeL = surfacePoint(-0.33, 0.27);
  const eyeR = surfacePoint(0.33, 0.27);
  const mouthPos = surfacePoint(0, -0.45);

  // état animé
  const s = useRef({
    color: new THREE.Color("#00e5ff"), target: new THREE.Color(), expr: { ...EXPRESSIONS.neutral },
    blinkAt: 2, blinkT: -1, gaze: new THREE.Vector2(), saccade: new THREE.Vector2(), saccadeAt: 1, rot: new THREE.Euler(), pulse: 0,
  });

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const st = s.current;
    dt = Math.min(dt, 0.05);
    const aiState = live.state;

    // couleur selon l'état
    st.target.set(STATE_COLORS[aiState]);
    st.color.lerp(st.target, 1 - Math.pow(0.02, dt));
    for (const m of [headMat, bustMat, pointsMat, mouthMat, floorMat, ...eyeMats]) {
      (m.uniforms.uColor.value as THREE.Color).copy(st.color);
      if (m.uniforms.uTime) m.uniforms.uTime.value = t;
    }
    browMat.color.copy(st.color).multiplyScalar(2.2);
    ringMat.color.copy(st.color);
    particleMat.color.copy(st.color);

    // expression
    let emo: Emotion = live.emotion;
    if (performance.now() > live.emotionUntil && aiState !== "thinking") emo = "neutral";
    if (aiState === "thinking" || aiState === "executing") emo = emo === "neutral" ? "thinking" : emo;
    if (aiState === "listening" && emo === "neutral") emo = "curious";
    const target = EXPRESSIONS[emo];
    const k = 1 - Math.pow(0.004, dt);
    (Object.keys(target) as (keyof Expr)[]).forEach((key) => { st.expr[key] = lerp(st.expr[key], target[key], k); });

    // clignements naturels (parfois doubles)
    if (t > st.blinkAt && st.blinkT < 0) st.blinkT = 0;
    let blink = 1;
    if (st.blinkT >= 0) {
      st.blinkT += dt;
      const d = 0.16;
      blink = st.blinkT < d ? Math.abs(Math.cos((st.blinkT / d) * Math.PI)) : 1;
      if (st.blinkT >= d) {
        st.blinkT = -1;
        st.blinkAt = t + (Math.random() < 0.18 ? 0.25 : 2 + Math.random() * 4.5);
      }
    }

    // regard : vers l'utilisateur (curseur) + micro-saccades ; vers le haut quand elle réfléchit
    if (t > st.saccadeAt) {
      st.saccade.set((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.15);
      st.saccadeAt = t + 0.8 + Math.random() * 2.5;
    }
    const gx = aiState === "thinking" ? 0.55 * Math.sign(Math.sin(t * 0.21) + 0.3) : pointer.x * 0.55;
    const gy = aiState === "thinking" ? 0.5 : pointer.y * 0.45;
    st.gaze.x = lerp(st.gaze.x, gx + st.saccade.x, 1 - Math.pow(0.0001, dt));
    st.gaze.y = lerp(st.gaze.y, gy + st.saccade.y, 1 - Math.pow(0.0001, dt));

    const speakOpen = aiState === "speaking" ? live.mouth : 0;
    eyeMats.forEach((m) => {
      (m.uniforms.uGaze.value as THREE.Vector2).copy(st.gaze);
      m.uniforms.uOpen.value = st.expr.open * blink;
      m.uniforms.uSquint.value = st.expr.squint;
      m.uniforms.uDilate.value = aiState === "listening" ? 0.8 : aiState === "thinking" ? 0.4 : 0;
    });
    mouthMat.uniforms.uOpen.value = Math.min(1, st.expr.mouth + speakOpen * 0.95);
    mouthMat.uniforms.uSmile.value = st.expr.smile * (1 - speakOpen * 0.4);
    mouthMat.uniforms.uWidth.value = st.expr.width * (1 - speakOpen * 0.12);

    // sourcils
    const by = st.expr.brow + (aiState === "speaking" ? live.speechLevel * 0.012 : 0);
    browL.current.position.y = eyeL.y + 0.012 + by;
    browR.current.position.y = eyeR.y + 0.012 + by + (emo === "curious" ? 0.02 : 0);
    browL.current.rotation.z = -st.expr.browTilt + 0.08;
    browR.current.rotation.z = st.expr.browTilt - 0.08;

    // mouvements de tête
    const idleY = Math.sin(t * 0.31) * 0.07 + Math.sin(t * 0.73) * 0.025;
    const idleX = Math.sin(t * 0.23) * 0.035 + Math.sin(t * 0.9) * 0.01;
    let rx = idleX - pointer.y * 0.12, ry = idleY + pointer.x * 0.22, rz = Math.sin(t * 0.17) * 0.02;
    if (aiState === "thinking") { rx -= 0.1; ry += 0.12 * Math.sin(t * 0.21); rz += 0.05; }
    if (aiState === "listening") { rz += 0.07; rx += 0.04; }
    if (aiState === "speaking") { rx += live.speechLevel * 0.06 * Math.sin(t * 6); ry += Math.sin(t * 1.7) * 0.03; }
    if (aiState === "offline") { rx += 0.25; }
    const hk = 1 - Math.pow(0.03, dt);
    head.current.rotation.x = lerp(head.current.rotation.x, rx, hk);
    head.current.rotation.y = lerp(head.current.rotation.y, ry, hk);
    head.current.rotation.z = lerp(head.current.rotation.z, rz, hk);
    head.current.position.y = Math.sin(t * 1.1) * 0.012 + (aiState === "listening" ? 0.02 : 0);
    head.current.position.z = lerp(head.current.position.z, aiState === "listening" ? 0.08 : 0, hk);

    // pulsations et anneaux
    st.pulse = Math.max(st.pulse * Math.pow(0.05, dt), live.pulse);
    live.pulse = 0;
    const energy = aiState === "speaking" ? live.speechLevel : aiState === "listening" ? live.mic : 0;
    headMat.uniforms.uPulse.value = st.pulse * 0.6 + energy * 0.5;
    headMat.uniforms.uGlitch.value = aiState === "offline" ? 1 : aiState === "executing" ? 0.4 : st.pulse * 0.3;
    bustMat.uniforms.uPulse.value = headMat.uniforms.uPulse.value * 0.5;
    const speed = aiState === "thinking" ? 2.6 : aiState === "executing" ? 3.4 : aiState === "listening" ? 1.4 : 0.6;
    rings.current.children.forEach((r, i) => {
      r.rotation.z += dt * speed * (i % 2 ? -0.35 : 0.5) * (1 + i * 0.3);
      const sc = 1 + energy * 0.06 * (i + 1) + st.pulse * 0.04;
      r.scale.setScalar(sc);
    });
    ringMat.opacity = 0.28 + energy * 0.4 + (aiState === "thinking" ? 0.15 : 0);
    particles.current.rotation.y += dt * speed * 0.12;
    particleMat.size = 0.02 + energy * 0.02;

    // décalage pour centrer l'avatar entre les panneaux de l'écran Assistant
    const shiftPx = size.width > 1100 ? -40 : 0;
    group.current.position.x = (shiftPx / size.width) * viewport.width;
  });

  return (
    <group ref={group}>
      <group ref={head} position={[0, 0, 0]}>
        <mesh geometry={headGeo} material={headMat} renderOrder={1} />
        <points geometry={headPointsGeo} material={pointsMat} renderOrder={2} />
        <Eye side={-1} mat={eyeMats[0]} />
        <Eye side={1} mat={eyeMats[1]} />
        <mesh ref={browL} geometry={browGeo} material={browMat} position={[eyeL.x, eyeL.y, eyeL.z + 0.02]} rotation={[0, -0.3, 0]} renderOrder={6} />
        <mesh ref={browR} geometry={browGeo} material={browMat} position={[eyeR.x, eyeR.y, eyeR.z + 0.02]} rotation={[0, 0.3, 0]} scale={[-1, 1, 1]} renderOrder={6} />
        <mesh position={[mouthPos.x, mouthPos.y + 0.01, mouthPos.z + 0.022]} rotation={[-0.18, 0, 0]} material={mouthMat} renderOrder={6}>
          <planeGeometry args={[0.4, 0.26]} />
        </mesh>
      </group>
      <mesh geometry={bustGeo} material={bustMat} renderOrder={0} />
      <group ref={rings} position={[0, -0.05, 0]}>
        <mesh rotation={[Math.PI / 2 - 0.25, 0.1, 0]} material={ringMat}><torusGeometry args={[1.45, 0.004, 8, 160]} /></mesh>
        <mesh rotation={[Math.PI / 2 + 0.35, -0.2, 0]} material={ringMat}><torusGeometry args={[1.62, 0.003, 8, 160, Math.PI * 1.4]} /></mesh>
        <mesh rotation={[Math.PI / 2 + 0.05, 0.4, 0]} material={ringMat}><torusGeometry args={[1.85, 0.0025, 8, 160, Math.PI * 0.9]} /></mesh>
      </group>
      <points ref={particles} geometry={particleGeo} material={particleMat} />
      <mesh position={[0, -2.75, 0]} rotation={[-Math.PI / 2, 0, 0]} material={floorMat}>
        <planeGeometry args={[6, 6]} />
      </mesh>
    </group>
  );
}
