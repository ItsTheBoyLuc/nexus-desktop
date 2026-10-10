import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, PageHeader } from '../components'
import { PAGE_LABELS, routes } from '../lib/routes'
import type { PageKey } from '../lib/routes'
import { useLeague } from './LeagueRoute'

/** The League pages exist for Formula 1 only: any other game is pointed at its Esports team page. */
export function F1Only({ page, children }: { page: PageKey; children: ReactNode }) {
  const { guild, game } = useLeague()
  if (game.key === 'f1') return <>{children}</>
  return (
    <div className="page">
      <PageHeader title={PAGE_LABELS[page]} />
      <EmptyState
        title="Only Formula 1 has a league"
        description={`${game.label} has the Esports team module. The League modules are available for Formula 1.`}
        action={
          <Link className="btn btn--secondary" to={routes.game(guild.id, game.key, 'esports')}>
            Open Esports team
          </Link>
        }
      />
    </div>
  )
}
