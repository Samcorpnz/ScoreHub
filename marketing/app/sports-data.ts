// One entry per named sport template. Structure, clock, timeouts, buttons and
// options mirror frontend/app/sport-templates.ts and the per-sport guides in
// help/app/(docs)/sports — change them together.

export interface SportButton {
  label: string;
  desc: string;
}

export interface SportOption {
  name: string;
  choices: string[];
}

export interface SportSection {
  heading: string;
  body: string;
}

export interface Sport {
  /** URL slug here and on the help centre (/sports/<slug>). */
  slug: string;
  name: string;
  /** Mid-sentence form of the name. */
  lower: string;
  structure: string;
  clock: string;
  timeouts?: string;
  buttons: SportButton[];
  options?: SportOption[];
  /** One-line summary for cards and meta descriptions. */
  summary: string;
  intro: string;
  sections: SportSection[];
  /** Has its own scoring panel in place of the standard score buttons. */
  dedicatedPanel?: boolean;
  /** Clock counts down from a fixed period length. */
  countDown: boolean;
  related: string[];
}

export const SPORTS: Sport[] = [
  {
    slug: "netball",
    name: "Netball",
    lower: "netball",
    structure: "4 quarters × 15:00",
    clock: "15:00 countdown per quarter",
    timeouts: "1 per team",
    buttons: [
      { label: "+1", desc: "A standard goal from inside the goal circle." },
      { label: "+2", desc: "A Super Shot from the outer zone, for Fast5-style rules." },
    ],
    summary: "Four 15-minute quarters, goals and Super Shots, centre-pass possession.",
    intro:
      "ScoreHub's netball template is set up for four 15-minute quarters with a countdown clock, so a volunteer at the scorer's bench can run a full match from a laptop or tablet without touching a settings screen.",
    sections: [
      {
        heading: "Goals, Super Shots and the centre pass",
        body: "Each team has a +1 button for a standard goal and a +2 button for a Super Shot, with matching minus buttons for corrections. The possession control can mark which team has the next centre pass, and it shows on the display so the crowd and the bench can see it.",
      },
      {
        heading: "Quarter breaks handled in one tap",
        body: "End Quarter stops the clock, moves to the next quarter, resets the clock to 15:00 and tells every display it's a break. If you end a quarter early by mistake, Reopen takes you back.",
      },
      {
        heading: "A netball stats panel for data-fed matches",
        body: "When a match is fed from a ChampionData source through the ScoreHub Bridge app, the large venue display adds a netball stats panel next to the scoreboard. Matches scored by hand show the standard scoreboard.",
      },
    ],
    countDown: true,
    related: ["basketball", "volleyball", "futsal"],
  },
  {
    slug: "basketball",
    name: "Basketball",
    lower: "basketball",
    structure: "4 quarters × 10:00",
    clock: "10:00 countdown per quarter",
    timeouts: "5 per team",
    buttons: [
      { label: "FT (+1)", desc: "A free throw." },
      { label: "2PT (+2)", desc: "A field goal from inside the three-point line." },
      { label: "3PT (+3)", desc: "A field goal from beyond the three-point line." },
    ],
    summary: "Four 10-minute quarters, FT/2PT/3PT buttons, team fouls and overtime.",
    intro:
      "The basketball template runs four 10-minute quarters with a countdown clock and labelled FT, 2PT and 3PT buttons, so the score table can keep up with a fast game from a keyboard or a touchscreen.",
    sections: [
      {
        heading: "Team fouls that reset each quarter",
        body: "Every team has a Fouls counter under its score buttons. Ending a quarter resets both teams' fouls to zero for the next one, so nobody has to remember to clear them at the break.",
      },
      {
        heading: "Overtime is built in",
        body: "Any period after the fourth is treated as overtime and starts with 5:00 on the clock instead of 10:00. Possession shows next to the score, and the larger venue displays show each team's fouls and remaining timeouts (five to start).",
      },
      {
        heading: "Fast enough for a two-person table",
        body: "Keyboard shortcuts cover every score value for both teams, plus start and stop on the space bar. An Elgato Stream Deck can run the clock and score too, alongside whoever is on the control panel.",
      },
    ],
    countDown: true,
    related: ["netball", "futsal", "handball"],
  },
  {
    slug: "rugby-union",
    name: "Rugby Union",
    lower: "rugby union",
    structure: "2 halves × 40:00",
    clock: "Counts up from 0:00",
    buttons: [
      { label: "PEN/DG (+3)", desc: "A penalty goal or drop goal." },
      { label: "TRY (+5)", desc: "An unconverted try." },
      { label: "CONV TRY (+7)", desc: "A try plus a successful conversion." },
    ],
    summary: "Two halves on a count-up clock, with try, converted try and penalty buttons.",
    intro:
      "Rugby union halves rarely end on exactly 40:00, so ScoreHub's rugby union template counts the clock up from zero and leaves the call on half time to the person scoring.",
    sections: [
      {
        heading: "Score buttons that match the game",
        body: "Three labelled buttons cover the common scoring plays: PEN/DG for three, TRY for five and CONV TRY for seven. If the conversion comes later, add the try first and use the minus and plus buttons to adjust, or undo the last action.",
      },
      {
        heading: "You decide when the half ends",
        body: "The clock keeps running past 40:00 for stoppage time. Select End Half when the referee blows up; the clock stops, the period moves on and displays show the break.",
      },
    ],
    countDown: false,
    related: ["rugby-league", "touch-rugby", "football"],
  },
  {
    slug: "rugby-league",
    name: "Rugby League",
    lower: "rugby league",
    structure: "2 halves × 40:00",
    clock: "Counts up from 0:00",
    buttons: [
      { label: "CONV/PEN (+2)", desc: "A conversion or penalty goal." },
      { label: "TRY (+4)", desc: "An unconverted try." },
      { label: "CONV TRY (+6)", desc: "A try plus a successful conversion." },
    ],
    summary: "Two halves on a count-up clock, with four-point tries and two-point goals.",
    intro:
      "The rugby league template scores the game the way league is played: four for a try, two for a conversion or penalty goal, and a single button for a converted try.",
    sections: [
      {
        heading: "League point values out of the box",
        body: "CONV/PEN adds two, TRY adds four and CONV TRY adds six. There's no setup to do: pick Rugby League when you create the match and the buttons are already labelled.",
      },
      {
        heading: "A clock that follows the referee",
        body: "The clock counts up from 0:00 in each half and doesn't stop itself at 40 minutes. Stop it for injuries, start it again, and end the half when the hooter goes.",
      },
    ],
    countDown: false,
    related: ["rugby-union", "touch-rugby", "football"],
  },
  {
    slug: "volleyball",
    name: "Volleyball",
    lower: "volleyball",
    structure: "Best of 5 sets",
    clock: "Counts up from 0:00",
    timeouts: "2 per team",
    buttons: [{ label: "+1", desc: "A point, awarded on every rally." }],
    summary: "Best of five sets, rally-point scoring, scores reset every set.",
    intro:
      "Volleyball is scored a rally at a time, so the volleyball template keeps it to one large point button per team and resets the score to 0–0 at the end of every set.",
    sections: [
      {
        heading: "Set-by-set scoring",
        body: "Select End Set and ScoreHub moves to the next set and puts both teams back on zero. The current set number shows on every display. ScoreHub shows the score within the current set; it doesn't keep a tally of sets won.",
      },
      {
        heading: "Timeouts on the scoreboard",
        body: "Each team starts with two timeouts. Tap Timeouts left when a team calls one and the count updates on the larger venue displays.",
      },
    ],
    countDown: false,
    related: ["badminton", "netball", "pickleball"],
  },
  {
    slug: "football",
    name: "Football",
    lower: "football",
    structure: "2 halves × 45:00",
    clock: "Counts up from 0:00",
    buttons: [{ label: "+1", desc: "A goal." }],
    summary: "Two halves on a count-up clock with a single goal button per team.",
    intro:
      "Football needs very little from a scoreboard: the score, the half and a clock that runs up through stoppage time. The football template gives you exactly that.",
    sections: [
      {
        heading: "A running clock, like the stadium board",
        body: "The clock counts up from 0:00 and keeps going past 45:00 until you end the half. Stop it if your competition stops the clock; otherwise leave it running.",
      },
      {
        heading: "One key per goal",
        body: "With a single score value, the whole match can be run from four keys and the space bar. That makes football a good first match for a new volunteer scorer.",
      },
    ],
    countDown: false,
    related: ["futsal", "hockey", "rugby-union"],
  },
  {
    slug: "handball",
    name: "Handball",
    lower: "handball",
    structure: "2 halves × 30:00",
    clock: "30:00 countdown per half",
    timeouts: "3 per team",
    buttons: [{ label: "+1", desc: "A goal." }],
    summary: "Two 30-minute halves on a countdown clock, three timeouts per team.",
    intro:
      "Handball is high scoring and quick, so the handball template pairs a 30-minute countdown with one large goal button per team and three team timeouts.",
    sections: [
      {
        heading: "Built for a high-scoring game",
        body: "Goals come every minute or so in handball. A single +1 button per team, with keyboard shortcuts for both, keeps the scorer's eyes on the court instead of the screen.",
      },
      {
        heading: "Team timeouts tracked for you",
        body: "Each team starts with three timeouts. The remaining count shows on the larger venue displays and drops by one each time you record a timeout.",
      },
    ],
    countDown: true,
    related: ["futsal", "basketball", "floorball"],
  },
  {
    slug: "hockey",
    name: "Hockey",
    lower: "hockey",
    structure: "4 quarters × 15:00",
    clock: "15:00 countdown per quarter",
    timeouts: "1 per team",
    buttons: [{ label: "+1", desc: "A goal." }],
    summary: "Four 15-minute quarters on a countdown clock with a goal button per team.",
    intro:
      "The hockey template follows the modern four-quarter format: 15 minutes a quarter on a countdown clock, with the quarter number and the break shown on every screen.",
    sections: [
      {
        heading: "Quarters and breaks",
        body: "End Quarter stops the clock, advances the quarter and resets to 15:00. Displays show that it's a break until play restarts, which is useful on a turf with a single scoreboard at one end.",
      },
      {
        heading: "Works at the turf",
        body: "Scoring runs in a browser over a normal internet connection, so a phone on mobile data can score the match while the clubrooms screen shows it.",
      },
    ],
    countDown: true,
    related: ["football", "floorball", "netball"],
  },
  {
    slug: "water-polo",
    name: "Water Polo",
    lower: "water polo",
    structure: "4 quarters × 8:00",
    clock: "8:00 countdown per quarter",
    timeouts: "2 per team",
    buttons: [{ label: "+1", desc: "A goal." }],
    summary: "Four 8-minute quarters, a countdown clock, possession and timeouts.",
    intro:
      "Water polo runs four 8-minute quarters of stopped time. The water polo template gives the desk a countdown clock that starts and stops on a single key, with possession and timeouts alongside.",
    sections: [
      {
        heading: "Stopped time without the fuss",
        body: "Start and stop the clock from the space bar, the large on-screen button or a Stream Deck key. Nudge it by 1, 10 or 60 seconds, or type an exact time, if the desk and the referee disagree.",
      },
      {
        heading: "Possession and timeouts poolside",
        body: "The template starts with possession shown and two timeouts per team. Possession shows on every scoreboard display, and timeouts on the larger venue displays, so teams can see them from across the pool.",
      },
    ],
    countDown: true,
    related: ["handball", "basketball", "hockey"],
  },
  {
    slug: "tennis",
    name: "Tennis",
    lower: "tennis",
    structure: "Best of 3 or 5 sets",
    clock: "Counts up from 0:00",
    buttons: [{ label: "+1", desc: "Adds one to that player's score in the current set." }],
    options: [{ name: "Match format", choices: ["Best of 3 — most tour, club and doubles matches", "Best of 5 — Grand Slam men's singles"] }],
    summary: "Best of 3 or 5 sets with a running score that resets each set.",
    intro:
      "The tennis template is a simple set-by-set scoreboard: choose best of three or five when you create the match, add to each player's score as the set goes on, and end the set to start the next from 0–0.",
    sections: [
      {
        heading: "Best of 3 or best of 5",
        body: "Pick the format when you set up the match. The control panel shows where you are, for example Set 2 of 3, and won't go past the final set.",
      },
      {
        heading: "What it does and doesn't track",
        body: "ScoreHub keeps one running score per player for the current set and resets it when the set ends. It doesn't track 15/30/40 game points or keep a tally of sets won, so it suits a courtside games scoreboard more than a full umpire's scoring system.",
      },
    ],
    countDown: false,
    related: ["squash", "badminton", "pickleball"],
  },
  {
    slug: "touch-rugby",
    name: "Touch Rugby",
    lower: "touch rugby",
    structure: "2 halves × 40:00",
    clock: "40:00 countdown per half",
    buttons: [{ label: "+1", desc: "A touchdown." }],
    summary: "Two halves on a countdown clock with a touchdown button per team.",
    intro:
      "Touch modules often run a dozen fields at once with volunteer scorers. The touch rugby template keeps it to a countdown clock and one touchdown button per team.",
    sections: [
      {
        heading: "Set the clock to your module's game length",
        body: "The template starts each half at 40:00. Most touch competitions play shorter games, so type your own half length into the clock and select Set before kick-off.",
      },
      {
        heading: "Made for multi-field afternoons",
        body: "On a Pro or Venue plan every field can be live at the same time, each with its own scorer on a phone and its own display link.",
      },
    ],
    countDown: true,
    related: ["rugby-union", "rugby-league", "football"],
  },
  {
    slug: "futsal",
    name: "Futsal",
    lower: "futsal",
    structure: "2 halves × 20:00",
    clock: "20:00 countdown per half",
    timeouts: "1 per team",
    buttons: [{ label: "+1", desc: "A goal." }],
    summary: "Two 20-minute halves, stopped-time countdown, one timeout per team.",
    intro:
      "Futsal is played to a stopped clock, which is hard to run on a wall timer. The futsal template gives the bench a 20-minute countdown that stops and starts on a key press.",
    sections: [
      {
        heading: "Stopped-time halves",
        body: "The clock counts down from 20:00 and only runs while you have it started. End Half stops it, moves to the second half and resets to 20:00.",
      },
      {
        heading: "Fouls and timeouts on show",
        body: "Each team has a running count under its score that you can use for accumulated fouls, plus one timeout. Both appear on the larger venue displays.",
      },
    ],
    countDown: true,
    related: ["football", "handball", "basketball"],
  },
  {
    slug: "pickleball",
    name: "Pickleball",
    lower: "pickleball",
    structure: "Best of 3 games to 11",
    clock: "Counts up from 0:00",
    timeouts: "2 per team",
    buttons: [{ label: "+1", desc: "A point." }],
    summary: "Best of three games to 11, with scores resetting each game.",
    intro:
      "The pickleball template scores best of three games to 11. Each side has one point button, and ending a game puts both sides back on zero for the next.",
    sections: [
      {
        heading: "Game-by-game scoring",
        body: "End Game moves to the next game and resets the score to 0–0. ScoreHub shows the score in the current game; it doesn't end a game for you at 11 or keep a tally of games won.",
      },
      {
        heading: "Easy to run from the sideline",
        body: "One button per side means a player sitting out can score from a phone. Two timeouts per team are tracked on the larger venue displays.",
      },
    ],
    countDown: false,
    related: ["badminton", "tennis", "table-tennis"],
  },
  {
    slug: "badminton",
    name: "Badminton",
    lower: "badminton",
    structure: "Best of 3 games to 21",
    clock: "Counts up from 0:00",
    timeouts: "1 per team",
    buttons: [{ label: "+1", desc: "A point." }],
    summary: "Best of three games to 21, rally-point scoring, per-game reset.",
    intro:
      "Badminton is rally-point scoring to 21, best of three games. The badminton template keeps one point button per side and resets the score when a game ends.",
    sections: [
      {
        heading: "Rally points, one tap each",
        body: "Add a point for whoever wins the rally. A minus button and Undo cover mis-taps, and you can step back through your last 50 actions.",
      },
      {
        heading: "One screen per court",
        body: "Give each court its own match and its own display link. A hall with six courts can run six scoreboards from six phones on a Pro or Venue plan.",
      },
    ],
    countDown: false,
    related: ["pickleball", "table-tennis", "squash"],
  },
  {
    slug: "table-tennis",
    name: "Table Tennis",
    lower: "table tennis",
    structure: "Best of 7 games to 11",
    clock: "Counts up from 0:00",
    timeouts: "1 per team",
    buttons: [{ label: "+1", desc: "A point." }],
    summary: "Best of seven games to 11, with a per-game score reset.",
    intro:
      "The table tennis template is set up for best of seven games to 11, with a single point button per player and a fresh 0–0 at the start of each game.",
    sections: [
      {
        heading: "Up to seven games",
        body: "End Game advances the game number and resets both scores. The game number shows on the display, so spectators can follow a long match.",
      },
      {
        heading: "A scoreboard for every table",
        body: "Any phone or tablet with a browser can be the scoreboard for a table, or the scorer's control panel. There's nothing to install on either.",
      },
    ],
    countDown: false,
    related: ["badminton", "squash", "pickleball"],
  },
  {
    slug: "floorball",
    name: "Floorball",
    lower: "floorball",
    structure: "3 periods × 20:00",
    clock: "20:00 countdown per period",
    timeouts: "1 per team",
    buttons: [{ label: "+1", desc: "A goal." }],
    summary: "Three 20-minute periods on a countdown clock, one timeout per team.",
    intro:
      "Floorball plays three 20-minute periods. The floorball template sets the period count, labels and countdown for you, so the secretariat only has to start the clock.",
    sections: [
      {
        heading: "Three periods, labelled properly",
        body: "Displays show Period 1, 2 and 3 instead of quarters or halves. End Period stops the clock, moves on and resets it to 20:00.",
      },
      {
        heading: "Goals, timeouts and a count for penalties",
        body: "Each team has a goal button, one timeout and a running count under the score that you can use however your competition needs.",
      },
    ],
    countDown: true,
    related: ["hockey", "handball", "futsal"],
  },
  {
    slug: "squash",
    name: "Squash",
    lower: "squash",
    structure: "Best of 5 games to 11",
    clock: "Counts up from 0:00",
    buttons: [{ label: "+1", desc: "A point." }],
    options: [{ name: "Match format", choices: ["Best of 5 — WSF / PSA major events", "Best of 3 — circuit and club events"] }],
    summary: "Best of 5 or best of 3 games to 11, with a per-game reset.",
    intro:
      "The squash template scores point-a-rally games to 11, in best of five or best of three. Pick the format when you create the match and the control panel keeps you inside it.",
    sections: [
      {
        heading: "Best of 5 or best of 3",
        body: "The panel shows where you are in the match, for example Game 2 of 3, and the End Game button changes to Final Game on the last one.",
      },
      {
        heading: "A display for the glass-back court",
        body: "Put the score on a screen above the court or on a stream of the show court. ScoreHub shows the score in the current game; it doesn't keep a tally of games won.",
      },
    ],
    countDown: false,
    related: ["tennis", "badminton", "table-tennis"],
  },
  {
    slug: "lawn-bowls",
    name: "Lawn Bowls",
    lower: "lawn bowls",
    structure: "21 ends",
    clock: "Counts up from 0:00",
    buttons: [{ label: "+1 to +4", desc: "The number of shots won on an end." }],
    summary: "21 ends, with one to four shots scored per end.",
    intro:
      "Bowls is scored an end at a time, so the lawn bowls template swaps quarters for 21 ends and gives each team buttons for one, two, three or four shots.",
    sections: [
      {
        heading: "Score an end in one tap",
        body: "When the end is measured, tap the number of shots for the winning team and move to the next end. The end number and running total show on the display.",
      },
      {
        heading: "A scoreboard the clubrooms can read",
        body: "Put the display on the clubrooms TV or share the link so members can follow from their phones. Text size can be scaled up on Pro and Venue plans for screens a long way from the green.",
      },
    ],
    countDown: false,
    related: ["cricket", "indoor-cricket", "squash"],
  },
  {
    slug: "indoor-cricket",
    name: "Indoor Cricket",
    lower: "indoor cricket",
    structure: "2 × 8-over innings",
    clock: "Counts up from 0:00",
    buttons: [
      { label: "+1, +2, +4, +6", desc: "Runs scored off a delivery." },
      { label: "Wicket", desc: "Takes the wicket penalty off the batting team's score." },
    ],
    options: [{ name: "Wicket penalty", choices: ["−5 runs — Cricket NZ standard", "−2 runs — ICF international"] }],
    summary: "Two innings, run buttons and a wicket button that deducts the penalty.",
    intro:
      "Indoor cricket takes runs off for a wicket instead of dismissing the batter, which most scoreboards can't do. ScoreHub's indoor cricket template has a wicket button that does it for you.",
    sections: [
      {
        heading: "Wickets that deduct runs",
        body: "Choose a 5-run or 2-run wicket penalty when you set up the match. Each Wicket tap takes that many runs off the team's score and adds one to its wicket count. Scores stop at zero and a wicket can be undone like any other action.",
      },
      {
        heading: "Runs and wickets on screen",
        body: "Displays show each team as runs/wickets, for example 42/3, and the large venue display adds an indoor cricket stats panel beside the scoreboard.",
      },
    ],
    countDown: false,
    related: ["cricket", "softball", "netball"],
  },
  {
    slug: "softball",
    name: "Softball",
    lower: "softball",
    structure: "7 innings (fastpitch) or 6 (slowpitch)",
    clock: "Counts up from 0:00",
    buttons: [
      { label: "Ball / Strike / Out", desc: "Track the count. The fourth ball is a walk and the third strike records an out." },
      { label: "+1 run", desc: "Add a run each time a runner scores." },
      { label: "End Half-Inning", desc: "Moves from top to bottom, or on to the next inning, and clears the count and outs." },
    ],
    options: [{ name: "Format", choices: ["Fastpitch — WBSC international, 7 innings", "Slowpitch — community and social, 6 innings"] }],
    summary: "A dedicated panel for balls, strikes, outs, innings and runs.",
    intro:
      "Softball doesn't fit a clock-and-score scoreboard, so ScoreHub gives it its own scoring panel: balls, strikes, outs, top or bottom of the inning, and runs for each team.",
    sections: [
      {
        heading: "The count, kept for you",
        body: "Tap Ball, Strike or Out as the plate umpire calls them. A fourth ball resets the count for the next batter, a third strike records an out, and the third out ends the half-inning. Slowpitch starts every batter on a 1–1 count.",
      },
      {
        heading: "Fastpitch and slowpitch",
        body: "Choose the format when you create the match: seven innings for fastpitch, six for slowpitch. In fastpitch a mercy-rule prompt appears from the sixth inning when one team leads by eight or more, as a cue for the umpire's call.",
      },
      {
        heading: "A softball stats panel on the big screen",
        body: "The large venue display adds a softball panel beside the scoreboard, showing the count, outs and format alongside the runs.",
      },
    ],
    dedicatedPanel: true,
    countDown: false,
    related: ["cricket", "indoor-cricket", "netball"],
  },
  {
    slug: "cricket",
    name: "Cricket",
    lower: "cricket",
    structure: "T20, ODI or Test",
    clock: "Counts up from 0:00",
    buttons: [
      { label: "• 1 2 3 4 6", desc: "Runs off the ball, or a dot ball." },
      { label: "Wide / No-ball / Bye / Leg-bye", desc: "Mark the ball as an extra before choosing the runs." },
      { label: "Wicket", desc: "Choose how the batter was out and who comes in next." },
    ],
    options: [{ name: "Format", choices: ["T20 — 20 overs per side", "ODI — 50 overs per side", "Test — up to 2 innings per side, multi-day"] }],
    summary: "Ball-by-ball scoring for T20, ODI and Test, with batter and bowler figures.",
    intro:
      "Cricket gets a full ball-by-ball scoring panel. Record each delivery and ScoreHub keeps the score, overs, batter and bowler figures, strike and extras for you, in T20, ODI or Test format.",
    sections: [
      {
        heading: "Ball-by-ball, with the bookkeeping done",
        body: "Wides and no-balls don't count towards the over. Strike changes on odd runs and at the end of each over. After six legal balls the over completes, the bowler's figures update and a maiden is counted if no runs came from it. A free hit is flagged after a no-ball.",
      },
      {
        heading: "Squads, wickets and bowling changes",
        body: "Enter up to 11 players a side when you create the match. For each wicket you choose the dismissal (bowled, caught, lbw, run out, stumped and more) and the next batter. Change the bowler from the squad list at the end of each over.",
      },
      {
        heading: "Chases, declarations and the follow-on",
        body: "In the second innings of a T20 or ODI the panel shows the target with runs and balls remaining. Test matches add declarations, the follow-on decision and the day and session shown with the score.",
      },
      {
        heading: "A cricket scorecard on the big screen",
        body: "The large venue display adds a cricket stats panel beside the scoreboard, so the clubrooms can see more than the total.",
      },
    ],
    dedicatedPanel: true,
    countDown: false,
    related: ["indoor-cricket", "softball", "lawn-bowls"],
  },
];

export function getSport(slug: string): Sport | undefined {
  return SPORTS.find(s => s.slug === slug);
}
