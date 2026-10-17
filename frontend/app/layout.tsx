import type { Metadata } from 'next'
import '@fontsource-variable/inter/index.css'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'ScoreHub',
  description: 'Sign in to ScoreHub to score live matches from your browser and put the score on venue screens and streams.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Samcorp ScoreHub',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#07090F" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
