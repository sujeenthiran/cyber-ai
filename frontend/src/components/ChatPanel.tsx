import { useEffect, useRef, useState } from "react";
import { Markdown } from "../lib/markdown";
import { interrupt, newConversation, sendMessage } from "../lib/connection";
import { useStore, type ToolEvent } from "../lib/store";
import { mic } from "../audio/mic";
import { speech } from "../audio/speech";
import { Icon } from "./Icons";

const TOOL_STATUS: Record<string, string> = {
  running: "en cours", waiting: "attend ton accord", ok: "terminé", error: "erreur", denied: "refusé", blocked: "bloqué",
};

function ToolChip({ t }: { t: ToolEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tool-chip ts-${t.status}`} onClick={() => setOpen(!open)}>
      <div className="tool-chip-head">
        <span className="tool-dot" />
        <span className="tool-name">{t.name}</span>
        <span className="tool-status">{TOOL_STATUS[t.status] || t.status}</span>
      </div>
      {open && (
        <div className="tool-chip-body">
          <code>{t.command}</code>
          {t.summary && <pre>{t.summary}</pre>}
        </div>
      )}
    </div>
  );
}

const SUGGESTIONS = [
  "Présente-toi en quelques phrases",
  "Quel est l'état de mon PC ?",
  "Explique-moi l'OWASP Top 10 simplement",
  "Quels ports écoutent sur ma machine ?",
];

export function ChatPanel() {
  const { messages, aiState, conversationTitle } = useStore();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);
  return (
    <section className="panel chat">
      <div className="panel-title chat-title">
        <span>{conversationTitle || "Nouvelle conversation"}</span>
        <button className="btn ghost sm" onClick={newConversation} title="Nouvelle conversation"><Icon.plus /> Nouvelle</button>
      </div>
      <div className="chat-scroll">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-title">Je t'écoute.</div>
            <p>Parle-moi avec le micro ou écris ci-dessous. Je peux analyser, expliquer et agir sur ton PC, toujours avec ton accord.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => sendMessage(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role} ${m.error ? "msg-error" : ""}`}>
            {m.role === "assistant" && <div className="msg-who">CYBER AI</div>}
            {m.memory && m.memory.length > 0 && <div className="msg-memory" title={m.memory.join("\n")}>◈ {m.memory.length} souvenir(s) utilisé(s)</div>}
            {m.tools.length > 0 && <div className="msg-tools">{m.tools.map((t) => <ToolChip key={t.id} t={t} />)}</div>}
            {m.text ? <Markdown text={m.text} /> : m.pending ? <div className="typing"><span /><span /><span /></div> : null}
            {m.stats?.seconds != null && <div className="msg-stats">{m.stats.seconds}s{m.stats.tok_s ? ` · ${m.stats.tok_s} tok/s` : ""}</div>}
          </div>
        ))}
        <div ref={end} />
      </div>
      <Composer busy={aiState === "thinking" || aiState === "executing" || aiState === "speaking" || aiState === "waiting"} />
    </section>
  );
}

function Composer({ busy }: { busy: boolean }) {
  const [text, setText] = useState("");
  const { micActive, handsFree, voiceOut, transcribing, set } = useStore();
  const submit = () => {
    if (!text.trim()) return;
    sendMessage(text);
    setText("");
  };
  return (
    <div className="composer">
      <textarea
        value={text}
        placeholder={transcribing ? "Transcription en cours…" : "Écris à CYBER AI…  (Entrée pour envoyer)"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        rows={2}
      />
      <div className="composer-actions">
        <button className={`icon-btn ${voiceOut ? "on" : ""}`} title={voiceOut ? "Voix activée" : "Voix coupée"}
          onClick={() => { if (voiceOut) speech.stop(); set({ voiceOut: !voiceOut }); }}>
          {voiceOut ? <Icon.speaker /> : <Icon.mute />}
        </button>
        <button className={`icon-btn ${handsFree && micActive ? "on" : ""}`} title="Mode mains libres (écoute continue)"
          onClick={() => {
            if (handsFree && micActive) { mic.stop(); set({ handsFree: false }); }
            else { set({ handsFree: true }); mic.start(true); }
          }}>
          <Icon.wave />
        </button>
        {busy ? (
          <button className="icon-btn stop" title="Interrompre (Échap)" onClick={interrupt}><Icon.stop /></button>
        ) : (
          <button className="icon-btn send" title="Envoyer" onClick={submit} disabled={!text.trim()}><Icon.send /></button>
        )}
      </div>
    </div>
  );
}
