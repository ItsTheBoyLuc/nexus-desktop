import { useId, useState } from 'react'
import { ADVANCE_LIMITS, BAN_LIMITS, CLEAR_LIMITS, MANUAL_LIMITS, validateAdvanceDraft, validateBanDraft, validateClearDraft } from '../../shared/penaltyValidation'
import { LIMIT_NOTES } from '../../shared/textLimits'
import type { AdvanceRaceResult, BanResult, ClearPointsResult } from '../../shared/types'
import { Button, Modal, Notice, TextField } from '../components'
import { confirmed, describeAdvanceEffect, describeBanEffect, describeClearEffect } from '../lib/penaltyActions'
import { ActionShell } from './ActionShell'

/** What every destructive dialog gets from the Penalties screen. */
interface CommonProps {
  guildId: string
  /** The season shown in the overview: every action is sent with it explicitly, never "whatever is current". */
  season: number
  currentSeason: number
  /** The FIA role was refused earlier: the dialog stays read-only. */
  denied: boolean
  onDenied: () => void
  onClose: () => void
  onOpenPenaltySettings: () => void
}

const DENIED_TEXT = 'Only members with the FIA role, or server administrators, can clear points, give or remove bans and advance the race. The server refused your account, so this action is off.'

function useFieldErrors() {
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  return {
    submitted,
    markSubmitted: () => setSubmitted(true),
    clear: () => setServerErrors({}),
    set: (field: string, message: string) => setServerErrors({ [field]: message }),
    show: (field: string, local: string | undefined): string | null => serverErrors[field] ?? (submitted ? (local ?? null) : null)
  }
}

// ── Clear points ────────────────────────────────────────────────────────────

interface ClearProps extends CommonProps {
  driver: string
  displayName: string
  currentTotal: number | null
  onDone: (result: ClearPointsResult) => void
}

