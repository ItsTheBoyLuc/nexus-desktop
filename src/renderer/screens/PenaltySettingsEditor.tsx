import { ListRestart, RotateCcw, Save } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { draftOfPenaltySettings, PENALTY_SETTINGS_LIMITS, penaltySettingsChanged, validatePenaltySettingsDraft } from '../../shared/penaltyValidation'
import type { PenaltySettingsDraft, PenaltySettingsField } from '../../shared/penaltyValidation'
import type { PenaltySettings } from '../../shared/types'
import { Badge, Button, Card, ErrorState, LoadingRegion, Notice, Skeleton, TextField, useToast, WriteProblemNotice } from '../components'
import { usePenaltySettings, useServerSettings } from '../hooks/data'
import { useAdminDenied } from '../hooks/useFiaDenied'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeError, errorCode, fieldErrorFor, unwrap, writeProblem } from '../lib/errors'
import type { WriteProblem } from '../lib/errors'
import { formatWhen } from '../lib/format'
import { invalidatePenalties } from '../lib/invalidation'

const SERVER_FIELDS = {
  invalid_current_season: 'currentSeason',
  invalid_expiry_races: 'expiryRaces',
  invalid_quali_ban_threshold: 'qualiBanThreshold',
  invalid_race_ban_threshold: 'raceBanThreshold'
} as const satisfies Record<string, PenaltySettingsField>

/** The values the form starts from: what is saved, or (never set up) the server's defaults. */
function startValues(settings: PenaltySettings) {
  if (settings.configured && settings.expiryRaces !== null && settings.qualiBanThreshold !== null && settings.raceBanThreshold !== null) {
    return { currentSeason: settings.currentSeason, expiryRaces: settings.expiryRaces, qualiBanThreshold: settings.qualiBanThreshold, raceBanThreshold: settings.raceBanThreshold }
  }
  const defaults = settings.defaults ?? { currentSeason: settings.currentSeason, expiryRaces: 15, qualiBanThreshold: 8, raceBanThreshold: 13 }
  return { ...defaults, currentSeason: settings.currentSeason }
}

