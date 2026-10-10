import type { FaqItem } from "./components/Faq";
import { SHOTS, type Shot } from "./screenshots";

export interface SolutionSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
  steps?: string[];
  /** Help centre path for readers who want the full instructions. */
  help?: { label: string; path: string };
}

export interface Solution {
  slug: string;
  /** Short name for nav, cards and breadcrumbs. */
  name: string;
  eyebrow: string;
  title: string;
  description: string;
  h1: string;
  lede: string;
  /** One-line summary for cards on other pages. */
  summary: string;
  plan: string;
  shots: Shot[];
  sections: SolutionSection[];
  faq: FaqItem[];
  cta: string;
}

// Capabilities and plan gating here follow the help centre (help/app/(docs))
// and requirePlan()/requireAddOn() in relay/src/server.ts.
export const SOLUTIONS: Solution[] = [
  {
    slug: "venues",
    name: "Venues & clubs",
    eyebrow: "For venues and clubs",
    title: "Digital Scoreboard Software for Venues & Clubs — ScoreHub",
    description:
      "Turn any TV, projector or LED screen into a live scoreboard. Score from a browser at the bench, brand it in your club colours, and bridge an existing console if you have one.",
    h1: "Digital scoreboard software for venues and clubs",
    lede: "Your scorer taps the score in on a laptop, tablet or phone at the bench. Every screen in the building shows it a moment later. There's no scoreboard controller to buy and nothing to install.",
    summary: "Turn any screen in the building into a live scoreboard, scored from the bench.",
    plan: "Free, Pro or Venue",
    shots: [SHOTS.advanced, SHOTS.fullscreen],
    sections: [
      {
        heading: "Any screen can be the scoreboard",
        paragraphs: [
          "Every ScoreHub display is a web page, so anything that can open a browser can show the score: a TV with a laptop plugged in, a smart TV, a projector, or an LED wall fed through a capture card.",
        ],
        bullets: [
          "Basic: a simple centred scoreboard for a small screen, tablet or phone.",
          "Advanced: a wider board with a header bar, team logos, fouls and timeouts, plus a stats panel for sports that have one.",
          "Fullscreen: fills a second monitor or projector edge to edge, with Wide, Stacked and Minimal layouts.",
        ],
        help: { label: "Setting up venue screens", path: "/displaying-your-score/obs-and-venue-screens" },
      },
      {
        heading: "Simple enough for a volunteer at the bench",
        paragraphs: [
          "The control panel has one job on match day: clock, score and period. Each sport's buttons are already labelled, keyboard shortcuts cover the common actions, and Undo steps back through the last 50 actions when someone mis-taps.",
          "Only one panel scores a match at a time, so two people can't fight over the score. A second scorer can take over mid-match without losing anything, and a phone can run the match courtside when a laptop isn't practical.",
        ],
        help: { label: "Using the control panel", path: "/running-a-match" },
      },
      {
        heading: "In your club's colours",
        paragraphs: [
          "Team colours are available on every plan. On Pro and Venue you can add team logos and a competition logo, set an accent colour and background, choose any Google Font, and scale the text up for a screen that's a long way from the crowd.",
          "Custom sound cues that play at set clock times are also part of Pro and Venue.",
        ],
        help: { label: "Branding your displays", path: "/displaying-your-score/branding" },
      },
      {
        heading: "Already have a scoreboard console?",
        paragraphs: [
          "If your venue runs a Swiss Timing Saturn or Vega console, the ScoreHub Bridge app reads it over RS422 serial from a laptop at the venue and pushes the score and clock into ScoreHub. Your operator keeps using the console they know, and every ScoreHub display and overlay follows it.",
          "Bridging a console needs the Data Feed add-on on a Pro or Venue plan. If the venue's internet drops, Bridge tells the operator to switch to manual control and reconnects on its own.",
        ],
        help: { label: "Connecting a console", path: "/connecting-the-bridge" },
      },
      {
        heading: "Buttons for the people who like buttons",
        paragraphs: [
          "An Elgato Stream Deck can start and stop the clock, add points and move the period, with each key showing the live value. Anything that can send an HTTP request can do the same through webhooks. Both are included on every plan and work alongside whoever is scoring on screen.",
        ],
        help: { label: "Stream Deck and webhooks", path: "/running-a-match/stream-deck-and-webhooks" },
      },
    ],
    faq: [
      {
        q: "What hardware do I need at the venue?",
        a: "A device with a web browser to score from, and a screen that can show a web page. Most venues use a laptop or tablet at the scorer's bench and a TV or projector with a computer or smart-TV browser behind it.",
      },
      {
        q: "Can more than one screen show the same match?",
        a: "Yes. Open as many display links as you like; they all follow the same live match. Displays don't need a login, so a link can also be shared with spectators.",
      },
      {
        q: "How many courts can we run at once?",
        a: "The Free plan allows one live match at a time. Pro and Venue allow concurrent live matches, so every court can have its own match, scorer and screen.",
      },
      {
        q: "Does it work with our existing scoreboard console?",
        a: "ScoreHub can read Swiss Timing Saturn and Vega consoles through the Bridge app with the Data Feed add-on. For other consoles, score from the browser control panel, or get in touch about your model.",
      },
      {
        q: "Can we remove the ScoreHub branding from the displays?",
        a: "Displays on the Free plan carry a small \"Powered by ScoreHub\" mark. Pro and Venue remove it.",
      },
    ],
    cta: "Ready to put the score on your screens?",
  },
  {
    slug: "tournaments",
    name: "Tournaments & leagues",
    eyebrow: "For tournaments, leagues and NSOs",
    title: "Tournament & League Scoring Software — ScoreHub",
    description:
      "Run every court of a tournament from a browser. Concurrent live matches, CSV fixture upload, a live dashboard and 21 sports in one account, with no hardware to configure at each table.",
    h1: "Tournament and league scoring software",
    lede: "Forty courts, a volunteer on each one, and a draw that changes at lunchtime. ScoreHub puts every table on a browser scoring panel and every result in one dashboard, without a hardware setup at each court.",
    summary: "Every court live at once, with the whole draw loaded from a spreadsheet.",
    plan: "Pro or Venue",
    shots: [SHOTS.control, SHOTS.advanced],
    sections: [
      {
        heading: "Every court live at the same time",
        paragraphs: [
          "Pro and Venue plans run concurrent live matches across your account, so each court or field has its own match, its own scorer and its own display link. Scoring happens in a browser, so the kit at each table is whatever laptop, tablet or phone is to hand.",
        ],
      },
      {
        heading: "Load the whole draw from a spreadsheet",
        paragraphs: [
          "Upload a CSV of fixtures and they appear in the dashboard's Upcoming tab, ready to start. Each row needs a sport and two team names, and can carry a competition or grade, a scheduled time and a match name. You can upload up to 500 fixtures at a time.",
          "ScoreHub lists what it read, and any rows it couldn't use, before anything is created. When a match is due, the scorer selects Start and the sport, teams and clock are already set.",
        ],
        help: { label: "Fixture upload format", path: "/running-a-match/dashboard-and-fixtures" },
      },
      {
        heading: "One dashboard for the whole event",
        paragraphs: [
          "The dashboard splits matches into Live, Upcoming and History. Filter by sport or competition, or search for a team, to find a court quickly. Ended matches move to History with the score locked, and can be reopened if a result needs correcting.",
        ],
      },
      {
        heading: "A team of scorers, each with the right access",
        paragraphs: [
          "Invite your scorers and give each one a role: Admins manage billing and the account, Managers handle tokens and display links, and Operators set up and score matches. If a scorer has to leave mid-match, the next one opens the match and takes control without losing the score.",
          "People who help more than one organisation switch between them from the dashboard, with a separate role in each.",
        ],
        help: { label: "Roles and permissions", path: "/account/roles-and-permissions" },
      },
      {
        heading: "Mixed-sport events on one account",
        paragraphs: [
          "All 21 sport templates are included on every plan, so a multi-sport event doesn't need a different system for each code. Netball on court one and futsal on court two each get the right periods, clock and score buttons.",
        ],
      },
      {
        heading: "Scores for the people who aren't courtside",
        paragraphs: [
          "Display links need no login. Put them on screens around the venue, add the overlay to a stream of the show court, or share a link so parents and teams can follow from their phones.",
        ],
      },
    ],
    faq: [
      {
        q: "How many matches can be live at once?",
        a: "Pro and Venue don't limit concurrent live matches. The Free plan allows one live match at a time across the account.",
      },
      {
        q: "Do scorers need their own accounts?",
        a: "Yes. Each scorer signs in with their own login. Invite them from the Account page and give them the Operator role so they can set up and score matches.",
      },
      {
        q: "Can spectators follow scores on their phones?",
        a: "Yes. Display links open in any browser without a login. Share the link for a match and it updates live as the scorer taps.",
      },
      {
        q: "Can we run different sports in the same event?",
        a: "Yes. Every match has its own sport, and a fixture upload can mix sports in the same file.",
      },
      {
        q: "What's the difference between Pro and Venue?",
        a: "Both allow concurrent live matches and fixture upload. Pro suits a single venue or club. Venue is sized for multi-court venues, national sports organisations and tournaments.",
      },
    ],
    cta: "Ready to run your next tournament from a browser?",
  },
  {
    slug: "streaming",
    name: "Streaming & broadcast",
    eyebrow: "For streamers and broadcast",
    title: "Scoreboard Overlay for OBS, vMix & Wirecast — ScoreHub",
    description:
      "A live scoreboard overlay and scorebug for OBS, vMix and Wirecast. Add one Browser Source with a transparent background and it updates itself as the match is scored.",
    h1: "Scoreboard overlay for OBS, vMix and Wirecast",
    lede: "You're on camera, commentary and the stream at once. Add ScoreHub as a Browser Source and the scorebug keeps itself up to date, scored from a phone, a keyboard or a Stream Deck.",
    summary: "A transparent score bar or scorebug that updates itself in OBS, vMix or Wirecast.",
    plan: "Any plan · Graphics add-on optional",
    shots: [SHOTS.overlay, SHOTS.scorebug],
    sections: [
      {
        heading: "Two overlays on every plan",
        paragraphs: [
          "Both overlays have transparent backgrounds, so they sit over your camera with no chroma key, and both are included on the Free plan.",
        ],
        bullets: [
          "Lower-third overlay: a full-width score bar for the top or bottom of the frame, at about 1920 × 120.",
          "Scorebug: a compact corner widget at about 480 × 100, in three sizes, positioned top or bottom, left or right.",
          "Fullscreen scoreboard: a 1920 × 1080 board to cut to at breaks and half time.",
        ],
      },
      {
        heading: "Set it up in OBS in a minute",
        paragraphs: ["The same link works as a Web Browser input in vMix or the equivalent source in Wirecast."],
        steps: [
          "Open the match's control panel, go to the Outputs tab and select Copy URL on the overlay or scorebug.",
          "In OBS, choose Sources, then +, then Browser.",
          "Paste the URL and set the width and height for that display.",
          "Drag the source into position over your camera.",
        ],
        help: { label: "OBS and vMix setup", path: "/displaying-your-score/obs-and-venue-screens" },
      },
      {
        heading: "A scorebug that updates itself",
        paragraphs: [
          "The overlay follows the live match, so there's no text source to retype. Score from the mobile panel on a phone, from keyboard shortcuts on the streaming PC, or hand the scoring to someone at the venue while you run the stream.",
          "On an Elgato Stream Deck, ScoreHub keys start and stop the clock, add points and change the period, and each key shows the live value. Webhooks do the same for anything that can send an HTTP request.",
        ],
        help: { label: "Stream Deck and webhooks", path: "/running-a-match/stream-deck-and-webhooks" },
      },
      {
        heading: "Broadcast scenes with the Graphics add-on",
        paragraphs: [
          "The Graphics add-on puts scene-driven graphics on one stable Browser Source: a lower third with both teams and scores, player stat cards, and player headshots with bios. A graphics operator switches scenes from a second device while the scorer keeps scoring, and the source URL never changes.",
          "Scenes use your match's accent colour and font. The player scenes are driven by a live player data feed; the lower third works on any match.",
        ],
        help: { label: "Using Graphics Operator", path: "/displaying-your-score/graphics-operator" },
      },
      {
        heading: "Feeding your own graphics engine",
        paragraphs: [
          "If you build graphics in Singular.live, Chyron or Vizrt, the Data Feed add-on gives them a token-authenticated JSON feed of the live match state: score, clock, period, team names, colours and logos.",
        ],
        help: { label: "Data Feed add-on", path: "/billing/data-feed-addon" },
      },
    ],
    faq: [
      {
        q: "Is the OBS scoreboard overlay free?",
        a: "Yes. The overlay and scorebug are included on the Free plan, with one live match at a time. Free displays carry a small \"Powered by ScoreHub\" mark, which Pro and Venue remove.",
      },
      {
        q: "Do I need a chroma key?",
        a: "No. The overlay, scorebug and graphics displays have transparent backgrounds, so they layer straight over your camera.",
      },
      {
        q: "Which streaming software does it work with?",
        a: "Anything that can show a web page as a source. That includes a Browser Source in OBS, a Web Browser input in vMix and the equivalent in Wirecast.",
      },
      {
        q: "Can the graphics use my team colours and logos?",
        a: "Team colours work on every plan. Team logos, a competition logo and a custom accent colour and font need Pro or Venue.",
      },
      {
        q: "Do I have to change the Browser Source for every match?",
        a: "Overlay and scorebug links belong to one match, so copy the new link for the next match. Stream Deck keys and the Graphics add-on's scene switching don't need the source changed during a match.",
      },
    ],
    cta: "Ready to put a live score on your stream?",
  },
];

export function getSolution(slug: string): Solution | undefined {
  return SOLUTIONS.find(s => s.slug === slug);
}
