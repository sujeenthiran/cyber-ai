// Connexion WebSocket avec le cerveau de CYBER AI.
import { api, wsUrl } from "./api";
import { live, type Emotion } from "./live";
import { speech } from "../audio/speech";
import { useStore, type ChatMessage } from "./store";

let ws: WebSocket | null = null;
let retry = 0;
let speakingFallbackText = "";

const uid = () => Math.random().toString(36).slice(2, 10);

function setState(s: any) {
  // "speaking" est piloté par le lecteur audio ; on ne l'écrase pas pendant la parole
  if (speech.isPlaying() && s === "idle") return;
  if (s === "idle" && useStore.getState().micActive) s = "listening";
  live.state = s;
  useStore.getState().set({ aiState: s });
}

export function setEmotion(e: Emotion, ms = 2500) {
  live.emotion = e;
  live.emotionUntil = performance.now() + ms;
  useStore.getState().set({ emotion: e });
}

export function connect() {
  ws = new WebSocket(wsUrl());
  ws.onopen = () => {
    retry = 0;
    useStore.getState().set({ connected: true });
    setState("idle");
    refreshStatus();
  };
  ws.onclose = (ev) => {
    useStore.getState().set({ connected: false, aiState: "offline" });
    live.state = "offline";
    if (ev.code === 4401) {
      useStore.getState().notify("Session expirée : relance CYBER AI avec son raccourci.", "error");
      return;
    }
    setTimeout(connect, Math.min(8000, 800 * 2 ** retry++));
  };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
}

export async function refreshStatus() {
  try {
    const [status, settings] = await Promise.all([api("/api/status"), api("/api/settings")]);
    useStore.getState().set({ status, settings });
  } catch { /* hors ligne */ }
}

function send(o: any) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o));
  else useStore.getState().notify("Pas de connexion avec le cerveau de CYBER AI.", "error");
}

export function sendMessage(text: string, viaVoice = false) {
  const st = useStore.getState();
  const t = text.trim();
  if (!t) return;
  speech.stop();
  const user: ChatMessage = { id: uid(), role: "user", text: t, tools: [] };
  const bot: ChatMessage = { id: uid(), role: "assistant", text: "", tools: [], pending: true };
  st.set({ messages: [...st.messages, user, bot], view: st.view === "assistant" ? st.view : "assistant" });
  speakingFallbackText = "";
  live.pulse = 1;
  send({ type: "user_message", text: t, conversation_id: st.conversationId, voice: st.voiceOut });
  void viaVoice;
}

export function interrupt() {
  speech.stop();
  send({ type: "interrupt" });
}

export function answerConfirm(id: string, approved: boolean) {
  const st = useStore.getState();
  st.set({ confirms: st.confirms.filter((c) => c.id !== id) });
  send({ type: "confirm_response", id, approved });
}

export function newConversation() {
  speech.stop();
  send({ type: "new_conversation" });
  useStore.getState().set({ messages: [], conversationId: null, conversationTitle: "" });
}

export async function loadConversation(id: number, title: string) {
  const msgs: any[] = await api(`/api/conversations/${id}`);
  newConversation();
  useStore.getState().set({
    conversationId: id,
    conversationTitle: title,
    view: "assistant",
    messages: msgs.map((m) => ({
      id: String(m.id), role: m.role, text: m.content,
      tools: (m.meta?.tools || []).map((t: any, i: number) => ({ id: `${m.id}-${i}`, name: t.tool, command: JSON.stringify(t.args), risk: "", status: t.status })),
    })),
  });
}

function handle(m: any) {
  const st = useStore.getState();
  switch (m.type) {
    case "state":
      setState(m.state);
      if (m.state === "thinking") setEmotion("thinking", 60000);
      break;
    case "conversation":
      st.set({ conversationId: m.id, conversationTitle: m.title });
      break;
    case "token":
      st.patchLast((x) => ({ ...x, text: x.text + m.text }));
      speakingFallbackText += m.text;
      break;
    case "memory_used":
      st.patchLast((x) => ({ ...x, memory: m.items }));
      break;
    case "audio":
      speech.enqueue(m.seq, m.data, m.emotion);
      break;
    case "tts_error":
      st.notify("Voix Piper indisponible : voix Windows utilisée.", "error");
      speech.speakFallback(m.text);
      break;
    case "tool_start":
      st.patchLast((x) => ({ ...x, tools: [...x.tools, { id: m.id, name: m.name, command: m.command, risk: m.risk, status: "running" }] }));
      setEmotion("thinking", 60000);
      break;
    case "confirm_request":
      st.set({ confirms: [...st.confirms, m] });
      st.patchLast((x) => ({ ...x, tools: x.tools.map((t) => (t.id === m.id ? { ...t, status: "waiting" } : t)) }));
      setEmotion("curious", 60000);
      break;
    case "tool_end":
      st.patchLast((x) => ({ ...x, tools: x.tools.map((t) => (t.id === m.id ? { ...t, status: m.status, summary: m.summary } : t)) }));
      st.set({ confirms: st.confirms.filter((c) => c.id !== m.id) });
      live.pulse = 1;
      break;
    case "activity":
      st.pushActivity(m.entry);
      break;
    case "warning":
      st.notify(m.text, "info");
      break;
    case "error":
      st.patchLast((x) => ({ ...x, pending: false, error: true, text: (x.text ? x.text + "\n\n" : "") + "⚠ " + m.text }));
      setEmotion("concerned", 4000);
      break;
    case "interrupted":
      st.patchLast((x) => ({ ...x, pending: false, text: x.text + (x.text ? " …" : "(interrompu)") }));
      setState("idle");
      break;
    case "done": {
      st.patchLast((x) => ({ ...x, pending: false, stats: m.stats }));
      setEmotion(m.emotion || "neutral", 3500);
      // Pas de voix Piper : on utilise la voix locale de Windows en secours
      if (st.voiceOut && !st.status?.tts?.ok && m.speech === 0 && speakingFallbackText.trim()) {
        speech.speakFallback(speakingFallbackText);
      }
      break;
    }
  }
}
