import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette, Noise } from "@react-three/postprocessing";
import { Avatar } from "./Avatar";

export function Scene() {
  return (
    <Canvas
      className="scene"
      dpr={[1, 1.75]}
      camera={{ position: [0, -0.2, 6.4], fov: 34, near: 0.1, far: 50 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl, camera }) => { gl.setClearColor("#02050b"); camera.lookAt(0, -0.55, 0); }}
    >
      <Avatar />
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur luminanceThreshold={0.28} luminanceSmoothing={0.35} intensity={0.85} radius={0.7} />
        <Noise opacity={0.035} />
        <Vignette eskil={false} offset={0.2} darkness={0.85} />
      </EffectComposer>
    </Canvas>
  );
}
