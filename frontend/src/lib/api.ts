// Accès à l'API locale. Le jeton de session arrive dans l'URL (#token=...) ouverte par le lanceur.
function readToken(): string {
  const m = location.hash.match(/token=([\w-]+)/);
  if (m) {
    try { sessionStorage.setItem("cyberai-token", m[1]); } catch { /* stockage indisponible */ }
    history.replaceState(null, "", location.pathname);
    return m[1];
  }
  try { return sessionStorage.getItem("cyberai-token") || ""; } catch { return ""; }
}

export const TOKEN = readToken();

export class ApiError extends Error {}

export async function api<T = any>(path: string, opts: { method?: string; body?: any; raw?: BodyInit; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-CyberAI-Token": TOKEN };
  let body: BodyInit | undefined = opts.raw;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const r = await fetch(path, { method: opts.method || (body ? "POST" : "GET"), headers, body, signal: opts.signal });
  if (!r.ok) {
    let msg = `${r.status}`;
    try { const j = await r.json(); msg = j.detail || msg; } catch { /* corps non JSON */ }
    throw new ApiError(msg);
  }
  const ct = r.headers.get("content-type") || "";
  return (ct.includes("json") ? r.json() : (r.blob() as any)) as T;
}

/** Lecture d'une réponse en flux NDJSON (téléchargement de modèle). */
export async function apiStream(path: string, body: any, onLine: (o: any) => void) {
  const r = await fetch(path, { method: "POST", headers: { "X-CyberAI-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok || !r.body) {
    let msg = `${r.status}`;
    try { msg = (await r.json()).detail || msg; } catch { /* */ }
    throw new ApiError(msg);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(JSON.parse(line));
    }
  }
}

export function wsUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws?token=${encodeURIComponent(TOKEN)}`;
}

export function fmtBytes(n: number) {
  if (!n) return "0 o";
  const u = ["o", "Ko", "Mo", "Go", "To"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i >= 3 ? 1 : 0)} ${u[i]}`;
}
