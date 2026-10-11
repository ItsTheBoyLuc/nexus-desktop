import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Plus, Power, PowerOff, RotateCw, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { isCatalogGameEnabled, leagueGamesFor } from '../../shared/leagueGames'
import { findPanel } from '../../shared/panels'
import { GAME_KEYS, GAME_LABELS } from '../../shared/types'
import type { LeagueGame, Tier } from '../../shared/types'
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingRegion, Notice, PageHeader, Select, Skeleton, Stagger, TextField, useToast } from '../components'
import { useGuildChannels, useLeagueGames } from '../hooks/data'
import { useSettings } from '../hooks/settings'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeError, describeWriteError, mayHaveSucceeded, unwrap } from '../lib/errors'
import { invalidateLeagueData } from '../lib/invalidation'
import { plural } from '../lib/format'
import { ariaSort, matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'
import { EnableGameDialog } from './EnableGameDialog'
import { PanelDialog } from './PanelDialog'
import { useServer } from './ServerRoute'
import { TierDialog } from './TierDialog'

type TierColumn = 'key' | 'role' | 'drivers' | 'points' | 'panel'
type PanelFilter = 'all' | 'posted' | 'not-posted'
type RoleFilter = 'all' | 'missing'

const TIER_GETTERS: Record<TierColumn, (tier: Tier) => string | number | null> = {
  key: (tier) => tier.key,
  role: (tier) => tier.roleName,
  drivers: (tier) => tier.driverCount,
  points: (tier) => tier.pointsSystem,
  panel: (tier) => (tier.signupPanelPosted ? 1 : 0)
}

function SortHeader({ label, column, sort, onSort }: { label: string; column: TierColumn; sort: SortState<TierColumn> | null; onSort: (column: TierColumn) => void }) {
  const state = ariaSort(sort, column)
  const Icon = state === 'ascending' ? ArrowUp : state === 'descending' ? ArrowDown : ArrowUpDown
  return (
    <th scope="col" aria-sort={state}>
      <button type="button" className="sort-btn" onClick={() => onSort(column)}>
        {label}
        <Icon size={14} aria-hidden="true" />
      </button>
    </th>
  )
}

interface TierActions {
  edit: (tier: Tier) => void
  panel: (tier: Tier) => void
  remove: (tier: Tier) => void
}

function TierTable({ guildId, game, actions, busy }: { guildId: string; game: LeagueGame; actions: TierActions; busy: boolean }) {
  const { settings } = useSettings()
  const channels = useGuildChannels(guildId)
  const [query, setQuery] = useState('')
  const [panelFilter, setPanelFilter] = useState<PanelFilter>('all')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [sort, setSort] = useState<SortState<TierColumn> | null>({ key: 'key', direction: 'asc' })

  const channelName = (id: string | null): string => {
    if (!id) return 'a channel'
    return channels.status === 'ready' ? (channels.data.find((channel) => channel.id === id)?.name ?? 'a deleted or hidden channel') : 'a channel'
  }

  const filtered = game.tiers.filter(
    (tier) =>
      matchesQuery([tier.key, tier.roleName, tier.pointsSystem], query) &&
      (panelFilter === 'all' || (panelFilter === 'posted') === tier.signupPanelPosted) &&
      (roleFilter === 'all' || tier.roleName === null)
  )
  const rows = sortRows(filtered, sort, TIER_GETTERS)
  const filtering = query.trim() !== '' || panelFilter !== 'all' || roleFilter !== 'all'
  const idPrefix = `tiers-${game.key}`

  return (
    <div className="stack stack--tight">
      <div className="table-tools">
        <div className="table-tools__search">
          <TextField
            label="Search tiers"
            type="search"
            value={query}
            placeholder="Tier, role or points system"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Select
          label="Sign-up panel"
          value={panelFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'posted', label: 'Panel posted' },
            { value: 'not-posted', label: 'No panel' }
          ]}
          onChange={(value) => setPanelFilter(value as PanelFilter)}
        />
        <Select
          label="Role"
          value={roleFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'missing', label: 'Role missing' }
          ]}
          onChange={(value) => setRoleFilter(value as RoleFilter)}
        />
      </div>

      <div className="table-wrap">
        <table className="table" aria-describedby={`${idPrefix}-count`}>
          <caption className="sr-only">Tiers of {game.label}</caption>
          <thead>
            <tr>
              <SortHeader label="Tier" column="key" sort={sort} onSort={(column) => setSort((current) => nextSort(current, column))} />
              <SortHeader label="Role" column="role" sort={sort} onSort={(column) => setSort((current) => nextSort(current, column))} />
              <SortHeader label="Drivers" column="drivers" sort={sort} onSort={(column) => setSort((current) => nextSort(current, column))} />
              <SortHeader label="Points system" column="points" sort={sort} onSort={(column) => setSort((current) => nextSort(current, column))} />
              <SortHeader label="Panel" column="panel" sort={sort} onSort={(column) => setSort((current) => nextSort(current, column))} />
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <Stagger as="tbody">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="table__empty">
                  No tier matches your search or filters.
                </td>
              </tr>
            ) : null}
            {rows.map((tier) => {
              const stored = findPanel(settings.panels, guildId, game.key, tier.key)
              return (
                <tr key={tier.key}>
                  <th scope="row" className="table__key">
                    {tier.key}
                  </th>
                  <td>
                    {tier.roleName !== null ? tier.roleName : <Badge tone="danger">Role missing</Badge>}
                    {tier.roleName === null ? <span className="table__note">The role was deleted in Discord</span> : null}
                  </td>
                  <td className="table__num">{tier.driverCount !== null ? tier.driverCount : <span className="muted">Unknown</span>}</td>
                  <td>{tier.pointsSystem ?? <span className="muted">None</span>}</td>
                  <td>
                    {tier.signupPanelPosted ? (
                      <>
                        <Badge tone="success">Posted</Badge>
                        <span className="table__note">
                          # {channelName(tier.signupChannelId)}
                          {stored ? ' - can be refreshed' : ' - posted outside this app'}
                        </span>
                      </>
                    ) : (
                      <span className="muted">Not posted</span>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <Button variant="ghost" size="sm" iconOnly disabled={busy} icon={<Pencil size={16} aria-hidden="true" />} onClick={() => actions.edit(tier)} aria-label={`Edit tier ${tier.key}`} title="Edit tier" />
                      <Button variant="ghost" size="sm" iconOnly disabled={busy} icon={<Send size={16} aria-hidden="true" />} onClick={() => actions.panel(tier)} aria-label={`Sign-up panel of tier ${tier.key}`} title="Sign-up panel" />
                      <Button variant="ghost" size="sm" iconOnly disabled={busy} icon={<Trash2 size={16} aria-hidden="true" />} onClick={() => actions.remove(tier)} aria-label={`Remove tier ${tier.key}`} title="Remove tier" />
                    </div>
                  </td>
                </tr>
              )
            })}
          </Stagger>
        </table>
      </div>
      <p className="muted table-count" id={`${idPrefix}-count`} aria-live="polite">
        {filtering ? `Showing ${rows.length} of ${plural(game.tiers.length, 'tier')}` : plural(game.tiers.length, 'tier')}
      </p>
    </div>
  )
}

