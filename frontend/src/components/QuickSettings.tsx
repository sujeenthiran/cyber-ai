import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { refreshStatus } from "../lib/connection";
import { useStore } from "../lib/store";

export function QuickSettings() {
  const { settings, set, notify } = useStore();
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => {
    api("/api/models").then((r) => setModels(r.models.map((m: any) => m.name))).catch(() => setModels([]));
  }, [settings?.provider]);
  if (!settings) return null;
  const save = async (patch: any) => {
    try {
      const s = await api("/api/settings", { method: "PUT", body: patch });
      set({ settings: s });
      refreshStatus();
    } catch (e: any) { notify(e.message, "error"); }
  };
  return (
    <section className="panel quick">
      <div className="panel-title">Configuration rapide</div>
      <label className="field">
        <span>Modèle</span>
        <select value={settings.model} onChange={(e) => save({ model: e.target.value })}>
          {!models.includes(settings.model) && <option value={settings.model}>{settings.model} (non installé)</option>}
          {models.filter((m) => !m.includes("embed")).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Créativité <b>{settings.temperature.toFixed(1)}</b></span>
        <input type="range" min={0} max={1.2} step={0.1} value={settings.temperature} onChange={(e) => save({ temperature: parseFloat(e.target.value) })} />
      </label>
      <div className="toggles">
        <label className="toggle"><input type="checkbox" checked={settings.tts_enabled} onChange={(e) => save({ tts_enabled: e.target.checked })} /><span>Voix Piper</span></label>
        <label className="toggle"><input type="checkbox" checked={settings.offline_mode} onChange={(e) => save({ offline_mode: e.target.checked })} /><span>Hors ligne</span></label>
      </div>
    </section>
  );
}
