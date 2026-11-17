import { useEffect } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";

const STATUS_ICON: Record<string, string> = { ok: "✓", error: "✕", denied: "⊘", blocked: "⛔", info: "•" };

export function ActivityPanel({ limit = 30 }: { limit?: number }) {
  const activity = useStore((s) => s.activity);
  const set = useStore((s) => s.set);
  useEffect(() => {
    api("/api/activity?limit=50").then((a) => set({ activity: a })).catch(() => {});
  }, [set]);
  return (
    <section className="panel activity">
      <div className="panel-title">Activité de l'IA</div>
      <div className="act-list">
        {activity.length === 0 && <div className="muted">Aucune action pour l'instant.</div>}
        {activity.slice(0, limit).map((a, i) => (
          <div key={a.id ?? i} className={`act-item st-${a.status}`}>
            <span className="act-ic">{STATUS_ICON[a.status] || "•"}</span>
            <span className="act-title">{a.title}</span>
            <span className="act-time">{new Date(a.ts * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
