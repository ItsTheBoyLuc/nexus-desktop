import { CalendarCheck, CalendarDays, ClipboardList, FileWarning, Gavel, ShieldAlert, Trophy, UserPlus, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, PageHeader } from '../components'
import { isLeaguePage, PAGE_LABELS, routes } from '../lib/routes'
import type { PageKey } from '../lib/routes'
import { useLeague } from './LeagueRoute'

const COPY: Record<PageKey, { icon: ReactNode; description: string }> = {
  calendar: { icon: <CalendarDays size={24} aria-hidden="true" />, description: 'Schedule races and sessions and keep every driver on the same timeline.' },
  teams: { icon: <Users size={24} aria-hidden="true" />, description: 'Manage teams and driver line-ups for this league.' },
  standings: { icon: <Trophy size={24} aria-hidden="true" />, description: 'See driver and team standings update as results come in.' },
  reports: { icon: <FileWarning size={24} aria-hidden="true" />, description: 'Review incident reports and apply penalties without leaving the app.' },
  penalties: { icon: <Gavel size={24} aria-hidden="true" />, description: 'Track penalty points, bans and expiry for every driver.' },
  'dirty-drivers': { icon: <ShieldAlert size={24} aria-hidden="true" />, description: 'Keep the list of drivers with repeated misconduct reports.' },
  attendance: { icon: <CalendarCheck size={24} aria-hidden="true" />, description: 'Set up race attendance and see who is racing.' },
  signups: { icon: <UserPlus size={24} aria-hidden="true" />, description: 'Open, close and review league sign-ups.' },
  esports: { icon: <ClipboardList size={24} aria-hidden="true" />, description: 'Manage the esports team: roster, events, results and announcements.' }
}

/** Placeholder for the screens of later phases. League pages exist for Formula 1 only. */
export function ComingSoon({ page }: { page: PageKey }) {
  const { guild, game } = useLeague()

  if (isLeaguePage(page) && game.key !== 'f1') {
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

  const { icon, description } = COPY[page]
  return (
    <div className="page">
      <PageHeader title={PAGE_LABELS[page]} description={`${guild.name} - ${game.label}`} />
      <EmptyState icon={icon} title="Coming in the next phase" description={description} />
    </div>
  )
}
