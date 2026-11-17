import { useEffect } from "react";
import { answerConfirm } from "../lib/connection";
import { useStore } from "../lib/store";

const RISK_TEXT: Record<string, string> = { medium: "Action à valider", high: "Action sensible", blocked: "Bloquée" };

export function ConfirmModal() {
  const c = useStore((s) => s.confirms[0]);
  useEffect(() => {
    if (!c) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") answerConfirm(c.id, false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [c]);
  if (!c) return null;
  return (
    <div className="modal-back">
      <div className={`modal confirm risk-${c.risk}`} role="dialog" aria-modal="true">
        <div className="confirm-head">
          <span className="confirm-badge">{RISK_TEXT[c.risk] || "Validation"}</span>
          <span className="confirm-tool">{c.tool}</span>
        </div>
        <div className="confirm-section">
          <label>Commande prévue</label>
          <pre className="confirm-cmd">{c.command}</pre>
        </div>
        <div className="confirm-section">
          <label>Objectif</label>
          <p>{c.objectif}</p>
        </div>
        <div className="confirm-section">
          <label>Conséquences possibles</label>
          <p>{c.consequences}</p>
        </div>
        {c.preview && (
          <div className="confirm-section">
            <label>Aperçu du contenu</label>
            <pre className="confirm-preview">{c.preview}</pre>
          </div>
        )}
        <div className="confirm-actions">
          <button className="btn danger" onClick={() => answerConfirm(c.id, false)}>Refuser</button>
          <button className="btn primary" autoFocus onClick={() => answerConfirm(c.id, true)}>Autoriser</button>
        </div>
        <div className="confirm-foot">CYBER AI n'agit jamais sans ton accord sur ce type d'action. Échap = refuser.</div>
      </div>
    </div>
  );
}

/** Confirmation pour les actions lancées depuis l'interface (Cyber Lab, Modèles...). */
export function LocalConfirm({ open, title, command, consequences, onAnswer }: {
  open: boolean; title: string; command: string; consequences: string; onAnswer: (ok: boolean) => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-back">
      <div className="modal confirm risk-high">
        <div className="confirm-head"><span className="confirm-badge">Action sensible</span><span className="confirm-tool">{title}</span></div>
        <div className="confirm-section"><label>Commande prévue</label><pre className="confirm-cmd">{command}</pre></div>
        <div className="confirm-section"><label>Conséquences possibles</label><p>{consequences}</p></div>
        <div className="confirm-actions">
          <button className="btn danger" onClick={() => onAnswer(false)}>Refuser</button>
          <button className="btn primary" onClick={() => onAnswer(true)}>Autoriser</button>
        </div>
      </div>
    </div>
  );
}
