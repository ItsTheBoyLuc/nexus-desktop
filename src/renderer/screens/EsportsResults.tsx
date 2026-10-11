import { Plus, RotateCw, Trophy } from 'lucide-react'
import { useCallback, useState } from 'react'
import { RACING_LIMITS, validateRacingResultDraft } from '../../shared/racingValidation'
import type { RacingResultField } from '../../shared/racingValidation'
import type { RacingResult } from '../../shared/types'
import { Button, EmptyState, ErrorState, LoadingRegion, Modal, Notice, PageHeader, Select, Skeleton, SortHeader, Stagger, TextField, useToast } from '../components'
import { useRacingTeams } from '../hooks/data'
import { usePagedList } from '../hooks/paged'
import { useManageDenied } from '../hooks/useFiaDenied'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeError, errorCode, fieldErrorFor, unwrap } from '../lib/errors'
import { formatWhen, plural } from '../lib/format'
import { invalidateRacing, racingKey } from '../lib/racingScope'
import {
  describeRacingError,
  describeResultCount,
  MANAGE_SERVER_RULE,
  RESULT_GETTERS,
  RESULT_LOST_TEXT,
  RESULT_TWICE_WARNING,
  resultSearchFields,
  RESULTS_APPEND_ONLY_TEXT,
  RESULTS_NOT_A_STANDING
} from '../lib/racingView'
import type { ResultColumn } from '../lib/racingView'
import { judgeWrite } from '../lib/racingWriteFlow'
import { matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'
import { EsportsNote, useEsports } from './EsportsRoute'
import type { EsportsContext } from './EsportsRoute'

const PAGE = 100

// ── Log a result ────────────────────────────────────────────────────────────

const SERVER_FIELDS = { invalid_team: 'team', invalid_event_name: 'eventName', invalid_result: 'result', invalid_drivers: 'drivers', invalid_notes: 'notes' } as const satisfies Record<string, RacingResultField>

/**
 * Log a result (/racing {game} results-log). Two steps, because the archive can never be corrected: the form, then a summary
 * that says logging the same result twice creates two entries. The write goes out once. After a lost answer the form is
 * locked: the only way forward is "Refresh results", never a second send with the same data.
 */
function LogResultDialog({ ctx, teams, defaultTeam, onClose }: { ctx: EsportsContext; teams: readonly string[]; defaultTeam: string; onClose: () => void }) {
  const toast = useToast()
  const write = useWriteAction()
  const manage = useManageDenied(ctx.guild.id)
  const [draft, setDraft] = useState({ team: defaultTeam, eventName: '', result: '', drivers: '', notes: '' })
  const [step, setStep] = useState<'edit' | 'confirm'>('edit')
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<RacingResultField, string>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [lost, setLost] = useState(false)

  const result = validateRacingResultDraft(draft)
  const errors: Partial<Record<RacingResultField, string>> = result.ok ? {} : result.errors
  const show = (field: RacingResultField): string | null => serverErrors[field] ?? (submitted ? (errors[field] ?? null) : null)
  const change = (field: RacingResultField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerErrors({})
    setProblem(null)
  }

  const review = (): void => {
    setSubmitted(true)
    if (result.ok && !manage.denied && !lost) setStep('confirm')
  }

  const refresh = (): void => {
    invalidateRacing(ctx.guild.id, ctx.game)
    onClose()
  }

  const submit = async (): Promise<void> => {
    if (!result.ok || lost || manage.denied) return
    const outcome = await write.run(() => unwrap(window.nexus.api.logRacingResult(ctx.guild.id, ctx.game, result.value)))
    if (!outcome) return
    if (outcome.ok) {
      invalidateRacing(ctx.guild.id, ctx.game)
      toast.push({ tone: 'success', title: 'Result logged', message: `${outcome.value.teamName}: ${outcome.value.result} at ${outcome.value.eventName}` })
      onClose()
      return
    }
    const error = outcome.error
    const verdict = judgeWrite(error, 'result')
    if (verdict.type === 'lost') {
      // The entry may be in the archive already: lock the form, read the archive again, never offer the same data for sending.
      invalidateRacing(ctx.guild.id, ctx.game)
      setLost(true)
      return
    }
    setStep('edit')
    if (verdict.type === 'denied') {
      manage.markDenied()
      return
    }
    const field = fieldErrorFor(error, SERVER_FIELDS)
    if (field) setServerErrors({ [field.field]: describeError(error) })
    else setProblem(describeRacingError(error, ctx.gameLabel))
  }

  const confirming = step === 'confirm' && result.ok && !lost
  return (
    <Modal
      open
      title={confirming ? `Log this ${ctx.gameLabel} result?` : `Log a ${ctx.gameLabel} result`}
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
              Refresh results
            </Button>
          </>
        ) : confirming ? (
          <>
            <Button variant="secondary" disabled={write.busy} onClick={() => setStep('edit')}>
              Back to editing
            </Button>
            <Button loading={write.busy} onClick={() => void submit()}>
              Log the result
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={manage.denied || teams.length === 0} onClick={review}>
              Review and log
            </Button>
          </>
        )
      }
    >
      {lost ? (
        <Notice tone="danger">
          <strong>The result may already be logged.</strong> {RESULT_LOST_TEXT}
        </Notice>
      ) : null}

      {confirming ? (
        <>
          <Notice tone="warning">{RESULT_TWICE_WARNING} {RESULTS_APPEND_ONLY_TEXT}</Notice>
          <dl className="facts facts--grid">
            <div>
              <dt>Team</dt>
              <dd className="plain-text">{result.value.team}</dd>
            </div>
            <div>
              <dt>Event</dt>
              <dd className="plain-text">{result.value.eventName}</dd>
            </div>
            <div>
              <dt>Result</dt>
              <dd className="plain-text">{result.value.result}</dd>
            </div>
            <div>
              <dt>Drivers involved</dt>
              <dd className="plain-text">{result.value.drivers}</dd>
            </div>
            {result.value.notes ? (
              <div>
                <dt>Notes</dt>
                <dd className="plain-text">{result.value.notes}</dd>
              </div>
            ) : null}
          </dl>
        </>
      ) : lost ? null : (
        <>
          <p className="muted">Like <code>/racing {ctx.game} results-log</code>. {RESULTS_APPEND_ONLY_TEXT}</p>
          {manage.denied ? (
            <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={manage.reset}>Check again</Button>}>
              {MANAGE_SERVER_RULE} The server refused your account, so this action is off. If your permissions changed, choose Check again.
            </Notice>
          ) : null}
          {teams.length === 0 ? <Notice tone="warning">This game has no team yet. Create a team on the Teams page first: a result belongs to a team.</Notice> : null}
          <Select label="Team" value={draft.team} placeholder="Choose a team" options={teams.map((name) => ({ value: name, label: name }))} error={show('team')} onChange={(value) => change('team', value)} />
          <TextField label="Event name" value={draft.eventName} maxLength={RACING_LIMITS.resultEventMax} placeholder="Daytona 24" error={show('eventName')} autoComplete="off" onChange={(event) => change('eventName', event.target.value)} />
          <TextField label="Result" value={draft.result} maxLength={RACING_LIMITS.resultMax} placeholder="P3 in GT3" hint="Free text, up to 100 characters." error={show('result')} autoComplete="off" onChange={(event) => change('result', event.target.value)} />
          <TextField label="Drivers involved" value={draft.drivers} maxLength={RACING_LIMITS.driversMax} placeholder="alice, bob" hint="Free text, as you would type it in the command (up to 200 characters)." error={show('drivers')} autoComplete="off" onChange={(event) => change('drivers', event.target.value)} />
          <TextField multiline label="Notes" optional rows={3} value={draft.notes} maxLength={RACING_LIMITS.notesMax} error={show('notes')} onChange={(event) => change('notes', event.target.value)} />
          {problem ? <Notice tone="danger">{problem}</Notice> : null}
        </>
      )}
    </Modal>
  )
}

