import { ArrowLeft, ExternalLink as ExternalIcon, Lock, Plus, RotateCw, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { SIGNUP_LIMITS, validateSignupDraft } from '../../shared/attendanceValidation'
import type { SignupField } from '../../shared/attendanceValidation'
import type { Signup, SignupCloseResult, SignupCreateResult } from '../../shared/types'
import { Badge, Button, Card, CopyButton, EmptyState, ErrorState, LoadingRegion, Modal, Notice, PageHeader, SearchSelect, Select, Skeleton, SortHeader, Tabs, tabPanelProps, TextField, useToast } from '../components'
import { useGuildChannels, useSignup, useSignups } from '../hooks/data'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeError, errorCode, fieldErrorFor, outcomeUnknown, unwrap } from '../lib/errors'
import { formatDay, plural } from '../lib/format'
import { invalidateSignups } from '../lib/invalidation'
import { describePanelError, describeSignupCreateError, describeSignupWriteError, matchesSignupFilter, SIGNUP_FILTER_OPTIONS, SIGNUP_GETTERS } from '../lib/signupView'
import type { SignupColumn, SignupFilter } from '../lib/signupView'
import { matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'
import { F1Only } from './F1Only'
import { useLeague } from './LeagueRoute'
import { SignupParticipants } from './SignupParticipants'
import { SignupQuestionsEditor } from './SignupQuestionsEditor'

type TabId = 'signups' | 'settings'

export const NOT_POSSIBLE =
  'Drivers sign up themselves with the button on the panel in Discord. The app cannot sign someone up, edit their answers, reopen, edit or delete a sign-up, or give one sign-up its own questions (the server\'s questions, or the defaults, are used). The only thing it can do to a participant is remove them.'

function readProblem(error: unknown): string {
  return errorCode(error) === 'forbidden' ? 'You no longer have the FIA, STAFF or Administrator role in this server, so sign-ups cannot be read.' : describeError(error)
}

// ── Create ──────────────────────────────────────────────────────────────────

function CreateSignupDialog({ guildId, onClose, onCreated }: { guildId: string; onClose: () => void; onCreated: (result: SignupCreateResult) => void }) {
  const channels = useGuildChannels(guildId)
  const toast = useToast()
  const write = useWriteAction()
  const [draft, setDraft] = useState({ title: '', description: '', channelId: '', confirmationChannelId: '', closeDate: '' })
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<SignupField, string>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [lost, setLost] = useState(false)

  const result = validateSignupDraft(draft)
  const errors: Partial<Record<SignupField, string>> = result.ok ? {} : result.errors
  const show = (field: SignupField): string | null => serverErrors[field] ?? (submitted ? (errors[field] ?? null) : null)
  const nameOf = (id: string): string => (channels.status === 'ready' ? (channels.data.find((channel) => channel.id === id)?.name ?? '') : '')
  const change = (field: SignupField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerErrors({})
    setProblem(null)
  }
  const options = channels.status === 'ready' ? channels.data.map((channel) => ({ value: channel.id, label: `# ${channel.name}` })) : []

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (!result.ok || lost) return
    const outcome = await write.run(() => unwrap(window.nexus.api.createSignup(guildId, result.value)))
    if (!outcome) return
    if (outcome.ok) {
      invalidateSignups(guildId)
      toast.push({ tone: 'success', title: 'Sign-up created', message: outcome.value.signup.title })
      onCreated(outcome.value)
      return
    }
    const error = outcome.error
    if (outcomeUnknown(error)) {
      // A lost answer may have posted the panel: it is never offered for sending again with the same data.
      invalidateSignups(guildId)
      setLost(true)
      return
    }
    const known = describeSignupCreateError(error, { channel: nameOf(draft.channelId), confirmation: nameOf(draft.confirmationChannelId) })
    if (known) {
      if (known.field) setServerErrors({ [known.field]: known.text })
      else setProblem(known.text)
      return
    }
    const field = fieldErrorFor(error, { invalid_title: 'title', invalid_description: 'description', invalid_close_date: 'closeDate' } as const)
    if (field) setServerErrors({ [field.field]: field.message })
    else setProblem(describeError(error))
  }

  return (
    <Modal
      open
      title="Create a sign-up"
      size="lg"
      dismissible={!write.busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={write.busy} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={write.busy} disabled={lost} onClick={() => void submit()}>
            Post the sign-up
          </Button>
        </>
      }
    >
      <p className="muted">
        Like <code>/league signup</code>: posts a panel with a <strong>Start Sign-up</strong> button in a channel. The panel lists the questions of the Settings tab (or the defaults). Nothing closes automatically.
      </p>
      {lost ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={onClose}>Close and refresh the list</Button>}>
          Nexus did not get a clear answer, so <strong>the sign-up may already be posted in Discord</strong>. It is not sent again with the same data, because that would post a second panel. The list was just read again: check it, and check the channel in Discord, before you create anything.
        </Notice>
      ) : null}
      <TextField label="Title" value={draft.title} maxLength={SIGNUP_LIMITS.titleMax} placeholder="Season 16 Sign-up" error={show('title')} autoComplete="off" onChange={(event) => change('title', event.target.value)} />
      <TextField multiline label="Description" optional rows={4} value={draft.description} maxLength={SIGNUP_LIMITS.descriptionMax} error={show('description')} onChange={(event) => change('description', event.target.value)} />
      <div className="field-pair">
        <SearchSelect
          label="Channel for the panel"
          value={draft.channelId}
          options={options}
          placeholder="Search channels"
          disabled={channels.status !== 'ready'}
          hint={channels.status === 'error' ? 'The channels could not be loaded.' : 'Only channels where Nexus can post and you can see are listed.'}
          error={show('channelId')}
          emptyText="No channel found. Nexus can only post where it has permission."
          onChange={(value) => change('channelId', value)}
        />
        <SearchSelect
          label="Confirmation channel"
          value={draft.confirmationChannelId}
          options={[{ value: '', label: 'Default: signup-confirmations' }, ...options]}
          placeholder="Default: signup-confirmations"
          disabled={channels.status !== 'ready'}
          hint="Where each finished sign-up is reported to the staff."
          error={show('confirmationChannelId')}
          emptyText="No channel found."
          onChange={(value) => change('confirmationChannelId', value)}
        />
      </div>
      <Notice tone="info">
        <strong>How the confirmation channel works.</strong> The sign-up stores the channel&apos;s <em>name</em>, not the channel. Every time a driver finishes, the bot looks for a channel with that name (ignoring emoji and capitals) and posts the confirmation there; if none matches, the bot <strong>creates</strong> one called
        after the name when the first driver signs up. Creating a sign-up here never creates a channel, it only checks that the bot could post there (or has Manage Channels to create it). Renaming the channel later, or adding a similarly named one, sends confirmations somewhere else.
      </Notice>
      <TextField label="Close date" optional value={draft.closeDate} maxLength={SIGNUP_LIMITS.closeDateMax} placeholder="1 June" hint="Free text, shown in the panel footer. Nothing closes automatically: you close the sign-up yourself." error={show('closeDate')} autoComplete="off" onChange={(event) => change('closeDate', event.target.value)} />
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
    </Modal>
  )
}

