import { useEffect } from "react";
import { Scene } from "./avatar/Scene";
import { connect, interrupt } from "./lib/connection";
import { useStore } from "./lib/store";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { ConfirmModal } from "./components/ConfirmModal";
import { Toast } from "./components/Toast";
import { AssistantView } from "./views/AssistantView";
import { CyberLabView } from "./views/CyberLabView";
import { TerminalView } from "./views/TerminalView";
import { FilesView } from "./views/FilesView";
import { MemoryView } from "./views/MemoryView";
import { SettingsView } from "./views/SettingsView";
import { ModelsView } from "./views/ModelsView";
import { TOKEN } from "./lib/api";

export function App() {
  const view = useStore((s) => s.view);
  const aiState = useStore((s) => s.aiState);
  useEffect(() => {
    const colors: Record<string, string> = { idle: "#00e5ff", listening: "#35ffc2", thinking: "#8a7bff", speaking: "#22d3ff", executing: "#ffb340", waiting: "#ffd23f", offline: "#ff4466" };
    document.documentElement.style.setProperty("--state-color", colors[aiState] || "#00e5ff");
  }, [aiState]);
  useEffect(() => {
    if (TOKEN) connect();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !useStore.getState().confirms.length) interrupt();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!TOKEN) {
    return (
      <div className="no-token">
        <div className="panel">
          <h1>CYBER AI</h1>
          <p>Ouvre CYBER AI avec son raccourci <b>CyberAI.bat</b> : il crée une session sécurisée.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`app view-${view}`}>
      <Scene />
      <div className="hud-grid" />
      <TopBar />
      <Sidebar />
      <main className="main">
        {view === "assistant" && <AssistantView />}
        {view === "lab" && <CyberLabView />}
        {view === "terminal" && <TerminalView />}
        {view === "files" && <FilesView />}
        {view === "memory" && <MemoryView />}
        {view === "settings" && <SettingsView />}
        {view === "models" && <ModelsView />}
      </main>
      <ConfirmModal />
      <Toast />
    </div>
  );
}
