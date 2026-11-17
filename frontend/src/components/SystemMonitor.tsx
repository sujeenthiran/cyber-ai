import { useEffect, useRef, useState } from "react";
import { api, fmtBytes } from "../lib/api";

type Snap = { cpu: number; ram: number; ram_used: number; ram_total: number; disk: number; net_up: number; net_down: number; procs: number; cores: number[]; llm_running: { name: string; vram: number; size: number }[] };

function Spark({ data, color }: { data: number[]; color: string }) {
  const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * 100},${30 - (v / 100) * 28}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="spark">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      <polygon points={`0,30 ${pts} 100,30`} fill={color} opacity="0.12" />
    </svg>
  );
}

export function SystemMonitor() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const hist = useRef<{ cpu: number[]; ram: number[] }>({ cpu: [], ram: [] });
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await api<Snap>("/api/system");
        if (!alive) return;
        hist.current.cpu = [...hist.current.cpu, s.cpu].slice(-40);
        hist.current.ram = [...hist.current.ram, s.ram].slice(-40);
        setSnap(s);
      } catch { /* */ }
    };
    tick();
    const i = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(i); };
  }, []);
  const llm = snap?.llm_running?.[0];
  return (
    <section className="panel monitor">
      <div className="panel-title">Ressources système</div>
      <div className="mon-row">
        <div className="mon-label">CPU <b>{snap ? Math.round(snap.cpu) : "–"}%</b></div>
        <Spark data={hist.current.cpu} color="var(--cyan)" />
      </div>
      <div className="mon-row">
        <div className="mon-label">RAM <b>{snap ? Math.round(snap.ram) : "–"}%</b> <small>{snap ? `${fmtBytes(snap.ram_used)} / ${fmtBytes(snap.ram_total)}` : ""}</small></div>
        <Spark data={hist.current.ram} color="var(--blue)" />
      </div>
      <div className="mon-grid">
        <div><small>Disque</small><b>{snap?.disk != null ? `${Math.round(snap.disk)}%` : "–"}</b></div>
        <div><small>↓ Réseau</small><b>{snap ? `${fmtBytes(snap.net_down)}/s` : "–"}</b></div>
        <div><small>↑ Réseau</small><b>{snap ? `${fmtBytes(snap.net_up)}/s` : "–"}</b></div>
        <div><small>Processus</small><b>{snap?.procs ?? "–"}</b></div>
      </div>
      <div className="mon-cores">
        {snap?.cores.map((c, i) => <span key={i} style={{ height: `${Math.max(6, c)}%` }} title={`Cœur ${i + 1} : ${Math.round(c)}%`} />)}
      </div>
      <div className="mon-llm">
        {llm ? <>Modèle chargé : <b>{llm.name}</b> · VRAM {fmtBytes(llm.vram)}{llm.vram < llm.size ? <em> (en partie sur CPU)</em> : null}</> : "Aucun modèle chargé en mémoire"}
      </div>
    </section>
  );
}
