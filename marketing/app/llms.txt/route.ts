import { APP_URL, HELP_URL, SITE_URL } from "../site";
import { addOns, plans } from "../pricing-data";
import { SOLUTIONS } from "../solutions-data";
import { SPORTS } from "../sports-data";

export const dynamic = "force-static";

// Built from the same data as the pages and the sitemap, so a new sport,
// solution or price shows up here without a second edit.
export function GET(): Response {
  const priced = [...plans, ...addOns].map(p => {
    const annual = "annual" in p ? `, or ${p.annual}` : "";
    return `- ${p.name}: ${p.price}${p.period}${annual}. ${p.detail}`;
  });

  const body = `# ScoreHub

> Live sport scoring software. A scorer runs the match from a browser on a laptop, tablet or phone, and the score appears on venue screens, streaming overlays and viewers' phones a moment later. Nothing to install, and no scoreboard controller to buy.

Prices are in New Zealand dollars (NZD). Add-ons need a Pro or Venue plan. The Free plan needs no credit card; sign up at ${APP_URL}/signup.

## Pricing

- [Plans and pricing](${SITE_URL}/pricing): Full plan comparison, add-ons and billing questions.
${priced.join("\n")}

## Solutions

${SOLUTIONS.map(s => `- [${s.name}](${SITE_URL}/solutions/${s.slug}): ${s.summary}`).join("\n")}

## Sports

- [All sports](${SITE_URL}/sports): Every sport template, with its period structure and scoring buttons.
${SPORTS.map(s => `- [${s.name}](${SITE_URL}/sports/${s.slug}): ${s.summary}`).join("\n")}

## Setup guides

- [Help centre](${HELP_URL}): Step-by-step guides. Its own index is at ${HELP_URL}/llms.txt.
- [Getting started](${HELP_URL}/getting-started): Create an account and run a first match.
- [Displaying your score](${HELP_URL}/displaying-your-score): Venue screens, OBS, vMix and branding.
- [Connecting a console (Bridge)](${HELP_URL}/connecting-the-bridge): Feed ScoreHub from a Saturn/Vega scoreboard console.

## Optional

- [Terms of service](${SITE_URL}/terms)
- [Privacy policy](${SITE_URL}/privacy)
`;

  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
