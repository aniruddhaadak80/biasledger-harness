import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { PRODUCT } from '@/lib/product'
import './globals.css'

export const metadata: Metadata = {
  title: PRODUCT.name,
  description: PRODUCT.tagline,
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

/**
 * Fonts are linked, not imported at build time.
 *
 * `next/font` would fetch Public Sans and Roboto Mono during `next build`, which makes the
 * build fail on a machine without network and pins a build-time dependency to a third-party
 * host. A stylesheet link degrades to the system stack instead, which is the right failure for
 * a documentation-grade surface.
 */
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Public+Sans:ital,wght@0,400;0,600;0,650;1,400&family=Roboto+Mono:wght@400;500&display=swap'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONT_HREF} />
      </head>
      <body>
        <div className="shell">
          <header className="site-header">
            <div className="container">
              <Link href="/" className="brand">
                <span>{PRODUCT.name}</span>
                <span className="brand-mark" aria-hidden="true">
                  #
                </span>
              </Link>
              <nav className="site-nav" aria-label="Main">
                <Link href="/">Board</Link>
                <Link href="/evidence">Evidence</Link>
                <Link href="/surfaces">Surfaces</Link>
                <Link href="/health">Health</Link>
              </nav>
            </div>
          </header>

          <main>
            <div className="container">{children}</div>
          </main>

          <footer className="site-footer">
            <div className="container">
              <span className="mono">
                {PRODUCT.name} v{PRODUCT.version} — Apache-2.0. Deterministic core, one registry, four
                front-ends.
              </span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
