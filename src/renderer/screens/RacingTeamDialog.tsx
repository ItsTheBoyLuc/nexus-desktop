import { RotateCw } from 'lucide-react'
import { useState } from 'react'
import { RACING_LIMITS, validateRacingTeamDraft } from '../../shared/racingValidation'
import type { RacingTeamDraft, RacingTeamField } from '../../shared/racingValidation'
import type { CardOutcome, RacingGame, RacingTeamDetail, WithCard } from '../../shared/types'
import { Button, ColorField, Modal, Notice, PostConfirmDialog, PostTargetSection, TextField, useToast } from '../components'
import { usePostTarget } from '../hooks/postTarget'
import { useManageDenied } from '../hooks/useFiaDenied'
import { useWriteAction } from '../hooks/useWriteAction'
import { errorCode, unwrap } from '../lib/errors'
import { invalidateRacing } from '../lib/racingScope'
import { createLostText, describeRacingError, MANAGE_SERVER_RULE } from '../lib/racingView'
import { judgeWrite } from '../lib/racingWriteFlow'
import type { EsportsContext } from './EsportsRoute'

const FIELD_OF_CODE = { invalid_name: 'name', invalid_color: 'color', invalid_focus: 'focus' } as const satisfies Record<string, RacingTeamField>

const TEAM_LOST_TEXT = 'Nexus did not get a clear answer, so the team and its Discord role may already have been created. It is not sent again with the same data. The list of teams was just read again: look at it, and at the roles in Discord, before you create anything.'

/** What the screen needs after a create: the team and, when a card was asked for, how it went and what was asked. */
export interface TeamCreated {
  team: RacingTeamDetail
  card: CardOutcome | null
  requested: { channelId: string; pingRoleIds?: string[] } | null
}

interface Props {
  ctx: EsportsContext
  onClose: () => void
  onCreated: (created: TeamCreated) => void
}

/**
 * Create an esports team (/racing {game} team-create): the team AND a Discord role in the team colour. Needs Manage Server or
 * Administrator. The class or category is free text for every game. With "Post in a channel" on (off by default) its card is posted too, after a
 * confirmation that names the channel and the roles. It is sent once: after a lost answer the form locks, because the team, its Discord role
 * and its card may already exist and a second send would be refused (or, with another spelling, create a second role).
 */
