import { ArrowDown, ArrowUp, Plus, RotateCw, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { RESULT_LIMITS, validateResultsDraft } from '../../shared/f1Validation'
import type { ResultsField } from '../../shared/f1Validation'
import type { RaceOutcome } from '../../shared/types'
import { Badge, Button, Card, MemberPicker, Modal, Notice, SearchSelect, SuccessMark, TextField, useToast } from '../components'
import type { Person, SearchOption } from '../components'
import { useGuildChannels } from '../hooks/data'
import { useSettings } from '../hooks/settings'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeAnnounceCode, describeChannelError, describeError, errorCode, fieldErrorFor, isChannelError, UiError, writeProblem } from '../lib/errors'
import type { WriteProblem } from '../lib/errors'
import { plural } from '../lib/format'
import { invalidateStandings } from '../lib/invalidation'
import { ambiguousFields, moveItem } from '../lib/resultsFlow'
import type { Candidate } from '../lib/resultsFlow'
import { outcomeNotes, planAfterConflict, planDuplicate, readLedger, sendResults } from '../lib/resultsGuard'
import type { DuplicatePlan } from '../lib/resultsGuard'

interface ResultsFormProps {
  guildId: string
  /** The season in effect (from the server settings), as a starting value. */
  defaultSeason: string
  known: readonly Candidate[]
  /** The server refused with fia_required earlier: the form is read-only. */
  denied: boolean
  onDenied: () => void
  onCheckAgain: () => void
  /** Leave the form: back to the tables. `lost` = the answer was lost and the user chose to refresh the standings. */
  onLeave: (reason: 'back' | 'lost') => void
}

interface Row {
  key: number
  userId: string
}

/** Backend validation codes shown under the field they belong to. */
const FIELD_OF_CODE = {
  invalid_season: 'season',
  invalid_round: 'round',
  invalid_circuit: 'circuit',
  invalid_results: 'positions',
  invalid_fastest_lap: 'fastestLap',
  fastest_lap_not_in_results: 'fastestLap',
  invalid_pole: 'pole',
  pole_not_in_results: 'pole'
} as const satisfies Record<string, ResultsField>

const START_ROWS = 3
const NO_CHANNEL = ''

