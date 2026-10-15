import { ArrowLeft, ExternalLink as ExternalIcon, Plus, RotateCw } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { ATTENDANCE_POST_LIMITS, validatePostDraft, validatePostFilters } from '../../shared/attendanceValidation'
import { LIMIT_NOTES } from '../../shared/textLimits'
import type { PostField, PostFilterDraft } from '../../shared/attendanceValidation'
import type { AttendanceDivision, AttendanceDriver, AttendancePostResult, AttendancePostSummary } from '../../shared/types'
import { Badge, Button, Card, CopyButton, EmptyState, ErrorState, LoadingRegion, Modal, Notice, SearchSelect, Select, Skeleton, SortHeader, Stagger, TextField, useToast } from '../components'
import { useAttendancePost, useGuildChannels } from '../hooks/data'
import { usePagedList } from '../hooks/paged'
import { useDebounced } from '../hooks/useDebounced'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeChannelError, describeError, errorCode, fieldErrorFor, isChannelError, outcomeUnknown, unwrap } from '../lib/errors'
import { plural } from '../lib/format'
import { invalidateAttendance } from '../lib/invalidation'
import { matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'

export const POSTED_AS_TYPED = 'The season, round, circuit and description are posted to Discord exactly as you type them. Discord formatting characters (like ** for bold or _ for italics) will show up as formatting there.'
export const DRIVERS_TOGGLE_THEMSELVES = 'Drivers set their own status with the Present, Absent and Reserve buttons under the post in Discord. The app only reads it: it cannot set, toggle or remove anyone\'s attendance, edit or delete a post, or delete a division.'

type PostColumn = 'round' | 'circuit' | 'division' | 'present' | 'absent' | 'reserve'
const GETTERS: Record<PostColumn, (post: AttendancePostSummary) => string | number | null> = {
  round: (post) => `${post.season.padStart(6, '0')} ${post.round.padStart(6, '0')}`,
  circuit: (post) => post.circuit,
  division: (post) => post.division, // posts from before divisions existed sort last
  present: (post) => post.counts.present,
  absent: (post) => post.counts.absent,
  reserve: (post) => post.counts.reserve
}

const PAGE = 100

// ── The list ────────────────────────────────────────────────────────────────

export function PostsList({ guildId, divisions, onOpen, onCreate }: { guildId: string; divisions: readonly AttendanceDivision[]; onOpen: (messageId: string) => void; onCreate: () => void }) {
  const [draft, setDraft] = useState<PostFilterDraft>({ division: '', season: '' })
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState<PostColumn> | null>(null) // the server's order: newest first
  const onSort = (column: PostColumn): void => setSort((current) => nextSort(current, column))

  const settled = useDebounced(draft)
  const checked = useMemo(() => validatePostFilters(settled), [settled])
  const filters = useMemo(() => (checked.ok ? checked.value : {}), [checked])
  const typed = validatePostFilters(draft)
  const seasonError = !typed.ok ? (typed.errors.season ?? null) : null

  const fetchPage = useCallback(
    (offset: number) => unwrap(window.nexus.api.attendancePosts(guildId, { ...filters, limit: PAGE, offset })).then((page) => ({ items: page.posts, total: page.total })),
    [guildId, filters]
  )
  const list = usePagedList(`f1-attendance:${guildId}:posts:${JSON.stringify(filters)}`, fetchPage, (post) => post.messageId)
  const filtering = draft.division !== '' || draft.season.trim() !== ''

  const rows = sortRows(
    list.items.filter((post) => matchesQuery([post.circuit, post.division, post.description, post.season, post.round], query)),
    sort,
    GETTERS
  )

  return (
    <div className="stack">
      <Card className="stack">
        <div className="section-head">
          <h2 className="section-title">Filters</h2>
          <Button variant="ghost" size="sm" disabled={!filtering} onClick={() => setDraft({ division: '', season: '' })}>
            Clear filters
          </Button>
        </div>
        <div className="field-pair">
          <Select
            label="Division"
            value={draft.division}
            options={[{ value: '', label: 'All divisions' }, ...divisions.map((division) => ({ value: division.name, label: division.name }))]}
            onChange={(value) => setDraft((current) => ({ ...current, division: value }))}
          />
          <TextField label="Season" value={draft.season} placeholder="16" hint="Exactly as typed when the post was made." error={seasonError} autoComplete="off" onChange={(event) => setDraft((current) => ({ ...current, season: event.target.value }))} />
        </div>
      </Card>

      {list.first.status === 'loading' ? (
        <LoadingRegion label="Loading the attendance posts" className="stack">
          <Skeleton height={40} />
          <Skeleton height={240} radius={12} />
        </LoadingRegion>
      ) : null}
      {list.first.status === 'error' ? <ErrorState title="Could not load the attendance posts" message={describeError(list.first.error)} onRetry={list.first.reload} /> : null}

      {list.first.status === 'ready' && list.total === 0 ? (
        <EmptyState
          title={filtering ? 'No post matches these filters' : 'No attendance posts yet'}
          description={filtering ? 'Change or clear the filters to see more.' : 'Create the first attendance post: Nexus posts it in a channel with the Present, Absent and Reserve buttons.'}
          action={
            filtering ? (
              <Button variant="secondary" onClick={() => setDraft({ division: '', season: '' })}>
                Clear filters
              </Button>
            ) : (
              <Button icon={<Plus size={16} aria-hidden="true" />} disabled={divisions.length === 0} onClick={onCreate}>
                Create attendance post
              </Button>
            )
          }
        />
      ) : null}

      {list.first.status === 'ready' && list.total > 0 ? (
        <div className="stack stack--tight" aria-busy={draft !== settled || undefined}>
          <TextField label="Search the loaded posts" type="search" value={query} placeholder="Circuit, division, round or description" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
          <div className="table-wrap">
            <table className="table table--wide" aria-describedby="posts-count">
              <caption className="sr-only">Attendance posts, newest first</caption>
              <thead>
                <tr>
                  <SortHeader label="Season / round" column="round" sort={sort} onSort={onSort} />
                  <SortHeader label="Circuit" column="circuit" sort={sort} onSort={onSort} />
                  <SortHeader label="Division" column="division" sort={sort} onSort={onSort} />
                  <SortHeader label="Present" column="present" sort={sort} onSort={onSort} numeric />
                  <SortHeader label="Absent" column="absent" sort={sort} onSort={onSort} numeric />
                  <SortHeader label="Reserve" column="reserve" sort={sort} onSort={onSort} numeric />
                </tr>
              </thead>
              <Stagger as="tbody">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="table__empty">
                      No loaded post matches your search.
                    </td>
                  </tr>
                ) : null}
                {rows.map((post) => (
                  <tr key={post.messageId}>
                    <th scope="row" className="table__key">
                      <button type="button" className="link-btn" onClick={() => onOpen(post.messageId)} aria-label={`Open the attendance post of season ${post.season}, round ${post.round}, ${post.circuit}`}>
                        <span>
                          Season {post.season}, round {post.round}
                        </span>
                      </button>
                    </th>
                    <td>
                      {post.circuit}
                      {post.description ? <span className="table__note text-clamp">{post.description}</span> : null}
                    </td>
                    <td>{post.division ?? <span className="muted">No division</span>}</td>
                    <td className="table__num">{post.counts.present}</td>
                    <td className="table__num">{post.counts.absent}</td>
                    <td className="table__num">{post.counts.reserve}</td>
                  </tr>
                ))}
              </Stagger>
            </table>
          </div>
          <p className="muted table-count" id="posts-count" aria-live="polite">
            {query.trim() !== '' ? `Showing ${rows.length} of ${plural(list.items.length, 'loaded post')}` : plural(list.items.length, 'post')}
            {list.total > list.items.length ? ` loaded, of ${list.total} on the server. Search and sorting only see the loaded ones.` : filtering ? ` for these filters.` : '.'}
          </p>
          {list.moreError ? <Notice tone="danger">Could not load more posts: {list.moreError} The posts above are still shown.</Notice> : null}
          {list.canLoadMore ? (
            <div className="dialog-actions dialog-actions--start">
              <Button variant="secondary" loading={list.loadingMore} onClick={list.loadMore}>
                Load more posts ({list.total - list.items.length} left)
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ── One post ────────────────────────────────────────────────────────────────

function NameList({ title, drivers }: { title: string; drivers: AttendanceDriver[] }) {
  return (
    <Card className="stack stack--tight">
      <div className="section-head">
        <h3>{title}</h3>
        <Badge tone={drivers.length > 0 ? 'primary' : 'neutral'}>{drivers.length}</Badge>
      </div>
      {drivers.length === 0 ? (
        <p className="muted">Nobody.</p>
      ) : (
        <ul className="name-list">
          {drivers.map((driver) => (
            <li key={driver.userId}>
              <span>{driver.name ?? 'A member who left the server'}</span>
              {!driver.inServer ? <Badge>Left the server</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export function PostDetail({ guildId, messageId, onBack }: { guildId: string; messageId: string; onBack: () => void }) {
  const post = useAttendancePost(guildId, messageId)
  return (
    <div className="stack">
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={onBack}>
          All posts
        </Button>
      </div>
      {post.status === 'loading' ? (
        <LoadingRegion label="Loading the attendance post" className="stack">
          <Skeleton height={80} radius={12} />
          <Skeleton height={220} radius={12} />
        </LoadingRegion>
      ) : null}
      {post.status === 'error' ? (
        <ErrorState
          title={errorCode(post.error) === 'post_not_found' ? 'This attendance post no longer exists' : 'Could not load the attendance post'}
          message={errorCode(post.error) === 'post_not_found' ? 'It is not in the server\'s attendance data any more. Go back to the list.' : describeError(post.error)}
          onRetry={errorCode(post.error) === 'post_not_found' ? onBack : post.reload}
        />
      ) : null}
      {post.status === 'ready' ? (
        <>
          <Card className="stack">
            <div className="section-head">
              <h2>
                Season {post.data.season}, round {post.data.round} <span className="muted">{post.data.circuit}</span>
              </h2>
              <Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} loading={post.refreshing === true} onClick={() => invalidateAttendance(guildId)}>
                Refresh
              </Button>
            </div>
            <p className="muted">
              {post.data.division ? `Division ${post.data.division}` : 'Made before divisions existed (no division)'}. {plural(post.data.counts.present, 'driver')} present, {post.data.counts.absent} absent, {post.data.counts.reserve} on reserve.
            </p>
            {post.data.description ? <p className="plain-text">{post.data.description}</p> : null}
            <p className="muted">{DRIVERS_TOGGLE_THEMSELVES} The post&apos;s channel is not stored by the server, so there is no link to the message from here.</p>
          </Card>
          <div className="attendance-columns">
            <NameList title="Present" drivers={post.data.attendance.present} />
            <NameList title="Absent" drivers={post.data.attendance.absent} />
            <NameList title="Reserve" drivers={post.data.attendance.reserve} />
          </div>
        </>
      ) : null}
    </div>
  )
}

// ── Create a post ───────────────────────────────────────────────────────────

export function PostDialog({ guildId, divisions, onClose, onCreated }: { guildId: string; divisions: readonly AttendanceDivision[]; onClose: () => void; onCreated: (result: AttendancePostResult) => void }) {
  const channels = useGuildChannels(guildId)
  const toast = useToast()
  const write = useWriteAction()
  const [draft, setDraft] = useState({ channelId: '', division: divisions[0]?.name ?? '', season: '', round: '', circuit: '', description: '' })
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<PostField, string>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [lost, setLost] = useState(false)

  const result = validatePostDraft(draft)
  const errors: Partial<Record<PostField, string>> = result.ok ? {} : result.errors
  const show = (field: PostField): string | null => serverErrors[field] ?? (submitted ? (errors[field] ?? null) : null)
  const channelName = (id: string): string => (channels.status === 'ready' ? (channels.data.find((channel) => channel.id === id)?.name ?? '') : '')
  const change = (field: PostField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerErrors({})
    setProblem(null)
  }

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (!result.ok || lost) return
    const outcome = await write.run(() => unwrap(window.nexus.api.createAttendancePost(guildId, result.value)))
    if (!outcome) return
    if (outcome.ok) {
      invalidateAttendance(guildId)
      toast.push({ tone: 'success', title: 'Attendance post created', message: `Season ${outcome.value.post.season}, round ${outcome.value.post.round}, ${outcome.value.post.circuit}` })
      onCreated(outcome.value)
      return
    }
    const error = outcome.error
    if (outcomeUnknown(error)) {
      // A lost answer may have posted the message: it is never offered for sending again with the same data.
      invalidateAttendance(guildId)
      setLost(true)
      return
    }
    if (isChannelError(error)) {
      setServerErrors({ channelId: describeChannelError(error, channelName(draft.channelId), 'Nothing was posted.') })
      return
    }
    if (errorCode(error) === 'division_not_found') {
      invalidateAttendance(guildId)
      setServerErrors({ division: 'That division no longer exists (it may have been renamed or removed in Discord). Nothing was posted. Close this window and choose a division again.' })
      return
    }
    const field = fieldErrorFor(error, { invalid_division: 'division', invalid_season: 'season', invalid_round: 'round', invalid_circuit: 'circuit', invalid_description: 'description' } as const)
    if (field) setServerErrors({ [field.field]: field.message })
    else setProblem(describeError(error))
  }

  return (
    <Modal
      open
      title="Create an attendance post"
      size="lg"
      dismissible={!write.busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={write.busy} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={write.busy} disabled={lost || divisions.length === 0} onClick={() => void submit()}>
            Post to Discord
          </Button>
        </>
      }
    >
      <p className="muted">Like <code>/f1 attendance</code>: posts the attendance embed with the Present, Absent and Reserve buttons, and marks the division&apos;s regular drivers as present.</p>
      <Notice tone="info">{POSTED_AS_TYPED}</Notice>
      {lost ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={onClose}>Close and refresh the list</Button>}>
          Nexus did not get a clear answer, so <strong>the post may already be in Discord</strong>. It is not sent again with the same data, because that would post it twice. The list of posts was just read again: check it, and check the channel in Discord, before you create anything.
        </Notice>
      ) : null}
      {divisions.length === 0 ? <Notice tone="warning">There is no division yet. Create one on the Divisions tab first: a post needs a division.</Notice> : null}
      <div className="field-pair">
        <Select label="Division" value={draft.division} options={divisions.map((division) => ({ value: division.name, label: division.name }))} placeholder="Choose a division" error={show('division')} onChange={(value) => change('division', value)} />
        <SearchSelect
          label="Channel"
          value={draft.channelId}
          options={channels.status === 'ready' ? channels.data.map((channel) => ({ value: channel.id, label: `# ${channel.name}` })) : []}
          placeholder="Search channels"
          disabled={channels.status !== 'ready'}
          hint={channels.status === 'error' ? 'The channels could not be loaded.' : 'Only channels where Nexus can post and you can see are listed.'}
          error={show('channelId')}
          emptyText="No channel found. Nexus can only post where it has permission."
          onChange={(value) => change('channelId', value)}
        />
      </div>
      <div className="field-triple">
        <TextField label="Season" value={draft.season} maxLength={ATTENDANCE_POST_LIMITS.seasonMax} placeholder="16" error={show('season')} autoComplete="off" onChange={(event) => change('season', event.target.value)} />
        <TextField label="Round" value={draft.round} maxLength={ATTENDANCE_POST_LIMITS.roundMax} placeholder="5" error={show('round')} autoComplete="off" onChange={(event) => change('round', event.target.value)} />
        <TextField label="Circuit" value={draft.circuit} maxLength={ATTENDANCE_POST_LIMITS.circuitMax} placeholder="Zandvoort" error={show('circuit')} autoComplete="off" onChange={(event) => change('circuit', event.target.value)} />
      </div>
      <TextField multiline label="Description" optional rows={3} value={draft.description} maxLength={ATTENDANCE_POST_LIMITS.descriptionMax} limitNote={LIMIT_NOTES.discordEmbed} error={show('description')} onChange={(event) => change('description', event.target.value)} />
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
    </Modal>
  )
}

/** What the API returned for a new post. Nothing is stored by the app: the message id is only shown (and in the list from now on). */
export function PostCreatedDialog({ guildId, result, onClose, onView }: { guildId: string; result: AttendancePostResult; onClose: () => void; onView: (messageId: string) => void }) {
  const channels = useGuildChannels(guildId)
  const name = channels.status === 'ready' ? channels.data.find((channel) => channel.id === result.channelId)?.name : undefined
  const link = `https://discord.com/channels/${guildId}/${result.channelId}/${result.post.messageId}`
  const toast = useToast()
  const open = async (): Promise<void> => {
    const opened = await window.nexus.system.openExternal(link).catch(() => false)
    if (!opened) toast.push({ tone: 'danger', title: 'Link not opened', message: 'The link could not be opened. Copy it and open it in your browser.' })
  }
  return (
    <Modal
      open
      title="Attendance post created"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => onView(result.post.messageId)}>
            View the post
          </Button>
          <Button data-autofocus onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <p>
        The post for <strong>season {result.post.season}, round {result.post.round}, {result.post.circuit}</strong> ({result.post.division ?? 'no division'}) is in Discord. {plural(result.post.counts.present, 'regular driver')} {result.post.counts.present === 1 ? 'was' : 'were'} marked present.
      </p>
      <dl className="facts facts--grid">
        <div>
          <dt>Channel</dt>
          <dd>{name ? `# ${name}` : 'A channel you chose'}</dd>
        </div>
        <div>
          <dt>Message ID</dt>
          <dd className="plain-text">{result.post.messageId}</dd>
        </div>
      </dl>
      <div className="dialog-actions dialog-actions--start">
        <Button variant="secondary" size="sm" icon={<ExternalIcon size={14} aria-hidden="true" />} onClick={() => void open()}>
          Open in Discord
        </Button>
        <CopyButton text={result.post.messageId} label="Copy the message ID" what="The message ID" />
      </div>
      <p className="muted">The link is built from the channel and message the server just returned. The server does not store a post&apos;s channel, so later the post is only found in the list, not by link.</p>
    </Modal>
  )
}
