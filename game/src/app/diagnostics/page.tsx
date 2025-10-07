import type { Metadata } from 'next'
import { DiagnosticsPanel } from '@/components/DiagnosticsPanel'

export const metadata: Metadata = {
  title: 'DriftPursuit Diagnostics',
  description: 'Production build for verifying connectivity with the DriftPursuit broker.'
}

export default function DiagnosticsPage() {
  //1.- Surface the existing diagnostics panel within the app router so operators can access connectivity checks.
  return (
    <main style={{ padding: '2rem', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: 'min(720px, 100%)' }}>
        <DiagnosticsPanel />
      </div>
    </main>
  )
}
