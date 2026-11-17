import { useEffect, useState } from "react";
import { api, apiStream, fmtBytes } from "../lib/api";
import { refreshStatus } from "../lib/connection";
import { useStore } from "../lib/store";

const SUGGESTED = [
  { name: "qwen3:8b", desc: "Recommandé · excellent français et outils · 5,2 Go" },
  { name: "nomic-embed-text", desc: "Mémoire sémantique (obligatoire pour la recherche par sens) · 270 Mo" },
  { name: "llama3.1:8b", desc: "Généraliste solide, bons outils · 4,9 Go" },
  { name: "qwen2.5-coder:7b", desc: "Spécialiste du code · 4,7 Go" },
  { name: "mistral-nemo", desc: "Très bon français, contexte long · 7,1 Go" },
  { name: "qwen3:4b", desc: "Plus léger et rapide · 2,6 Go" },
];

export function ModelsView() {
  const { settings, set, notify, status } = useStore();
  const [data, setData] = useState<any>(null);
  const [pull, setPull] = useState("");
  const [progress, setProgress] = useState<{ name: string; status: string; pct: number } | null>(null);

  const load = async () => {
    try { setData(await api("/api/models")); } catch (e: any) { setData(null); notify(e.message, "error"); }
  };
  useEffect(() => { load(); }, []);

  const activate = async (name: string) => {
    const s = await api("/api/settings", { method: "PUT", body: { model: name } });
    set({ settings: s }); refreshStatus(); notify(`Modèle actif : ${name}`, "ok");
  };
  const doPull = async (name: string) => {
    setProgress({ name, status: "démarrage", pct: 0 });
    try {
      await apiStream("/api/models/pull", { name }, (o) => {
        if (o.error) throw new Error(o.error);
        setProgress({ name, status: o.status, pct: o.total ? Math.round((o.completed / o.total) * 100) : 0 });
      });
      notify(`${name} installé`, "ok");
      load(); refreshStatus();
    } catch (e: any) { notify(e.message, "error"); }
    setProgress(null);
  };
  const installed = new Set((data?.models || []).map((m: any) => m.name.replace(/:latest$/, "")));
  const loaded = new Set((data?.running || []).map((m: any) => m.name));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Modèles IA</h1>
        <p>Moteur : {settings?.provider === "ollama" ? "Ollama" : "API locale compatible OpenAI"} · {status?.llm?.ok ? `connecté (${status.llm.version})` : status?.llm?.error || "…"}</p>
      </div>
      <div className="grid-2">
        <section className="panel">
          <div className="panel-title">Installés</div>
          {!data && <div className="muted">Moteur injoignable. Lance Ollama puis rafraîchis.</div>}
          {data?.models.map((m: any) => (
            <div key={m.name} className={`model-item ${settings?.model === m.name ? "active" : ""}`}>
              <div>
                <b>{m.name}</b> {loaded.has(m.name) && <span className="badge">en mémoire</span>} {settings?.model === m.name && <span className="badge on">actif</span>}
                <small>{[m.params, m.quant, m.size ? fmtBytes(m.size) : ""].filter(Boolean).join(" · ")}</small>
              </div>
              <div className="row">
                {!m.name.includes("embed") && settings?.model !== m.name && <button className="btn ghost sm" onClick={() => activate(m.name)}>Activer</button>}
                <button className="btn danger sm" onClick={async () => { if (confirmDelete(m.name)) { await api(`/api/models/${encodeURIComponent(m.name)}`, { method: "DELETE" }).catch((e) => notify(e.message, "error")); load(); } }}>Supprimer</button>
              </div>
            </div>
          ))}
          <button className="btn ghost sm" onClick={load}>Rafraîchir</button>
        </section>
        <section className="panel">
          <div className="panel-title">Télécharger un modèle</div>
          {settings?.offline_mode && <div className="warn">Mode hors ligne actif : désactive-le dans Paramètres le temps du téléchargement, puis réactive-le.</div>}
          {SUGGESTED.map((s) => (
            <div key={s.name} className="model-item">
              <div><b>{s.name}</b><small>{s.desc}</small></div>
              {installed.has(s.name) ? <span className="badge on">installé</span> :
                <button className="btn primary sm" disabled={!!progress || settings?.offline_mode} onClick={() => doPull(s.name)}>Installer</button>}
            </div>
          ))}
          <div className="row">
            <input placeholder="Autre modèle (ex. deepseek-r1:8b)" value={pull} onChange={(e) => setPull(e.target.value)} />
            <button className="btn primary" disabled={!pull || !!progress || settings?.offline_mode} onClick={() => doPull(pull)}>Installer</button>
          </div>
          {progress && (
            <div className="progress">
              <div className="row-between"><span>{progress.name} · {progress.status}</span><b>{progress.pct}%</b></div>
              <div className="gauge-bar"><span style={{ width: `${progress.pct}%` }} /></div>
            </div>
          )}
          <p className="muted small">Avec ta RX 6600 (8 Go), vise des modèles de 7 à 8 milliards de paramètres en Q4 : ils tiennent entièrement dans la carte graphique.</p>
        </section>
      </div>
    </div>
  );
}

function confirmDelete(name: string) {
  // fenêtre native volontairement simple pour une action irréversible
  return window.confirm(`Supprimer définitivement le modèle ${name} ?`);
}