export function RacingTeamDialog({ ctx, onClose, onCreated }: Props) {
  const { gameLabel } = ctx
  const game: RacingGame = ctx.game
  const guildId = ctx.guild.id
  const toast = useToast()
  const write = useWriteAction()
  const manage = useManageDenied(guildId)
  const target = usePostTarget(guildId, game)
  const [draft, setDraft] = useState<RacingTeamDraft>({ name: '', color: '#1E41FF', focus: '' })
  const [submitted, setSubmitted] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<RacingTeamField, string>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [lost, setLost] = useState(false)

  const result = validateRacingTeamDraft(draft)
  const errors: Partial<Record<RacingTeamField, string>> = result.ok ? {} : result.errors
  const show = (field: RacingTeamField): string | null => serverErrors[field] ?? (submitted ? (errors[field] ?? null) : null)
  const change = (field: RacingTeamField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerErrors({})
    setProblem(null)
  }
  const posting = target.enabled

  /** The form's button: with a card it first asks, naming the channel and the roles; without one the team is created at once. */
  const start = (): void => {
    setSubmitted(true)
    if (!result.ok || lost || manage.denied || target.problem !== null) return
    if (posting) setConfirming(true)
    else void submit()
  }

  const submit = async (): Promise<void> => {
    if (!result.ok || lost || manage.denied || target.problem !== null) return
    const input = { ...result.value, ...target.fields }
    const outcome = await write.run(() => unwrap(window.nexus.api.createRacingTeam(guildId, game, input)))
    if (!outcome) return
    if (outcome.ok) {
      invalidateRacing(guildId, game)
      const { card, ...team }: WithCard<RacingTeamDetail> = outcome.value
      toast.push({ tone: 'success', title: 'Team created', message: `${team.name} and its Discord role were created.` })
      onCreated({ team, card: card ?? null, requested: input.channelId ? { channelId: input.channelId, ...(input.pingRoleIds ? { pingRoleIds: input.pingRoleIds } : {}) } : null })
      return
    }
    const error = outcome.error
    setConfirming(false)
    const verdict = judgeWrite(error, 'team', posting)
    if (verdict.type === 'lost') {
      invalidateRacing(guildId, game)
      setLost(true)
      return
    }
    if (verdict.type === 'denied') {
      manage.markDenied()
      return
    }
    // A refusal about the card creates nothing: the team, its role and the message do not exist.
    if (target.explainRefusal(error, verdict, gameLabel, 'Nothing was created or posted.')) return
    const code = errorCode(error)
    if (code === 'team_exists') setServerErrors({ name: describeRacingError(error, gameLabel) })
    else if (code !== null && code in FIELD_OF_CODE) setServerErrors({ [FIELD_OF_CODE[code as keyof typeof FIELD_OF_CODE]]: describeRacingError(error, gameLabel) })
    else setProblem(describeRacingError(error, gameLabel, 'Nothing was created or posted.'))
  }

  return (
    <>
      <Modal
        open={!confirming}
        title={`Create a ${gameLabel} team`}
        size="lg"
        dismissible={!write.busy}
        onClose={onClose}
        footer={
          <>
            <Button variant="secondary" disabled={write.busy} onClick={onClose}>
              Cancel
            </Button>
            <Button loading={write.busy} disabled={lost || manage.denied} onClick={start}>
              {posting ? 'Review and create' : 'Create the team'}
            </Button>
          </>
        }
      >
        <p className="muted">
          Like <code>/racing {game} team-create</code>. Nexus creates the team <strong>and a Discord role</strong> with this colour, named after the team; the members you add later get that role. Its name and class can be edited afterwards (Edit team); its colour cannot, and a team cannot be deleted from the app.
        </p>
        {manage.denied ? (
          <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={manage.reset}>Check again</Button>}>
            {MANAGE_SERVER_RULE} The server refused your account, so this action is off. If your permissions changed, choose Check again.
          </Notice>
        ) : null}
        {lost ? (
          <Notice tone="danger" action={<Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={onClose}>Close and refresh the list</Button>}>
            <strong>The team and its Discord role may already exist.</strong> {createLostText(TEAM_LOST_TEXT, posting)}
          </Notice>
        ) : null}
        <TextField label="Team name" value={draft.name} maxLength={RACING_LIMITS.teamNameMax} hint="Names are compared ignoring capitals: Apex and APEX are the same team." error={show('name')} autoComplete="off" onChange={(event) => change('name', event.target.value)} />
        <ColorField label="Colour" value={draft.color} onChange={(value) => change('color', value)} hint="Hex colour, for example #1E41FF. The Discord role gets this colour." error={show('color')} />
        <TextField
          label="Class or category"
          optional
          value={draft.focus}
          maxLength={RACING_LIMITS.focusMax}
          placeholder="GT3, Hypercar, Gr.3 ..."
          hint="Free text, up to 30 characters. It is not a fixed list: type whatever your team races in."
          error={show('focus')}
          autoComplete="off"
          onChange={(event) => change('focus', event.target.value)}
        />
        <PostTargetSection target={target} guildId={guildId} gameLabel={gameLabel} what="the team card" disabled={lost || write.busy} showProblem={submitted} />
        {problem ? <Notice tone="danger">{problem}</Notice> : null}
      </Modal>
      <PostConfirmDialog
        open={confirming}
        title={`Create ${result.ok ? result.value.name : 'the team'} and post its card?`}
        channelLabel={`#${target.channelName(target.channelId) || 'the channel you chose'}`}
        guildName={ctx.guild.name}
        roles={target.pingViews}
        confirmLabel="Create and post"
        busy={write.busy}
        onConfirm={() => void submit()}
        onCancel={() => setConfirming(false)}
      >
        <p className="muted">
          The team and its Discord role are created, then its card is posted. If the post fails the team stays saved and you can post it again from here or from the team page.
        </p>
      </PostConfirmDialog>
    </>
  )
}
