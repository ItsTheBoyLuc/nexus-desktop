import { RotateCw } from 'lucide-react'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { MANUAL_LIMITS, validateManualPointsDraft } from '../../shared/penaltyValidation'
import type { ManualPointsDraft, ManualPointsField } from '../../shared/penaltyValidation'
import type { ManualPointsResult } from '../../shared/types'
import { Button, Modal, Notice, SearchSelect, TextField, useToast } from '../components'
import { useGuildChannels } from '../hooks/data'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeAnnounceCode, describeChannelError, describeError, errorCode, fieldErrorFor, isChannelError, outcomeUnknown, unwrap } from '../lib/errors'
import { invalidatePenalties } from '../lib/invalidation'
import { BanNoticeDialog } from './BanNoticeDialog'

export interface ManualPointsPrefill {
  driver?: string
  points?: number
  season?: number
  penaltyType?: string
  reason?: string
}

interface ManualPointsDialogProps {
  guildId: string
  prefill?: ManualPointsPrefill
  /** The driver cannot be changed (opened from a driver's row, or as the fix for a decision whose points were not saved). */
  lockDriver?: boolean
  /** Names to suggest while typing a driver (the drivers of the penalty overview). */
  suggestions?: readonly string[]
  /** Shown above the form, e.g. why the dialog was opened. */
  intro?: ReactNode
  onClose: () => void
  /** The points are saved (the dialog closes itself afterwards; a ban notice is shown first when there is one). */
  onSaved?: (result: ManualPointsResult) => void
  onOpenPenaltySettings: () => void
}

const SERVER_FIELDS = {
  invalid_driver: 'driver',
  invalid_penalty_type: 'penaltyType',
  invalid_reason: 'reason',
  invalid_points: 'points',
  invalid_season: 'season',
  nothing_to_do: 'points'
} as const satisfies Record<string, ManualPointsField>

/**
 * Add penalty points by hand (/f1 penalty). Staff can do it. The server checks the ban thresholds in the same write
 * and RETURNS the ban text without posting it, so a threshold opens the ban notice dialog. Without a channel nothing is
 * posted at all. The request is sent once: after a lost answer the form locks and only offers to refresh the points,
 * because the points may already be saved and a second send would add them twice.
 */
