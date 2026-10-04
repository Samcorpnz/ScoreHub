const CATEGORIES = [
  {
    href: "/getting-started",
    title: "Getting started",
    description: "Create your first match, score it from the control panel, and get your score on screen.",
  },
  {
    href: "/running-a-match",
    title: "Running a match",
    description: "The control panel, keyboard shortcuts, fixtures, sound cues, and Stream Deck.",
  },
  {
    href: "/displaying-your-score",
    title: "Displays and graphics",
    description: "Venue screens, OBS and vMix overlays, branding, and Graphics Operator.",
  },
  {
    href: "/connecting-the-bridge",
    title: "Consoles and data feeds",
    description: "Connect a scoring console or a ChampionData feed with the Bridge app.",
  },
  {
    href: "/sports",
    title: "Sports",
    description: "Setup and scoring guides for every sport ScoreHub supports.",
  },
  {
    href: "/account",
    title: "Account management",
    description: "Signing in, roles, inviting your team, and switching between organisations.",
  },
  {
    href: "/billing",
    title: "Billing",
    description: "Plans, add-ons, upgrading, invoices, and cancelling.",
  },
  {
    href: "/support",
    title: "Support",
    description: "Troubleshooting and how to reach the ScoreHub team.",
  },
];

export default function HelpHome() {
  return (
    <>
      <div className="hero">
        <h1>How can we help?</h1>
        <p>
          Setup guides for every sport, plus everything on running matches, managing your
          organisation, and billing.
        </p>
      </div>
      <div className="category-grid">
        {CATEGORIES.map(c => (
          <a key={c.href} href={c.href} className="category-card">
            <h2>{c.title}</h2>
            <p>{c.description}</p>
          </a>
        ))}
      </div>
    </>
  );
}
