import { useEffect, useRef } from "react";
import { live } from "../lib/live";

// Visualiseur audio circulaire/linéaire : voix de l'IA, micro, ou respiration au repos.
export function AudioViz({ height = 56 }: { height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const smooth = new Float32Array(48);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const t = performance.now() / 1000;
      const active = live.state === "speaking" || live.state === "listening";
      const color = getComputedStyle(document.documentElement).getPropertyValue("--state-color").trim() || "#00e5ff";
      const n = smooth.length;
      const bw = w / n;
      for (let i = 0; i < n; i++) {
        const mirror = Math.abs(i - n / 2) / (n / 2);
        const raw = active ? live.spectrum[Math.floor((1 - mirror) * 40)] / 255 : 0.06 + 0.05 * Math.sin(t * 2 + i * 0.4);
        smooth[i] += (raw - smooth[i]) * 0.3;
        const bh = Math.max(2, smooth[i] * h * 0.95);
        const x = i * bw + bw * 0.25;
        const grad = g.createLinearGradient(0, h / 2 - bh / 2, 0, h / 2 + bh / 2);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(0.5, color);
        grad.addColorStop(1, "transparent");
        g.fillStyle = grad;
        g.globalAlpha = 0.35 + smooth[i] * 0.8;
        g.fillRect(x, h / 2 - bh / 2, bw * 0.5, bh);
      }
      g.globalAlpha = 1;
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="audioviz" style={{ height }} />;
}
