import { CalendarDays, FileWarning, Trophy, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { EmptyState, PageHeader } from '../components'
import { PAGE_LABELS } from '../lib/routes'
import type { PageKey } from '../lib/routes'

type PlaceholderPage = Exclude<PageKey, 'overview' | 'announcement'>

const COPY: Record<PlaceholderPage, { icon: ReactNode; description: string }> = {
  calendar: { icon: <CalendarDays size={24} aria-hidden="true" />, description: 'Schedule races and sessions and keep every driver on the same timeline.' },
  reports: { icon: <FileWarning size={24} aria-hidden="true" />, description: 'Review incident reports and apply penalties without leaving the app.' },
  standings: { icon: <Trophy size={24} aria-hidden="true" />, description: 'See driver and team standings update as results come in.' },
  teams: { icon: <Users size={24} aria-hidden="true" />, description: 'Manage teams and driver line-ups for this league.' }
}

export function ComingSoon({ page }: { page: PlaceholderPage }) {
  const { icon, description } = COPY[page]
  return (
    <div className="page">
      <PageHeader title={PAGE_LABELS[page]} />
      <EmptyState icon={icon} title="Coming in the next phase" description={description} />
    </div>
  )
}
