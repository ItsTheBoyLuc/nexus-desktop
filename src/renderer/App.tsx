import { Logo } from './components'

export function App() {
  return (
    <main style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Logo size={48} />
        <h1>Nexus</h1>
      </div>
    </main>
  )
}
