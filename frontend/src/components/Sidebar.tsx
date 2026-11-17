import { useStore, type View } from "../lib/store";
import { Icon } from "./Icons";

const ITEMS: { id: View; label: string; icon: () => JSX.Element }[] = [
  { id: "assistant", label: "Assistant", icon: Icon.assistant },
  { id: "lab", label: "Cyber Lab", icon: Icon.lab },
  { id: "terminal", label: "Terminal", icon: Icon.terminal },
  { id: "files", label: "Fichiers", icon: Icon.files },
  { id: "memory", label: "Mémoire", icon: Icon.memory },
  { id: "models", label: "Modèles IA", icon: Icon.models },
  { id: "settings", label: "Paramètres", icon: Icon.settings },
];

export function Sidebar() {
  const view = useStore((s) => s.view);
  const set = useStore((s) => s.set);
  return (
    <nav className="sidebar">
      {ITEMS.map((it) => (
        <button key={it.id} className={`nav-item ${view === it.id ? "active" : ""}`} onClick={() => set({ view: it.id })} title={it.label}>
          <span className="nav-icon"><it.icon /></span>
          <span className="nav-label">{it.label}</span>
        </button>
      ))}
      <div className="sidebar-foot">LOCAL · HORS LIGNE</div>
    </nav>
  );
}