interface GameActions extends TierActions {
  addTier: (game: LeagueGame) => void
  toggle: (game: LeagueGame) => void
  removeGame: (game: LeagueGame) => void
}

function LeagueGameBlock({ guildId, game, actions, busy, workingKey }: { guildId: string; game: LeagueGame; actions: GameActions; busy: boolean; workingKey: string | null }) {
  return (
    <Card className="league-game">
      <div className="league-game__head">
        <div className="league-game__title">
          <h3>{game.label}</h3>
          <div className="league-game__meta">
            <Badge tone={game.active ? 'success' : 'neutral'}>{game.active ? 'Enabled' : 'Disabled'}</Badge>
            <span className="muted">
              Key <code>{game.key}</code> - {game.category}
            </span>
          </div>
        </div>
        <div className="league-game__actions">
          <Button size="sm" icon={<Plus size={14} aria-hidden="true" />} disabled={busy} onClick={() => actions.addTier(game)}>
            Add tier
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={workingKey === `toggle:${game.key}`}
            disabled={busy && workingKey !== `toggle:${game.key}`}
            icon={game.active ? <PowerOff size={14} aria-hidden="true" /> : <Power size={14} aria-hidden="true" />}
            onClick={() => actions.toggle(game)}
          >
            {game.active ? 'Disable game' : 'Enable game'}
          </Button>
          <Button destructive variant="ghost" size="sm" disabled={busy} icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => actions.removeGame(game)}>
            Delete game
          </Button>
        </div>
      </div>

      {game.tiers.length === 0 ? (
        <EmptyState
          title="No tiers yet"
          description="A tier links a Discord role to a sign-up panel. Members click Join on the panel to get the role."
          action={
            <Button icon={<Plus size={16} aria-hidden="true" />} disabled={busy} onClick={() => actions.addTier(game)}>
              Add the first tier
            </Button>
          }
        />
      ) : (
        <TierTable guildId={guildId} game={game} actions={actions} busy={busy} />
      )}
    </Card>
  )
}