export function ClearPointsDialog({ guildId, season, currentSeason, denied, onDenied, onClose, onOpenPenaltySettings, driver, displayName, currentTotal, onDone }: ClearProps) {
  const [mode, setMode] = useState<'all' | 'partial'>('partial')
  const [points, setPoints] = useState('')
  const [reason, setReason] = useState('')
  const fields = useFieldErrors()

  const result = validateClearDraft({ driver, mode, points, reason, season: String(season) })
  const errors: Partial<Record<string, string>> = result.ok ? {} : result.errors
  const touch = (): void => fields.clear()

  return (
    <ActionShell<ClearPointsResult>
      title={`Clear points of ${displayName}`}
      confirmTitle={`Clear points of ${displayName}?`}
      confirmLabel={mode === 'all' ? 'Clear all points' : 'Remove the points'}
      guildId={guildId}
      deniedMessage={denied ? DENIED_TEXT : null}
      onDenied={onDenied}
      onClose={onClose}
      onOpenPenaltySettings={onOpenPenaltySettings}
      onField={fields.set}
      onDone={onDone}
      review={() => {
        fields.markSubmitted()
        if (!result.ok) return null
        return (
          <>
            <p>
              You are about to change the penalty points of <strong>{displayName}</strong> in <strong>season {season}</strong>.
            </p>
            <ul className="plain-list">
              {describeClearEffect(result.value, displayName, currentSeason, mode === 'all' ? currentTotal : null).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <Notice tone="warning">
              <span>Reason that is kept:</span> <span className="text-clamp text-clamp--wide">{result.value.reason}</span>
              <span>Cleared points cannot be brought back from the app.</span>
            </Notice>
          </>
        )
      }}
      send={() => {
        if (!result.ok) throw new Error('unreachable: the confirm step only opens for a valid form')
        return window.nexus.api.clearPenaltyPoints(guildId, confirmed(result.value))
      }}
      form={
        <>
          <p className="muted">
            Driver <strong>{displayName}</strong>, season <strong>{season}</strong>
            {currentTotal !== null ? <>, currently {currentTotal} {currentTotal === 1 ? 'point' : 'points'}</> : null}. Like <code>/league clear-penalty</code>.
          </p>
          <fieldset className="choice-group">
            <legend className="field__label">What to clear</legend>
            <div className="choice">
              <input type="radio" id="clear-partial" name="clear-mode" checked={mode === 'partial'} onChange={() => { setMode('partial'); touch() }} />
              <label htmlFor="clear-partial">
                Remove some points
                <span className="choice__note">The history is kept with an admin-removal entry.</span>
              </label>
            </div>
            <div className="choice">
              <input type="radio" id="clear-all" name="clear-mode" checked={mode === 'all'} onChange={() => { setMode('all'); touch() }} />
              <label htmlFor="clear-all">
                Clear everything
                <span className="choice__note">All points and the whole history of this season; both bans are lifted.</span>
              </label>
            </div>
          </fieldset>
          {mode === 'partial' ? (
            <TextField label="Points to remove" inputMode="numeric" value={points} hint={`${CLEAR_LIMITS.pointsMin} to ${CLEAR_LIMITS.pointsMax}. The total never goes below 0.`} error={fields.show('points', errors['points'])} autoComplete="off" onChange={(event) => { setPoints(event.target.value); touch() }} />
          ) : null}
          <TextField multiline label="Reason" rows={4} value={reason} maxLength={CLEAR_LIMITS.reasonMax} limitNote={LIMIT_NOTES.stored} error={fields.show('reason', errors['reason'])} onChange={(event) => { setReason(event.target.value); touch() }} />
          {fields.show('season', errors['season']) ? <Notice tone="danger">{fields.show('season', errors['season'])}</Notice> : null}
        </>
      }
    />
  )
}

// ── Bans ────────────────────────────────────────────────────────────────────

interface BanProps extends CommonProps {
  /** Set when opened for one driver (their history); empty = type or pick a name. */
  driver: string
  displayName: string
  lockDriver: boolean
  suggestions: readonly string[]
  /** Starts on this action. */
  initialAction?: 'give' | 'remove'
  initialType?: 'quali' | 'race'
  onDone: (result: BanResult) => void
}

export function BanDialog({ guildId, season, currentSeason, denied, onDenied, onClose, onOpenPenaltySettings, driver: initialDriver, displayName, lockDriver, suggestions, initialAction = 'give', initialType = 'quali', onDone }: BanProps) {
  const [driver, setDriver] = useState(initialDriver)
  const [banType, setBanType] = useState<string>(initialType)
  const [action, setAction] = useState<string>(initialAction)
  const [reason, setReason] = useState('')
  const fields = useFieldErrors()
  const listId = useId()

  const result = validateBanDraft({ driver, banType, action, reason, season: String(season) })
  const errors: Partial<Record<string, string>> = result.ok ? {} : result.errors
  const name = lockDriver ? displayName : driver.trim()
  const touch = (): void => fields.clear()

  return (
    <ActionShell<BanResult>
      title={lockDriver ? `Bans of ${displayName}` : 'Give or remove a ban'}
      confirmTitle={`${action === 'give' ? 'Give' : 'Remove'} the ${banType === 'quali' ? 'qualifying' : 'race'} ban of ${name}?`}
      confirmLabel={action === 'give' ? 'Give the ban' : 'Remove the ban'}
      guildId={guildId}
      deniedMessage={denied ? DENIED_TEXT : null}
      onDenied={onDenied}
      onClose={onClose}
      onOpenPenaltySettings={onOpenPenaltySettings}
      onField={fields.set}
      onDone={onDone}
      review={() => {
        fields.markSubmitted()
        if (!result.ok) return null
        return (
          <>
            <p>
              You are about to change the ban of <strong>{name}</strong> in <strong>season {season}</strong>.
            </p>
            <ul className="plain-list">
              {describeBanEffect(result.value, name, currentSeason).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {result.value.reason ? <p className="muted">Reason for the activity log: {result.value.reason}</p> : null}
          </>
        )
      }}
      send={() => {
        if (!result.ok) throw new Error('unreachable: the confirm step only opens for a valid form')
        return window.nexus.api.setBan(guildId, confirmed(result.value))
      }}
      form={
        <>
          <p className="muted">
            Like <code>/league ban-manage</code>. Season <strong>{season}</strong>. Giving a ban does not change the driver&apos;s points; removing one keeps them.
          </p>
          <TextField
            label="Driver"
            value={lockDriver ? displayName : driver}
            readOnly={lockDriver}
            list={!lockDriver && suggestions.length > 0 ? listId : undefined}
            maxLength={MANUAL_LIMITS.driverMax}
            hint={lockDriver ? undefined : "The driver's name as the league uses it. Removing a ban needs a penalty record in this season."}
            error={fields.show('driver', errors['driver'])}
            autoComplete="off"
            onChange={(event) => { setDriver(event.target.value); touch() }}
          />
          {!lockDriver && suggestions.length > 0 ? (
            <datalist id={listId}>
              {suggestions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          ) : null}
          <div className="field-pair">
            <fieldset className="choice-group">
              <legend className="field__label">Ban</legend>
              <div className="choice">
                <input type="radio" id="ban-quali" name="ban-type" checked={banType === 'quali'} onChange={() => { setBanType('quali'); touch() }} />
                <label htmlFor="ban-quali">Qualifying ban</label>
              </div>
              <div className="choice">
                <input type="radio" id="ban-race" name="ban-type" checked={banType === 'race'} onChange={() => { setBanType('race'); touch() }} />
                <label htmlFor="ban-race">Race ban</label>
              </div>
            </fieldset>
            <fieldset className="choice-group">
              <legend className="field__label">Action</legend>
              <div className="choice">
                <input type="radio" id="ban-give" name="ban-action" checked={action === 'give'} onChange={() => { setAction('give'); touch() }} />
                <label htmlFor="ban-give">Give the ban</label>
              </div>
              <div className="choice">
                <input type="radio" id="ban-remove" name="ban-action" checked={action === 'remove'} onChange={() => { setAction('remove'); touch() }} />
                <label htmlFor="ban-remove">Remove the ban</label>
              </div>
            </fieldset>
          </div>
          <TextField label="Reason" optional value={reason} maxLength={BAN_LIMITS.reasonMax} hint="Only kept in the activity log, not with the driver." error={fields.show('reason', errors['reason'])} autoComplete="off" onChange={(event) => { setReason(event.target.value); touch() }} />
          {fields.show('season', errors['season']) ? <Notice tone="danger">{fields.show('season', errors['season'])}</Notice> : null}
        </>
      }
    />
  )
}

// ── Advance race ────────────────────────────────────────────────────────────

interface AdvanceProps extends Omit<CommonProps, 'season'> {
  onDone: (result: AdvanceRaceResult) => void
}

export function AdvanceRaceDialog({ guildId, currentSeason, denied, onDenied, onClose, onOpenPenaltySettings, onDone }: AdvanceProps) {
  const [raceNumber, setRaceNumber] = useState('')
  const fields = useFieldErrors()
  const result = validateAdvanceDraft({ raceNumber })
  const errors: Partial<Record<string, string>> = result.ok ? {} : result.errors

  return (
    <ActionShell<AdvanceRaceResult>
      title="Advance the race"
      confirmTitle={result.ok ? `Advance to race ${result.value.raceNumber}?` : 'Advance the race?'}
      confirmLabel="Advance and remove expired points"
      guildId={guildId}
      deniedMessage={denied ? DENIED_TEXT : null}
      onDenied={onDenied}
      onClose={onClose}
      onOpenPenaltySettings={onOpenPenaltySettings}
      onField={fields.set}
      onDone={onDone}
      review={() => {
        fields.markSubmitted()
        if (!result.ok) return null
        return (
          <>
            <p>
              You are about to advance the penalty race counter of <strong>season {currentSeason}</strong> to <strong>race {result.value.raceNumber}</strong>.
            </p>
            <ul className="plain-list">
              {describeAdvanceEffect(result.value.raceNumber, currentSeason).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <Notice tone="warning">
              <strong>Expired points are removed permanently.</strong> This cannot be undone from the app.
            </Notice>
          </>
        )
      }}
      send={() => {
        if (!result.ok) throw new Error('unreachable: the confirm step only opens for a valid form')
        return window.nexus.api.advanceRace(guildId, confirmed(result.value))
      }}
      form={
        <>
          <p className="muted">
            Like <code>/league advance-race</code>. It works on the <strong>current season</strong> (season {currentSeason}) and needs the penalty settings. Nothing is posted in Discord.
          </p>
          <TextField
            label="Race number that was just completed"
            inputMode="numeric"
            value={raceNumber}
            placeholder="6"
            hint={`${ADVANCE_LIMITS.min} to ${ADVANCE_LIMITS.max}. Every penalty entry that expires at or before this race is removed.`}
            error={fields.show('raceNumber', errors['raceNumber'])}
            autoComplete="off"
            onChange={(event) => { setRaceNumber(event.target.value); fields.clear() }}
          />
        </>
      }
    />
  )
}

/** What advance race did, as the server reports it. */
export function AdvanceResultDialog({ result, onClose }: { result: AdvanceRaceResult; onClose: () => void }) {
  return (
    <Modal open title={`Advanced to race ${result.raceNumber}`} size="lg" onClose={onClose} footer={<Button data-autofocus onClick={onClose}>Close</Button>}>
      <p>
        Season {result.season}: {result.expired.length === 0 ? 'nothing had expired, so no points were removed.' : `${result.expired.length} expired ${result.expired.length === 1 ? 'entry was' : 'entries were'} removed.`}
      </p>
      {result.updated.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Drivers whose total changed</caption>
            <thead>
              <tr>
                <th scope="col">Driver</th>
                <th scope="col" className="table__num">Before</th>
                <th scope="col" className="table__num">After</th>
              </tr>
            </thead>
            <tbody>
              {result.updated.map((item) => (
                <tr key={item.key}>
                  <th scope="row" className="table__key">{item.displayName}</th>
                  <td className="table__num">{item.oldTotal}</td>
                  <td className="table__num">{item.newTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {result.expired.length > 0 ? (
        <details>
          <summary>The expired entries ({result.expired.length})</summary>
          <ul className="plain-list">
            {result.expired.map((item, index) => (
              <li key={`${item.key}-${index}`}>
                {item.displayName}: {item.points} {item.points === 1 ? 'point' : 'points'} from {item.race}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Modal>
  )
}
