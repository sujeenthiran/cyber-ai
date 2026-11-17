// Valeurs lues à chaque image par l'avatar (sans re-rendu React).
export type AIState = "idle" | "listening" | "thinking" | "speaking" | "executing" | "waiting" | "offline";
export type Emotion = "neutral" | "happy" | "concerned" | "surprised" | "curious" | "thinking";

export const live = {
  mouth: 0,          // ouverture de la bouche 0..1 (voix)
  mic: 0,            // niveau micro 0..1
  speechLevel: 0,    // niveau de la voix de l'IA 0..1
  state: "idle" as AIState,
  emotion: "neutral" as Emotion,
  emotionUntil: 0,
  spectrum: new Uint8Array(64) as Uint8Array, // spectre affiché par le visualiseur
  pulse: 0,          // impulsion (nouveau message, action...)
};

// accès console pour le diagnostic (lecture seule de l'animation)
(window as any).__cyberLive = live;
