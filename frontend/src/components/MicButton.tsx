import { useEffect, useRef } from "react";
import { mic } from "../audio/mic";
import { live } from "../lib/live";
import { useStore } from "../lib/store";
import { STATE_LABELS } from "./TopBar";
import { Icon } from "./Icons";
import { AudioViz } from "./AudioViz";

const HINTS: Record<string, string> = {
  idle: "Clique sur le micro et parle",
  listening: "Je t'écoute… parle naturellement",
  thinking: "Je réfléchis…",
  speaking: "Parle pour m'interrompre",
  executing: "J'exécute une action…",
  waiting: "Valide ou refuse l'action proposée",
  offline: "Connexion au cerveau local…",
};

export function MicButton() {
  const { micActive, handsFree, aiState, transcribing, set } = useStore();
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (ring.current) ring.current.style.transform = `scale(${1 + live.mic * 0.6})`;
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  const toggle = () => {
    if (micActive) { mic.stop(); set({ handsFree: false }); }
    else mic.start(handsFree);
  };
  return (
    <div className="mic-zone">
      <div className={`state-label s-${aiState}`}>{transcribing ? "Transcription…" : STATE_LABELS[aiState]}</div>
      <AudioViz />
      <button className={`mic-btn ${micActive ? "active" : ""}`} onClick={toggle} title={micActive ? "Couper le micro" : "Parler"}>
        <div className="mic-ring" ref={ring} />
        <Icon.mic />
      </button>
      <div className="mic-hint">{micActive && handsFree ? "Mode mains libres actif" : HINTS[aiState]}</div>
    </div>
  );
}
