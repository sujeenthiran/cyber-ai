// Icônes SVG au trait (style HUD)
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const Icon = {
  assistant: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="9" r="5" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /><circle cx="10" cy="8.5" r=".6" /><circle cx="14" cy="8.5" r=".6" /></svg>,
  lab: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" /><path d="M9 12l2 2 4-4" /></svg>,
  terminal: () => <svg viewBox="0 0 24 24" {...P}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M12 15h5" /></svg>,
  files: () => <svg viewBox="0 0 24 24" {...P}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>,
  memory: () => <svg viewBox="0 0 24 24" {...P}><path d="M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 006 0V4a3 3 0 00-3 0zM15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-6 0" /></svg>,
  settings: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>,
  models: () => <svg viewBox="0 0 24 24" {...P}><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /><rect x="9.5" y="9.5" width="5" height="5" /></svg>,
  mic: () => <svg viewBox="0 0 24 24" {...P}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>,
  send: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 12l16-8-6 16-3-7-7-1z" /></svg>,
  stop: () => <svg viewBox="0 0 24 24" {...P}><rect x="6" y="6" width="12" height="12" rx="2" /></svg>,
  speaker: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11" /></svg>,
  mute: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M17 9l5 5M22 9l-5 5" /></svg>,
  plus: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 5v14M5 12h14" /></svg>,
  wave: () => <svg viewBox="0 0 24 24" {...P}><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2" /></svg>,
};
