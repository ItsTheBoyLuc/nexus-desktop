import { CalendarDays, Plus, RotateCw, Send } from 'lucide-react'
import { useCallback, useState } from 'react'
import { previewEventDate, RACING_LIMITS, isPastDate, validateRacingEventDraft } from '../../shared/racingValidation'
import type { RacingEventField } from '../../shared/racingValidation'
import type { CardOutcome, RacingEvent } from '../../shared/types'
import { Badge, Button, EmptyState, ErrorState, LoadingRegion, Modal, Notice, PageHeader, PostConfirmDialog, PostTargetSection, Skeleton, SortHeader, Stagger, TextField, useToast } from '../components'
import { usePostTarget } from '../hooks/postTarget'
import { usePagedList } from '../hooks/paged'
import { useManageDenied } from '../hooks/useFiaDenied'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeError, errorCode, fieldErrorFor, unwrap } from '../lib/errors'
import { plural } from '../lib/format'
import { invalidateRacing, racingKey } from '../lib/racingScope'
import { createLostText, describeEventDate, describeRacingError, EVENT_GETTERS, MANAGE_SERVER_RULE } from '../lib/racingView'
import type { EventColumn } from '../lib/racingView'
import { judgeWrite } from '../lib/racingWriteFlow'
import { matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'
import { EsportsNote, useEsports } from './EsportsRoute'
import type { EsportsContext } from './EsportsRoute'
import { CardOutcomeDialog, PostToDiscordDialog } from './CardPostDialogs'

const PAGE = 100
export const EVENTS_NO_EDIT_TEXT = 'Events cannot be edited or deleted: no command does it, so the API has no endpoint. The server keeps what you add, so check the date before you save.'

const EVENT_LOST_TEXT = 'Nexus did not get a clear answer, so the event may already have been added. It is not sent again with the same data: the server keeps every event, so a second send would list it twice. The list was just read again: look at it first.'

/** What an event card shows: the same fields the list shows. Untrusted text, shown as plain text only. */
function EventCardSummary({ event }: { event: Pick<RacingEvent, 'name' | 'date' | 'time' | 'class' | 'notes' | 'dateIso'> }) {
  return (
    <dl className="facts facts--grid">
      <div>
        <dt>Event</dt>
        <dd className="plain-text">{event.name}</dd>
      </div>
      <div>
        <dt>When</dt>
        <dd className="plain-text">
          {event.date} {event.time}
        </dd>
      </div>
      <div>
        <dt>Class or category</dt>
        <dd className="plain-text">{event.class === '' ? 'Not set' : event.class}</dd>
      </div>
      {event.notes ? (
        <div className="facts__wide">
          <dt>Notes</dt>
          <dd className="plain-text">{event.notes}</dd>
        </div>
      ) : null}
    </dl>
  )
}

/** The event as it was just added, for the card follow-up. */
interface EventCreated {
  event: RacingEvent
  card: CardOutcome
  requested: { channelId: string; pingRoleIds?: string[] }
}

// ── Add an event ────────────────────────────────────────────────────────────

const SERVER_FIELDS = { invalid_name: 'name', invalid_date: 'date', invalid_time: 'time', invalid_class: 'class', invalid_notes: 'notes' } as const satisfies Record<string, RacingEventField>

/**
 * Add an event (/racing {game} event-add). The bot reads the date in five formats, tried in order, so 03/04/2026 would be March
 * 4th and a date it cannot read is kept forever and listed last. So the date comes from a DATE PICKER, is sent as YYYY-MM-DD only
 * (the first format it tries), is shown back as "Interpreted as: <full date>" before saving, and an unreadable date is refused here.
 */
function AddEventDialog({ ctx, onClose, onAdded }: { ctx: EsportsContext; onClose: () => void; onAdded: (created: EventCreated) => void }) {
  const toast = useToast()
  const write = useWriteAction()
  const manage = useManageDenied(ctx.guild.id)
  const target = usePostTarget(ctx.guild.id, ctx.game)
  const [confirming, setConfirming] = useState(false)
  const [draft, setDraft] = useState({ name: '', date: '', time: '20:00', zone: 'UTC', class: '', notes: '' })
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<RacingEventField, string>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [lost, setLost] = useState(false)

  const result = validateRacingEventDraft(draft)
  const errors: Partial<Record<RacingEventField, string>> = result.ok ? {} : result.errors
  const preview = previewEventDate(draft.date)
  const show = (field: RacingEventField): string | null => serverErrors[field] ?? (submitted ? (errors[field] ?? null) : null)
  const change = (field: RacingEventField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerErrors({})
    setProblem(null)
  }
  const past = preview.ok && isPastDate(preview.iso, new Date().toISOString().slice(0, 10))

  const posting = target.enabled

  /** The form's button: with a card it first asks, naming the channel and the roles; without one the event is added at once. */
  const start = (): void => {
    setSubmitted(true)
    if (!result.ok || lost || manage.denied || target.problem !== null) return
    if (posting) setConfirming(true)
    else void submit()
  }

  const submit = async (): Promise<void> => {
    if (!result.ok || lost || manage.denied || target.problem !== null) return
    const input = { ...result.value, ...target.fields }
    const outcome = await write.run(() => unwrap(window.nexus.api.addRacingEvent(ctx.guild.id, ctx.game, input)))
    if (!outcome) return
    if (outcome.ok) {
      invalidateRacing(ctx.guild.id, ctx.game)
      const { card, ...event } = outcome.value
      toast.push({ tone: 'success', title: 'Event added', message: `${event.name}${event.dateIso ? `, ${describeEventDate(event).readAs ?? event.date}` : ''}` })
      if (card !== undefined && input.channelId !== undefined) onAdded({ event, card, requested: { channelId: input.channelId, ...(input.pingRoleIds ? { pingRoleIds: input.pingRoleIds } : {}) } })
      else onClose()
      return
    }
    const error = outcome.error
    setConfirming(false)
    const verdict = judgeWrite(error, 'event', posting)
    if (verdict.type === 'lost') {
      invalidateRacing(ctx.guild.id, ctx.game)
      setLost(true)
      return
    }
    if (verdict.type === 'denied') {
      manage.markDenied()
      return
    }
    // A refusal about the card adds nothing: the event does not exist.
    if (target.explainRefusal(error, verdict, ctx.gameLabel, 'Nothing was added or posted.')) return
    const field = fieldErrorFor(error, SERVER_FIELDS)
    if (field) setServerErrors({ [field.field]: describeError(error) })
    else setProblem(describeRacingError(error, ctx.gameLabel, 'Nothing was added or posted.'))
  }

  return (
    <>
    <Modal
      open={!confirming}
      title={`Add a ${ctx.gameLabel} event`}
      size="lg"
      dismissible={!write.busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={write.busy} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={write.busy} disabled={lost || manage.denied} onClick={start}>
            {posting ? 'Review and add' : 'Add the event'}
          </Button>
        </>
      }
    >
      <p className="muted">Like <code>/racing {ctx.game} event-add</code>. {EVENTS_NO_EDIT_TEXT}</p>
      {manage.denied ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={manage.reset}>Check again</Button>}>
          {MANAGE_SERVER_RULE} The server refused your account, so this action is off. If your permissions changed, choose Check again.
        </Notice>
      ) : null}
      {lost ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={onClose}>Close and refresh the list</Button>}>
          <span>
            <strong>The event may already have been added.</strong> {createLostText(EVENT_LOST_TEXT, posting)}
          </span>
        </Notice>
      ) : null}
      <TextField label="Event name" value={draft.name} maxLength={RACING_LIMITS.eventNameMax} placeholder="Daytona 24" error={show('name')} autoComplete="off" onChange={(event) => change('name', event.target.value)} />
      <div className="field-triple">
        <TextField label="Date" type="date" value={draft.date} error={show('date')} onChange={(event) => change('date', event.target.value)} />
        <TextField label="Time (24-hour)" type="time" value={draft.time} error={show('time')} onChange={(event) => change('time', event.target.value)} />
        <TextField label="Time zone" value={draft.zone} maxLength={10} placeholder="UTC" hint="For example UTC, CET or UTC+2." error={show('zone')} autoComplete="off" onChange={(event) => change('zone', event.target.value)} />
      </div>
      <p className="date-preview" aria-live="polite">
        {preview.ok ? (
          <>
            <strong>Interpreted as:</strong> {preview.label}
            {draft.time && !errors.time ? <>, {draft.time} {draft.zone.trim()}</> : null}
          </>
        ) : draft.date === '' ? (
          <span className="muted">Pick a date to see how the bot will read it.</span>
        ) : (
          <span className="field__error">{preview.message}</span>
        )}
      </p>
      <Notice tone="info">The date is sent as <code>YYYY-MM-DD</code>, the one format the bot always reads the same way. A date written like 03/04/2026 would be read as March 4th, and a date it cannot read is kept forever and listed last, which is why the app never sends one.</Notice>
      {past ? <Notice tone="warning">This date is in the past. The event list only shows upcoming events, so it would not appear there.</Notice> : null}
      <div className="field-pair">
        <TextField label="Class or category" optional value={draft.class} maxLength={RACING_LIMITS.classMax} placeholder="GT3, Hypercar ..." hint="Free text, up to 30 characters." error={show('class')} autoComplete="off" onChange={(event) => change('class', event.target.value)} />
      </div>
      <TextField multiline label="Notes" optional rows={3} value={draft.notes} maxLength={RACING_LIMITS.notesMax} error={show('notes')} onChange={(event) => change('notes', event.target.value)} />
      <PostTargetSection target={target} guildId={ctx.guild.id} gameLabel={ctx.gameLabel} what="the event card" disabled={lost || write.busy} showProblem={submitted} />
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
    </Modal>
    <PostConfirmDialog
      open={confirming}
      title={`Add ${result.ok ? result.value.name : 'the event'} and post its card?`}
      channelLabel={`#${target.channelName(target.channelId) || 'the channel you chose'}`}
      guildName={ctx.guild.name}
      roles={target.pingViews}
      confirmLabel="Add and post"
      busy={write.busy}
      onConfirm={() => void submit()}
      onCancel={() => setConfirming(false)}
    >
      <p className="muted">The event is added, then its card is posted. If the post fails the event stays saved and you can post it again from the list.</p>
    </PostConfirmDialog>
    </>
  )
}

