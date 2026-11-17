// Micro + détection de parole (VAD) : début/fin de phrase, interruption de l'IA, envoi à Whisper local.
import { api } from "../lib/api";
import { live } from "../lib/live";
import { useStore } from "../lib/store";
import { audioCtx } from "./context";
import { speech } from "./speech";
import { interrupt, sendMessage } from "../lib/connection";

const TARGET_RATE = 16000;

function encodeWav(samples: Float32Array, rate: number): Blob {
  // rééchantillonnage linéaire vers 16 kHz
  const ratio = rate / TARGET_RATE;
  const n = Math.floor(samples.length / ratio);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio, i0 = Math.floor(pos), f = pos - i0;
    const s = (samples[i0] || 0) * (1 - f) + (samples[i0 + 1] || 0) * f;
    pcm[i] = Math.max(-1, Math.min(1, s)) * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + pcm.byteLength);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.byteLength, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, TARGET_RATE, true); v.setUint32(28, TARGET_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, pcm.byteLength, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}

class MicListener {
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: Float32Array[] = [];
  private preroll: Float32Array[] = [];
  private speaking = false;
  private speechMs = 0;
  private silenceMs = 0;
  private once = false;
  private freq = new Uint8Array(512);

  get active() { return !!this.stream; }

  /** continuous = mains libres ; sinon une seule phrase puis arrêt. */
  async start(continuous: boolean) {
    if (this.stream) { this.once = !continuous; return; }
    this.once = !continuous;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch {
      useStore.getState().notify("Micro inaccessible : autorise-le dans la fenêtre (icône 🎤 de la barre d'adresse).", "error");
      return;
    }
    const ctx = audioCtx();
    const src = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.node = ctx.createScriptProcessor(2048, 1, 1);
    src.connect(this.analyser);
    src.connect(this.node);
    this.node.connect(ctx.destination); // nécessaire pour que le traitement tourne (sortie silencieuse)
    this.node.onaudioprocess = (e) => {
      e.outputBuffer.getChannelData(0).fill(0);
      this.process(new Float32Array(e.inputBuffer.getChannelData(0)), ctx.sampleRate);
    };
    useStore.getState().set({ micActive: true });
    if (live.state === "idle") { live.state = "listening"; useStore.getState().set({ aiState: "listening" }); }
  }

  stop() {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.node = null;
    this.speaking = false;
    this.chunks = [];
    live.mic = 0;
    useStore.getState().set({ micActive: false });
    if (live.state === "listening") { live.state = "idle"; useStore.getState().set({ aiState: "idle" }); }
  }

  private process(buf: Float32Array, rate: number) {
    const s = useStore.getState().settings || {};
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    live.mic = Math.min(1, rms * 12);
    if (this.analyser && !speech.isPlaying()) {
      this.analyser.getByteFrequencyData(this.freq);
      for (let i = 0; i < 64; i++) live.spectrum[i] = this.freq[i * 2 + 1];
    }
    const ms = (buf.length / rate) * 1000;
    // seuil relevé pendant que l'IA parle (évite qu'elle s'interrompe avec sa propre voix)
    const threshold = (s.vad_threshold ?? 0.02) * (speech.isPlaying() ? 2.5 : 1);
    const loud = rms > threshold;
    if (!this.speaking) {
      this.preroll.push(buf);
      if (this.preroll.length > 6) this.preroll.shift();
      this.speechMs = loud ? this.speechMs + ms : 0;
      if (this.speechMs > 160) {
        this.speaking = true;
        this.silenceMs = 0;
        this.chunks = [...this.preroll];
        const st = useStore.getState();
        // Interruption : l'utilisateur parle pendant que l'IA parle ou réfléchit
        if (speech.isPlaying() || st.aiState === "thinking") interrupt();
        live.state = "listening";
        st.set({ aiState: "listening" });
      }
      return;
    }
    this.chunks.push(buf);
    this.silenceMs = loud ? 0 : this.silenceMs + ms;
    const total = this.chunks.length * ms;
    if (this.silenceMs > (s.vad_silence_ms ?? 900) || total > 30000) {
      this.speaking = false;
      const all = new Float32Array(this.chunks.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of this.chunks) { all.set(c, o); o += c.length; }
      this.chunks = [];
      void this.transcribe(encodeWav(all, rate));
      if (this.once) this.stop();
    }
  }

  private async transcribe(wav: Blob) {
    const st = useStore.getState();
    st.set({ transcribing: true });
    live.state = "thinking";
    st.set({ aiState: "thinking" });
    try {
      const r = await api<{ text: string }>("/api/stt", { raw: wav });
      if (r.text && r.text.trim().length > 1) sendMessage(r.text, true);
      else { live.state = this.active ? "listening" : "idle"; st.set({ aiState: live.state }); }
    } catch (e: any) {
      st.notify(e.message || "Reconnaissance vocale impossible", "error");
      live.state = "idle";
      st.set({ aiState: "idle" });
    } finally {
      st.set({ transcribing: false });
    }
  }
}

export const mic = new MicListener();
