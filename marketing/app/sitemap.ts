import type { MetadataRoute } from "next";
import { SITE_URL } from "./site";
import { SPORTS } from "./sports-data";
import { SOLUTIONS } from "./solutions-data";

export const dynamic = "force-static";

// No lastModified: a build-time timestamp would claim every page changed on
// every deploy, which teaches crawlers to ignore it.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/pricing`, changeFrequency: "monthly", priority: 0.9 },
    ...SOLUTIONS.map(s => ({
      url: `${SITE_URL}/solutions/${s.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    { url: `${SITE_URL}/sports`, changeFrequency: "monthly", priority: 0.8 },
    ...SPORTS.map(s => ({
      url: `${SITE_URL}/sports/${s.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
