import { Fragment } from "react";
import { safeLinkUrl } from "../markdown-sanitize.js";

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function inline(text, keyPrefix) {
  const parts = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match;
  let i = 0;
  while ((match = regex.exec(text))) {
    if (match.index > last) {
      parts.push(<Fragment key={`${keyPrefix}-t${i++}`}>{text.slice(last, match.index)}</Fragment>);
    }
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={`${keyPrefix}-b${i++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(
        <code key={`${keyPrefix}-c${i++}`} className="rounded bg-slate-800 px-1 py-0.5 text-xs">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("*")) {
      parts.push(<em key={`${keyPrefix}-i${i++}`}>{token.slice(1, -1)}</em>);
    } else {
      const m = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (m) {
        // Ask answers are untrusted LLM/RAG output — link targets must pass the
        // shared scheme sanitizer or render as inert text (React 18 warns on
        // javascript: hrefs but still renders them; it does not strip them).
        const href = safeLinkUrl(m[2]);
        if (!href) {
          parts.push(
            <span
              key={`${keyPrefix}-x${i++}`}
              title="Link removed (unsafe URL)"
              className="text-indigo-400/70 underline decoration-dotted"
            >
              {m[1]}
            </span>
          );
        } else {
          parts.push(
            <a
              key={`${keyPrefix}-a${i++}`}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 hover:text-indigo-300 underline"
            >
              {m[1]}
            </a>
          );
        }
      } else {
        parts.push(<Fragment key={`${keyPrefix}-x${i++}`}>{token}</Fragment>);
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    parts.push(<Fragment key={`${keyPrefix}-z${i}`}>{text.slice(last)}</Fragment>);
  }
  return parts;
}

export default function Markdown({ text }) {
  const escaped = escapeHtml(String(text ?? ""));
  const lines = escaped.split("\n");
  const blocks = [];
  let list = null;
  let block = null;
  let codeBlock = null; // { lang, lines } when inside a fenced ``` block
  let key = 0;

  const flushCodeBlock = () => {
    if (!codeBlock) return;
    const { lang, lines: codeLines } = codeBlock;
    blocks.push(
      <pre
        key={key++}
        className={`mb-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-[13px] leading-relaxed ${lang ? "language-" + lang : ""}`}
      >
        <code className="font-mono text-slate-200">{codeLines.join("\n")}</code>
      </pre>
    );
    codeBlock = null;
  };

  const flushBlock = () => {
    if (block) {
      blocks.push(<p key={key++} className="mb-2 leading-relaxed">{inline(block, `p${key}`)}</p>);
      block = null;
    }
  };

  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={key++} className={`mb-2 ${list.ordered ? "list-decimal" : "list-disc"} pl-5 space-y-0.5`}>
          {list.items.map((item, idx) => (
            <li key={idx} className="leading-relaxed">
              {inline(item, `li${key}-${idx}`)}
            </li>
          ))}
        </Tag>
      );
      list = null;
    }
  };

  for (const line of lines) {
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushBlock();
      flushList();
      if (codeBlock) {
        flushCodeBlock();
      } else {
        codeBlock = { lang: fence[1], lines: [] };
      }
      continue;
    }
    if (codeBlock) {
      codeBlock.lines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);

    if (heading) {
      flushBlock();
      flushList();
      const level = heading[1].length;
      const Tag = `h${level}`;
      blocks.push(
        <Tag key={key++} className="mb-2 mt-3 font-semibold text-slate-50">
          {inline(heading[2], `h${key}`)}
        </Tag>
      );
    } else if (bullet || numbered) {
      flushBlock();
      const content = bullet ? bullet[1] : numbered[1];
      if (!list || list.ordered !== Boolean(numbered)) {
        flushList();
        list = { ordered: Boolean(numbered), items: [] };
      }
      list.items.push(content);
    } else if (quote) {
      flushBlock();
      flushList();
      blocks.push(
        <blockquote key={key++} className="mb-2 border-l-2 border-indigo-500 pl-3 text-slate-400 italic">
          {inline(quote[1], `q${key}`)}
        </blockquote>
      );
    } else if (line.trim() === "") {
      flushBlock();
      flushList();
    } else {
      flushList();
      block = block ? `${block}\n${line}` : line;
    }
  }
  flushBlock();
  flushList();
  flushCodeBlock(); // unclosed fence at end of answer

  return <div className="break-words text-sm text-slate-200">{blocks}</div>;
}
