// Captured from the real app (a local docker-compose stack) into
// public/screenshots. Sizes are the capture sizes, so the browser can reserve
// the space before the image loads.
export interface Shot {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
}

export const SHOTS = {
  control: {
    src: "/screenshots/control-panel.png",
    alt: "ScoreHub control panel scoring a basketball match: start button, undo, end quarter, and +1, +2 and +3 buttons for each team",
    caption: "The browser control panel, scoring a basketball match.",
    width: 1040,
    height: 900,
  },
  controlCricket: {
    src: "/screenshots/control-panel-cricket.png",
    alt: "ScoreHub cricket scoring panel showing 21/1 after 1.5 overs, batter and bowler figures, extras and run buttons, and a wicket button",
    caption: "The ball-by-ball cricket panel, with batter and bowler figures kept for you.",
    width: 1040,
    height: 900,
  },
  advanced: {
    src: "/screenshots/display-advanced.png",
    alt: "ScoreHub advanced venue scoreboard display showing Sharks 47, Magic 42, the game clock, quarter, possession and timeouts",
    caption: "The advanced venue display, as it appears on a scoreboard TV.",
    width: 1280,
    height: 720,
  },
  fullscreen: {
    src: "/screenshots/display-fullscreen.png",
    alt: "ScoreHub fullscreen scoreboard display filling the screen with both team scores and the game clock",
    caption: "The fullscreen display, for a projector, second monitor or capture card.",
    width: 1280,
    height: 720,
  },
  cricket: {
    src: "/screenshots/display-cricket.png",
    alt: "ScoreHub cricket scoreboard display showing Titans 21/1, current run rate, batting and bowling figures and the balls of the current over",
    caption: "The venue display for cricket, with the stats panel under the score.",
    width: 1280,
    height: 720,
  },
  overlay: {
    src: "/screenshots/overlay.png",
    alt: "ScoreHub lower-third scoreboard overlay with a transparent background, showing both team scores, clock and quarter over video",
    caption: "The lower-third overlay. Its background is transparent; the colour here stands in for your camera.",
    width: 1280,
    height: 160,
  },
  scorebug: {
    src: "/screenshots/scorebug.png",
    alt: "ScoreHub corner scorebug with a transparent background, showing team abbreviations, scores, clock and quarter over video",
    caption: "The scorebug, positioned top right.",
    width: 640,
    height: 240,
  },
} satisfies Record<string, Shot>;
