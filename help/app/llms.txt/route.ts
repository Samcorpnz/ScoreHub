import { NAV } from "../nav";

export const dynamic = "force-static";

const HELP_URL = "https://help.scorehub.co.nz";
const SITE_URL = "https://scorehub.co.nz";

// Built from the sidebar nav, so a page added there is listed here too.
export function GET(): Response {
  const sections = NAV.map(section => {
    const links = section.links.map(link => `- [${link.title}](${HELP_URL}${link.href})`);
    // A section's landing page is usually its first link; list it only when it isn't.
    if (!section.links.some(link => link.href === section.href)) {
      links.unshift(`- [${section.title} overview](${HELP_URL}${section.href})`);
    }
    return `## ${section.title}\n\n${links.join("\n")}`;
  });

  const body = `# ScoreHub Help Centre

> Setup and how-to guides for ScoreHub, live sport scoring software: creating an account, running a match from the browser control panel, putting the score on venue screens and streams, connecting a scoreboard console, per-sport scoring guides, and account and billing.

Start with Getting started. Product overview and current prices are on the marketing site, indexed at ${SITE_URL}/llms.txt.

${sections.join("\n\n")}
`;

  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