// ── The list ────────────────────────────────────────────────────────────────

function EventsScreen({ ctx }: { ctx: EsportsContext }) {
  const manage = useManageDenied(ctx.guild.id)
  const [adding, setAdding] = useState(false)
  const [posting, setPosting] = useState<RacingEvent | null>(null)
  const [followUp, setFollowUp] = useState<EventCreated | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState<EventColumn> | null>(null) // the API's order: soonest first, unreadable dates last
  const onSort = (column: EventColumn): void => setSort((current) => nextSort(current, column))

  const fetchPage = useCallback(
    (offset: number) => unwrap(window.nexus.api.racingEvents(ctx.guild.id, ctx.game, { limit: PAGE, offset })).then((page) => ({ items: page.events, total: page.total })),
    [ctx.guild.id, ctx.game]
  )
  const list = usePagedList(racingKey(ctx.guild.id, ctx.game, 'events'), fetchPage, (event) => event.id)

  const rows = sortRows(
    list.items.filter((event) => matchesQuery([event.name, event.class, event.notes, event.date, event.time], query)),
    sort,
    EVENT_GETTERS
  )

  return (
    <div className="page">
      <PageHeader
        title="Events"
        description={`${ctx.guild.name} - upcoming ${ctx.gameLabel} events`}
        actions={
          <div className="header-actions">
            <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} loading={list.first.status === 'ready' && list.first.refreshing === true} onClick={() => invalidateRacing(ctx.guild.id, ctx.game)}>
              Refresh
            </Button>
            <Button icon={<Plus size={16} aria-hidden="true" />} disabled={manage.denied} title={manage.denied ? 'Needs the Manage Server permission' : undefined} onClick={() => setAdding(true)}>
              Add an event
            </Button>
          </div>
        }
      />
      <EsportsNote game={ctx.game} gameLabel={ctx.gameLabel} />
      {manage.denied ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={manage.reset}>Check again</Button>}>
          {MANAGE_SERVER_RULE} The events stay readable. If your permissions changed, choose Check again.
        </Notice>
      ) : null}

      {list.first.status === 'loading' ? (
        <LoadingRegion label="Loading the events" className="stack">
          <Skeleton height={40} />
          <Skeleton height={240} radius={12} />
        </LoadingRegion>
      ) : null}
      {list.first.status === 'error' ? <ErrorState title="Could not load the events" message={errorCode(list.first.error) === 'forbidden' ? 'You no longer have the FIA, STAFF or Administrator role in this server, so the events cannot be read.' : describeError(list.first.error)} onRetry={list.first.reload} /> : null}

      {list.first.status === 'ready' && list.total === 0 ? (
        <EmptyState
          icon={<CalendarDays size={24} aria-hidden="true" />}
          title="No upcoming events"
          description="Only upcoming events are listed: events in the past are left out by the bot. Add the next one."
          action={
            <Button icon={<Plus size={16} aria-hidden="true" />} disabled={manage.denied} onClick={() => setAdding(true)}>
              Add an event
            </Button>
          }
        />
      ) : null}

      {list.first.status === 'ready' && list.total > 0 ? (
        <div className="stack stack--tight">
          <TextField label="Search the loaded events" type="search" value={query} placeholder="Name, class, notes or date" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
          <div className="table-wrap">
            <table className="table table--wide" aria-describedby="racing-events-count">
              <caption className="sr-only">Upcoming {ctx.gameLabel} events, soonest first</caption>
              <thead>
                <tr>
                  <SortHeader label="Date" column="date" sort={sort} onSort={onSort} />
                  <SortHeader label="Time" column="time" sort={sort} onSort={onSort} />
                  <SortHeader label="Event" column="name" sort={sort} onSort={onSort} />
                  <SortHeader label="Class" column="class" sort={sort} onSort={onSort} />
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <Stagger as="tbody">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="table__empty">
                      No loaded event matches your search.
                    </td>
                  </tr>
                ) : null}
                {rows.map((event) => {
                  const date = describeEventDate(event)
                  return (
                    <tr key={event.id}>
                      <td>
                        {date.text}
                        {date.unreadable ? <Badge tone="danger">Date not understood</Badge> : null}
                        {date.readAs ? <span className="table__note">Read as {date.readAs}</span> : null}
                        {date.ambiguous ? <Badge tone="danger">Could mean another day</Badge> : null}
                      </td>
                      <td>{event.time}</td>
                      <th scope="row" className="table__key">
                        {event.name}
                        {event.notes ? <span className="table__note plain-text">{event.notes}</span> : null}
                      </th>
                      <td>{event.class === '' ? <span className="muted">-</span> : event.class}</td>
                      <td>
                        <div className="row-actions">
                          <Button variant="ghost" size="sm" iconOnly disabled={manage.denied} icon={<Send size={16} aria-hidden="true" />} aria-label={`Post the card of ${event.name} to Discord`} title={manage.denied ? 'Needs the Manage Server permission' : 'Post to Discord'} onClick={() => setPosting(event)} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </Stagger>
            </table>
          </div>
          <p className="muted table-count" id="racing-events-count" aria-live="polite">
            {query.trim() !== '' ? `Showing ${rows.length} of ${plural(list.items.length, 'loaded event')}` : plural(list.items.length, 'event')}
            {list.total > list.items.length ? ` loaded, of ${list.total}. Search and sorting only see the loaded ones.` : '.'} Sorted as the server returns them: soonest first, dates the bot cannot read last. {EVENTS_NO_EDIT_TEXT}
          </p>
          {list.moreError ? <Notice tone="danger">Could not load more events: {list.moreError} The events above are still shown.</Notice> : null}
          {list.canLoadMore ? (
            <div className="dialog-actions dialog-actions--start">
              <Button variant="secondary" loading={list.loadingMore} onClick={list.loadMore}>
                Load more events ({list.total - list.items.length} left)
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {adding ? (
        <AddEventDialog
          ctx={ctx}
          onClose={() => setAdding(false)}
          onAdded={(created) => {
            setAdding(false)
            setFollowUp(created)
          }}
        />
      ) : null}
      {posting ? (
        <PostToDiscordDialog
          ctx={ctx}
          title={`Post the card of ${posting.name}`}
          subject={`the card of ${posting.name}`}
          summary={<EventCardSummary event={posting} />}
          send={(card) => unwrap(window.nexus.api.postRacingEvent(ctx.guild.id, ctx.game, { id: posting.id, ...card }))}
          onClose={() => setPosting(null)}
        />
      ) : null}
      {followUp ? (
        <CardOutcomeDialog
          ctx={ctx}
          kind="event"
          itemName={followUp.event.name}
          card={followUp.card}
          requested={followUp.requested}
          summary={<EventCardSummary event={followUp.event} />}
          send={(card) => unwrap(window.nexus.api.postRacingEvent(ctx.guild.id, ctx.game, { id: followUp.event.id, ...card }))}
          onClose={() => setFollowUp(null)}
        />
      ) : null}
    </div>
  )
}

/** Keyed by server AND game: switching either rebuilds the screen, so nothing of the old game's list or form is left. */
export function EsportsEvents() {
  const ctx = useEsports()
  return <EventsScreen key={ctx.scope} ctx={ctx} />
}
