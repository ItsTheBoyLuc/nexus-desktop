import { CalendarDays, Pencil, Plus, RotateCw, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { EVENT_TYPES } from '../../shared/types'
import type { Calendar as CalendarData, CalendarRound, NextRace } from '../../shared/types'
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingRegion, Notice, PageHeader, Select, Skeleton, SortHeader, Stagger, TextField, useToast, WriteProblemNotice } from '../components'
import { useCalendar, useGuildChannels, useNextRace } from '../hooks/data'
import { useSettings } from '../hooks/settings'
import { useWriteAction } from '../hooks/useWriteAction'
import { addRoundBlocker, isTbdDate, matchesDateFilter, ROUND_GETTERS, roundLabel } from '../lib/calendarView'
import type { CalendarColumn, DateFilter } from '../lib/calendarView'
import { describeError, errorCode, unwrap, writeProblem } from '../lib/errors'
import type { WriteProblem } from '../lib/errors'
import { formatCountdown, plural } from '../lib/format'
import { invalidateCalendar } from '../lib/invalidation'
import { matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'
import { F1Only } from './F1Only'
import { PostCalendarDialog } from './PostCalendarDialog'
import { RoundDialog } from './RoundDialog'
import { useLeague } from './LeagueRoute'

const typeTone = (eventType: string): 'neutral' | 'primary' | 'success' => (eventType === 'Sprint Weekend' ? 'primary' : eventType === 'Full Qualifying' ? 'success' : 'neutral')

function DateCell({ round }: { round: CalendarRound }) {
  return isTbdDate(round.date) ? <Badge>TBD</Badge> : <span>{round.date}</span>
}
function TimeCell({ round }: { round: CalendarRound }) {
  return round.time === '' ? <Badge>TBD</Badge> : <span>{round.time}</span>
}

function NextRaceCard({ guildId }: { guildId: string }) {
  const next = useNextRace(guildId)
  return (
    <section aria-labelledby="next-race-heading" className="stack stack--tight">
      <h2 id="next-race-heading" className="section-title">
        Next race
      </h2>
      <Card>
        {next.status === 'loading' ? (
          <LoadingRegion label="Loading the next race">
            <Skeleton width="40%" height={22} />
            <Skeleton width="60%" height={14} />
          </LoadingRegion>
        ) : null}
        {next.status === 'error' ? (
          <div className="inline-state" role="alert">
            <span>Could not load the next race. {describeError(next.error)}</span>
            <Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={next.reload}>
              Try again
            </Button>
          </div>
        ) : null}
        {next.status === 'ready' && next.data === null ? <p className="muted">There is no calendar yet, so there is no next race. Add a round to start one.</p> : null}
        {next.status === 'ready' && next.data !== null ? <NextRaceBody race={next.data} /> : null}
      </Card>
    </section>
  )
}

function NextRaceBody({ race }: { race: NextRace }) {
  const { race: round } = race
  return (
    <div className="next-event">
      <CalendarDays size={22} aria-hidden="true" className="quick-action__icon" />
      <div className="next-event__text">
        <span className="next-event__name">
          {round.flag ? `${round.flag} ` : ''}
          {round.name}
        </span>
        <span className="muted">
          Round {round.round} - {isTbdDate(round.date) ? 'date TBD' : round.date}
          {round.time ? ` at ${round.time}` : ', time TBD'}
        </span>
        <span className="next-event__meta">
          <Badge tone={typeTone(round.eventType)}>{round.eventType}</Badge>
          {race.upcoming && race.countdownHours !== null ? (
            <Badge tone="primary">{race.countdown ? `${race.countdown.days}d ${race.countdown.hours}h` : formatCountdown(race.countdownHours)}</Badge>
          ) : (
            <Badge>No upcoming race</Badge>
          )}
        </span>
        {!race.upcoming ? <span className="muted">Every round is in the past, so this is the last round of the calendar.</span> : null}
      </div>
    </div>
  )
}

function RoundTable({ calendar, busy, onEdit, onDelete }: { calendar: CalendarData; busy: boolean; onEdit: (round: CalendarRound) => void; onDelete: (round: CalendarRound) => void }) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [sort, setSort] = useState<SortState<CalendarColumn> | null>({ key: 'round', direction: 'asc' })

  const filtered = calendar.rounds.filter(
    (round) => matchesQuery([round.name, round.date, round.time, round.eventType, String(round.round), round.flag], query) && (typeFilter === 'all' || round.eventType === typeFilter) && matchesDateFilter(round, dateFilter)
  )
  const rows = sortRows(filtered, sort, ROUND_GETTERS)
  const filtering = query.trim() !== '' || typeFilter !== 'all' || dateFilter !== 'all'
  const onSort = (column: CalendarColumn): void => setSort((current) => nextSort(current, column))

  return (
    <div className="stack stack--tight">
      <div className="table-tools">
        <div className="table-tools__search">
          <TextField label="Search rounds" type="search" value={query} placeholder="Name, date, number or type" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Select
          label="Event type"
          value={typeFilter}
          options={[{ value: 'all', label: 'All' }, ...EVENT_TYPES.map((type) => ({ value: type, label: type }))]}
          onChange={setTypeFilter}
        />
        <Select
          label="Date and time"
          value={dateFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'dated', label: 'Fully scheduled' },
            { value: 'tbd', label: 'Has a TBD' }
          ]}
          onChange={(value) => setDateFilter(value as DateFilter)}
        />
      </div>

      <div className="table-wrap">
        <table className="table" aria-describedby="rounds-count">
          <caption className="sr-only">Rounds of {calendar.name}</caption>
          <thead>
            <tr>
              <SortHeader label="Round" column="round" sort={sort} onSort={onSort} />
              <SortHeader label="Race" column="name" sort={sort} onSort={onSort} />
              <SortHeader label="Date" column="date" sort={sort} onSort={onSort} />
              <SortHeader label="Time" column="time" sort={sort} onSort={onSort} />
              <SortHeader label="Event type" column="type" sort={sort} onSort={onSort} />
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <Stagger as="tbody">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="table__empty">
                  No round matches your search or filters.
                </td>
              </tr>
            ) : null}
            {rows.map((round) => (
              <tr key={round.round}>
                <th scope="row" className="table__key table__num">
                  {round.round}
                </th>
                <td>
                  {round.flag ? <span className="flag-text">{round.flag}</span> : null}
                  {round.name}
                </td>
                <td className="table__num">
                  <DateCell round={round} />
                </td>
                <td className="table__num">
                  <TimeCell round={round} />
                </td>
                <td>
                  <Badge tone={typeTone(round.eventType)}>{round.eventType}</Badge>
                </td>
                <td>
                  <div className="row-actions">
                    <Button variant="ghost" size="sm" iconOnly disabled={busy} icon={<Pencil size={16} aria-hidden="true" />} onClick={() => onEdit(round)} aria-label={`Edit ${roundLabel(round)}`} title="Edit round" />
                    <Button variant="ghost" size="sm" iconOnly disabled={busy} icon={<Trash2 size={16} aria-hidden="true" />} onClick={() => onDelete(round)} aria-label={`Delete ${roundLabel(round)}`} title="Delete round" />
                  </div>
                </td>
              </tr>
            ))}
          </Stagger>
        </table>
      </div>
      <p className="muted table-count" id="rounds-count" aria-live="polite">
        {filtering ? `Showing ${rows.length} of ${plural(calendar.rounds.length, 'round')}` : plural(calendar.rounds.length, 'round')}
        {calendar.rounds.length > 0 ? '. Round numbers are the ones stored: deleting a round leaves a gap.' : ''}
      </p>
    </div>
  )
}

