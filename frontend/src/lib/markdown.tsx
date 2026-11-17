import React from "react";

// Rendu Markdown minimal et sûr (aucun HTML injecté) : blocs de code, `code`, **gras**, listes, titres.
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const rx = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = rx.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("`")) out.push(<code key={key + i++} className="md-inline">{t.slice(1, -1)}</code>);
    else if (t.startsWith("**")) out.push(<strong key={key + i++}>{t.slice(2, -2)}</strong>);
    else out.push(<em key={key + i++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{lang || "code"}</span>
        <button onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
          {copied ? "Copié ✓" : "Copier"}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const parts = text.split(/```/);
  parts.forEach((part, idx) => {
    if (idx % 2 === 1) {
      const nl = part.indexOf("\n");
      const lang = nl >= 0 ? part.slice(0, nl).trim() : "";
      const code = nl >= 0 ? part.slice(nl + 1) : part;
      blocks.push(<CodeBlock key={"c" + idx} lang={lang} code={code.replace(/\n$/, "")} />);
      return;
    }
    const lines = part.split("\n");
    let list: React.ReactNode[] = [];
    let ordered = false;
    const flush = (k: string) => {
      if (list.length) {
        blocks.push(ordered ? <ol key={k}>{list}</ol> : <ul key={k}>{list}</ul>);
        list = [];
      }
    };
    lines.forEach((line, li) => {
      const k = `${idx}-${li}`;
      const ul = line.match(/^\s*[-*•]\s+(.*)/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
      const h = line.match(/^\s*#{1,4}\s+(.*)/);
      if (ul || ol) {
        if (list.length && ordered !== !!ol) flush("l" + k);
        ordered = !!ol;
        list.push(<li key={k}>{inline((ul || ol)![1], k)}</li>);
        return;
      }
      flush("l" + k);
      if (h) blocks.push(<div key={k} className="md-h">{inline(h[1], k)}</div>);
      else if (line.trim()) blocks.push(<p key={k}>{inline(line, k)}</p>);
    });
    flush("end" + idx);
  });
  return <div className="md">{blocks}</div>;
}
