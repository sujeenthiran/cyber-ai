import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { loadConversation } from "../lib/connection";
import { useStore } from "../lib/store";

const CATS = ["profil", "preference", "projet", "connaissance", "conversation", "general"];

export function MemoryView() {
  const notify = useStore((s) => s.notify);
  const [mems, setMems] = useState<any[]>([]);
  const [convs, setConvs] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [content, setContent] = useState("");
  const [newCat, setNewCat] = useState("profil");
  const [imp, setImp] = useState(3);

  const load = async () => {
    try {
      setMems(await api(`/api/memories?q=${encodeURIComponent(q)}&category=${cat}`));
      setConvs(await api("/api/conversations"));
    } catch (e: any) { notify(e.message, "error"); }
  };
  useEffect(() => { load(); }, [cat]);

  return (
    <div className="page">
      <div className="page-head row-between">
        <div><h1>Mémoire</h1><p>Tout est stocké en local (SQLite). La recherche combine mots-clés et sens (vecteurs nomic-embed-text).</p></div>
        <button className="btn ghost" onClick={async () => { const r = await api("/api/memories/reindex", { method: "POST" }); notify(`${r.indexed} souvenir(s) vectorisé(s)`, "ok"); load(); }}>Recalculer les vecteurs</button>
      </div>
      <div className="grid-2 mem">
        <section className="panel">
          <div className="panel-title">Souvenirs ({mems.length})</div>
          <div className="row">
            <input placeholder="Rechercher par sens : « mon réseau », « mes projets »…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
            <button className="btn primary" onClick={load}>Chercher</button>
          </div>
          <div className="chips">
            <button className={!cat ? "on" : ""} onClick={() => setCat("")}>Tous</button>
            {CATS.map((c) => <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c}</button>)}
          </div>
          <div className="mem-list">
            {mems.length === 0 && <div className="muted">Aucun souvenir. Dis par exemple à CYBER AI : « Retiens que je m'appelle … ».</div>}
            {mems.map((m) => (
              <div key={m.id} className="mem-item">
                <span className={`mem-cat c-${m.category}`}>{m.category}</span>
                <span className="mem-text">{m.content}</span>
                <span className="mem-imp">{"★".repeat(m.importance)}</span>
                {m.vector ? <span className="mem-vec" title="Vectorisé">◈</span> : null}
                <button className="x" title="Oublier" onClick={async () => { await api(`/api/memories/${m.id}`, { method: "DELETE" }); load(); }}>✕</button>
              </div>
            ))}
          </div>
          <div className="mem-add">
            <input placeholder="Ajouter un souvenir manuellement…" value={content} onChange={(e) => setContent(e.target.value)} />
            <select value={newCat} onChange={(e) => setNewCat(e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
            <select value={imp} onChange={(e) => setImp(+e.target.value)}>{[1, 2, 3, 4, 5].map((i) => <option key={i} value={i}>{"★".repeat(i)}</option>)}</select>
            <button className="btn primary" disabled={!content.trim()} onClick={async () => { await api("/api/memories", { body: { content, category: newCat, importance: imp } }); setContent(""); load(); }}>Ajouter</button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">Historique des conversations ({convs.length})</div>
          <div className="mem-list">
            {convs.map((c) => (
              <div key={c.id} className="conv-item" onClick={() => loadConversation(c.id, c.title)}>
                <span className="conv-title">{c.title}</span>
                <small>{c.count} msg · {new Date(c.updated * 1000).toLocaleString("fr-FR")}</small>
                <button className="x" title="Supprimer" onClick={async (e) => { e.stopPropagation(); await api(`/api/conversations/${c.id}`, { method: "DELETE" }); load(); }}>✕</button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
