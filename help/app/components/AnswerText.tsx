import type { ReactNode } from "react";
import { NAV } from "../nav";

// The assistant replies in a small markdown subset: paragraphs, bullet and
// numbered lists, **bold**, `code` and [links](/path). Rendering it to React
// nodes (never raw HTML) keeps model output from injecting markup.
const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;

const ARTICLE_PATHS = new Set(["/", ...NAV.flatMap(section => [section.href, ...section.links.map(l => l.href)])]);

// The model can invent links. Only real help articles and ScoreHub's own
// sites become clickable; anything else is shown as plain text.
function safeHref(href: string): string | null {
  if (href.startsWith("/")) {
    const path = href.split(/[?#]/)[0].replace(/\/$/, "") || "/";
    return ARTICLE_PATHS.has(path) ? href : null;
  }
  try {
    const url = new URL(href);
    const ours = url.hostname === "scorehub.co.nz" || url.hostname.endsWith(".scorehub.co.nz");
    return url.protocol === "https:" && ours ? href : null;
  } catch {
    return null;
  }
}

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const [whole, linkText, href, bold, code] = match;
    if (linkText) {
      const safe = safeHref(href);
      nodes.push(
        safe ? (
          <a key={index} href={safe}>
            {linkText}
          </a>
        ) : (
          linkText
        ),
      );
    } else if (bold) {
      nodes.push(<strong key={index}>{bold}</strong>);
    } else {
      nodes.push(<code key={index}>{code}</code>);
    }
    last = index + whole.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const BULLET = /^\s*[-*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

export function AnswerText({ text }: { readonly text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const marker = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
    if (marker) {
      const items: string[] = [];
      while (i < lines.length && marker.test(lines[i])) items.push(lines[i++].replace(marker, ""));
      const List = marker === BULLET ? "ul" : "ol";
      blocks.push(
        <List key={blocks.length}>
          {items.map((item, n) => (
            <li key={n}>{inline(item)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) {
      para.push(lines[i++].replace(/^#+\s*/, ""));
    }
    blocks.push(<p key={blocks.length}>{inline(para.join(" "))}</p>);
  }
  return <>{blocks}</>;
}