function SignupCreatedDialog({ guildId, result, onClose, onOpen }: { guildId: string; result: SignupCreateResult; onClose: () => void; onOpen: (signupId: string) => void }) {
  const toast = useToast()
  const link = `https://discord.com/channels/${guildId}/${result.channelId}/${result.signup.signupId}`
  const open = async (): Promise<void> => {
    const opened = await window.nexus.system.openExternal(link).catch(() => false)
    if (!opened) toast.push({ tone: 'danger', title: 'Link not opened', message: 'The link could not be opened. Copy it and open it in your browser.' })
  }
  return (
    <Modal
      open
      title="Sign-up created"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpen(result.signup.signupId)}>
            Open the sign-up
          </Button>
          <Button data-autofocus onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <p>
        <strong>{result.signup.title}</strong> is open in Discord. Confirmations go to a channel named <strong>{result.signup.confirmationChannel}</strong> (found or created by the bot when the first driver signs up).
      </p>
      <div className="dialog-actions dialog-actions--start">
        <Button variant="secondary" size="sm" icon={<ExternalIcon size={14} aria-hidden="true" />} onClick={() => void open()}>
          Open the panel in Discord
        </Button>
        <CopyButton text={result.signup.signupId} label="Copy the sign-up ID" what="The sign-up ID" />
      </div>
    </Modal>
  )
}

