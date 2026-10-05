// Flattens every help article into src/docs-bundle.json so the Worker's
// /api/ask route can hand the whole help centre to the model as context.
// Runs before `next build`; the output is generated, not committed.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(here, "..", "app", "(docs)");
const outFile = join(here, "..", "src", "docs-bundle.json");

function findArticles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return findArticles(full);
    return entry.name === "page.mdx" ? [full] : [];
  });
}

function toArticle(file) {
  const source = readFileSync(file, "utf8");
  const href = "/" + relative(docsRoot, dirname(file)).split(sep).join("/");
  const title =
    source.match(/export const metadata = \{\s*title:\s*"([^"]+)"/)?.[1] ??
    source.match(/^# (.+)$/m)?.[1] ??
    href;
  const text = source
    .split("\n")
    .filter(line => !/^(import|export) /.test(line))
    // Drop JSX wrappers like <Callout> but keep the prose inside them.
    .map(line => line.replace(/<\/?[A-Z][^>]*>/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { href, title, text };
}

const articles = findArticles(docsRoot)
  .map(toArticle)
  .sort((a, b) => a.href.localeCompare(b.href));

writeFileSync(outFile, JSON.stringify(articles));
console.log(`docs bundle: ${articles.length} articles → ${relative(process.cwd(), outFile)}`);
