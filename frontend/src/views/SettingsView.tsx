import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { refreshStatus } from "../lib/connection";
import { useStore } from "../lib/store";

function ListEditor({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [add, setAdd] = useState("");
  return (
    <div className="list-editor">
      {value.map((v, i) => (
        <div key={i} className="le-item"><code>{v}</code><button className="x" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button></div>
      ))}
      <div className="row">
        <input value={add} placeholder={placeholder} onChange={(e) => setAdd(e.target.value)} />
        <button className="btn ghost sm" disabled={!add.trim()} onClick={() => { onChange([...value, add.trim()]); setAdd(""); }}>Ajouter</button>
      </div>
    </div>
  );
}

export function SettingsView() {
  const { settings, set, notify } = useStore();
  const [draft, setDraft] = useState<any>(settings);
  useEffect(() => { setDraft(settings); }, [settings]);
  if (!draft) return null;
  const up = (k: string, v: any) => setDraft({ ...draft, [k]: v });
  const save = async () => {
    try {
      const { voices, ...rest } = draft;
      const s = await api("/api/settings", { method: "PUT", body: rest });
      set({ settings: s });
      refreshStatus();
      notify("Paramètres enregistrés", "ok");
    } catch (e: any) { notify(e.message, "error"); }
  };
  const testVoice = async () => {
    try {
      const blob = await api<Blob>("/api/tts", { body: { text: `Bonjour${draft.user_name ? " " + draft.user_name : ""}, je suis CYBER AI. Ma voix fonctionne en local.` } });
      new Audio(URL.createObjectURL(blob)).play();
    } catch (e: any) { notify(e.message, "error"); }
  };
  return (
    <div className="page">
      <div className="page-head row-between">
        <div><h1>Paramètres</h1><p>Tout reste sur ce PC. Enregistre pour appliquer.</p></div>
        <button className="btn primary" onClick={save}>Enregistrer</button>
      </div>
      <div className="grid-2">
        <section className="panel form">
          <div className="panel-title">Identité</div>
          <label className="field"><span>Ton prénom</span><input value={draft.user_name} onChange={(e) => up("user_name", e.target.value)} /></label>
          <label className="field"><span>Consignes personnelles pour CYBER AI</span>
            <textarea rows={4} value={draft.persona_extra} placeholder="Ex : sois plus détaillée sur Linux, rappelle-moi de sauvegarder pfSense…" onChange={(e) => up("persona_extra", e.target.value)} /></label>
          <div className="panel-title">Cerveau</div>
          <label className="field"><span>Moteur</span>
            <select value={draft.provider} onChange={(e) => up("provider", e.target.value)}>
              <option value="ollama">Ollama</option><option value="openai">Compatible OpenAI local (LM Studio, llama.cpp)</option>
            </select></label>
          {draft.provider === "ollama"
            ? <label className="field"><span>Adresse Ollama</span><input value={draft.ollama_url} onChange={(e) => up("ollama_url", e.target.value)} /></label>
            : <label className="field"><span>Adresse API locale</span><input value={draft.openai_url} onChange={(e) => up("openai_url", e.target.value)} /></label>}
          <label className="field"><span>Modèle de conversation</span><input value={draft.model} onChange={(e) => up("model", e.target.value)} /></label>
          <label className="field"><span>Modèle de mémoire (embeddings)</span><input value={draft.embed_model} onChange={(e) => up("embed_model", e.target.value)} /></label>
          <label className="field"><span>Créativité <b>{draft.temperature}</b></span><input type="range" min={0} max={1.2} step={0.1} value={draft.temperature} onChange={(e) => up("temperature", +e.target.value)} /></label>
          <label className="field"><span>Contexte (tokens)</span>
            <select value={draft.num_ctx} onChange={(e) => up("num_ctx", +e.target.value)}>{[4096, 8192, 12288, 16384].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label className="field"><span>Messages d'historique envoyés</span><input type="number" min={2} max={60} value={draft.history_messages} onChange={(e) => up("history_messages", +e.target.value)} /></label>
        </section>
        <section className="panel form">
          <div className="panel-title">Voix</div>
          <label className="toggle"><input type="checkbox" checked={draft.tts_enabled} onChange={(e) => up("tts_enabled", e.target.checked)} /><span>Synthèse vocale Piper</span></label>
          <label className="field"><span>Voix</span>
            <div className="row">
              <select value={draft.tts_voice} onChange={(e) => up("tts_voice", e.target.value)}>
                {(draft.voices?.length ? draft.voices : [draft.tts_voice]).map((v: string) => <option key={v}>{v}</option>)}
              </select>
              <button className="btn ghost sm" onClick={testVoice}>Tester</button>
            </div></label>
          <label className="field"><span>Vitesse <b>{draft.tts_speed}</b></span><input type="range" min={0.7} max={1.5} step={0.05} value={draft.tts_speed} onChange={(e) => up("tts_speed", +e.target.value)} /></label>
          <label className="field"><span>Reconnaissance vocale (Whisper)</span>
            <select value={draft.stt_model} onChange={(e) => up("stt_model", e.target.value)}>
              <option value="base">base (rapide)</option><option value="small">small (recommandé)</option><option value="medium">medium (précis, plus lent)</option>
            </select></label>
          <label className="field"><span>Sensibilité du micro <b>{draft.vad_threshold}</b> (plus petit = plus sensible)</span>
            <input type="range" min={0.005} max={0.08} step={0.005} value={draft.vad_threshold} onChange={(e) => up("vad_threshold", +e.target.value)} /></label>
          <label className="field"><span>Silence de fin de phrase <b>{draft.vad_silence_ms} ms</b></span>
            <input type="range" min={500} max={2000} step={100} value={draft.vad_silence_ms} onChange={(e) => up("vad_silence_ms", +e.target.value)} /></label>
          <div className="panel-title">Sécurité</div>
          <label className="toggle"><input type="checkbox" checked={draft.offline_mode} onChange={(e) => up("offline_mode", e.target.checked)} /><span>Mode hors ligne (aucun accès Internet par l'IA)</span></label>
          <label className="field"><span>Dossiers autorisés</span>
            <ListEditor value={draft.allowed_roots} onChange={(v) => up("allowed_roots", v)} placeholder="C:\Users\toi\Documents\Projets" /></label>
          <label className="field"><span>Cibles réseau autorisées (IP ou CIDR que tu as le droit de tester)</span>
            <ListEditor value={draft.authorized_targets} onChange={(v) => up("authorized_targets", v)} placeholder="192.168.50.0/24" /></label>
          <label className="field"><span>Délai max d'une commande (s)</span><input type="number" min={10} max={1800} value={draft.command_timeout} onChange={(e) => up("command_timeout", +e.target.value)} /></label>
        </section>
      </div>
    </div>
  );
}