export function ManualPointsDialog({ guildId, prefill = {}, lockDriver = false, suggestions = [], intro, onClose, onSaved, onOpenPenaltySettings }: ManualPointsDialogProps) {
  const channels = useGuildChannels(guildId)
  const toast = useToast()
  const write = useWriteAction()
  const listId = useId()

  const [draft, setDraft] = useState<ManualPointsDraft>({
    driver: prefill.driver ?? '',
    penaltyType: prefill.penaltyType ?? '',
    points: prefill.points !== undefined ? String(prefill.points) : '',
    reason: prefill.reason ?? '',
    season: prefill.season !== undefined ? String(prefill.season) : '',
    channelId: ''
  })
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<ManualPointsField, string>>>({})
  const [blocked, setBlocked] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [lost, setLost] = useState(false)
  const [saved, setSaved] = useState<ManualPointsResult | null>(null)

  const result = validateManualPointsDraft(draft)
  const errors: Partial<Record<ManualPointsField, string>> = result.ok ? {} : result.errors
  const show = (field: ManualPointsField): string | null => serverErrors[field] ?? (submitted ? (errors[field] ?? null) : null)
  const channelName = (id: string): string => (channels.status === 'ready' ? (channels.data.find((channel) => channel.id === id)?.name ?? '') : '')

  const change = (field: ManualPointsField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerErrors({})
    setProblem(null)
    setBlocked(false)
  }

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (!result.ok || lost) return
    const outcome = await write.run(() => unwrap(window.nexus.api.addPenaltyPoints(guildId, result.value)))
    if (!outcome) return
    if (outcome.ok) {
      invalidatePenalties(guildId)
      const value = outcome.value
      onSaved?.(value)
      if (value.banNotice) {
        setSaved(value) // the points are saved: show the ban text before anything else
        return
      }
      toast.push({
        tone: 'success',
        title: value.saved ? 'Penalty points added' : 'Stewards Decision posted',
        message: value.saved ? `${value.pointsAdded} ${value.pointsAdded === 1 ? 'point' : 'points'} for ${value.driver} in season ${value.season}${value.totalPoints !== null ? `, now ${value.totalPoints} in total` : ''}.` : `Nothing was recorded for ${value.driver}.`
      })
      if (value.announceError) toast.push({ tone: 'danger', title: 'The post failed', message: `The points are saved, but the Stewards Decision was not posted: ${describeAnnounceCode(value.announceError)}` })
      onClose()
      return
    }
    const error = outcome.error
    const code = errorCode(error)
    if (code === 'penalty_not_configured') {
      setBlocked(true)
      return
    }
    if (outcomeUnknown(error)) {
      invalidatePenalties(guildId)
      setLost(true)
      return
    }
    if (draft.channelId !== '' && isChannelError(error)) {
      setServerErrors({ channelId: describeChannelError(error, channelName(draft.channelId), "The server refused the request, so the points should not have been saved. If you are unsure, check the driver's history.") })
      return
    }
    const field = fieldErrorFor(error, SERVER_FIELDS)
    if (field) setServerErrors({ [field.field]: field.message })
    else setProblem(describeError(error))
  }

  if (saved?.banNotice) {
    return (
      <BanNoticeDialog
        guildId={guildId}
        notice={saved.banNotice}
        driverName={saved.driver}
        season={saved.season}
        source="manual-points"
        onClose={() => {
          toast.push({ tone: 'success', title: 'Penalty points added', message: `${saved.pointsAdded} ${saved.pointsAdded === 1 ? 'point' : 'points'} for ${saved.driver} in season ${saved.season}, now ${saved.totalPoints ?? '?'} in total.` })
          onClose()
        }}
      />
    )
  }

  const pointsNumber = Number(draft.points)
  return (
    <Modal
      open
      title="Add penalty points"
      size="lg"
      dismissible={!write.busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={write.busy} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={write.busy} disabled={lost || blocked} onClick={() => void submit()}>
            Add penalty points
          </Button>
        </>
      }
    >
      {intro}
      <p className="muted">
        Like <code>/f1 penalty</code>. The points count from round 0 of the season and expire after the number of races in the penalty settings. If they reach a ban threshold, the server returns the ban text; nothing is announced in Discord by itself.
      </p>

      {blocked ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={onOpenPenaltySettings}>Open Penalty settings</Button>}>
          <strong>The penalty rules have not been set up yet, so nothing was changed.</strong> Save the Penalty settings first (an Administrator is needed for that), then add the points.
        </Notice>
      ) : null}
      {lost ? (
        <Notice
          tone="danger"
          action={
            <Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={onClose}>
              Close and check the points
            </Button>
          }
        >
          Nexus did not get a clear answer, so <strong>the points may already have been added</strong>. They are not sent again from here, because that would add them twice. Close this window, look at the driver&apos;s total in the penalty overview (it was just refreshed) and decide from there.
        </Notice>
      ) : null}

      <TextField
        label="Driver"
        value={draft.driver}
        readOnly={lockDriver}
        list={suggestions.length > 0 && !lockDriver ? listId : undefined}
        maxLength={MANUAL_LIMITS.driverMax}
        hint="The driver's name as the league uses it: the server finds them by name (ignoring case), not by Discord ID."
        error={show('driver')}
        autoComplete="off"
        onChange={(event) => change('driver', event.target.value)}
      />
      {suggestions.length > 0 && !lockDriver ? (
        <datalist id={listId}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      ) : null}
      <div className="field-pair">
        <TextField label="Penalty type" value={draft.penaltyType} maxLength={MANUAL_LIMITS.typeMax} placeholder="Drive-Through" error={show('penaltyType')} autoComplete="off" onChange={(event) => change('penaltyType', event.target.value)} />
        <TextField label="Points" inputMode="numeric" value={draft.points} placeholder="3" hint={`0 to ${MANUAL_LIMITS.pointsMax}. 0 records nothing and needs a channel.`} error={show('points')} autoComplete="off" onChange={(event) => change('points', event.target.value)} />
      </div>
      <TextField label="Reason" value={draft.reason} maxLength={MANUAL_LIMITS.reasonMax} error={show('reason')} autoComplete="off" onChange={(event) => change('reason', event.target.value)} />
      <div className="field-pair">
        <TextField label="Season" optional inputMode="numeric" value={draft.season} placeholder="Current season" hint="Empty: the server's current season." error={show('season')} autoComplete="off" onChange={(event) => change('season', event.target.value)} />
        <SearchSelect
          label="Post the Stewards Decision in a channel (optional)"
          value={draft.channelId}
          options={[{ value: '', label: 'No channel: do not post' }, ...(channels.status === 'ready' ? channels.data.map((channel) => ({ value: channel.id, label: `# ${channel.name}` })) : [])]}
          placeholder="No channel: do not post"
          disabled={channels.status !== 'ready'}
          hint="Posts the public Stewards Decision embed. The ban text is never posted."
          error={show('channelId')}
          emptyText="No channel found. Nexus can only post where it has permission."
          onChange={(value) => change('channelId', value)}
        />
      </div>
      {draft.channelId === '' && pointsNumber > 0 ? <p className="muted">Nothing is posted in Discord. The points are only saved.</p> : null}
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
    </Modal>
  )
}
