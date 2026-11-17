// Lecture des phrases synthétisées par Piper, dans l'ordre, avec analyse du volume pour le lip-sync.
import { audioCtx } from "./context";
import { live, type Emotion } from "../lib/live";
import { useStore } from "../lib/store";

type Item = { seq: number; buffer: AudioBuffer; emotion: Emotion };

class SpeechPlayer {
  private queue: Item[] = [];
  private nextSeq = 1;
  private current: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private data = new Uint8Array(1024);
  private fallbackActive = false;
  private epoch = 0;
  private pending = new Map<number, Promise<void>>();

  private ensure() {
    const ctx = audioCtx();
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.5;
      this.analyser.connect(ctx.destination);
      this.data = new Uint8Array(this.analyser.frequencyBinCount);
      this.loop();
    }
    return ctx;
  }

  isPlaying() {
    return !!this.current || this.fallbackActive;
  }

  enqueue(seq: number, b64: string, emotion: Emotion) {
    const ctx = this.ensure();
    if (seq === 1) this.nextSeq = 1;
    const epoch = this.epoch;
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const p = ctx.decodeAudioData(bin.buffer).then((buffer) => {
      if (epoch !== this.epoch) return;
      this.queue.push({ seq, buffer, emotion });
      this.queue.sort((a, b) => a.seq - b.seq);
      this.playNext();
    }).catch(() => { /* audio invalide */ });
    this.pending.set(seq, p);
  }

  private playNext() {
    if (this.current || !this.queue.length || this.queue[0].seq !== this.nextSeq) return;
    const item = this.queue.shift()!;
    this.nextSeq++;
    const ctx = this.ensure();
    const src = ctx.createBufferSource();
    src.buffer = item.buffer;
    src.connect(this.analyser!);
    this.current = src;
    live.state = "speaking";
    useStore.getState().set({ aiState: "speaking" });
    if (item.emotion && item.emotion !== "neutral") {
      live.emotion = item.emotion;
      live.emotionUntil = performance.now() + item.buffer.duration * 1000 + 600;
    }
    src.onended = () => {
      if (this.current !== src) return;
      this.current = null;
      if (this.queue.length) this.playNext();
      else setTimeout(() => this.maybeIdle(), 250);
    };
    src.start();
  }

  private maybeIdle() {
    if (this.current || this.queue.length || this.fallbackActive) return;
    const st = useStore.getState();
    if (st.aiState === "speaking") {
      live.state = "idle";
      st.set({ aiState: "idle" });
    }
  }

  stop() {
    this.epoch++;
    this.queue = [];
    this.nextSeq = 1;
    if (this.current) {
      try { this.current.onended = null; this.current.stop(); } catch { /* déjà arrêté */ }
      this.current = null;
    }
    if (this.fallbackActive) {
      speechSynthesis.cancel();
      this.fallbackActive = false;
    }
    live.mouth = 0;
    if (live.state === "speaking") {
      live.state = "idle";
      useStore.getState().set({ aiState: "idle" });
    }
  }

  /** Secours : voix française intégrée à Windows (locale aussi), lip-sync simulé. */
  speakFallback(text: string) {
    const clean = text.replace(/```[\s\S]*?```/g, " ").replace(/[`*#_>]/g, " ").replace(/https?:\/\/\S+/g, "le lien").trim();
    if (!clean || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(clean.slice(0, 1500));
    u.lang = "fr-FR";
    const fr = speechSynthesis.getVoices().find((v) => v.lang.startsWith("fr") && v.localService);
    if (fr) u.voice = fr;
    u.onstart = () => { this.fallbackActive = true; live.state = "speaking"; useStore.getState().set({ aiState: "speaking" }); };
    u.onend = u.onerror = () => { this.fallbackActive = false; this.maybeIdle(); };
    speechSynthesis.speak(u);
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    if (this.current && this.analyser) {
      this.analyser.getByteFrequencyData(this.data);
      // énergie dans la bande de la voix (≈ 150 Hz – 3 kHz)
      const sr = audioCtx().sampleRate;
      const binHz = sr / 2 / this.data.length;
      const lo = Math.floor(150 / binHz), hi = Math.floor(3000 / binHz);
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += this.data[i];
      const level = Math.min(1, (sum / (hi - lo) / 255) * 2.2);
      live.speechLevel = level;
      live.mouth += (Math.pow(level, 0.8) - live.mouth) * 0.55;
      for (let i = 0; i < 64; i++) live.spectrum[i] = this.data[Math.floor(i * 1.6) + 2] || 0;
    } else if (this.fallbackActive) {
      const t = performance.now() / 1000;
      const level = Math.max(0, Math.sin(t * 13) * 0.5 + Math.sin(t * 7.3) * 0.35 + 0.25);
      live.speechLevel = level;
      live.mouth += (level * 0.8 - live.mouth) * 0.4;
      for (let i = 0; i < 64; i++) live.spectrum[i] = Math.max(0, 140 * level * Math.sin(i * 0.35 + t * 8) + 60 * level);
    } else {
      live.speechLevel *= 0.85;
      live.mouth *= 0.75;
    }
  };
}

export const speech = new SpeechPlayer();
