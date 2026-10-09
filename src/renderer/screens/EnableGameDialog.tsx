import { RotateCw } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { planEnable } from '../../shared/leagueGames'
import type { LeagueGame } from '../../shared/types'
import { GAME_LIMITS, validateGameDraft } from '../../shared/validation'
import type { GameField } from '../../shared/validation'
import { Button, ErrorState, LoadingRegion, Modal, Notice, Skeleton, TextField, useToast } from '../components'
import { useLeagueGames } from '../hooks/data'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeError, describeWriteError, mayHaveSucceeded, unwrap } from '../lib/errors'
import { invalidateLeagueData } from '../lib/invalidation'

interface EnableGameDialogProps {
  guildId: string
  /** Catalog key: f1, lmu, iracing, gt7, acc. */
  slug: string
  label: string
  onClose: () => void
}

/**
 * "Enable game". Uses the league games of the server (GET /league/games) to decide what enabling means:
 *  - disabled league games for this game exist -> enable one of them (PATCH active), never create a duplicate,
 *  - none exist -> create the league game, keyed by the game's slug (POST).
 */
export function EnableGameDialog({ guildId, slug, label, onClose }: EnableGameDialogProps) {
  const league = useLeagueGames(guildId)
  const toast = useToast()
  const write = useWriteAction()

  const [name, setName] = useState(label)
  const [category, setCategory] = useState(label)
  const [submitted, setSubmitted] = useState(false)
  const [workingKey, setWorkingKey] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ text: string; uncertain: boolean } | null>(null)

  const plan = league.status === 'ready' ? planEnable(slug, league.data.games) : null
  const draft = validateGameDraft({ gameKey: slug, label: name, category })
  const errors: Partial<Record<GameField, string>> = draft.ok ? {} : draft.errors

  const finish = (title: string): void => {
    invalidateLeagueData(guildId)
    toast.push({ tone: 'success', title, message: `${label} is now available for this server.` })
    onClose()
  }
  const fail = (error: unknown): void => setProblem({ text: describeWriteError(error, 'Enabling the game'), uncertain: mayHaveSucceeded(error) })

  const enableExisting = async (game: LeagueGame): Promise<void> => {
    setProblem(null)
    setWorkingKey(game.key)
    const outcome = await write.run(() => unwrap(window.nexus.api.setGameActive(guildId, game.key, true)))
    setWorkingKey(null)
    if (!outcome) return
    if (outcome.ok) finish('Game enabled')
    else fail(outcome.error)
  }

  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitted(true)
    if (!draft.ok) return
    setProblem(null)
    const outcome = await write.run(() => unwrap(window.nexus.api.createGame(guildId, draft.value)))
    if (!outcome) return
    if (outcome.ok) finish('Game enabled')
    else fail(outcome.error)
  }

  const checkAgain = (): void => {
    setProblem(null)
    invalidateLeagueData(guildId)
  }

  return (
    <Modal open title={`Enable ${label}`} dismissible={!write.busy} onClose={onClose}>
      {league.status === 'loading' ? (
        <LoadingRegion label="Loading">
          <Skeleton height={20} width="70%" />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </LoadingRegion>
      ) : null}

      {league.status === 'error' ? <ErrorState title="Could not check this game" message={describeError(league.error)} onRetry={league.reload} /> : null}

      {plan?.kind === 'already' ? (
        <>
          <p>{label} is already enabled for this server.</p>
          <div className="dialog-actions">
            <Button onClick={checkAgain}>Refresh</Button>
          </div>
        </>
      ) : null}

      {plan?.kind === 'enable-existing' ? (
        <>
          <p>
            This server already has {plan.candidates.length === 1 ? 'a league game' : 'league games'} for {label} that {plan.candidates.length === 1 ? 'is' : 'are'} switched off. Enable{' '}
            {plan.candidates.length === 1 ? 'it' : 'the one you want'}; its tiers are kept.
          </p>
          <ul className="candidate-list" aria-label="Disabled league games">
            {plan.candidates.map((game) => (
              <li key={game.key} className="candidate">
                <div className="candidate__text">
                  <span className="candidate__name">{game.label}</span>
                  <span className="candidate__meta">
                    Key {game.key} - {game.category} - {game.tiers.length} {game.tiers.length === 1 ? 'tier' : 'tiers'}
                  </span>
                </div>
                <Button size="sm" loading={workingKey === game.key} disabled={write.busy && workingKey !== game.key} onClick={() => void enableExisting(game)}>
                  Enable
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {plan?.kind === 'create' ? (
        <form className="stack stack--tight" onSubmit={(event) => void create(event)} noValidate aria-label={`Enable ${label}`}>
          <p>
            {label} has not been set up for this server yet. Enabling it creates its league game (key <code>{plan.gameKey}</code>), where you can then add tiers.
          </p>
          <TextField
            label="Name"
            value={name}
            maxLength={GAME_LIMITS.labelMax}
            error={submitted ? (errors.label ?? null) : null}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
          <TextField
            label="Category"
            value={category}
            maxLength={GAME_LIMITS.categoryMax}
            hint="Shown on the sign-up panels, for example Open Wheel or GT."
            error={submitted ? (errors.category ?? null) : null}
            autoComplete="off"
            onChange={(event) => setCategory(event.target.value)}
          />
          <div className="dialog-actions">
            <Button variant="secondary" disabled={write.busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={write.busy}>
              Enable game
            </Button>
          </div>
        </form>
      ) : null}

      {problem ? (
        <Notice
          tone="danger"
          action={
            problem.uncertain ? (
              <Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={checkAgain}>
                Refresh
              </Button>
            ) : undefined
          }
        >
          {problem.text}
        </Notice>
      ) : null}

      {plan?.kind === 'enable-existing' || league.status !== 'ready' ? (
        <div className="dialog-actions">
          <Button variant="secondary" disabled={write.busy} onClick={onClose}>
            Close
          </Button>
        </div>
      ) : null}
    </Modal>
  )
}
