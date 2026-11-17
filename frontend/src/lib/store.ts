import { create } from "zustand";
import type { AIState, Emotion } from "./live";

export type ToolEvent = { id: string; name: string; command: string; risk: string; status: "running" | "waiting" | "ok" | "error" | "denied" | "blocked"; summary?: string };
export type ChatMessage = { id: string; role: "user" | "assistant" | "system"; text: string; tools: ToolEvent[]; pending?: boolean; error?: boolean; stats?: any; memory?: string[] };
export type ConfirmRequest = { id: string; tool: string; command: string; objectif: string; consequences: string; risk: string; preview?: string | null };
export type Activity = { id?: number; ts: number; kind: string; title: string; detail: string; status: string };
export type View = "assistant" | "lab" | "terminal" | "files" | "memory" | "settings" | "models";

type Store = {
  view: View;
  connected: boolean;
  aiState: AIState;
  emotion: Emotion;
  messages: ChatMessage[];
  conversationId: number | null;
  conversationTitle: string;
  confirms: ConfirmRequest[];
  activity: Activity[];
  status: any | null;
  settings: any | null;
  handsFree: boolean;
  voiceOut: boolean;
  micActive: boolean;
  transcribing: boolean;
  toast: { text: string; kind: "info" | "error" | "ok" } | null;
  set: (p: Partial<Store>) => void;
  patchLast: (fn: (m: ChatMessage) => ChatMessage) => void;
  pushActivity: (a: Activity) => void;
  notify: (text: string, kind?: "info" | "error" | "ok") => void;
};

let toastTimer: number | undefined;

export const useStore = create<Store>((set, get) => ({
  view: "assistant",
  connected: false,
  aiState: "offline",
  emotion: "neutral",
  messages: [],
  conversationId: null,
  conversationTitle: "",
  confirms: [],
  activity: [],
  status: null,
  settings: null,
  handsFree: false,
  voiceOut: true,
  micActive: false,
  transcribing: false,
  toast: null,
  set: (p) => set(p),
  patchLast: (fn) => {
    const msgs = get().messages.slice();
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant") { msgs[i] = fn(msgs[i]); break; }
    }
    set({ messages: msgs });
  },
  pushActivity: (a) => set({ activity: [a, ...get().activity].slice(0, 200) }),
  notify: (text, kind = "info") => {
    set({ toast: { text, kind } });
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => set({ toast: null }), 4200);
  },
}));