type Pending =
  | { kind: 'tier'; game: LeagueGame; tier: Tier }
  | { kind: 'game'; game: LeagueGame }

export function GamesTiers() {
  const { guild } = useServer()
  const league = useLeagueGames(guild.id)
  const toast = useToast()
  const write = useWriteAction()
  const { reload: reloadSettings } = useSettings()

  const [enableSlug, setEnableSlug] = useState<{ slug: string; label: string } | null>(null)
  const [tierDialog, setTierDialog] = useState<{ game: LeagueGame; tier?: Tier } | null>(null)
  const [panelDialog, setPanelDialog] = useState<{ game: LeagueGame; tier: Tier } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [workingKey, setWorkingKey] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ text: string; uncertain: boolean } | null>(null)

  const games = league.status === 'ready' ? league.data.games : []

  const reloadAfterRemove = async (): Promise<void> => {
    await reloadSettings() // the main process forgot the removed panels
    invalidateLeagueData(guild.id)
  }

  const fail = (error: unknown, what: string): void => setProblem({ text: describeWriteError(error, what), uncertain: mayHaveSucceeded(error) })

  const toggle = async (game: LeagueGame): Promise<void> => {
    setProblem(null)
    setWorkingKey(`toggle:${game.key}`)
    const outcome = await write.run(() => unwrap(window.nexus.api.setGameActive(guild.id, game.key, !game.active)))
    setWorkingKey(null)
    if (!outcome) return
    if (outcome.ok) {
      invalidateLeagueData(guild.id)
      toast.push({ tone: 'success', title: game.active ? 'Game disabled' : 'Game enabled', message: game.label })
    } else fail(outcome.error, 'The change')
  }

  const confirmRemove = async (): Promise<void> => {
    if (!pending) return
    setProblem(null)
    const target = pending
    const outcome = await write.run(() =>
      target.kind === 'tier'
        ? unwrap(window.nexus.api.deleteTier(guild.id, target.game.key, target.tier.key))
        : unwrap(window.nexus.api.deleteGame(guild.id, target.game.key))
    )
    if (!outcome) return
    setPending(null)
    if (outcome.ok) {
      await reloadAfterRemove()
      toast.push({ tone: 'success', title: target.kind === 'tier' ? 'Tier removed' : 'Game deleted', message: target.kind === 'tier' ? `${target.tier.key} in ${target.game.label}` : target.game.label })
    } else fail(outcome.error, target.kind === 'tier' ? 'The removal' : 'The deletion')
  }

  const tierActions: GameActions = {
    edit: (tier) => {
      const game = games.find((item) => item.tiers.includes(tier))
      if (game) setTierDialog({ game, tier })
    },
    panel: (tier) => {
      const game = games.find((item) => item.tiers.includes(tier))
      if (game) setPanelDialog({ game, tier })
    },
    remove: (tier) => {
      const game = games.find((item) => item.tiers.includes(tier))
      if (game) setPending({ kind: 'tier', game, tier })
    },
    addTier: (game) => setTierDialog({ game }),
    toggle: (game) => void toggle(game),
    removeGame: (game) => setPending({ kind: 'game', game })
  }

  const catalog = GAME_KEYS.map((slug) => ({ slug, label: GAME_LABELS[slug], matching: leagueGamesFor(slug, games) }))
  const known = new Set(catalog.flatMap((entry) => entry.matching.map((game) => game.key)))
  const others = games.filter((game) => !known.has(game.key))
  const anyEnabled = GAME_KEYS.some((slug) => isCatalogGameEnabled(slug, games))

  return (
    <div className="page">
      <PageHeader
        title="Games & Tiers"
        description={`Enable games and manage the tiers drivers sign up for in ${guild.name}.`}
        actions={
          <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} loading={league.status === 'ready' && league.refreshing === true} onClick={league.reload}>
            Refresh
          </Button>
        }
      />

      {league.status === 'loading' ? (
        <LoadingRegion label="Loading games and tiers" className="stack">
          <Skeleton height={140} radius={12} />
          <Skeleton height={140} radius={12} />
        </LoadingRegion>
      ) : null}

      {league.status === 'error' ? <ErrorState title="Could not load the games" message={describeError(league.error)} onRetry={league.reload} /> : null}

      {league.status === 'ready' ? (
        <>
          {!league.data.memberCacheComplete ? (
            <Notice tone="info">Discord did not return the full member list, so the driver counts may be lower than the real numbers.</Notice>
          ) : null}

          {problem ? (
            <Notice
              tone="danger"
              action={
                problem.uncertain ? (
                  <Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={() => { setProblem(null); invalidateLeagueData(guild.id) }}>
                    Refresh
                  </Button>
                ) : undefined
              }
            >
              {problem.text}
            </Notice>
          ) : null}

          {!anyEnabled ? (
            <EmptyState
              icon={<Power size={24} aria-hidden="true" />}
              title="No game is enabled yet"
              description="Enable a game below to add tiers and post sign-up panels for it."
            />
          ) : null}

          {catalog.map(({ slug, label, matching }) => (
            <section key={slug} className="game-section" aria-labelledby={`game-${slug}`}>
              <div className="game-section__head">
                <h2 id={`game-${slug}`}>{label}</h2>
                {matching.length === 0 || !isCatalogGameEnabled(slug, games) ? <Badge>Not enabled</Badge> : null}
                {matching.length === 0 ? (
                  <Button size="sm" icon={<Power size={14} aria-hidden="true" />} disabled={write.busy} onClick={() => setEnableSlug({ slug, label })}>
                    Enable game
                  </Button>
                ) : null}
              </div>
              {matching.map((game) => (
                <LeagueGameBlock key={game.key} guildId={guild.id} game={game} actions={tierActions} busy={write.busy} workingKey={workingKey} />
              ))}
            </section>
          ))}

          {others.length > 0 ? (
            <section className="game-section" aria-labelledby="game-others">
              <div className="game-section__head">
                <h2 id="game-others">Other league games</h2>
              </div>
              {others.map((game) => (
                <LeagueGameBlock key={game.key} guildId={guild.id} game={game} actions={tierActions} busy={write.busy} workingKey={workingKey} />
              ))}
            </section>
          ) : null}
        </>
      ) : null}

      {enableSlug ? <EnableGameDialog guildId={guild.id} slug={enableSlug.slug} label={enableSlug.label} onClose={() => setEnableSlug(null)} /> : null}
      {tierDialog ? <TierDialog guildId={guild.id} game={tierDialog.game} tier={tierDialog.tier} onClose={() => setTierDialog(null)} /> : null}
      {panelDialog ? <PanelDialog guildId={guild.id} game={panelDialog.game} tier={panelDialog.tier} onClose={() => setPanelDialog(null)} /> : null}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'game' ? `Delete ${pending.game.label}?` : `Remove tier ${pending?.kind === 'tier' ? pending.tier.key : ''}?`}
        confirmLabel={pending?.kind === 'game' ? 'Delete game' : 'Remove tier'}
        busy={write.busy}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setPending(null)}
      >
        {pending?.kind === 'tier' ? <RemoveTierText game={pending.game} tier={pending.tier} /> : null}
        {pending?.kind === 'game' ? <DeleteGameText game={pending.game} /> : null}
      </ConfirmDialog>
    </div>
  )
}

