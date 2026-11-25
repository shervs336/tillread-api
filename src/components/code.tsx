import { CopyButton } from "./ui";

// A tiny highlighter for the TypeScript in these docs: strings, comments, keywords, numbers.
// A `//` right after ":" or a letter is part of a URL, not a comment.
const TOKEN = /((?<![:\w])\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(import|from|export|const|let|await|async|function|return|type|interface|new|if|else|true|false|null|undefined|number|string|boolean)\b|\b(\d[\d_]*(?:\.\d+)?)\b/g;

function highlight(code: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of code.matchAll(TOKEN)) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const cls = m[1] ? "text-[#8f8c80] italic" : m[2] ? "text-[#9fd8b6]" : m[3] ? "text-[#f0b8a0]" : "text-[#e9c46a]";
    out.push(
      <span key={i++} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  out.push(code.slice(last));
  return out;
}

export function Code({ code, title, copy = true }: { code: string; title?: string; copy?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-code-bg text-code-ink shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      {(title || copy) && (
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
          <span className="font-mono text-xs text-white/55">{title}</span>
          {copy && <CopyButton text={code} className="text-white/60 hover:bg-white/10 hover:text-white" />}
        </div>
      )}
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">
        <code>{highlight(code)}</code>
      </pre>
    </div>
  );
}