// ── The archive ─────────────────────────────────────────────────────────────

function ResultsScreen({ ctx }: { ctx: EsportsContext }) {
  const teams = useRacingTeams(ctx.guild.id, ctx.game)
  const manage = useManageDenied(ctx.guild.id)
  const [logging, setLogging] = useState(false)
  const [team, setTeam] = useState('') // '' = every team; otherwise the team stats of that one team
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState<ResultColumn> | null>(null) // the API's order: oldest first
  const onSort = (column: ResultColumn): void => setSort((current) => nextSort(current, column))

  const fetchPage = useCallback(
    (offset: number) =>
      unwrap(window.nexus.api.racingResults(ctx.guild.id, ctx.game, { ...(team !== '' ? { team } : {}), limit: PAGE, offset })).then((page) => ({ items: page.results, total: page.total })),
    [ctx.guild.id, ctx.game, team]
  )
  const list = usePagedList(racingKey(ctx.guild.id, ctx.game, 'results', team.toLowerCase()), fetchPage, (entry: RacingResult) => entry.id)

  const teamNames = teams.status === 'ready' ? teams.data.map((item) => item.name) : []
  const rows = sortRows(
    list.items.filter((entry) => matchesQuery(resultSearchFields(entry), query)),
    sort,
    RESULT_GETTERS
  )
  const teamGone = list.first.status === 'error' && errorCode(list.first.error) === 'team_not_found'
  const shownTeam = team !== '' ? team : null

  return (
    <div className="page">
      <PageHeader
        title="Results"
        description={`${ctx.guild.name} - the ${ctx.gameLabel} results archive and team stats`}
        actions={
          <div className="header-actions">
            <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} loading={list.first.status === 'ready' && list.first.refreshing === true} onClick={() => invalidateRacing(ctx.guild.id, ctx.game)}>
              Refresh results
            </Button>
            <Button icon={<Plus size={16} aria-hidden="true" />} disabled={manage.denied} title={manage.denied ? 'Needs the Manage Server permission' : undefined} onClick={() => setLogging(true)}>
              Log a result
            </Button>
          </div>
        }
      />
      <EsportsNote game={ctx.game} gameLabel={ctx.gameLabel} />
      <Notice tone="info">
        {RESULTS_APPEND_ONLY_TEXT} {RESULTS_NOT_A_STANDING}
      </Notice>
      {manage.denied ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={manage.reset}>Check again</Button>}>
          {MANAGE_SERVER_RULE} The results stay readable. If your permissions changed, choose Check again.
        </Notice>
      ) : null}

      <div className="table-tools table-tools--two">
        <div className="table-tools__search">
          <TextField label="Search the loaded results" type="search" value={query} placeholder="Event, team, result, drivers or notes" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Select
          label="Team stats"
          value={team}
          disabled={teams.status !== 'ready'}
          options={[{ value: '', label: 'All teams' }, ...teamNames.map((name) => ({ value: name, label: name }))]}
          hint={teams.status === 'error' ? 'The teams could not be loaded.' : undefined}
          onChange={setTeam}
        />
      </div>

      {list.first.status === 'loading' ? (
        <LoadingRegion label="Loading the results" className="stack">
          <Skeleton height={40} />
          <Skeleton height={240} radius={12} />
        </LoadingRegion>
      ) : null}
      {list.first.status === 'error' ? (
        <ErrorState
          title={teamGone ? 'That team no longer exists' : 'Could not load the results'}
          message={teamGone ? describeRacingError(list.first.error, ctx.gameLabel) : errorCode(list.first.error) === 'forbidden' ? 'You no longer have the FIA, STAFF or Administrator role in this server, so the results cannot be read.' : describeError(list.first.error)}
          onRetry={teamGone ? () => setTeam('') : list.first.reload}
        />
      ) : null}

      {list.first.status === 'ready' && list.total === 0 ? (
        <EmptyState
          icon={<Trophy size={24} aria-hidden="true" />}
          title={team !== '' ? `No result logged for ${team}` : 'No result logged yet'}
          description={team !== '' ? 'Choose All teams to see the whole archive, or log the first result of this team.' : `Nothing is in the ${ctx.gameLabel} archive yet. Log the first result after a race.`}
          action={
            <Button icon={<Plus size={16} aria-hidden="true" />} disabled={manage.denied} onClick={() => setLogging(true)}>
              Log a result
            </Button>
          }
        />
      ) : null}

      {list.first.status === 'ready' && list.total > 0 ? (
        <div className="stack stack--tight">
          <div className="table-wrap">
            <table className="table table--wide" aria-describedby="racing-results-count">
              <caption className="sr-only">{team !== '' ? `${ctx.gameLabel} results of ${team}` : `${ctx.gameLabel} results archive`}, oldest first</caption>
              <thead>
                <tr>
                  <SortHeader label="Logged" column="logged" sort={sort} onSort={onSort} />
                  <SortHeader label="Event" column="event" sort={sort} onSort={onSort} />
                  <SortHeader label="Team" column="team" sort={sort} onSort={onSort} />
                  <SortHeader label="Result" column="result" sort={sort} onSort={onSort} />
                  <th scope="col">Drivers</th>
                </tr>
              </thead>
              <Stagger as="tbody">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="table__empty">
                      No loaded result matches your search.
                    </td>
                  </tr>
                ) : null}
                {rows.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.loggedAt === '' ? <span className="muted">-</span> : formatWhen(entry.loggedAt)}</td>
                    <th scope="row" className="table__key">
                      <span className="plain-text">{entry.eventName}</span>
                      {entry.notes ? <span className="table__note plain-text">{entry.notes}</span> : null}
                    </th>
                    <td className="plain-text">{entry.teamName}</td>
                    <td className="plain-text">{entry.result}</td>
                    <td className="plain-text">{entry.drivers}</td>
                  </tr>
                ))}
              </Stagger>
            </table>
          </div>
          <p className="muted table-count" id="racing-results-count" aria-live="polite">
            {describeResultCount(list.total, shownTeam)}. {query.trim() !== '' ? `Showing ${rows.length} of ${plural(list.items.length, 'loaded entry', 'loaded entries')}. ` : ''}
            {list.total > list.items.length ? `${list.items.length} loaded, oldest first: the newest entries are on the last pages. Search and sorting only see the loaded ones.` : 'All loaded, oldest first.'}
          </p>
          {list.moreError ? <Notice tone="danger">Could not load more results: {list.moreError} The results above are still shown.</Notice> : null}
          {list.canLoadMore ? (
            <div className="dialog-actions dialog-actions--start">
              <Button variant="secondary" loading={list.loadingMore} onClick={list.loadMore}>
                Load more results ({list.total - list.items.length} left)
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {logging ? <LogResultDialog ctx={ctx} teams={teamNames} defaultTeam={team} onClose={() => setLogging(false)} /> : null}
    </div>
  )
}

/** Keyed by server AND game: switching either rebuilds the screen, so nothing of the old game's archive, form or dialog is left. */
export function EsportsResults() {
  const ctx = useEsports()
  return <ResultsScreen key={ctx.scope} ctx={ctx} />
}
