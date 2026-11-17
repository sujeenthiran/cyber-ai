import { useEffect, useState } from "react";
import { api, fmtBytes } from "../lib/api";
import { sendMessage } from "../lib/connection";
import { useStore } from "../lib/store";

export function FilesView() {
  const notify = useStore((s) => s.notify);
  const [roots, setRoots] = useState<string[]>([]);
  const [dir, setDir] = useState<any>(null);
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [analysis, setAnalysis] = useState<any>(null);

  const open = async (path: string) => {
    try { setDir(await api(`/api/files/list?path=${encodeURIComponent(path)}`)); setFile(null); setAnalysis(null); }
    catch (e: any) { notify(e.message, "error"); }
  };
  useEffect(() => {
    api<string[]>("/api/files/roots").then((r) => { setRoots(r); if (r[0]) open(r[0]); }).catch((e) => notify(e.message, "error"));
  }, []);

  const preview = async (path: string) => {
    setAnalysis(null);
    try { setFile(await api(`/api/files/read?path=${encodeURIComponent(path)}`)); }
    catch (e: any) { setFile(null); notify(e.message, "error"); }
  };

  return (
    <div className="page">
      <div className="page-head row-between">
        <div><h1>Fichiers</h1><p>Seuls les dossiers autorisés sont visibles par CYBER AI. Ajoutes-en dans Paramètres.</p></div>
        <div className="row">{roots.map((r) => <button key={r} className="btn ghost sm" onClick={() => open(r)}>{r.split(/[\\/]/).pop()}</button>)}</div>
      </div>
      <div className="files">
        <section className="panel file-list">
          <div className="panel-title path">{dir?.path}</div>
          <div className="fl-scroll">
            {dir?.parent && <div className="fl-item dir" onClick={() => open(dir.parent)}>↰ ..</div>}
            {dir?.items.length === 0 && <div className="muted">Dossier vide.</div>}
            {dir?.items.map((it: any) => (
              <div key={it.path} className={`fl-item ${it.type === "dossier" ? "dir" : ""} ${file?.path === it.path ? "sel" : ""}`}
                onClick={() => (it.type === "dossier" ? open(it.path) : preview(it.path))}>
                <span>{it.type === "dossier" ? "▸" : "·"} {it.nom}</span>
                <small>{it.taille != null ? fmtBytes(it.taille) : ""} {it.modifie}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="panel file-view">
          {!file && !analysis && <div className="muted center">Sélectionne un fichier pour l'aperçu.</div>}
          {(file || analysis) && (
            <>
              <div className="panel-title row-between">
                <span className="path">{file?.path || analysis?.fichier}</span>
                <div className="row">
                  <button className="btn ghost sm" onClick={() => api("/api/files/open", { body: { path: file?.path || analysis?.fichier } }).catch((e) => notify(e.message, "error"))}>Ouvrir</button>
                  <button className="btn ghost sm" onClick={async () => { try { setAnalysis(await api("/api/cyber/analyze-file", { body: { path: file?.path || analysis?.fichier } })); } catch (e: any) { notify(e.message, "error"); } }}>Analyser</button>
                  {file && <button className="btn primary sm" onClick={() => sendMessage(`Lis et explique-moi ce fichier : ${file.path}`)}>Demander à CYBER AI</button>}
                </div>
              </div>
              {analysis ? <pre className="file-content">{JSON.stringify(analysis, null, 2)}</pre> : <pre className="file-content">{file?.content}</pre>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