export function ResultsForm({ guildId, defaultSeason, known, denied, onDenied, onCheckAgain, onLeave }: ResultsFormProps) {
  const toast = useToast()
  const write = useWriteAction()
  const channels = useGuildChannels(guildId)
  const { settings, reload: reloadSettings } = useSettings()
  const nextKey = useRef(START_ROWS)

  const [season, setSeason] = useState(defaultSeason)
  const [round, setRound] = useState('')
  const [circuit, setCircuit] = useState('')
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: START_ROWS }, (_, key) => ({ key, userId: '' })))
  const [people, setPeople] = useState<Map<string, Person>>(() => new Map())
  const [fastestLap, setFastestLap] = useState('')
  const [pole, setPole] = useState('')
  const [channelId, setChannelId] = useState(NO_CHANNEL)
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<ResultsField, string>>>({})
  /** The dialog is open; `plan` says whether it is the plain confirmation or the "recorded before" warning. */
  const [confirming, setConfirming] = useState(false)
  const [plan, setPlan] = useState<DuplicatePlan | null>(null)
  const [problem, setProblem] = useState<WriteProblem | null>(null)
  const [lost, setLost] = useState(false)
  const [outcome, setOutcome] = useState<RaceOutcome | null>(null)

  const drivers = rows.map((row) => row.userId)
  const result = validateResultsDraft({ season, round, circuit, drivers, fastestLap, pole, channelId })
  const errors: Partial<Record<ResultsField, string>> = result.ok ? {} : result.errors
  const show = (field: ResultsField): string | null => serverErrors[field] ?? (submitted ? (errors[field] ?? null) : null)

  const nameOf = (userId: string): string => people.get(userId)?.displayName ?? known.find((person) => person.id === userId)?.displayName ?? userId
  const channelName = (id: string): string => (channels.status === 'ready' ? (channels.data.find((channel) => channel.id === id)?.name ?? '') : '')
  const chosenOptions: SearchOption[] = [
    { value: '', label: 'None' },
    ...rows.flatMap((row, index) => (row.userId !== '' ? [{ value: row.userId, label: nameOf(row.userId), description: `Finished P${index + 1}` }] : []))
  ]
  const channelOptions: SearchOption[] = [
    { value: NO_CHANNEL, label: 'No channel: do not post' },
    ...(channels.status === 'ready' ? channels.data.map((channel) => ({ value: channel.id, label: `# ${channel.name}` })) : [])
  ]

  const clearServer = (): void => {
    setServerErrors({})
    setProblem(null)
  }
  const setRow = (key: number, userId: string, person: Person | null): void => {
    const nextDrivers = rows.map((row) => (row.key === key ? userId : row.userId))
    setRows((current) => current.map((row) => (row.key === key ? { ...row, userId } : row)))
    if (person) setPeople((current) => new Map(current).set(person.id, person))
    // A driver who is no longer in the results cannot keep the fastest lap or the pole.
    if (fastestLap !== '' && !nextDrivers.includes(fastestLap)) setFastestLap('')
    if (pole !== '' && !nextDrivers.includes(pole)) setPole('')
    clearServer()
  }
  const addRows = (count: number): void => {
    setRows((current) => [...current, ...Array.from({ length: Math.min(count, RESULT_LIMITS.maxDrivers - current.length) }, () => ({ key: nextKey.current++, userId: '' }))])
  }
  const removeRow = (index: number): void => {
    const gone = rows[index]?.userId ?? ''
    setRows((current) => current.filter((_, position) => position !== index))
    if (gone !== '') {
      if (fastestLap === gone) setFastestLap('')
      if (pole === gone) setPole('')
    }
    clearServer()
  }
  const taken = (own: string): Map<string, string> => new Map(rows.flatMap((row, index) => (row.userId !== '' && row.userId !== own ? [[row.userId, `Already at P${index + 1}`] as [string, string]] : [])))

  /** "Review and record": first the server's ledger is read, so the warning (if any) comes before the confirm dialog. */
  const review = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitted(true)
    clearServer()
    if (!result.ok || denied) return
    const read = await write.run(() => readLedger(window.nexus.api, guildId, season, round))
    if (!read) return
    if (read.ok) {
      setPlan(planDuplicate(read.value, settings.ledger, guildId, season, round))
      setConfirming(true)
    }
  }

  const record = async (): Promise<void> => {
    if (!result.ok || !plan) return
    // The warning dialog's confirm button is the only place that sets this: the plain dialog never does.
    const confirmedDuplicate = plan.repeat
    const sent = await write.run(async () => {
      const answer = await sendResults(window.nexus.api, guildId, result.value, confirmedDuplicate)
      // 409: nothing was recorded. Read the ledger again (inside the same guarded step) to show what the server has.
      const read = answer.kind === 'duplicate' ? await readLedger(window.nexus.api, guildId, season, round) : null
      return { answer, read }
    })
    if (!sent) return
    if (!sent.ok) {
      setConfirming(false)
      setProblem(writeProblem(sent.error, 'Recording the results'))
      return
    }
    const { answer, read } = sent.value
    switch (answer.kind) {
      case 'recorded':
        setConfirming(false)
        await reloadSettings() // the main process just wrote the local ledger entry
        invalidateStandings(guildId)
        setOutcome(answer.outcome)
        toast.push({ tone: 'success', title: 'Results recorded', message: answer.outcome.raceTitle })
        return
      case 'duplicate':
        // The server says this season and round was recorded already: nothing was changed. Show the warning and ask again.
        setPlan(planAfterConflict(read ?? { ok: false }, settings.ledger, guildId, season, round))
        return
      case 'lost':
        // The race may already be recorded: the data is never offered for sending again.
        setConfirming(false)
        setLost(true)
        return
      case 'refused':
        setConfirming(false)
        handleRefusal(answer.error)
        return
    }
  }

  const handleRefusal = (error: unknown): void => {
    const code = errorCode(error)
    if (code === 'fia_required') {
      onDenied()
      return
    }
    if (channelId !== NO_CHANNEL && isChannelError(error)) {
      // Checked by the server before anything is recorded: nothing was recorded or posted.
      setServerErrors({ channelId: describeChannelError(error, channelName(channelId), 'Nothing was recorded or posted.') })
      return
    }
    if (code === 'ambiguous_name') {
      const message = error instanceof UiError ? error.info.message : ''
      const text = describeError(error)
      setServerErrors(Object.fromEntries(ambiguousFields(message, fastestLap !== '', pole !== '').map((field) => [field, text])))
      return
    }
    const field = fieldErrorFor(error, FIELD_OF_CODE)
    if (field) setServerErrors({ [field.field]: field.message })
    else setProblem(writeProblem(error, 'Recording the results'))
  }

  const startAnother = (): void => {
    setOutcome(null)
    setRows(Array.from({ length: START_ROWS }, () => ({ key: nextKey.current++, userId: '' })))
    setPeople(new Map())
    setFastestLap('')
    setPole('')
    setRound('')
    setCircuit('')
    setPlan(null)
    setSubmitted(false)
  }

  // ── After the answer ──
  if (outcome) {
    const notes = outcomeNotes(outcome)
    return (
      <Card className="stack">
        <div className="success-heading">
          <SuccessMark size={22} className="success-heading__icon" />
          <h2>Results recorded</h2>
        </div>
        <p>
          <strong>{outcome.raceTitle}</strong>. These are the points the server awarded; the standings below were read again from the server.
        </p>
        {outcome.notFound.length > 0 ? (
          <Notice tone="warning">
            The server could not match {plural(outcome.notFound.length, 'driver')} and gave {outcome.notFound.length === 1 ? 'them' : 'these drivers'} no points: {outcome.notFound.join(', ')}. The other drivers were recorded.
          </Notice>
        ) : null}
        {notes.posted && outcome.posted ? <Notice tone="success">Posted the results, driver standings and team standings in #{channelName(outcome.posted.channelId) || 'the chosen channel'}.</Notice> : null}
        {notes.announceError ? (
          <Notice tone="warning">
            The points are recorded, but posting them in {channelId !== NO_CHANNEL && channelName(channelId) ? `#${channelName(channelId)}` : 'the channel'} failed: {describeAnnounceCode(notes.announceError)} Nothing is lost; post the standings by hand if you still want them in that channel.
          </Notice>
        ) : null}
        {notes.ledgerMissing ? (
          <Notice tone="warning">
            The points were applied, but the server could not write this race into its results ledger, so the duplicate warning will not know about it. Do not record this race again.
          </Notice>
        ) : null}
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Points awarded by the server for {outcome.raceTitle}</caption>
            <thead>
              <tr>
                <th scope="col" className="table__num">Position</th>
                <th scope="col">Driver</th>
                <th scope="col" className="table__num">Points awarded</th>
                <th scope="col">Match</th>
              </tr>
            </thead>
            <tbody>
              {outcome.results.map((line) => (
                <tr key={line.position}>
                  <td className="table__num">{line.position}</td>
                  <th scope="row" className="table__key">{line.name}</th>
                  <td className="table__num">{line.points}</td>
                  <td>{line.matched ? <Badge tone="success">Recorded</Badge> : <Badge tone="danger">Not found</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={startAnother}>
            Enter another race
          </Button>
          <Button onClick={() => onLeave('back')}>Back to the standings</Button>
        </div>
      </Card>
    )
  }

  if (lost) {
    return (
      <Card className="stack">
        <Notice
          tone="danger"
          action={
            <Button icon={<RotateCw size={14} aria-hidden="true" />} size="sm" onClick={() => { invalidateStandings(guildId); onLeave('lost') }}>
              Refresh standings
            </Button>
          }
        >
          Nexus did not get a clear answer from the server, so the results of <strong>{season.trim()} / round {round.trim()} / {circuit.trim()}</strong> <strong>may already have been recorded</strong>. They are not sent again from here: sending
          them a second time would add the points twice. Refresh the standings and compare them with what you expected before you decide anything else.
        </Notice>
      </Card>
    )
  }

  const repeat = plan?.repeat === true
  return (
    <form className="stack" onSubmit={(event) => void review(event)} noValidate aria-label="Enter race results">
      <Notice tone="info">
        Recording a race <strong>adds</strong> its points to the standings. The server keeps a ledger of the races recorded <strong>through this app</strong> and warns before the same season and round is recorded again. Results recorded through Discord commands
        (<code>/f1 standings</code>) are <strong>not in that ledger</strong>, so recording a race you already entered in Discord adds its points twice, without any warning.
      </Notice>

      {denied ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={onCheckAgain}>Check again</Button>}>
          {describeError(new UiError({ kind: 'http', code: 'fia_required', message: '', status: 403 }))} The form is read-only. If your roles changed, choose Check again.
        </Notice>
      ) : null}

      <Card className="stack">
        <h2 className="section-title">Race</h2>
        <div className="field-triple">
          <TextField label="Season" value={season} maxLength={RESULT_LIMITS.seasonMax} readOnly={denied} error={show('season')} autoComplete="off" onChange={(event) => { setSeason(event.target.value); clearServer() }} />
          <TextField label="Round" value={round} maxLength={RESULT_LIMITS.roundMax} readOnly={denied} placeholder="3" error={show('round')} autoComplete="off" onChange={(event) => { setRound(event.target.value); clearServer() }} />
          <TextField label="Circuit" value={circuit} maxLength={RESULT_LIMITS.circuitMax} readOnly={denied} placeholder="Zandvoort" error={show('circuit')} autoComplete="off" onChange={(event) => { setCircuit(event.target.value); clearServer() }} />
        </div>
        <p className="muted">These three only form the title, for example Season 5 Round 3 - Zandvoort. The round is free text, not a calendar round. The server compares season and round as text (ignoring case and spaces) to spot a repeat.</p>
      </Card>

      <Card className="stack">
        <div className="section-head">
          <h2 className="section-title">Finishing order</h2>
          <span className="muted">{plural(rows.length, 'position')} of at most {RESULT_LIMITS.maxDrivers}</span>
        </div>
        <ol className="result-rows">
          {rows.map((row, index) => (
            <li key={row.key} className="result-row">
              <span className="result-row__pos" aria-hidden="true">P{index + 1}</span>
              <div className="result-row__picker">
                <MemberPicker
                  label={`Driver in position ${index + 1}`}
                  guildId={guildId}
                  value={row.userId}
                  known={known}
                  taken={taken(row.userId)}
                  placeholder="Search by name"
                  disabled={denied}
                  onChange={(person) => setRow(row.key, person?.id ?? '', person)}
                />
              </div>
              <div className="result-row__actions">
                <Button variant="ghost" size="sm" iconOnly disabled={denied || index === 0} icon={<ArrowUp size={16} aria-hidden="true" />} aria-label={`Move position ${index + 1} up`} onClick={() => setRows((current) => moveItem(current, index, index - 1))} />
                <Button variant="ghost" size="sm" iconOnly disabled={denied || index === rows.length - 1} icon={<ArrowDown size={16} aria-hidden="true" />} aria-label={`Move position ${index + 1} down`} onClick={() => setRows((current) => moveItem(current, index, index + 1))} />
                <Button variant="ghost" size="sm" iconOnly disabled={denied || rows.length <= 1} icon={<Trash2 size={16} aria-hidden="true" />} aria-label={`Remove position ${index + 1}`} onClick={() => removeRow(index)} />
              </div>
            </li>
          ))}
        </ol>
        {show('positions') ? (
          <p className="field__error" role="alert">
            {show('positions')}
          </p>
        ) : null}
        <div className="dialog-actions dialog-actions--start">
          <Button variant="secondary" size="sm" icon={<Plus size={14} aria-hidden="true" />} disabled={denied || rows.length >= RESULT_LIMITS.maxDrivers} onClick={() => addRows(1)}>
            Add position
          </Button>
          <Button variant="secondary" size="sm" disabled={denied || rows.length >= RESULT_LIMITS.maxDrivers} onClick={() => addRows(5)}>
            Add 5 positions
          </Button>
        </div>
        <p className="muted">Drivers on a team or in the standings are listed first; type two letters to search the whole server. A driver the server does not know scores nothing, and the result tells you who.</p>
      </Card>

      <Card className="stack">
        <h2 className="section-title">Bonus points</h2>
        <div className="field-pair">
          <SearchSelect label="Fastest lap" value={fastestLap} options={chosenOptions} placeholder="None" disabled={denied} hint="Chosen from the drivers above. The winner gets no fastest-lap bonus." error={show('fastestLap')} emptyText="Choose the finishing order first." onChange={(value) => { setFastestLap(value); clearServer() }} />
          <SearchSelect label="Pole position" value={pole} options={chosenOptions} placeholder="None" disabled={denied} hint="Chosen from the drivers above." error={show('pole')} emptyText="Choose the finishing order first." onChange={(value) => { setPole(value); clearServer() }} />
        </div>
      </Card>

      <Card className="stack">
        <h2 className="section-title">Post results to a channel</h2>
        <SearchSelect
          label="Channel (optional)"
          value={channelId}
          options={channelOptions}
          placeholder="No channel: do not post"
          disabled={denied || channels.status !== 'ready'}
          hint={
            channels.status === 'error'
              ? 'The channels could not be loaded. You can still record the race without posting it.'
              : 'Optional. Posts the results, the driver standings and the team standings as embeds. The default is not to post anything.'
          }
          error={show('channelId')}
          emptyText="No channel found. Nexus can only post where it has permission."
          onChange={(value) => { setChannelId(value); clearServer() }}
        />
        {channels.status === 'error' ? (
          <div className="dialog-actions dialog-actions--start">
            <Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={channels.reload}>
              Reload channels
            </Button>
          </div>
        ) : null}
        <p className="muted">The server checks the channel before it records anything. If only the post fails afterwards, the points stay recorded and you are told.</p>
      </Card>

      {problem ? <Notice tone="danger">{problem.text}</Notice> : null}

      <div className="form-actions form-actions--split">
        <Button variant="ghost" disabled={write.busy} onClick={() => onLeave('back')}>
          Back to the standings
        </Button>
        <Button type="submit" disabled={denied} loading={write.busy && !confirming}>
          Review and record
        </Button>
      </div>

      {/* Keyed by the warning state: when a 409 flips the dialog to the warning, it is rebuilt and Cancel gets the focus again. */}
      <Modal
        key={repeat ? 'recorded-before' : 'plain'}
        open={confirming}
        title={repeat ? 'This round was recorded before' : 'Add these points to the standings?'}
        dismissible={!write.busy}
        onClose={() => setConfirming(false)}
        footer={
          <>
            {/* Cancel is the default focus: Enter never records by accident, and the repeat warning is not one keystroke away. */}
            <Button variant="secondary" data-autofocus disabled={write.busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button loading={write.busy} onClick={() => void record()}>
              {repeat ? 'Record again and add the points a second time' : 'Record and add the points'}
            </Button>
          </>
        }
      >
        {repeat && plan ? (
          <Notice tone="warning">
            {plan.earlier.length > 0 ? (
              <>
                {plan.source === 'server' ? 'The server' : 'This app'} already has <strong>Season {season.trim()}, round {round.trim()}</strong> recorded through the app:{' '}
                {plan.earlier.map((entry) => `${entry.circuit}${entry.recordedBy ? ` by ${entry.recordedBy}` : ''}, ${new Date(entry.at).toLocaleString()}`).join('; ')}.{' '}
              </>
            ) : (
              <>The server says <strong>Season {season.trim()}, round {round.trim()}</strong> was already recorded through the app. </>
            )}
            Recording it again <strong>adds the points a second time</strong>; the server cannot undo that.
          </Notice>
        ) : null}
        {plan?.source === 'local' ? (
          <Notice tone="info">The server&apos;s results ledger could not be read, so this check only knows the races this app recorded on this computer. The server will still refuse a repeat it knows about, and you will be asked again.</Notice>
        ) : null}
        <p>
          The points for this race will be <strong>ADDED</strong> to the driver and team standings, together with wins and podiums. This cannot be undone from the app.
        </p>
        {result.ok ? (
          <ul className="plain-list">
            <li>
              <strong>Season {result.value.season} / round {result.value.round} / {result.value.circuit}</strong>
            </li>
            <li>{plural(result.value.results.length, 'driver')} in finishing order, from {nameOf(result.value.results[0] ?? '')} on P1</li>
            {result.value.fastestLap ? <li>Fastest lap: {nameOf(result.value.fastestLap)}</li> : null}
            {result.value.pole ? <li>Pole position: {nameOf(result.value.pole)}</li> : null}
            <li>{result.value.channelId ? <>The results and both standings are posted in <strong>#{channelName(result.value.channelId) || 'the chosen channel'}</strong>.</> : 'Nothing is posted in Discord.'}</li>
          </ul>
        ) : null}
        <p className="muted">The server works out the points from the points system. Nothing is calculated in this app.</p>
      </Modal>
    </form>
  )
}
