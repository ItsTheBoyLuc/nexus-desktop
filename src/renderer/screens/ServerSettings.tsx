import { RotateCcw, RotateCw, Save } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ServerSettings, SeasonSource } from '../../shared/types'
import { DEFAULT_FOOTER_NAME, isValidHexColor, SETTINGS_LIMITS, validateSettingsDraft } from '../../shared/validation'
import type { SettingsDraft, SettingsField } from '../../shared/validation'
import { Badge, Button, Card, ErrorState, LoadingRegion, Notice, PageHeader, Skeleton, TextField, useToast } from '../components'
import { useServerSettings } from '../hooks/data'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeError, describeWriteError, errorCode, mayHaveSucceeded, unwrap } from '../lib/errors'
import { invalidateServerSettings } from '../lib/invalidation'
import { useServer } from './ServerRoute'

/**
 * Servers where saving came back 403 admin_required during this session. Nothing in the API tells us
 * the permission up front, so the first refusal is remembered and the form stays read-only until the app restarts.
 */
const adminDenied = new Set<string>()

const SOURCE_LABELS: Record<SeasonSource, string> = {
  penalty_settings: 'Set by the penalty-points settings',
  settings: 'Set in the server settings',
  default: 'Default (no season set yet)'
}

function draftOf(settings: ServerSettings): SettingsDraft {
  return {
    embedColor: settings.embedColor,
    footerName: settings.footerName,
    seasonNumber: settings.seasonNumber === null ? '' : String(settings.seasonNumber)
  }
}

/** What a Nexus embed will look like with the draft values. Uses the last valid colour while the field is being typed. */
function EmbedPreview({ color, footer }: { color: string; footer: string }) {
  return (
    <div className="embed-preview" style={{ borderLeftColor: color }} aria-label="Embed preview">
      <div className="embed-preview__title">Sign-up panel preview</div>
      <div className="embed-preview__text">This is how embeds posted by Nexus in your server will look.</div>
      <div className="embed-preview__fields">
        <span>
          <strong>Category</strong>
          <br />
          Open Wheel
        </span>
        <span>
          <strong>Tier</strong>
          <br />
          Tier 1
        </span>
      </div>
      <div className="embed-preview__footer">{footer.trim() === '' ? DEFAULT_FOOTER_NAME : footer.trim()}</div>
    </div>
  )
}

