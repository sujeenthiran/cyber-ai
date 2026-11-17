import { ActivityPanel } from "../components/ActivityPanel";
import { ChatPanel } from "../components/ChatPanel";
import { MicButton } from "../components/MicButton";
import { QuickSettings } from "../components/QuickSettings";
import { SystemMonitor } from "../components/SystemMonitor";
import { useStore } from "../lib/store";

function SetupBanner() {
  const status = useStore((s) => s.status);
  const set = useStore((s) => s.set);
  if (!status) return null;
  const issues: string[] = [];
  if (!status.llm?.ok) issues.push("Le moteur Ollama ne répond pas : lance l'application Ollama.");
  else if (!status.model_installed) issues.push(`Le modèle ${status.model} n'est pas installé.`);
  if (!status.tts?.ok) issues.push("Voix Piper absente : la voix de Windows sera utilisée.");
  if (!issues.length) return null;
  return (
    <div className="setup-banner" onClick={() => set({ view: "models" })}>
      {issues.map((i) => <div key={i}>⚠ {i}</div>)}
    </div>
  );
}

export function AssistantView() {
  return (
    <div className="assistant">
      <aside className="col-left">
        <SystemMonitor />
        <ActivityPanel />
        <QuickSettings />
      </aside>
      <div className="col-center">
        <SetupBanner />
        <div className="center-spacer" />
        <MicButton />
      </div>
      <aside className="col-right">
        <ChatPanel />
      </aside>
    </div>
  );
}