// ── One sign-up ─────────────────────────────────────────────────────────────

function SignupDetail({ guildId, signupId, onBack }: { guildId: string; signupId: string; onBack: () => void }) {
  const signup = useSignup(guildId, signupId)
  const channels = useGuildChannels(guildId)
  const toast = useToast()
  const write = useWriteAction()
  const [closing, setClosing] = useState(false)
  const [closeProblem, setCloseProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'warning' | 'danger'; text: string } | null>(null)

  const channelName = (id: string | null): string | null => (id && channels.status === 'ready' ? (channels.data.find((channel) => channel.id === id)?.name ?? null) : null)

  const close = async (): Promise<void> => {
    setCloseProblem(null)
    const outcome = await write.run(() => unwrap(window.nexus.api.closeSignup(guildId, signupId)))
    if (!outcome) return
    if (outcome.ok) {
      const value: SignupCloseResult = outcome.value
      setClosing(false)
      invalidateSignups(guildId)
      toast.push({ tone: 'success', title: 'Sign-up closed', message: value.signup.title })
      if (!value.panelUpdated) {
        setNotice({
          tone: 'warning',
          text: `The sign-up is closed and new sign-ups are refused, but the panel in Discord could not be greyed out: ${describePanelError(value.panelError ?? 'unknown')}. Its button may still look active; clicking it answers that sign-ups are closed.`
        })
      }
      return
    }
    const error = outcome.error
    if (outcomeUnknown(error)) {
      setClosing(false)
      invalidateSignups(guildId)
      setNotice({ tone: 'danger', text: 'Nexus did not get a clear answer, so the sign-up may already be closed. It is not sent again from here. The sign-up was read again: look at its status.' })
      return
    }
    if (errorCode(error) === 'already_closed' || errorCode(error) === 'signup_not_found') {
      setClosing(false)
      invalidateSignups(guildId)
      setNotice({ tone: 'warning', text: describeSignupWriteError(error) })
      return
    }
    setCloseProblem(describeSignupWriteError(error))
  }

  return (
    <div className="stack">
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={onBack}>
          All sign-ups
        </Button>
      </div>
      {signup.status === 'loading' ? (
        <LoadingRegion label="Loading the sign-up" className="stack">
          <Skeleton height={120} radius={12} />
        </LoadingRegion>
      ) : null}
      {signup.status === 'error' ? (
        <ErrorState
          title={errorCode(signup.error) === 'signup_not_found' ? 'This sign-up no longer exists' : 'Could not load the sign-up'}
          message={errorCode(signup.error) === 'signup_not_found' ? describeSignupWriteError(signup.error) : readProblem(signup.error)}
          onRetry={errorCode(signup.error) === 'signup_not_found' ? onBack : signup.reload}
        />
      ) : null}
      {notice ? (
        <Notice tone={notice.tone} action={<Button variant="secondary" size="sm" onClick={() => setNotice(null)}>Dismiss</Button>}>
          {notice.text}
        </Notice>
      ) : null}
      {signup.status === 'ready' ? (
        <>
          <Card className="stack">
            <div className="section-head">
              <h2>{signup.data.title}</h2>
              <div className="header-actions">
                <Badge tone={signup.data.status === 'open' ? 'success' : 'neutral'}>{signup.data.status === 'open' ? 'Open' : 'Closed'}</Badge>
                {signup.data.status === 'open' ? (
                  <Button variant="secondary" size="sm" icon={<Lock size={14} aria-hidden="true" />} disabled={signup.refreshing === true} onClick={() => { setClosing(true); setCloseProblem(null) }}>
                    Close this sign-up
                  </Button>
                ) : null}
              </div>
            </div>
            {signup.data.description ? <p className="plain-text">{signup.data.description}</p> : null}
            <dl className="facts facts--grid">
              <div>
                <dt>Participants</dt>
                <dd>{signup.data.participantCount}</dd>
              </div>
              <div>
                <dt>Close date</dt>
                <dd>{signup.data.closeDate ?? <span className="muted">None (nothing closes automatically)</span>}</dd>
              </div>
              <div>
                <dt>Panel channel</dt>
                <dd>{channelName(signup.data.panelChannelId) ? `# ${channelName(signup.data.panelChannelId)}` : <span className="muted">Not known</span>}</dd>
              </div>
              <div>
                <dt>Confirmation channel (by name)</dt>
                <dd>{signup.data.confirmationChannel || <span className="muted">Not known</span>}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDay(signup.data.createdAt)}</dd>
              </div>
              {signup.data.customQuestionCount > 0 ? (
                <div>
                  <dt>Own questions</dt>
                  <dd>{plural(signup.data.customQuestionCount, 'question')} set in Discord</dd>
                </div>
              ) : null}
            </dl>
          </Card>
          <SignupParticipants key={signup.data.signupId} guildId={guildId} signup={signup.data} />
        </>
      ) : null}

      <Modal
        open={closing && signup.status === 'ready'}
        title="Close this sign-up?"
        dismissible={!write.busy}
        onClose={() => setClosing(false)}
        footer={
          <>
            {/* Cancel is the default focus: Enter never closes a sign-up by accident. */}
            <Button variant="secondary" data-autofocus disabled={write.busy} onClick={() => setClosing(false)}>
              Cancel
            </Button>
            <Button loading={write.busy} onClick={() => void close()}>
              Close the sign-up
            </Button>
          </>
        }
      >
        <p>
          Closing <strong>{signup.status === 'ready' ? signup.data.title : 'this sign-up'}</strong> has these effects:
        </p>
        <ul className="plain-list">
          <li>The panel in Discord is greyed out and its button is disabled ("Sign-ups Closed").</li>
          <li>New sign-ups are refused. The people who already signed up stay on the list.</li>
          <li>
            <strong>It cannot be reopened, edited or deleted</strong>, from the app or in Discord: there is no command for it. Staff can still remove participants afterwards.
          </li>
        </ul>
        {closeProblem ? <Notice tone="danger">{closeProblem}</Notice> : null}
      </Modal>
    </div>
  )
}

