import { RotateCw, Trash2, UserX } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { Signup, SignupParticipant } from '../../shared/types'
import { Badge, Button, EmptyState, ErrorState, LoadingRegion, Modal, Notice, Skeleton, SortHeader, TextField, useToast } from '../components'
import { usePagedList } from '../hooks/paged'
import { useWriteAction } from '../hooks/useWriteAction'
import { errorCode, describeError, outcomeUnknown, unwrap } from '../lib/errors'
import { formatWhen, plural } from '../lib/format'
import { invalidateSignups } from '../lib/invalidation'
import { describeSignupWriteError, PARTICIPANT_GETTERS, participantName, participantSearchFields } from '../lib/signupView'
import type { ParticipantColumn } from '../lib/signupView'
import { matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'

const PAGE = 100

/** The answers of one person, as a plain list. Every text is rendered as text, never as HTML. */
function Answers({ participant }: { participant: SignupParticipant }) {
  if (participant.answers.length === 0) return <span className="muted">No answers</span>
  return (
    <dl className="answers">
      {participant.answers.map((item, index) => (
        <div key={`${index}-${item.question}`} className="answers__row">
          <dt>{item.question}</dt>
          <dd>{item.answer === '' ? <span className="muted">-</span> : item.answer}</dd>
        </div>
      ))}
    </dl>
  )
}

interface Props {
  guildId: string
  signup: Signup
}

/**
 * Everyone who signed up, with all their answers, paged by the server (100 at a time). PRIVACY: the answers are personal
 * data (first name, nationality, age ...). They live in this component's memory only: nothing is written to disk, to the
 * settings file, to a log or to a cache, and they are gone when this screen is left or the server is switched. There is no export.
 */
export function SignupParticipants({ guildId, signup }: Props) {
  const toast = useToast()
  const write = useWriteAction()
  const fetchPage = useCallback(
    (offset: number) => unwrap(window.nexus.api.signupParticipants(guildId, signup.signupId, { limit: PAGE, offset })).then((page) => ({ items: page.participants, total: page.total })),
    [guildId, signup.signupId]
  )
  const list = usePagedList(`league-signups:${guildId}:participants:${signup.signupId}`, fetchPage, (participant) => participant.userId)

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState<ParticipantColumn> | null>({ key: 'signedUp', direction: 'asc' })
  const [pending, setPending] = useState<SignupParticipant | null>(null)
  const [notice, setNotice] = useState<{ tone: 'warning' | 'danger'; text: string } | null>(null)
  const onSort = (column: ParticipantColumn): void => setSort((current) => nextSort(current, column))

  const rows = sortRows(
    list.items.filter((participant) => matchesQuery(participantSearchFields(participant), query)),
    sort,
    PARTICIPANT_GETTERS
  )

  const remove = async (): Promise<void> => {
    if (!pending) return
    const target = pending
    const outcome = await write.run(() => unwrap(window.nexus.api.removeParticipant(guildId, signup.signupId, target.userId)))
    if (!outcome) return
    if (outcome.ok) {
      setPending(null)
      invalidateSignups(guildId) // the list is read again: no row number or position is relied upon
      toast.push({ tone: 'success', title: 'Participant removed', message: `${participantName(target)} is no longer signed up. ${plural(outcome.value.participantCount, 'participant')} left.` })
      return
    }
    const error = outcome.error
    setPending(null)
    if (outcomeUnknown(error)) {
      invalidateSignups(guildId)
      setNotice({ tone: 'danger', text: `Nexus did not get a clear answer, so ${participantName(target)} may already be removed. It is not sent again from here. The list was read again: look at it before you do anything else.` })
      return
    }
    if (errorCode(error) === 'participant_not_found' || errorCode(error) === 'signup_not_found') invalidateSignups(guildId)
    setNotice({ tone: 'warning', text: describeSignupWriteError(error) })
  }

  return (
    <div className="stack">
      <Notice tone="info">
        <strong>The answers are personal data.</strong> They are kept in memory only: never saved to a file, a log or a cache, and cleared when you leave this screen or switch server. They are shown as plain text, and the app has no export. Drivers sign up themselves in Discord; the app cannot sign someone up or change their answers.
      </Notice>
      {notice ? (
        <Notice tone={notice.tone} action={<Button variant="secondary" size="sm" onClick={() => setNotice(null)}>Dismiss</Button>}>
          {notice.text}
        </Notice>
      ) : null}

      {list.first.status === 'loading' ? (
        <LoadingRegion label="Loading the participants" className="stack">
          <Skeleton height={40} />
          <Skeleton height={260} radius={12} />
        </LoadingRegion>
      ) : null}
      {list.first.status === 'error' ? <ErrorState title="Could not load the participants" message={errorCode(list.first.error) === 'forbidden' ? 'You no longer have the FIA, STAFF or Administrator role in this server, so the participants cannot be read.' : describeError(list.first.error)} onRetry={list.first.reload} /> : null}

      {list.first.status === 'ready' && list.total === 0 ? (
        <EmptyState icon={<UserX size={24} aria-hidden="true" />} title="Nobody has signed up yet" description="Drivers sign up with the button on the panel in Discord. They appear here as soon as they finish the form." />
      ) : null}

      {list.first.status === 'ready' && list.total > 0 ? (
        <div className="stack stack--tight">
          <div className="section-head">
            <TextField label="Search the loaded participants" type="search" value={query} placeholder="Name, platform, username or any answer" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
            <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} loading={list.first.refreshing === true} onClick={() => invalidateSignups(guildId)}>
              Refresh
            </Button>
          </div>
          <div className="table-wrap">
            <table className="table table--wide" aria-describedby="participants-count">
              <caption className="sr-only">Participants of {signup.title}</caption>
              <thead>
                <tr>
                  <SortHeader label="Driver" column="name" sort={sort} onSort={onSort} />
                  <SortHeader label="Platform" column="platform" sort={sort} onSort={onSort} />
                  <SortHeader label="Platform username" column="platformUsername" sort={sort} onSort={onSort} />
                  <th scope="col">Answers</th>
                  <SortHeader label="Signed up" column="signedUp" sort={sort} onSort={onSort} />
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="table__empty">
                      No loaded participant matches your search.
                    </td>
                  </tr>
                ) : null}
                {rows.map((participant) => (
                  <tr key={participant.userId}>
                    <th scope="row" className="table__key">
                      {participantName(participant)}
                      {participant.displayName !== null ? <span className="table__note">@{participant.username}</span> : null}
                      {!participant.inServer ? <Badge>Left the server</Badge> : null}
                    </th>
                    <td>{participant.platformName || participant.platform}</td>
                    <td>{participant.platformUsername}</td>
                    <td className="answers-cell">
                      <Answers participant={participant} />
                    </td>
                    <td>{formatWhen(participant.timestamp)}</td>
                    <td>
                      <div className="row-actions">
                        <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={16} aria-hidden="true" />} aria-label={`Remove ${participantName(participant)} from this sign-up`} title="Remove from this sign-up" disabled={write.busy} onClick={() => setPending(participant)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted table-count" id="participants-count" aria-live="polite">
            {query.trim() !== '' ? `Showing ${rows.length} of ${plural(list.items.length, 'loaded participant')}` : plural(list.items.length, 'participant')}
            {list.total > list.items.length ? ` loaded, of ${list.total}. Search and sorting only see the loaded ones.` : ' in this sign-up.'}
          </p>
          {list.moreError ? <Notice tone="danger">Could not load more participants: {list.moreError} The ones above are still shown.</Notice> : null}
          {list.canLoadMore ? (
            <div className="dialog-actions dialog-actions--start">
              <Button variant="secondary" loading={list.loadingMore} onClick={list.loadMore}>
                Load more participants ({list.total - list.items.length} left)
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={pending !== null}
        title={pending ? `Remove ${participantName(pending)} from this sign-up?` : 'Remove participant?'}
        dismissible={!write.busy}
        onClose={() => setPending(null)}
        footer={
          <>
            {/* Cancel is the default focus: Enter never removes a person by accident. */}
            <Button variant="secondary" data-autofocus disabled={write.busy} onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button loading={write.busy} onClick={() => void remove()}>
              Remove the participant
            </Button>
          </>
        }
      >
        {pending ? (
          <>
            <p>
              This removes <strong>{participantName(pending)}</strong> (@{pending.username}) from <strong>{signup.title}</strong>, together with all their answers. <strong>It cannot be undone</strong> from the app: they would have to sign up again in Discord, and only while the sign-up is open.
            </p>
            <ul className="plain-list">
              <li>{signup.status === 'closed' ? 'The sign-up is closed, which does not stop staff from removing someone.' : 'The sign-up stays open.'}</li>
              {!pending.inServer ? <li>They have left the server. Staff can still remove them.</li> : null}
              <li>Nothing is posted in Discord, and the person is not told.</li>
            </ul>
          </>
        ) : null}
      </Modal>
    </div>
  )
}