function RemoveTierText({ game, tier }: { game: LeagueGame; tier: Tier }): ReactNode {
  return (
    <>
      <p>
        This removes the tier <strong>{tier.key}</strong> from <strong>{game.label}</strong> in Nexus, together with its settings (points system, sign-up channel).
      </p>
      <ul className="plain-list">
        <li>The Discord role {tier.roleName ? <strong>{tier.roleName}</strong> : 'of this tier'} is not deleted, and drivers keep it.</li>
        <li>A sign-up panel already posted in Discord is not removed from the channel.</li>
        <li>Nexus forgets the panel it remembers for this tier, so it can no longer be refreshed from this app.</li>
      </ul>
      <p>This cannot be undone. You can add the tier again with the same key.</p>
    </>
  )
}

function DeleteGameText({ game }: { game: LeagueGame }): ReactNode {
  const names = game.tiers.slice(0, 6).map((tier) => tier.key)
  return (
    <>
      <p>
        This permanently deletes the league game <strong>{game.label}</strong> (key <code>{game.key}</code>)
        {game.tiers.length > 0 ? (
          <>
            {' '}
            and its <strong>{plural(game.tiers.length, 'tier')}</strong>: {names.join(', ')}
            {game.tiers.length > names.length ? `, and ${game.tiers.length - names.length} more` : ''}.
          </>
        ) : (
          '.'
        )}
      </p>
      <ul className="plain-list">
        <li>Discord roles are not deleted.</li>
        <li>Sign-up panels already posted stay in Discord, but their Join button will answer that the tier no longer exists.</li>
        <li>Nexus forgets the panels it remembers for these tiers.</li>
      </ul>
      <p>
        This cannot be undone. A game&apos;s name and category cannot be edited: to change them, delete the game and enable it again with the new values (the tiers have to be added again).
      </p>
    </>
  )
}
