import type { MetadataRoute } from "next";
import { NAV } from "./nav";

export const dynamic = "force-static";

const HELP_URL = "https://help.scorehub.co.nz";

// Built from the sidebar nav, so a page added there is listed here too.
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = new Set<string>(["/"]);
  for (const section of NAV) {
    paths.add(section.href);
    for (const link of section.links) paths.add(link.href);
  }
  return [...paths].map(path => ({
    url: path === "/" ? HELP_URL : `${HELP_URL}${path}`,
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : 0.6,
  }));
}
