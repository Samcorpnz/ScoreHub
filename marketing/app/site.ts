import type { Metadata } from "next";

export const APP_URL = "https://app.scorehub.co.nz";
export const SITE_URL = "https://scorehub.co.nz";
export const HELP_URL = "https://help.scorehub.co.nz";
export const OG_IMAGE = { url: "/og-image.png", width: 1200, height: 630 };

// Child pages don't inherit the root layout's Open Graph/Twitter fields
// one by one — setting any replaces the lot — so each page builds a full set.
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: path,
      siteName: "ScoreHub",
      title,
      description,
      locale: "en_NZ",
      images: [{ ...OG_IMAGE, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OG_IMAGE.url],
    },
  };
}