function SettingsForm({ settings, guildId }: { settings: ServerSettings; guildId: string }) {
  const toast = useToast()
  const write = useWriteAction()
  const [draft, setDraft] = useState<SettingsDraft>(() => draftOf(settings))
  const [submitted, setSubmitted] = useState(false)
  const [denied, setDenied] = useState(() => adminDenied.has(guildId))
  const [problem, setProblem] = useState<{ text: string; uncertain: boolean } | null>(null)

  const result = validateSettingsDraft(draft, settings)
  const errors: Partial<Record<SettingsField, string>> = result.ok ? {} : result.errors
  const changes = result.ok ? result.value : {}
  const dirty = Object.keys(changes).length > 0
  const showError = (field: SettingsField): string | null => (submitted || draft[field] !== draftOf(settings)[field] ? (errors[field] ?? null) : null)

  const previewColor = isValidHexColor(draft.embedColor.trim()) ? draft.embedColor.trim() : settings.embedColor
  const pickerColor = previewColor.toLowerCase()
  const update = (field: SettingsField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setProblem(null)
  }

  const penaltyOverrides = settings.seasonSource === 'penalty_settings'

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitted(true)
    if (!result.ok || !dirty || denied) return
    setProblem(null)
    const outcome = await write.run(() => unwrap(window.nexus.api.saveServerSettings(guildId, result.value)))
    if (!outcome) return
    if (outcome.ok) {
      toast.push({ tone: 'success', title: 'Settings saved', message: 'New embeds will use these settings.' })
      invalidateServerSettings(guildId) // re-read from the server: the form below is rebuilt from what is really stored
      return
    }
    if (errorCode(outcome.error) === 'admin_required') {
      adminDenied.add(guildId)
      setDenied(true) // the banner at the top of the form says it; no second message
      setDraft(draftOf(settings)) // read-only now: show what is really stored, not the edit that was refused
      return
    }
    setProblem({ text: describeWriteError(outcome.error, 'The change'), uncertain: mayHaveSucceeded(outcome.error) })
  }

  return (
    <div className="settings-layout">
      <Card>
        <form className="stack" onSubmit={(event) => void save(event)} noValidate aria-label="Server settings">
          {denied ? (
            <Notice tone="danger">
              Only server administrators can change these settings. Your account has the staff role but not the Administrator permission, so the values below are read-only.
              Ask a server administrator to change them, or to give you the permission in Discord.
            </Notice>
          ) : null}

          <div className="field">
            <TextField
              label="Embed colour"
              value={draft.embedColor}
              maxLength={7}
              readOnly={denied}
              hint="Hex colour with a #, for example #FF6B00."
              error={showError('embedColor')}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => update('embedColor', event.target.value)}
            />
            <label className="color-pick">
              <input
                type="color"
                value={pickerColor}
                disabled={denied}
                aria-label="Pick the embed colour"
                onChange={(event) => update('embedColor', event.target.value.toUpperCase())}
              />
              <span>Pick from a colour chooser</span>
            </label>
          </div>

          <TextField
            label="Footer name"
            value={draft.footerName}
            maxLength={SETTINGS_LIMITS.footerMax}
            readOnly={denied}
            hint={`Shown at the bottom of every embed. Leave it empty to use "${DEFAULT_FOOTER_NAME}".`}
            error={showError('footerName')}
            autoComplete="off"
            onChange={(event) => update('footerName', event.target.value)}
          />

          <div className="stack stack--tight">
            <TextField
              label="Season number"
              optional
              inputMode="numeric"
              value={draft.seasonNumber}
              readOnly={denied}
              placeholder="Not set"
              hint={`Whole number from ${SETTINGS_LIMITS.seasonMin} to ${SETTINGS_LIMITS.seasonMax}. Same as "Default season number" in /server settings.`}
              error={showError('seasonNumber')}
              autoComplete="off"
              onChange={(event) => update('seasonNumber', event.target.value)}
            />
            <p className="season-line">
              Season in effect: <strong>{settings.effectiveSeason}</strong> <Badge tone={penaltyOverrides ? 'primary' : 'neutral'}>{SOURCE_LABELS[settings.seasonSource]}</Badge>
            </p>
            {penaltyOverrides ? (
              <Notice tone="warning">
                The season in effect ({settings.effectiveSeason}) comes from the penalty-points settings, which take priority over the season number here
                {settings.seasonNumber !== null ? ` (${settings.seasonNumber})` : ''}. Changing the season number on this page will not change the season the bot uses. Change the
                current season in the penalty-points settings in Discord instead.
              </Notice>
            ) : null}
          </div>

          {problem ? (
            <Notice
              tone="danger"
              action={
                problem.uncertain ? (
                  <Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={() => invalidateServerSettings(guildId)}>
                    Refresh
                  </Button>
                ) : undefined
              }
            >
              {problem.text}
            </Notice>
          ) : null}

          <div className="form-actions form-actions--split">
            <Button
              variant="ghost"
              disabled={!dirty && !submitted}
              icon={<RotateCcw size={16} aria-hidden="true" />}
              onClick={() => {
                setDraft(draftOf(settings))
                setSubmitted(false)
                setProblem(null)
              }}
            >
              Discard changes
            </Button>
            <Button type="submit" loading={write.busy} disabled={denied || !dirty} icon={<Save size={16} aria-hidden="true" />}>
              Save changes
            </Button>
          </div>
        </form>
      </Card>

      <aside className="stack stack--tight" aria-label="Preview">
        <h2 className="section-title">Preview</h2>
        <EmbedPreview color={previewColor} footer={draft.footerName} />
        <p className="muted preview-note">Messages Nexus has already posted keep their old colour and footer. Refresh a sign-up panel in Games &amp; Tiers to update it.</p>
      </aside>
    </div>
  )
}

export function ServerSettingsScreen() {
  const { guild } = useServer()
  const settings = useServerSettings(guild.id)

  return (
    <div className="page">
      <PageHeader title="Settings" description={`Look and season of the embeds Nexus posts in ${guild.name}.`} />

      {settings.status === 'loading' ? (
        <LoadingRegion label="Loading settings">
          <div className="settings-layout">
            <div className="card stack">
              <Skeleton height={40} />
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
            <Skeleton height={200} radius={12} />
          </div>
        </LoadingRegion>
      ) : null}

      {settings.status === 'error' ? <ErrorState title="Could not load the settings" message={describeError(settings.error)} onRetry={settings.reload} /> : null}

      {settings.status === 'ready' ? (
        // Keyed by what the server holds: after a save and re-read the draft is rebuilt from the stored values.
        <SettingsForm
          key={`${settings.data.embedColor}|${settings.data.footerName}|${settings.data.seasonNumber}|${settings.data.effectiveSeason}`}
          settings={settings.data}
          guildId={guild.id}
        />
      ) : null}
    </div>
  )
}
