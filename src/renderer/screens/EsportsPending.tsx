import { ClipboardList } from 'lucide-react'
import { EmptyState, PageHeader } from '../components'
import { ESPORTS_PAGE_LABELS } from '../lib/routes'
import type { EsportsPageKey } from '../lib/routes'
import { EsportsNote, useEsports } from './EsportsRoute'

const DESCRIPTION: Record<EsportsPageKey, string> = {
  teams: '',
  events: '',
  results: 'The append-only results archive and the team stats of this game.',
  attendance: 'Attendance posts with the Available and Not Available buttons.',
  announcement: 'Announcements posted for this game.'
}

/** The esports pages that come in the next part of milestone 5 (results, attendance and the per-game announcement). */
export function EsportsPending({ page }: { page: EsportsPageKey }) {
  const ctx = useEsports()
  return (
    <div className="page">
      <PageHeader title={ESPORTS_PAGE_LABELS[page]} description={`${ctx.guild.name} - ${ctx.gameLabel} esports team`} />
      <EsportsNote game={ctx.game} gameLabel={ctx.gameLabel} />
      <EmptyState icon={<ClipboardList size={24} aria-hidden="true" />} title="Coming in the next step" description={DESCRIPTION[page]} />
    </div>
  )
}
