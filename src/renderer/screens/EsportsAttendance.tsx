import { ArrowLeft, CalendarCheck, Plus, RotateCw } from 'lucide-react'
import { useCallback, useState } from 'react'
import { RACING_LIMITS, validateRacingAttendanceDraft } from '../../shared/racingValidation'
import { LIMIT_NOTES } from '../../shared/textLimits'
import type { RacingAttendanceField } from '../../shared/racingValidation'
import type { RacingAttendanceInput, RacingAttendanceResult, RacingAttendeeRow } from '../../shared/types'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingRegion, Modal, Notice, PageHeader, PingRolesField, PostConfirmDialog, PostResultDialog, SearchSelect, Select, Skeleton, SortHeader, Stagger, TextField, useToast } from '../components'
import { useGuildChannels, usePingRoles, useRacingAttendancePost, useRacingTeamRoles } from '../hooks/data'
import { usePagedList } from '../hooks/paged'
import { useSettings } from '../hooks/settings'
import { useManagerDenied } from '../hooks/useFiaDenied'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeChannelError, describeError, errorCode, fieldErrorFor, unwrap } from '../lib/errors'
import { plural } from '../lib/format'
import { resolvePingRoles } from '../lib/pingRoles'
import { invalidateRacing, racingKey } from '../lib/racingScope'
import {
  ATTENDANCE_DRIVERS_TOGGLE_TEXT,
  ATTENDANCE_FILTER_OPTIONS,
  ATTENDANCE_GETTERS,
  ATTENDANCE_POSTED_AS_TYPED,
  attendanceLostText,
  describeRacingError,
  matchesAttendanceFilter,
  MANAGER_RULE
} from '../lib/racingView'
import type { AttendanceColumn, AttendanceFilter } from '../lib/racingView'
import { judgeWrite } from '../lib/racingWriteFlow'
import { matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'
import { EsportsNote, useEsports } from './EsportsRoute'
import type { EsportsContext } from './EsportsRoute'

const PAGE = 100
const LEFT_NAME = 'A member who left the server'

// ── The list ────────────────────────────────────────────────────────────────

function PostsList({ ctx, onOpen, onCreate, managerDenied }: { ctx: EsportsContext; onOpen: (messageId: string) => void; onCreate: () => void; managerDenied: boolean }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<AttendanceFilter>('all')
  const [sort, setSort] = useState<SortState<AttendanceColumn> | null>(null) // the server's order: newest first
  const onSort = (column: AttendanceColumn): void => setSort((current) => nextSort(current, column))

  const fetchPage = useCallback(
    (offset: number) => unwrap(window.nexus.api.racingAttendance(ctx.guild.id, ctx.game, { limit: PAGE, offset })).then((page) => ({ items: page.posts, total: page.total })),
    [ctx.guild.id, ctx.game]
  )
  const list = usePagedList(racingKey(ctx.guild.id, ctx.game, 'attendance'), fetchPage, (post) => post.messageId)

  const rows = sortRows(
    list.items.filter((post) => matchesAttendanceFilter(post, filter) && matchesQuery([post.name, post.date, post.description], query)),
    sort,
    ATTENDANCE_GETTERS
  )
  const filtering = query.trim() !== '' || filter !== 'all'

  return (
    <div className="stack">
      {list.first.status === 'loading' ? (
        <LoadingRegion label="Loading the attendance posts" className="stack">
          <Skeleton height={40} />
          <Skeleton height={240} radius={12} />
        </LoadingRegion>
      ) : null}
      {list.first.status === 'error' ? (
        <ErrorState
          title="Could not load the attendance posts"
          message={errorCode(list.first.error) === 'forbidden' ? 'You no longer have the FIA, STAFF or Administrator role in this server, so the posts cannot be read.' : describeError(list.first.error)}
          onRetry={list.first.reload}
        />
      ) : null}

      {list.first.status === 'ready' && list.total === 0 ? (
        <EmptyState
          icon={<CalendarCheck size={24} aria-hidden="true" />}
          title="No attendance posts yet"
          description={`Create the first ${ctx.gameLabel} attendance post: Nexus posts it in a channel with the Available and Not Available buttons.`}
          action={
            <Button icon={<Plus size={16} aria-hidden="true" />} disabled={managerDenied} onClick={onCreate}>
              Create attendance post
            </Button>
          }
        />
      ) : null}

      {list.first.status === 'ready' && list.total > 0 ? (
        <div className="stack stack--tight">
          <div className="table-tools table-tools--two">
            <div className="table-tools__search">
              <TextField label="Search the loaded posts" type="search" value={query} placeholder="Name, date or description" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
            </div>
            <Select label="Show" value={filter} options={ATTENDANCE_FILTER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} onChange={(value) => setFilter(value as AttendanceFilter)} />
          </div>
          <div className="table-wrap">
            <table className="table table--wide" aria-describedby="racing-attendance-count">
              <caption className="sr-only">{ctx.gameLabel} attendance posts, newest first</caption>
              <thead>
                <tr>
                  <SortHeader label="Post" column="name" sort={sort} onSort={onSort} />
                  <SortHeader label="Date" column="date" sort={sort} onSort={onSort} />
                  <SortHeader label="Available" column="available" sort={sort} onSort={onSort} numeric />
                  <SortHeader label="Not available" column="unavailable" sort={sort} onSort={onSort} numeric />
                </tr>
              </thead>
              <Stagger as="tbody">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="table__empty">
                      No loaded post matches your search or filter.
                    </td>
                  </tr>
                ) : null}
                {rows.map((post) => (
                  <tr key={post.messageId}>
                    <th scope="row" className="table__key">
                      <button type="button" className="link-btn" onClick={() => onOpen(post.messageId)} aria-label={`Open the attendance post ${post.name}, ${post.date}`}>
                        <span className="plain-text">{post.name}</span>
                      </button>
                      {post.description ? <span className="table__note text-clamp">{post.description}</span> : null}
                    </th>
                    <td className="plain-text">{post.date}</td>
                    <td className="table__num">{post.counts.available}</td>
                    <td className="table__num">{post.counts.unavailable}</td>
                  </tr>
                ))}
              </Stagger>
            </table>
          </div>
          <p className="muted table-count" id="racing-attendance-count" aria-live="polite">
            {filtering ? `Showing ${rows.length} of ${plural(list.items.length, 'loaded post')}` : plural(list.items.length, 'post')}
            {list.total > list.items.length ? ` loaded, of ${list.total}. Search, filter and sorting only see the loaded ones.` : '.'} Newest first, as the server returns them.
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

function NameList({ title, rows, query }: { title: string; rows: RacingAttendeeRow[]; query: string }) {
  const shown = rows.filter((row) => matchesQuery([row.name], query))
  return (
    <Card className="stack stack--tight">
      <div className="section-head">
        <h3>{title}</h3>
        <Badge tone={rows.length > 0 ? 'primary' : 'neutral'}>{rows.length}</Badge>
      </div>
      {rows.length === 0 ? (
        <p className="muted">Nobody.</p>
      ) : shown.length === 0 ? (
        <p className="muted">Nobody here matches your search.</p>
      ) : (
        <ul className="name-list">
          {shown.map((row) => (
            <li key={row.userId}>
              <span className="plain-text">{row.name ?? LEFT_NAME}</span>
              {!row.inServer ? <Badge>Left the server</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function PostDetail({ ctx, messageId, onBack }: { ctx: EsportsContext; messageId: string; onBack: () => void }) {
  const post = useRacingAttendancePost(ctx.guild.id, ctx.game, messageId)
  const [query, setQuery] = useState('')
  const gone = post.status === 'error' && errorCode(post.error) === 'post_not_found'

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
          title={gone ? 'This attendance post no longer exists' : 'Could not load the attendance post'}
          message={gone ? "It is not in this game's attendance data any more. Go back to the list." : describeError(post.error)}
          onRetry={gone ? onBack : post.reload}
        />
      ) : null}
      {post.status === 'ready' ? (
        <>
          <Card className="stack">
            <div className="section-head">
              <h2>
                <span className="plain-text">{post.data.name}</span> <span className="muted plain-text">{post.data.date}</span>
              </h2>
              <Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} loading={post.refreshing === true} onClick={() => invalidateRacing(ctx.guild.id, ctx.game)}>
                Refresh
              </Button>
            </div>
            <p className="muted">
              {plural(post.data.attendance.available.length, 'driver')} available, {post.data.attendance.unavailable.length} not available. The names are what the server holds now: refresh to read the buttons again.
            </p>
            {post.data.description ? <p className="plain-text">{post.data.description}</p> : null}
            <p className="muted">{ATTENDANCE_DRIVERS_TOGGLE_TEXT}</p>
            {post.data.attendance.available.length + post.data.attendance.unavailable.length > 10 ? (
              <TextField label="Search the names" type="search" value={query} placeholder="Part of a name" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
            ) : null}
          </Card>
          <div className="attendance-columns attendance-columns--two">
            <NameList title="Available" rows={post.data.attendance.available} query={query} />
            <NameList title="Not available" rows={post.data.attendance.unavailable} query={query} />
          </div>
        </>
      ) : null}
    </div>
  )
}

// ── Create a post ───────────────────────────────────────────────────────────

const SERVER_FIELDS = { invalid_name: 'name', invalid_date: 'date', invalid_description: 'description' } as const satisfies Record<string, RacingAttendanceField>

/** What the screen needs to show the result: the answer, and the role ids that were asked for (to notice when the answer disagrees). */
interface CreatedPost {
  result: RacingAttendanceResult
  requested: string[]
}

type CreatePhase = 'editing' | 'confirming'

function CreatePostDialog({ ctx, onClose, onCreated }: { ctx: EsportsContext; onClose: () => void; onCreated: (created: CreatedPost) => void }) {
  const channels = useGuildChannels(ctx.guild.id)
  const roles = usePingRoles(ctx.guild.id)
  const teamRoles = useRacingTeamRoles(ctx.guild.id, ctx.game)
  const { postChannelOf, rememberPostChannel } = useSettings()
  const toast = useToast()
  const write = useWriteAction()
  const manager = useManagerDenied(ctx.guild.id, ctx.game)
  const [draft, setDraft] = useState({ channelId: '', name: '', date: '', description: '' })
  const [pingIds, setPingIds] = useState<string[]>([])
  const [pingError, setPingError] = useState<string | null>(null)
  const [phase, setPhase] = useState<CreatePhase>('editing')
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<RacingAttendanceField, string>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [lost, setLost] = useState(false)

  const channelList = channels.status === 'ready' ? channels.data : []
  // The channel last used for this game on this server, when it still exists. It is only a starting point: the user can pick another.
  const remembered = postChannelOf(ctx.guild.id, ctx.game)
  const channelId = draft.channelId !== '' ? draft.channelId : remembered !== null && channelList.some((channel) => channel.id === remembered) ? remembered : ''

  const result = validateRacingAttendanceDraft({ ...draft, channelId })
  const errors: Partial<Record<RacingAttendanceField, string>> = result.ok ? {} : result.errors
  const show = (field: RacingAttendanceField): string | null => serverErrors[field] ?? (submitted ? (errors[field] ?? null) : null)
  const channelName = (id: string): string => channelList.find((channel) => channel.id === id)?.name ?? ''
  const change = (field: RacingAttendanceField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerErrors({})
    setProblem(null)
    if (field === 'channelId' && value !== '') rememberPostChannel(ctx.guild.id, ctx.game, value) // the channel id and nothing else
  }
  const changePings = (ids: string[]): void => {
    setPingIds(ids)
    setPingError(null)
    setProblem(null)
  }

  const refresh = (): void => {
    invalidateRacing(ctx.guild.id, ctx.game)
    onClose()
  }

  const review = (): void => {
    setSubmitted(true)
    if (result.ok && !lost && !manager.denied) setPhase('confirming')
  }

  const submit = async (): Promise<void> => {
    if (!result.ok || lost || manager.denied) return
    const input: RacingAttendanceInput = { ...result.value, ...(pingIds.length > 0 ? { pingRoleIds: pingIds } : {}) }
    const outcome = await write.run(() => unwrap(window.nexus.api.createRacingAttendance(ctx.guild.id, ctx.game, input)))
    if (!outcome) return
    if (outcome.ok) {
      invalidateRacing(ctx.guild.id, ctx.game)
      toast.push({ tone: 'success', title: 'Attendance post created', message: `${outcome.value.post.name}, ${outcome.value.post.date}` })
      onCreated({ result: outcome.value, requested: pingIds })
      return
    }
    const error = outcome.error
    const verdict = judgeWrite(error, 'attendance')
    setPhase('editing')
    if (verdict.type === 'lost') {
      // The message may be in Discord already (and may already have pinged people): lock the form, read the list again, never offer the same data for sending.
      invalidateRacing(ctx.guild.id, ctx.game)
      setLost(true)
      return
    }
    if (verdict.type === 'denied') {
      manager.markDenied()
      return
    }
    if (verdict.type === 'channel') {
      setServerErrors({ channelId: describeChannelError(error, channelName(channelId), 'Nothing was posted.') })
      return
    }
    if (verdict.type === 'ping') {
      // Nothing was posted. The roles stay so they can be fixed, and the list is read again: a role may have changed in Discord.
      setPingError(describeRacingError(error, ctx.gameLabel))
      roles.reload()
      return
    }
    const field = fieldErrorFor(error, SERVER_FIELDS)
    if (field) setServerErrors({ [field.field]: describeError(error) })
    else setProblem(describeRacingError(error, ctx.gameLabel))
  }

  return (
    <>
      <Modal
        open={phase === 'editing'}
        title={`Create a ${ctx.gameLabel} attendance post`}
        size="lg"
        dismissible={!write.busy}
        onClose={onClose}
        footer={
          lost ? (
            <>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              <Button icon={<RotateCw size={14} aria-hidden="true" />} onClick={refresh}>
                Refresh posts
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" disabled={write.busy} onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={manager.denied} onClick={review}>
                Review and post
              </Button>
            </>
          )
        }
      >
        {lost ? (
          <Notice tone="danger">
            <strong>The post may already be in Discord.</strong> {attendanceLostText(pingIds.length > 0)}
          </Notice>
        ) : (
          <>
            <p className="muted">Like <code>/racing {ctx.game} attendance</code>: posts the attendance embed with the Available and Not Available buttons. The buttons keep working after a bot restart.</p>
            <Notice tone="info">{ATTENDANCE_POSTED_AS_TYPED}</Notice>
            {manager.denied ? (
              <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={manager.reset}>Check again</Button>}>
                {MANAGER_RULE} The server refused your account for {ctx.gameLabel}, so this action is off. If your role changed, choose Check again.
              </Notice>
            ) : null}
            <div className="field-pair">
              <TextField label="Name of the post" value={draft.name} maxLength={RACING_LIMITS.attendanceNameMax} placeholder="Tuesday Practice" error={show('name')} autoComplete="off" onChange={(event) => change('name', event.target.value)} />
              <TextField label="Date" value={draft.date} maxLength={RACING_LIMITS.attendanceDateMax} placeholder="2026-09-14" hint="Free text, up to 20 characters, shown as typed." error={show('date')} autoComplete="off" onChange={(event) => change('date', event.target.value)} />
            </div>
            <SearchSelect
              label="Channel"
              value={channelId}
              options={channelList.map((channel) => ({ value: channel.id, label: `# ${channel.name}` }))}
              placeholder="Search channels"
              disabled={channels.status !== 'ready'}
              hint={channels.status === 'error' ? 'The channels could not be loaded.' : 'Only channels where Nexus can post and you can see are listed.'}
              error={show('channelId')}
              emptyText="No channel found. Nexus can only post where it has permission."
              onChange={(value) => change('channelId', value)}
            />
            <TextField multiline label="Description" optional rows={3} value={draft.description} maxLength={RACING_LIMITS.attendanceDescriptionMax} limitNote={LIMIT_NOTES.discordEmbed} error={show('description')} onChange={(event) => change('description', event.target.value)} />
            <PingRolesField guildId={ctx.guild.id} gameLabel={ctx.gameLabel} roles={roles} teamRoles={teamRoles} ids={pingIds} onChange={changePings} error={pingError} />
            {problem ? <Notice tone="danger">{problem}</Notice> : null}
          </>
        )}
      </Modal>
      <PostConfirmDialog
        open={phase === 'confirming'}
        title={`Post this ${ctx.gameLabel} attendance post?`}
        channelLabel={`#${channelName(channelId) || 'the channel you chose'}`}
        guildName={ctx.guild.name}
        roles={resolvePingRoles(pingIds, roles.status === 'ready' ? roles.data : [])}
        confirmLabel="Post to Discord"
        busy={write.busy}
        onConfirm={() => void submit()}
        onCancel={() => setPhase('editing')}
      >
        <div className="preview">
          <div className="preview__title plain-text">{draft.name.trim()}</div>
          <div className="preview__message plain-text">{draft.date.trim()}</div>
          {draft.description.trim() ? <div className="preview__message plain-text">{draft.description.trim()}</div> : null}
        </div>
        <p className="muted">It is posted with the Available and Not Available buttons. The name, date and description go to Discord exactly as typed.</p>
      </PostConfirmDialog>
    </>
  )
}

/** What the API returned for the new post. Nothing is stored by the app: the link is built from the ids in the answer and kept in memory only. */
function PostCreatedDialog({ ctx, created, onClose, onView }: { ctx: EsportsContext; created: CreatedPost; onClose: () => void; onView: (messageId: string) => void }) {
  const channels = useGuildChannels(ctx.guild.id)
  const { result, requested } = created
  const channelName = channels.status === 'ready' ? channels.data.find((channel) => channel.id === result.channelId)?.name : undefined
  return (
    <PostResultDialog
      title="Attendance post created"
      intro={
        <>
          The post <strong className="plain-text">{result.post.name}</strong> is in Discord, with the Available and Not Available buttons.
        </>
      }
      guildId={ctx.guild.id}
      channelId={result.channelId}
      channelName={channelName}
      messageId={result.post.messageId}
      pingedRoles={result.pingedRoles}
      requestedRoleIds={requested}
      facts={
        <>
          <div>
            <dt>Name</dt>
            <dd className="plain-text">{result.post.name}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd className="plain-text">{result.post.date}</dd>
          </div>
          {result.post.description ? (
            <div className="facts__wide">
              <dt>Description</dt>
              <dd className="text-clamp text-clamp--wide">{result.post.description}</dd>
            </div>
          ) : null}
          <div>
            <dt>Answers so far</dt>
            <dd>
              {result.post.counts.available} available, {result.post.counts.unavailable} not available
            </dd>
          </div>
        </>
      }
      actions={
        <Button variant="secondary" onClick={() => onView(result.post.messageId)}>
          View the post
        </Button>
      }
      onClose={onClose}
    />
  )
}

// ── The screen ──────────────────────────────────────────────────────────────

function AttendanceScreen({ ctx }: { ctx: EsportsContext }) {
  const manager = useManagerDenied(ctx.guild.id, ctx.game)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreatedPost | null>(null)

  return (
    <div className="page">
      <PageHeader
        title="Attendance"
        description={`${ctx.guild.name} - ${ctx.gameLabel} attendance posts`}
        actions={
          <div className="header-actions">
            {openId === null ? (
              <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={() => invalidateRacing(ctx.guild.id, ctx.game)}>
                Refresh posts
              </Button>
            ) : null}
            <Button icon={<Plus size={16} aria-hidden="true" />} disabled={manager.denied} title={manager.denied ? 'Needs Manage Server, or being a Manager or Coach of a team of this game' : undefined} onClick={() => setCreating(true)}>
              Create attendance post
            </Button>
          </div>
        }
      />
      <EsportsNote game={ctx.game} gameLabel={ctx.gameLabel} />
      <Notice tone="info">{ATTENDANCE_DRIVERS_TOGGLE_TEXT}</Notice>
      {manager.denied ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={manager.reset}>Check again</Button>}>
          {MANAGER_RULE} The posts stay readable. If your role changed, choose Check again.
        </Notice>
      ) : null}

      {openId === null ? <PostsList ctx={ctx} onOpen={setOpenId} onCreate={() => setCreating(true)} managerDenied={manager.denied} /> : <PostDetail ctx={ctx} messageId={openId} onBack={() => setOpenId(null)} />}

      {creating ? (
        <CreatePostDialog
          ctx={ctx}
          onClose={() => setCreating(false)}
          onCreated={(post) => {
            setCreating(false)
            setCreated(post)
          }}
        />
      ) : null}
      {created ? (
        <PostCreatedDialog
          ctx={ctx}
          created={created}
          onClose={() => setCreated(null)}
          onView={(messageId) => {
            setCreated(null)
            setOpenId(messageId)
          }}
        />
      ) : null}
    </div>
  )
}

/** Keyed by server AND game: switching either rebuilds the screen, so no list, open post, form or dialog of the old game is left. */
export function EsportsAttendance() {
  const ctx = useEsports()
  return <AttendanceScreen key={ctx.scope} ctx={ctx} />
}
