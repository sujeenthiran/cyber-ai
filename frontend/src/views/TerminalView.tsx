import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { sendMessage } from "../lib/connection";

type Line = { kind: "cmd" | "out" | "err" | "info"; text: string };

export function TerminalView() {
  const [lines, setLines] = useState<Line[]>([{ kind: "info", text: "Terminal CYBER AI : tes commandes s'exécutent sur ce PC (dossier de travail CyberAI_Workspace). Les commandes destructrices sont bloquées." }]);
  const [cmd, setCmd] = useState("");
  const [shell, setShell] = useState("powershell");
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [lines]);

  const run = async () => {
    const c = cmd.trim();
    if (!c || busy) return;
    setCmd(""); setHist([c, ...hist].slice(0, 100)); setHi(-1);
    setLines((l) => [...l, { kind: "cmd", text: c }]);
    if (c === "clear" || c === "cls") { setLines([]); return; }
    setBusy(true);
    try {
      const r = await api("/api/terminal", { body: { command: c, shell } });
      setLines((l) => [...l, ...(r.stdout ? [{ kind: "out" as const, text: r.stdout }] : []), ...(r.stderr ? [{ kind: "err" as const, text: r.stderr }] : []),
        { kind: "info", text: `code ${r.code} · ${r.duration}s` }]);
    } catch (e: any) {
      setLines((l) => [...l, { kind: "err", text: e.message }]);
    } finally { setBusy(false); }
  };

  const last = [...lines].reverse().find((l) => l.kind === "out" || l.kind === "err");
  return (
    <div className="page">
      <div className="page-head row-between">
        <div><h1>Terminal</h1><p>Exécution directe et journalisée. Pour une commande proposée par l'IA, la validation se fait dans l'Assistant.</p></div>
        <div className="row">
          <select value={shell} onChange={(e) => setShell(e.target.value)}><option value="powershell">PowerShell</option><option value="cmd">cmd</option></select>
          <button className="btn ghost" disabled={!last} onClick={() => last && sendMessage(`Explique-moi cette sortie de terminal :\n\`\`\`\n${last.text.slice(0, 5000)}\n\`\`\``)}>Expliquer la sortie</button>
        </div>
      </div>
      <section className="panel terminal">
        <div className="term-scroll">
          {lines.map((l, i) => (
            <pre key={i} className={`term-${l.kind}`}>{l.kind === "cmd" ? `${shell === "cmd" ? ">" : "PS>"} ${l.text}` : l.text}</pre>
          ))}
          {busy && <pre className="term-info">… exécution</pre>}
          <div ref={end} />
        </div>
        <div className="term-input">
          <span className="prompt">{shell === "cmd" ? ">" : "PS>"}</span>
          <input autoFocus value={cmd} disabled={busy} spellCheck={false} onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") run();
              if (e.key === "ArrowUp" && hist.length) { const n = Math.min(hist.length - 1, hi + 1); setHi(n); setCmd(hist[n]); e.preventDefault(); }
              if (e.key === "ArrowDown") { const n = hi - 1; setHi(n); setCmd(n >= 0 ? hist[n] : ""); e.preventDefault(); }
            }} placeholder="Get-NetTCPConnection -State Listen" />
        </div>
      </section>
    </div>
  );
}
