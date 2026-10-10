import type { MetadataRoute } from 'next'

// The marketing site (scorehub.co.nz) is what should rank; here only the
// sign-in pages are worth crawling. Display links carry a per-match access
// token, so they stay out of search engines entirely.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/login', '/signup'],
      disallow: '/',
    },
  }
}