// ── The list ────────────────────────────────────────────────────────────────

function SignupList({ guildId, onOpen, onCreate }: { guildId: string; onOpen: (signupId: string) => void; onCreate: () => void }) {
  const signups = useSignups(guildId)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SignupFilter>('all')
  const [sort, setSort] = useState<SortState<SignupColumn> | null>({ key: 'created', direction: 'desc' })
  const onSort = (column: SignupColumn): void => setSort((current) => nextSort(current, column))

  const data = signups.status === 'ready' ? signups.data : []
  const rows = sortRows(
    data.filter((signup) => matchesQuery([signup.title, signup.description, signup.closeDate], query) && matchesSignupFilter(signup, filter)),
    sort,
    SIGNUP_GETTERS
  )
  const filtering = query.trim() !== '' || filter !== 'all'

  return (
    <div className="stack">
      {signups.status === 'loading' ? (
        <LoadingRegion label="Loading the sign-ups" className="stack">
          <Skeleton height={40} />
          <Skeleton height={200} radius={12} />
        </LoadingRegion>
      ) : null}
      {signups.status === 'error' ? <ErrorState title="Could not load the sign-ups" message={readProblem(signups.error)} onRetry={signups.reload} /> : null}
      {signups.status === 'ready' && data.length === 0 ? (
        <EmptyState
          icon={<UserPlus size={24} aria-hidden="true" />}
          title="No sign-ups yet"
          description="Create a sign-up: Nexus posts a panel with a Start Sign-up button, and drivers sign up in Discord."
          action={
            <Button icon={<Plus size={16} aria-hidden="true" />} onClick={onCreate}>
              Create the first sign-up
            </Button>
          }
        />
      ) : null}
      {signups.status === 'ready' && data.length > 0 ? (
        <div className="stack stack--tight">
          <div className="table-tools table-tools--two">
            <div className="table-tools__search">
              <TextField label="Search sign-ups" type="search" value={query} placeholder="Title, description or close date" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
            </div>
            <Select label="Status" value={filter} options={SIGNUP_FILTER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} onChange={(value) => setFilter(value as SignupFilter)} />
          </div>
          <div className="table-wrap">
            <table className="table table--wide" aria-describedby="signups-count">
              <caption className="sr-only">Sign-ups, newest first by default</caption>
              <thead>
                <tr>
                  <SortHeader label="Title" column="title" sort={sort} onSort={onSort} />
                  <SortHeader label="Status" column="status" sort={sort} onSort={onSort} />
                  <SortHeader label="Participants" column="participants" sort={sort} onSort={onSort} numeric />
                  <SortHeader label="Close date" column="closes" sort={sort} onSort={onSort} />
                  <SortHeader label="Created" column="created" sort={sort} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="table__empty">
                      No sign-up matches your search or filter.
                    </td>
                  </tr>
                ) : null}
                {rows.map((signup: Signup) => (
                  <tr key={signup.signupId}>
                    <th scope="row" className="table__key">
                      <button type="button" className="link-btn" onClick={() => onOpen(signup.signupId)} aria-label={`Open the sign-up ${signup.title}`}>
                        <span>{signup.title}</span>
                      </button>
                    </th>
                    <td>
                      <Badge tone={signup.status === 'open' ? 'success' : 'neutral'}>{signup.status === 'open' ? 'Open' : 'Closed'}</Badge>
                    </td>
                    <td className="table__num">{signup.participantCount}</td>
                    <td>{signup.closeDate ?? <span className="muted">None</span>}</td>
                    <td>{formatDay(signup.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted table-count" id="signups-count" aria-live="polite">
            {filtering ? `Showing ${rows.length} of ${plural(data.length, 'sign-up')}` : plural(data.length, 'sign-up')}. The close date is free text from the panel; nothing closes automatically.
          </p>
        </div>
      ) : null}
    </div>
  )
}

// ── The screen ──────────────────────────────────────────────────────────────

function SignupsScreen() {
  const { guild } = useLeague()
  const [tab, setTab] = useState<TabId>('signups')
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<SignupCreateResult | null>(null)

  return (
    <div className="page">
      <PageHeader
        title="Sign-ups"
        description={`${guild.name} - league sign-ups and their questions`}
        actions={
          <div className="header-actions">
            <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={() => invalidateSignups(guild.id)}>
              Refresh
            </Button>
            {tab === 'signups' && selected === null ? (
              <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreating(true)}>
                Create a sign-up
              </Button>
            ) : null}
          </div>
        }
      />
      <Notice tone="info">{NOT_POSSIBLE}</Notice>

      <Tabs
        label="Sign-ups"
        idPrefix="signups"
        active={tab}
        onChange={(id) => {
          setTab(id as TabId)
          setSelected(null)
        }}
        tabs={[
          { id: 'signups', label: 'Sign-ups' },
          { id: 'settings', label: 'Settings' }
        ]}
      />
      {tab === 'settings' ? (
        <div {...tabPanelProps('signups', 'settings')}>
          <SignupQuestionsEditor guildId={guild.id} />
        </div>
      ) : (
        <div {...tabPanelProps('signups', 'signups')} className="stack">
          {selected !== null ? <SignupDetail key={selected} guildId={guild.id} signupId={selected} onBack={() => setSelected(null)} /> : <SignupList guildId={guild.id} onOpen={setSelected} onCreate={() => setCreating(true)} />}
        </div>
      )}

      {creating ? (
        <CreateSignupDialog
          guildId={guild.id}
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false)
            setCreated(result)
          }}
        />
      ) : null}
      {created ? (
        <SignupCreatedDialog
          guildId={guild.id}
          result={created}
          onClose={() => setCreated(null)}
          onOpen={(signupId) => {
            setCreated(null)
            setTab('signups')
            setSelected(signupId)
          }}
        />
      ) : null}
    </div>
  )
}

/** Keyed by the server: switching server drops everything this screen holds, the participants' answers included. */
function SignupsForServer() {
  const { guild } = useLeague()
  return <SignupsScreen key={guild.id} />
}

export function Signups() {
  return (
    <F1Only page="signups">
      <SignupsForServer />
    </F1Only>
  )
}
