import { Ban, FastForward, Gavel, Plus, RotateCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SEASON_LIMITS, wholeNumber } from '../../shared/penaltyValidation'
import type { AdvanceRaceResult, PenaltyOverview, PenaltyRow } from '../../shared/types'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingRegion, Notice, PageHeader, Select, Skeleton, SortHeader, Tabs, tabPanelProps, TextField, useToast } from '../components'
import { usePenaltyOverview } from '../hooks/data'
import { useDebounced } from '../hooks/useDebounced'
import { useFiaDenied } from '../hooks/useFiaDenied'
import { describeError, errorCode } from '../lib/errors'
import { plural } from '../lib/format'
import { invalidatePenalties } from '../lib/invalidation'
import { banLabel, describeAdvanceResult, describeBanResult, describeClearResult, matchesPenaltyFilter, PENALTY_FILTER_OPTIONS, PENALTY_GETTERS } from '../lib/penaltyActions'
import type { PenaltyColumn, PenaltyFilter } from '../lib/penaltyActions'
import { matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'
import { DriverPenaltyHistory } from './DriverPenaltyHistory'
import { F1Only } from './F1Only'
import { useLeague } from './LeagueRoute'
import { ManualPointsDialog } from './ManualPointsDialog'
import { AdvanceRaceDialog, AdvanceResultDialog, BanDialog, ClearPointsDialog } from './PenaltyActionDialogs'
import { PENALTY_TAB_QUERY } from './penaltyNav'
import { PenaltySettingsEditor } from './PenaltySettingsEditor'

type TabId = 'overview' | 'settings'

type Dialog =
  | { kind: 'points'; driver?: string }
  | { kind: 'clear'; driver: PenaltyRow | { displayName: string; totalPoints: number } }
  | { kind: 'ban'; driver: string | null }
  | { kind: 'advance' }

function BanBadge({ row }: { row: Pick<PenaltyRow, 'ban' | 'qualiBanned' | 'raceBanned'> }) {
  return <Badge tone={row.ban === 'none' ? 'neutral' : 'danger'}>{banLabel(row)}</Badge>
}

function OverviewTable({ overview, onOpen }: { overview: PenaltyOverview; onOpen: (row: PenaltyRow) => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PenaltyFilter>('all')
  const [sort, setSort] = useState<SortState<PenaltyColumn> | null>({ key: 'points', direction: 'desc' })
  const onSort = (column: PenaltyColumn): void => setSort((current) => nextSort(current, column))

  const rows = sortRows(
    overview.drivers.filter((row) => matchesQuery([row.displayName, row.key], query) && matchesPenaltyFilter(row, filter)),
    sort,
    PENALTY_GETTERS
  )
  const filtering = query.trim() !== '' || filter !== 'all'

  return (
    <div className="stack stack--tight">
      <div className="table-tools table-tools--two">
        <div className="table-tools__search">
          <TextField label="Search drivers" type="search" value={query} placeholder="Driver name" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Select label="Show" value={filter} options={PENALTY_FILTER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} onChange={(value) => setFilter(value as PenaltyFilter)} />
      </div>
      <div className="table-wrap">
        <table className="table table--wide" aria-describedby="penalties-count">
          <caption className="sr-only">Penalty points in season {overview.season}</caption>
          <thead>
            <tr>
              <SortHeader label="Pos" column="position" sort={sort} onSort={onSort} numeric />
              <SortHeader label="Driver" column="driver" sort={sort} onSort={onSort} />
              <SortHeader label="Points" column="points" sort={sort} onSort={onSort} numeric />
              <SortHeader label="Incidents" column="incidents" sort={sort} onSort={onSort} numeric />
              <SortHeader label="Ban" column="ban" sort={sort} onSort={onSort} />
              <SortHeader label="Reported" column="reported" sort={sort} onSort={onSort} numeric />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="table__empty">
                  No driver matches your search or filter.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="table__num">{row.position}</td>
                <th scope="row" className="table__key">
                  <button type="button" className="link-btn" onClick={() => onOpen(row)} aria-label={`Open the penalty history of ${row.displayName}`}>
                    <span>{row.displayName}</span>
                  </button>
                </th>
                <td className="table__num">{row.totalPoints}</td>
                <td className="table__num">{row.incidents}</td>
                <td>
                  <BanBadge row={row} />
                </td>
                <td className="table__num">{row.reportedCount > 0 ? <Badge tone="danger">Reported ({row.reportedCount})</Badge> : <span className="muted">-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted table-count" id="penalties-count" aria-live="polite">
        {filtering ? `Showing ${rows.length} of ${plural(overview.drivers.length, 'driver')}` : plural(overview.drivers.length, 'driver')}. &quot;Reported&quot; counts the dirty-driver reports staff filed for the driver.
      </p>
    </div>
  )
}

function PenaltiesScreen() {
  const { guild } = useLeague()
  const toast = useToast()
  const fia = useFiaDenied(guild.id)
  const [params, setParams] = useSearchParams()
  const tab: TabId = params.get(PENALTY_TAB_QUERY) === 'settings' ? 'settings' : 'overview'
  const setTab = (next: TabId): void => setParams(next === 'overview' ? {} : { [PENALTY_TAB_QUERY]: next }, { replace: true })

  const [seasonText, setSeasonText] = useState('')
  const settledSeason = useDebounced(seasonText)
  const parsedSeason = settledSeason.trim() === '' ? undefined : wholeNumber(settledSeason, SEASON_LIMITS.min, SEASON_LIMITS.max)
  const seasonProblem = seasonText.trim() !== '' && wholeNumber(seasonText, SEASON_LIMITS.min, SEASON_LIMITS.max) === null
  const requestedSeason = parsedSeason === null ? undefined : parsedSeason

  const overview = usePenaltyOverview(guild.id, requestedSeason)
  const [driver, setDriver] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [advanced, setAdvanced] = useState<AdvanceRaceResult | null>(null)

  const data = overview.status === 'ready' ? overview.data : null
  const season = data?.season ?? requestedSeason ?? 0
  const currentSeason = data?.currentSeason ?? season
  const suggestions = useMemo(() => (data ? data.drivers.map((row) => row.displayName) : []), [data])
  const goSettings = (): void => {
    setDialog(null)
    setTab('settings')
  }
  const close = (): void => setDialog(null)
  const notConfigured = overview.status === 'error' && errorCode(overview.error) === 'penalty_not_configured'
  const canAct = data !== null // actions need to know the season the overview shows

  return (
    <div className="page">
      <PageHeader
        title="Penalties"
        description={`${guild.name} - penalty points, bans and expiry`}
        actions={
          <div className="header-actions">
            <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} loading={overview.status === 'ready' && overview.refreshing === true} onClick={() => invalidatePenalties(guild.id)}>
              Refresh
            </Button>
          </div>
        }
      />

      <Tabs
        label="Penalties"
        idPrefix="penalties"
        active={tab}
        onChange={(id) => setTab(id as TabId)}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'settings', label: 'Settings' }
        ]}
      />

      {tab === 'settings' ? (
        <div {...tabPanelProps('penalties', 'settings')}>
          <PenaltySettingsEditor guildId={guild.id} />
        </div>
      ) : (
        <div {...tabPanelProps('penalties', 'overview')} className="stack">
          {driver !== null && data ? (
            <DriverPenaltyHistory
              guildId={guild.id}
              driver={driver}
              season={season}
              currentSeason={currentSeason}
              fiaDenied={fia.denied}
              onBack={() => setDriver(null)}
              onAddPoints={() => setDialog({ kind: 'points', driver })}
              onClear={(total) => setDialog({ kind: 'clear', driver: { displayName: driver, totalPoints: total } })}
              onBan={() => setDialog({ kind: 'ban', driver })}
            />
          ) : (
            <>
              <Card className="stack">
                <div className="section-head">
                  <h2 className="section-title">Season</h2>
                  <div className="header-actions">
                    <Button icon={<Plus size={16} aria-hidden="true" />} disabled={!canAct} onClick={() => setDialog({ kind: 'points' })}>
                      Add penalty points
                    </Button>
                    <Button variant="secondary" icon={<Ban size={16} aria-hidden="true" />} disabled={!canAct || fia.denied} title={fia.denied ? 'Needs the FIA role or the Administrator permission' : undefined} onClick={() => setDialog({ kind: 'ban', driver: null })}>
                      Give or remove a ban
                    </Button>
                    <Button variant="secondary" icon={<FastForward size={16} aria-hidden="true" />} disabled={!canAct || fia.denied} title={fia.denied ? 'Needs the FIA role or the Administrator permission' : undefined} onClick={() => setDialog({ kind: 'advance' })}>
                      Advance race
                    </Button>
                  </div>
                </div>
                <div className="season-line">
                  <TextField label="Season" inputMode="numeric" value={seasonText} placeholder={data ? String(data.currentSeason) : 'Current season'} hint="Empty shows the current season." error={seasonProblem ? `A whole number from ${SEASON_LIMITS.min} to ${SEASON_LIMITS.max}.` : null} autoComplete="off" onChange={(event) => { setSeasonText(event.target.value); setDriver(null) }} />
                  <Button variant="ghost" size="sm" disabled={seasonText === ''} onClick={() => { setSeasonText(''); setDriver(null) }}>
                    Current season
                  </Button>
                  {data ? <Badge tone={data.isCurrent ? 'primary' : 'neutral'}>{data.isCurrent ? `Season ${data.season} (current)` : `Season ${data.season} (not the current season)`}</Badge> : null}
                </div>
                {data ? (
                  <p className="muted">
                    Rules: points expire after {data.settings.expiryRaces ?? '?'} races; a qualifying ban at {data.settings.qualiBanThreshold ?? '?'} points and a race ban at {data.settings.raceBanThreshold ?? '?'}. They are set on the Settings tab and are stored apart from the points.
                  </p>
                ) : null}
                {fia.denied ? (
                  <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={fia.reset}>Check again</Button>}>
                    Clearing points, bans and advancing the race need the FIA role or the Administrator permission, and the server refused your account. Adding points and reading stay available. If your roles changed, choose Check again.
                  </Notice>
                ) : null}
              </Card>

              {overview.status === 'loading' ? (
                <LoadingRegion label="Loading the penalty points" className="stack">
                  <Skeleton height={40} />
                  <Skeleton height={240} radius={12} />
                </LoadingRegion>
              ) : null}
              {notConfigured ? (
                <EmptyState
                  icon={<Gavel size={24} aria-hidden="true" />}
                  title="The penalty rules have not been set up yet"
                  description="Until they are saved (this needs the Administrator permission), there are no penalty points to show and none can be added."
                  action={<Button onClick={() => setTab('settings')}>Open the Settings tab</Button>}
                />
              ) : null}
              {overview.status === 'error' && !notConfigured ? <ErrorState title="Could not load the penalty points" message={describeError(overview.error)} onRetry={overview.reload} /> : null}
              {data ? (
                data.drivers.length === 0 ? (
                  <EmptyState
                    icon={<Gavel size={24} aria-hidden="true" />}
                    title={`No penalty points in season ${data.season}`}
                    description="Nobody has penalty points in this season. Points appear here when a report decision awards them or when you add them by hand."
                    action={
                      <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setDialog({ kind: 'points' })}>
                        Add penalty points
                      </Button>
                    }
                  />
                ) : (
                  <OverviewTable overview={data} onOpen={(row) => setDriver(row.displayName)} />
                )
              ) : null}
            </>
          )}
        </div>
      )}

      {dialog?.kind === 'points' ? (
        <ManualPointsDialog
          guildId={guild.id}
          prefill={{ driver: dialog.driver, ...(data && !data.isCurrent ? { season: data.season } : {}) }}
          lockDriver={dialog.driver !== undefined}
          suggestions={suggestions}
          onClose={close}
          onOpenPenaltySettings={goSettings}
        />
      ) : null}
      {dialog?.kind === 'clear' ? (
        <ClearPointsDialog
          guildId={guild.id}
          season={season}
          currentSeason={currentSeason}
          denied={fia.denied}
          onDenied={fia.markDenied}
          onClose={close}
          onOpenPenaltySettings={goSettings}
          driver={dialog.driver.displayName}
          displayName={dialog.driver.displayName}
          currentTotal={dialog.driver.totalPoints}
          onDone={(result) => {
            invalidatePenalties(guild.id)
            toast.push({ tone: 'success', title: 'Points cleared', message: describeClearResult(result) })
            close()
          }}
        />
      ) : null}
      {dialog?.kind === 'ban' ? (
        <BanDialog
          guildId={guild.id}
          season={season}
          currentSeason={currentSeason}
          denied={fia.denied}
          onDenied={fia.markDenied}
          onClose={close}
          onOpenPenaltySettings={goSettings}
          driver={dialog.driver ?? ''}
          displayName={dialog.driver ?? ''}
          lockDriver={dialog.driver !== null}
          suggestions={suggestions}
          onDone={(result) => {
            invalidatePenalties(guild.id)
            toast.push({ tone: 'success', title: result.action === 'give' ? 'Ban given' : 'Ban removed', message: describeBanResult(result) })
            close()
          }}
        />
      ) : null}
      {dialog?.kind === 'advance' ? (
        <AdvanceRaceDialog
          guildId={guild.id}
          currentSeason={currentSeason}
          denied={fia.denied}
          onDenied={fia.markDenied}
          onClose={close}
          onOpenPenaltySettings={goSettings}
          onDone={(result) => {
            invalidatePenalties(guild.id)
            toast.push({ tone: 'success', title: 'Race advanced', message: describeAdvanceResult(result) })
            close()
            setAdvanced(result)
          }}
        />
      ) : null}
      {advanced ? <AdvanceResultDialog result={advanced} onClose={() => setAdvanced(null)} /> : null}
    </div>
  )
}

export function Penalties() {
  return (
    <F1Only page="penalties">
      <PenaltiesScreen />
    </F1Only>
  )
}
