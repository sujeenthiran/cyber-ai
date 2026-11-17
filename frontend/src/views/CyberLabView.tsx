import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { sendMessage } from "../lib/connection";
import { useStore } from "../lib/store";
import { LocalConfirm } from "../components/ConfirmModal";

const INSTALL: Record<string, string> = {
  nmap: "nmap.org/download", tshark: "wireshark.org (inclus)", wireshark: "wireshark.org", yara: "github.com/VirusTotal/yara/releases",
  semgrep: "pip install semgrep", docker: "docker.com", zap: "zaproxy.org", python: "python.org", git: "git-scm.com",
};

function RiskGauge({ score, level }: { score: number; level: string }) {
  const pct = Math.min(100, (score / 12) * 100);
  return (
    <div className={`gauge lvl-${level}`}>
      <div className="gauge-bar"><span style={{ width: `${pct}%` }} /></div>
      <div className="gauge-label">Risque <b>{level}</b> · score {score}</div>
    </div>
  );
}

export function CyberLabView() {
  const notify = useStore((s) => s.notify);
  const [tools, setTools] = useState<any>(null);
  const [filePath, setFilePath] = useState("");
  const [fileRes, setFileRes] = useState<any>(null);
  const [logPath, setLogPath] = useState("");
  const [logRes, setLogRes] = useState<any>(null);
  const [target, setTarget] = useState("");
  const [profile, setProfile] = useState("decouverte");
  const [scan, setScan] = useState<any>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    api("/api/cyber/tools").then((t) => { setTools(t); setTarget(t.authorized_targets[t.authorized_targets.length - 1] || ""); }).catch((e) => notify(e.message, "error"));
  }, [notify]);

  const run = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind);
    try { await fn(); } catch (e: any) { notify(e.message, "error"); } finally { setBusy(""); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Cyber Lab</h1>
        <p>Analyses de sécurité locales. Les scans réseau sont limités à tes cibles autorisées et demandent toujours ta validation.</p>
      </div>
      <div className="grid-2">
        <section className="panel">
          <div className="panel-title">Arsenal installé</div>
          <div className="tool-grid">
            {tools && Object.entries(tools.installed).map(([name, path]) => (
              <div key={name} className={`tool-card ${path ? "on" : "off"}`} title={(path as string) || `Installer : ${INSTALL[name]}`}>
                <b>{name}</b><small>{path ? "installé" : INSTALL[name]}</small>
              </div>
            ))}
          </div>
          <div className="muted small">Cibles autorisées : {tools?.authorized_targets.join(", ")} (modifiables dans Paramètres)</div>
        </section>

        <section className="panel">
          <div className="panel-title">Analyse de fichier suspect (statique, sans exécution)</div>
          <div className="row">
            <input placeholder="Chemin du fichier (dans un dossier autorisé)" value={filePath} onChange={(e) => setFilePath(e.target.value)} />
            <button className="btn primary" disabled={!filePath || busy === "file"} onClick={() => run("file", async () => setFileRes(await api("/api/cyber/analyze-file", { body: { path: filePath } })))}>
              {busy === "file" ? "Analyse…" : "Analyser"}
            </button>
          </div>
          {fileRes && (
            <div className="result">
              <RiskGauge score={fileRes.score_risque} level={fileRes.niveau} />
              <div className="kv"><span>Type réel</span><b>{fileRes.type_reel}</b></div>
              <div className="kv"><span>Entropie</span><b>{fileRes.entropie}</b></div>
              <div className="kv"><span>SHA256</span><code className="wrap">{fileRes.sha256}</code></div>
              {fileRes.raisons.length > 0 && <ul className="reasons">{fileRes.raisons.map((r: string) => <li key={r}>{r}</li>)}</ul>}
              {Object.keys(fileRes.indicateurs).length > 0 && (
                <details><summary>Indicateurs ({Object.keys(fileRes.indicateurs).length})</summary>
                  <pre>{JSON.stringify(fileRes.indicateurs, null, 1)}</pre></details>
              )}
              <button className="btn ghost sm" onClick={() => sendMessage(`Voici l'analyse statique d'un fichier. Explique-moi les risques et quoi faire :\n\`\`\`json\n${JSON.stringify(fileRes, null, 1).slice(0, 5000)}\n\`\`\``)}>Demander à CYBER AI</button>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-title">Analyse de logs</div>
          <div className="row">
            <input placeholder="Chemin du fichier de log (auth.log, access.log, export Windows…)" value={logPath} onChange={(e) => setLogPath(e.target.value)} />
            <button className="btn primary" disabled={!logPath || busy === "log"} onClick={() => run("log", async () => setLogRes(await api("/api/cyber/analyze-log", { body: { path: logPath } })))}>
              {busy === "log" ? "Analyse…" : "Analyser"}
            </button>
          </div>
          {logRes && (
            <div className="result">
              <div className="kv"><span>Lignes</span><b>{logRes.lignes_analysees}</b></div>
              {logRes.alertes.length === 0 ? <div className="ok-text">Aucune alerte majeure détectée.</div> :
                <div className="alerts">{logRes.alertes.map((a: any) => <div key={a.type} className={`alert sev-${a.gravite}`}><b>{a.type}</b> × {a.occurrences} <span>{a.gravite}</span></div>)}</div>}
              <div className="kv"><span>IP les plus actives</span><code>{logRes.ip_les_plus_actives.slice(0, 5).map((x: any) => `${x[0]} (${x[1]})`).join(", ") || "—"}</code></div>
              <button className="btn ghost sm" onClick={() => sendMessage(`Analyse ces résultats de logs et dis-moi s'il y a une attaque et quoi faire :\n\`\`\`json\n${JSON.stringify(logRes, null, 1).slice(0, 5000)}\n\`\`\``)}>Demander à CYBER AI</button>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-title">Scan réseau Nmap (cibles autorisées)</div>
          {!tools?.installed?.nmap ? <div className="muted">Nmap n'est pas installé. Télécharge-le sur nmap.org puis relance CYBER AI.</div> : (
            <>
              <div className="row">
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  {tools.authorized_targets.map((t: string) => <option key={t}>{t}</option>)}
                </select>
                <select value={profile} onChange={(e) => setProfile(e.target.value)}>
                  {Object.entries(tools.nmap_profiles).map(([k, v]) => <option key={k} value={k}>{k} : {v as string}</option>)}
                </select>
                <button className="btn primary" disabled={busy === "nmap"} onClick={() => setConfirm(true)}>{busy === "nmap" ? "Scan…" : "Scanner"}</button>
              </div>
              {scan && <pre className="term-out">{scan.stdout || scan.stderr}</pre>}
              {scan && <button className="btn ghost sm" onClick={() => sendMessage(`Interprète ce résultat Nmap et propose des actions de durcissement :\n\`\`\`\n${(scan.stdout || "").slice(0, 5000)}\n\`\`\``)}>Demander à CYBER AI</button>}
            </>
          )}
        </section>
      </div>
      <LocalConfirm
        open={confirm}
        title="nmap_scan"
        command={`nmap (profil ${profile}) ${target}`}
        consequences={`${tools?.nmap_profiles?.[profile] || ""} Le scan génère du trafic visible sur ton réseau. Tu confirmes avoir le droit de scanner ${target}.`}
        onAnswer={(ok) => {
          setConfirm(false);
          if (ok) run("nmap", async () => setScan(await api("/api/cyber/nmap", { body: { target, profile } })));
        }}
      />
    </div>
  );
}
