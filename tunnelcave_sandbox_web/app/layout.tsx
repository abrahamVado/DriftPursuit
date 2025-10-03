import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'Tunnelcave Sandbox',
  description: 'Web HUD and world viewer for Drift Pursuit sandbox sessions.',
}

export default function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  //1.- Compose the HTML shell so Next.js can stream the React tree consistently.
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