function SettingsForm({ guildId, settings, canEdit }: { guildId: string; settings: PenaltySettings; canEdit: boolean | null }) {
  const toast = useToast()
  const write = useWriteAction()
  const admin = useAdminDenied(guildId)
  const [draft, setDraft] = useState<PenaltySettingsDraft>(() => draftOfPenaltySettings(startValues(settings)))
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<{ field: PenaltySettingsField; message: string } | null>(null)
  const [problem, setProblem] = useState<WriteProblem | null>(null)
  const [defaultsNote, setDefaultsNote] = useState(false)

  const readOnly = canEdit === false || admin.denied
  const result = validatePenaltySettingsDraft(draft)
  const errors: Partial<Record<PenaltySettingsField, string>> = result.ok ? {} : result.errors
  const saved = settings.configured ? startValues(settings) : null
  const dirty = result.ok ? penaltySettingsChanged(result.value, saved) : true
  const show = (field: PenaltySettingsField): string | null => (serverError?.field === field ? serverError.message : submitted ? (errors[field] ?? null) : null)

  const change = (field: PenaltySettingsField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerError(null)
    setProblem(null)
    setDefaultsNote(false)
  }

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitted(true)
    if (!result.ok || readOnly || !dirty) return
    setProblem(null)
    setServerError(null)
    const outcome = await write.run(() => unwrap(window.nexus.api.savePenaltySettings(guildId, result.value)))
    if (!outcome) return
    if (outcome.ok) {
      invalidatePenalties(guildId)
      toast.push({ tone: 'success', title: 'Penalty settings saved', message: 'Existing penalty points and bans were not recalculated.' })
      return
    }
    if (errorCode(outcome.error) === 'admin_required') {
      admin.markDenied()
      return
    }
    const field = fieldErrorFor(outcome.error, SERVER_FIELDS)
    if (field) setServerError(field)
    else setProblem(writeProblem(outcome.error, 'The change'))
  }

  return (
    <form className="stack" onSubmit={(event) => void save(event)} noValidate aria-label="Penalty settings">
      <Notice tone="info">
        <strong>Settings and points are stored separately.</strong> Saving these rules does not change any driver&apos;s points, and adding, clearing or expiring points never changes these rules. Existing totals and bans are <strong>not recalculated</strong> when a threshold changes (as in Discord);
        a new threshold applies the next time points are added, cleared or advanced.
      </Notice>

      {!settings.configured ? (
        <Notice tone="warning">
          <strong>The penalty rules have not been set up yet.</strong> Until an Administrator saves them, penalty points cannot be added, decided with points or advanced, and the penalty overview stays empty. The form starts with the server&apos;s defaults and the effective season.
        </Notice>
      ) : null}
      {readOnly ? (
        <Notice tone="danger" action={admin.denied ? <Button variant="secondary" size="sm" onClick={admin.reset}>Check again</Button> : undefined}>
          Only server <strong>Administrators</strong> can change the penalty settings. Your account has the staff role only, so the values below are read-only. {admin.denied ? 'If your permissions changed, choose Check again.' : ''}
        </Notice>
      ) : null}

      <Card className="stack">
        <div className="section-head">
          <h2 className="section-title">Penalty rules</h2>
          {settings.configured ? <Badge tone="primary">Saved</Badge> : <Badge>Not set up</Badge>}
        </div>
        <div className="field-pair">
          <TextField label="Current season" inputMode="numeric" value={draft.currentSeason} readOnly={readOnly} hint={`${PENALTY_SETTINGS_LIMITS.seasonMin} to ${PENALTY_SETTINGS_LIMITS.seasonMax}. The season every penalty command uses unless one is given.`} error={show('currentSeason')} autoComplete="off" onChange={(event) => change('currentSeason', event.target.value)} />
          <TextField label="Points expire after (races)" inputMode="numeric" value={draft.expiryRaces} readOnly={readOnly} hint={`${PENALTY_SETTINGS_LIMITS.otherMin} to ${PENALTY_SETTINGS_LIMITS.otherMax}. A penalty lasts this many races.`} error={show('expiryRaces')} autoComplete="off" onChange={(event) => change('expiryRaces', event.target.value)} />
        </div>
        <div className="field-pair">
          <TextField label="Qualifying ban at (points)" inputMode="numeric" value={draft.qualiBanThreshold} readOnly={readOnly} hint="A driver at or above this total gets a qualifying ban." error={show('qualiBanThreshold')} autoComplete="off" onChange={(event) => change('qualiBanThreshold', event.target.value)} />
          <TextField label="Race ban at (points)" inputMode="numeric" value={draft.raceBanThreshold} readOnly={readOnly} hint="A driver at or above this total gets a race ban." error={show('raceBanThreshold')} autoComplete="off" onChange={(event) => change('raceBanThreshold', event.target.value)} />
        </div>
        {settings.configured && settings.setupBy ? (
          <p className="muted">
            Last saved by {settings.setupBy}
            {settings.setupAt ? ` on ${formatWhen(settings.setupAt)}` : ''}.
          </p>
        ) : null}
      </Card>

      {defaultsNote ? (
        <Notice tone="info">
          The form now shows the server&apos;s default rules (current season kept as it is). <strong>Nothing is saved yet</strong>: press Save penalty settings to use them.
        </Notice>
      ) : null}
      <WriteProblemNotice problem={problem} onRefresh={() => invalidatePenalties(guildId)} refreshLabel="Refresh" />

      <div className="form-actions form-actions--split">
        <div className="header-actions">
          <Button
            variant="ghost"
            disabled={write.busy}
            icon={<RotateCcw size={16} aria-hidden="true" />}
            onClick={() => {
              setDraft(draftOfPenaltySettings(startValues(settings)))
              setSubmitted(false)
              setServerError(null)
              setProblem(null)
              setDefaultsNote(false)
            }}
          >
            Discard changes
          </Button>
          <Button
            variant="secondary"
            disabled={readOnly || write.busy || !settings.defaults}
            icon={<ListRestart size={16} aria-hidden="true" />}
            title={settings.defaults ? 'Fill the form with the default rules. Nothing is saved until you press Save.' : 'The server did not send its defaults.'}
            onClick={() => {
              if (!settings.defaults) return
              setDraft(draftOfPenaltySettings({ ...settings.defaults, currentSeason: Number(draft.currentSeason) > 0 ? Number(draft.currentSeason) : settings.currentSeason }))
              setSubmitted(false)
              setServerError(null)
              setDefaultsNote(true)
            }}
          >
            Use the default rules
          </Button>
        </div>
        <Button type="submit" loading={write.busy} disabled={readOnly || (settings.configured && !dirty)} icon={<Save size={16} aria-hidden="true" />}>
          Save penalty settings
        </Button>
      </div>
    </form>
  )
}

export function PenaltySettingsEditor({ guildId }: { guildId: string }) {
  const settings = usePenaltySettings(guildId)
  const server = useServerSettings(guildId)
  if (settings.status === 'loading') {
    return (
      <LoadingRegion label="Loading the penalty settings" className="stack">
        <Skeleton height={240} radius={12} />
      </LoadingRegion>
    )
  }
  if (settings.status === 'error') return <ErrorState title="Could not load the penalty settings" message={describeError(settings.error)} onRetry={settings.reload} />
  const canEdit = server.status === 'ready' ? server.data.canEdit : null
  // Rebuilt from what the server holds after every save and re-read.
  const key = JSON.stringify([settings.data.configured, settings.data.currentSeason, settings.data.expiryRaces, settings.data.qualiBanThreshold, settings.data.raceBanThreshold])
  return <SettingsForm key={key} guildId={guildId} settings={settings.data} canEdit={canEdit} />
}
