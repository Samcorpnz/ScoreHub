import localFont from "next/font/local";

// Oswald is bundled in the repo (font-files/, SIL Open Font License) rather
// than loaded through next/font/google, which downloads it from Google Fonts
// during every build — a failed fetch there failed CI. It's the variable
// font, so one file covers every weight the site uses (500–700).
export const oswald = localFont({
  src: "./font-files/oswald-latin-variable.woff2",
  weight: "200 700",
  variable: "--font-display",
  display: "swap",
});
