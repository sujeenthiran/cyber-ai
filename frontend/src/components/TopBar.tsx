import { useEffect, useState } from "react";
import { useStore } from "../lib/store";

export const STATE_LABELS: Record<string, string> = {
  idle: "En veille", listening: "À l'écoute", thinking: "Réflexion", speaking: "Parole",
  executing: "Exécution", waiting: "Attend ton accord", offline: "Hors ligne",
};

export function TopBar() {
  const { aiState, connected, status, settings } = useStore();
  const [now, setNow] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i); }, []);
  const llmOk = status?.llm?.ok;
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" />
        <span className="brand-name" data-text="CYBER AI">CYBER AI</span>
        <span className="brand-ver">v{status?.version || "0.1"}</span>
      </div>
      <div className={`state-chip s-${aiState}`}>
        <span className="dot" />{STATE_LABELS[aiState]}
      </div>
      <div className="top-right">
        <span className={`pill ${llmOk ? "ok" : "bad"}`} title={status?.llm?.error || ""}>
          ◉ {settings?.model || "…"} {llmOk ? "" : "· moteur absent"}
        </span>
        <span className={`pill ${connected ? "ok" : "bad"}`}>{connected ? "Liaison sécurisée" : "Déconnecté"}</span>
        {settings?.offline_mode && <span className="pill ok">Hors ligne</span>}
        <span className="clock">{now.toLocaleTimeString("fr-FR")}</span>
      </div>
    </header>
  );
}