function PostedStatus({ guildId }: { guildId: string }) {
  const { settings } = useSettings()
  const channels = useGuildChannels(guildId)
  const stored = settings.calendarPosts[guildId]
  if (!stored) return <p className="muted">This app has not posted the calendar in Discord yet.</p>
  const name = channels.status === 'ready' ? (channels.data.find((channel) => channel.id === stored.channelId)?.name ?? null) : null
  return (
    <p className="muted">
      Posted by this app in {name ? <strong>#{name}</strong> : 'a channel'}. Editing rounds does not change that message until you update it.
    </p>
  )
}

function CalendarScreen() {
  const { guild } = useLeague()
  const calendar = useCalendar(guild.id)
  const toast = useToast()
  const write = useWriteAction()
  const { settings } = useSettings()

  const [roundDialog, setRoundDialog] = useState<{ round?: CalendarRound } | null>(null)
  const [postOpen, setPostOpen] = useState(false)
  const [pending, setPending] = useState<CalendarRound | null>(null)
  const [problem, setProblem] = useState<WriteProblem | null>(null)

  const data = calendar.status === 'ready' ? calendar.data : null
  const blocker = data ? addRoundBlocker(data) : null
  const posted = Boolean(settings.calendarPosts[guild.id])

  const remove = async (): Promise<void> => {
    if (!pending) return
    const target = pending
    setProblem(null)
    const outcome = await write.run(() => unwrap(window.nexus.api.deleteRound(guild.id, target.round)))
    if (!outcome) return
    setPending(null)
    if (outcome.ok) {
      invalidateCalendar(guild.id) // re-read the calendar: nothing is patched locally
      toast.push({ tone: 'success', title: 'Round deleted', message: roundLabel(target) })
      return
    }
    if (errorCode(outcome.error) === 'round_not_found') invalidateCalendar(guild.id) // already gone: show the current list
    setProblem(writeProblem(outcome.error, 'The deletion'))
  }

  return (
    <div className="page">
      <PageHeader
        title="Calendar"
        description={data ? `${guild.name} - ${data.name}` : guild.name}
        actions={
          <div className="header-actions">
            <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} loading={calendar.status === 'ready' && calendar.refreshing === true} onClick={calendar.reload}>
              Refresh
            </Button>
            <Button variant="secondary" icon={<Send size={16} aria-hidden="true" />} disabled={!data || data.rounds.length === 0} onClick={() => setPostOpen(true)} title={data && data.rounds.length === 0 ? 'Add a round first' : undefined}>
              Post to Discord
            </Button>
            <Button icon={<Plus size={16} aria-hidden="true" />} disabled={!data || blocker !== null} onClick={() => setRoundDialog({})} title={blocker ?? undefined}>
              Add round
            </Button>
          </div>
        }
      />

      <NextRaceCard guildId={guild.id} />

      {calendar.status === 'loading' ? (
        <LoadingRegion label="Loading the calendar" className="stack">
          <Skeleton height={40} />
          <Skeleton height={200} radius={12} />
        </LoadingRegion>
      ) : null}

      {calendar.status === 'error' ? <ErrorState title="Could not load the calendar" message={describeError(calendar.error)} onRetry={calendar.reload} /> : null}

      {data ? (
        <section aria-labelledby="rounds-heading" className="stack stack--tight">
          <div className="section-head">
            <h2 id="rounds-heading" className="section-title">
              Rounds
            </h2>
            {data.rounds.length > 0 ? <PostedStatus guildId={guild.id} /> : null}
          </div>

          {data.setupInProgress ? (
            <Notice tone="warning">
              Someone is in the middle of the <code>/f1 calendar</code> setup in Discord. Finishing that setup replaces every round, including the ones you add or edit here.
            </Notice>
          ) : null}
          {blocker ? <Notice tone="info">{blocker}</Notice> : null}
          <WriteProblemNotice problem={problem} onRefresh={() => { setProblem(null); invalidateCalendar(guild.id) }} refreshLabel="Refresh the calendar" />

          {data.rounds.length === 0 ? (
            <EmptyState
              icon={<CalendarDays size={24} aria-hidden="true" />}
              title="No rounds yet"
              description="Add the first round to create the season calendar. You can then post it to a Discord channel and keep it up to date from here."
              action={
                <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setRoundDialog({})}>
                  Add the first round
                </Button>
              }
            />
          ) : (
            <RoundTable calendar={data} busy={write.busy} onEdit={(round) => setRoundDialog({ round })} onDelete={setPending} />
          )}
        </section>
      ) : null}

      {roundDialog ? <RoundDialog guildId={guild.id} round={roundDialog.round} onClose={() => setRoundDialog(null)} /> : null}
      {postOpen && data ? <PostCalendarDialog guildId={guild.id} roundCount={data.rounds.length} onClose={() => setPostOpen(false)} /> : null}

      <ConfirmDialog open={pending !== null} title={pending ? `Delete ${roundLabel(pending)}?` : 'Delete round?'} confirmLabel="Delete round" busy={write.busy} onConfirm={() => void remove()} onCancel={() => setPending(null)}>
        {pending ? (
          <>
            <p>
              This permanently deletes <strong>{roundLabel(pending)}</strong> ({isTbdDate(pending.date) ? 'date TBD' : pending.date}) from the calendar.
            </p>
            <ul className="plain-list">
              <li>The other rounds keep their numbers, so the calendar gets a gap at round {pending.round}. You can fill it later by adding a round with that number.</li>
              <li>
                {posted ? 'The calendar message already posted in Discord is not changed until you use "Update posted calendar".' : 'A calendar already posted in Discord is not changed until you post it again.'}
              </li>
              <li>Standings and race results are not affected.</li>
            </ul>
            <p>This cannot be undone.</p>
          </>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}

export function Calendar() {
  return (
    <F1Only page="calendar">
      <CalendarScreen />
    </F1Only>
  )
}
