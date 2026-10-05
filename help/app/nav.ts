export interface NavLink {
  title: string;
  href: string;
}

export interface NavSection {
  title: string;
  href: string;
  links: NavLink[];
}

export const SPORT_LINKS: NavLink[] = [
  { title: "Netball", href: "/sports/netball" },
  { title: "Basketball", href: "/sports/basketball" },
  { title: "Rugby Union", href: "/sports/rugby-union" },
  { title: "Rugby League", href: "/sports/rugby-league" },
  { title: "Volleyball", href: "/sports/volleyball" },
  { title: "Football", href: "/sports/football" },
  { title: "Handball", href: "/sports/handball" },
  { title: "Hockey", href: "/sports/hockey" },
  { title: "Water Polo", href: "/sports/water-polo" },
  { title: "Tennis", href: "/sports/tennis" },
  { title: "Touch Rugby", href: "/sports/touch-rugby" },
  { title: "Futsal", href: "/sports/futsal" },
  { title: "Pickleball", href: "/sports/pickleball" },
  { title: "Badminton", href: "/sports/badminton" },
  { title: "Table Tennis", href: "/sports/table-tennis" },
  { title: "Floorball", href: "/sports/floorball" },
  { title: "Squash", href: "/sports/squash" },
  { title: "Lawn Bowls", href: "/sports/lawn-bowls" },
  { title: "Indoor Cricket", href: "/sports/indoor-cricket" },
  { title: "Softball", href: "/sports/softball" },
  { title: "Cricket", href: "/sports/cricket" },
  { title: "Custom Sport", href: "/sports/custom" },
];

export const NAV: NavSection[] = [
  {
    title: "Getting started",
    href: "/getting-started",
    links: [
      { title: "Getting started", href: "/getting-started" },
    ],
  },
  {
    title: "Running a match",
    href: "/running-a-match",
    links: [
      { title: "Using the control panel", href: "/running-a-match" },
      { title: "The dashboard and fixtures", href: "/running-a-match/dashboard-and-fixtures" },
      { title: "Sharing control of a match", href: "/running-a-match/sharing-control" },
      { title: "Scoring from a phone", href: "/running-a-match/scoring-from-a-phone" },
      { title: "Sound cues", href: "/running-a-match/sound-cues" },
      { title: "Stream Deck and webhooks", href: "/running-a-match/stream-deck-and-webhooks" },
    ],
  },
  {
    title: "Displays and graphics",
    href: "/displaying-your-score",
    links: [
      { title: "Displaying your score", href: "/displaying-your-score" },
      { title: "Venue screens, OBS and vMix", href: "/displaying-your-score/obs-and-venue-screens" },
      { title: "Branding your displays", href: "/displaying-your-score/branding" },
      { title: "Using Graphics Operator", href: "/displaying-your-score/graphics-operator" },
    ],
  },
  {
    title: "Consoles and data feeds",
    href: "/connecting-the-bridge",
    links: [
      { title: "Connecting a console (Bridge)", href: "/connecting-the-bridge" },
      { title: "ChampionData and Bridge updates", href: "/connecting-the-bridge/championdata-and-updates" },
    ],
  },
  {
    title: "Sports",
    href: "/sports",
    links: SPORT_LINKS,
  },
  {
    title: "Account management",
    href: "/account",
    links: [
      { title: "Account overview", href: "/account" },
      { title: "Signing in, passwords and passkeys", href: "/account/signing-in" },
      { title: "Roles & permissions", href: "/account/roles-and-permissions" },
      { title: "Inviting your team", href: "/account/inviting-your-team" },
      { title: "Switching organisations", href: "/account/switching-organisations" },
    ],
  },
  {
    title: "Billing",
    href: "/billing",
    links: [
      { title: "Plans & pricing", href: "/billing" },
      { title: "Upgrading & downgrading", href: "/billing/upgrading-and-downgrading" },
      { title: "The Free plan's one-match limit", href: "/billing/free-plan-limit" },
      { title: "Graphics Operator add-on", href: "/billing/graphics-addon" },
      { title: "Data Feed add-on", href: "/billing/data-feed-addon" },
      { title: "Invoices & payment methods", href: "/billing/invoices-and-payment-methods" },
      { title: "Cancelling your plan", href: "/billing/cancelling" },
    ],
  },
  {
    title: "Support",
    href: "/support",
    links: [
      { title: "Contact support", href: "/support" },
      { title: "Troubleshooting", href: "/support/troubleshooting" },
    ],
  },
];
