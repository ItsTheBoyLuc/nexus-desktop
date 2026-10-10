import { ArrowLeft, FileWarning, RotateCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { REPORT_FILTER_LIMITS, validateReportFilters } from '../../shared/penaltyValidation'
import type { ReportFilterDraft, ReportFilterField } from '../../shared/penaltyValidation'
import type { ReportRoundRow } from '../../shared/types'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingRegion, Notice, PageHeader, Select, Skeleton, SortHeader, Tabs, tabPanelProps, TextField } from '../components'
import { useReportRound, useReportRounds } from '../hooks/data'
import { useDebounced } from '../hooks/useDebounced'
import { useReportList } from '../hooks/reports'
import type { ManualPointsPrefill } from '../lib/decisionFlow'
import { describeError, errorCode } from '../lib/errors'
import { plural } from '../lib/format'
import { invalidateReports } from '../lib/invalidation'
import { STATUS_FILTER_OPTIONS } from '../lib/reportView'
import { matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'
import { F1Only } from './F1Only'
import { useLeague } from './LeagueRoute'
import { useOpenPenaltySettings } from './penaltyNav'
import { ReportDetail } from './ReportDetail'
import { ReportTable } from './ReportTable'

type TabId = 'reports' | 'rounds'
interface Selected {
  id: string
  back: string
}

const NO_FILTERS: ReportFilterDraft = { season: '', round: '', status: '', driver: '' }

/** What the screens say when a read is refused because the staff role is gone. */
function readProblem(error: unknown): string {
  return errorCode(error) === 'forbidden' ? 'You no longer have the FIA, STAFF or Administrator role in this server, so reports cannot be read.' : describeError(error)
}

/** The filters live in the screen, so they are still there after opening a report and coming back. */
function AllReports({ guildId, draft, setDraft, onOpen }: { guildId: string; draft: ReportFilterDraft; setDraft: (next: ReportFilterDraft | ((current: ReportFilterDraft) => ReportFilterDraft)) => void; onOpen: (id: string) => void }) {
  // The filters go to the server, so typing is settled for a moment first (reads are limited to 60 a minute).
  const settled = useDebounced(draft)
  const checked = useMemo(() => validateReportFilters(settled), [settled])
  const filters = useMemo(() => (checked.ok ? checked.value : {}), [checked])
  const list = useReportList(guildId, filters)

  const typedErrors: Partial<Record<ReportFilterField, string>> = (() => {
    const result = validateReportFilters(draft)
    return result.ok ? {} : result.errors
  })()
  const filtering = Object.values(draft).some((value) => value.trim() !== '')
  const set = (field: keyof ReportFilterDraft, value: string): void => setDraft((current) => ({ ...current, [field]: value }))
  const waiting = draft !== settled // the typed filters have not been sent yet

  return (
    <div className="stack">
      <Card className="stack">
        <div className="section-head">
          <h2 className="section-title">Filters</h2>
          <Button variant="ghost" size="sm" disabled={!filtering} onClick={() => setDraft(NO_FILTERS)}>
            Clear filters
          </Button>
        </div>
        <div className="filter-grid">
          <TextField label="Season" value={draft.season} placeholder="5" error={typedErrors.season} hint={`At most ${REPORT_FILTER_LIMITS.seasonMax} characters.`} autoComplete="off" onChange={(event) => set('season', event.target.value)} />
          <TextField label="Round" value={draft.round} placeholder="3" error={typedErrors.round} hint={`At most ${REPORT_FILTER_LIMITS.roundMax} characters.`} autoComplete="off" onChange={(event) => set('round', event.target.value)} />
          <Select label="Status" value={draft.status} options={STATUS_FILTER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} error={typedErrors.status} onChange={(value) => set('status', value)} />
          <TextField label="Driver involved" value={draft.driver} placeholder="Part of a name" error={typedErrors.driver} hint="Matches the drivers named in the report." autoComplete="off" onChange={(event) => set('driver', event.target.value)} />
        </div>
        <p className="muted">Season, round, status and driver are asked of the server. The search box below the filters, and the column sorting, work on the reports that are loaded.</p>
      </Card>

      {list.first.status === 'loading' ? (
        <LoadingRegion label="Loading the reports" className="stack">
          <Skeleton height={40} />
          <Skeleton height={260} radius={12} />
        </LoadingRegion>
      ) : null}
      {list.first.status === 'error' ? <ErrorState title="Could not load the reports" message={readProblem(list.first.error)} onRetry={list.first.reload} /> : null}

      {list.first.status === 'ready' ? (
        list.total === 0 ? (
          <EmptyState
            icon={<FileWarning size={24} aria-hidden="true" />}
            title={filtering ? 'No report matches these filters' : 'No reports yet'}
            description={filtering ? 'Change or clear the filters to see more.' : 'Drivers file reports in Discord with /f1 report. They show up here as soon as one is filed.'}
            action={
              filtering ? (
                <Button variant="secondary" onClick={() => setDraft(NO_FILTERS)}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="stack stack--tight" aria-busy={waiting || list.first.refreshing === true || undefined}>
            <ReportTable
              reports={list.reports}
              onOpen={(report) => onOpen(report.id)}
              idPrefix="reports"
              caption="Reports"
              note={
                list.total > list.reports.length
                  ? `loaded, of ${list.total} on the server for ${filtering ? 'these filters' : 'this server'}. Search and sorting only see the loaded ones.`
                  : filtering
                    ? `for these filters (${list.total} on the server).`
                    : 'on the server.'
              }
            />
            {list.moreError ? <Notice tone="danger">Could not load more reports: {list.moreError} The reports above are still shown.</Notice> : null}
            {list.canLoadMore ? (
              <div className="dialog-actions dialog-actions--start">
                <Button variant="secondary" loading={list.loadingMore} onClick={list.loadMore}>
                  Load more reports ({list.total - list.reports.length} left)
                </Button>
              </div>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  )
}

type RoundColumn = 'round' | 'circuit' | 'total' | 'open' | 'penalty' | 'nfa'
const ROUND_GETTERS: Record<RoundColumn, (row: ReportRoundRow) => string | number | null> = {
  round: (row) => row.roundKey,
  circuit: (row) => row.circuit,
  total: (row) => row.total,
  open: (row) => row.pending + row.underInvestigation,
  penalty: (row) => row.penaltyIssued,
  nfa: (row) => row.noFurtherAction
}

function RoundsOverview({ guildId, onOpenRound }: { guildId: string; onOpenRound: (row: ReportRoundRow) => void }) {
  const rounds = useReportRounds(guildId)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState<RoundColumn> | null>({ key: 'round', direction: 'asc' })
  const onSort = (column: RoundColumn): void => setSort((current) => nextSort(current, column))

  if (rounds.status === 'loading') {
    return (
      <LoadingRegion label="Loading the round overview" className="stack">
        <Skeleton height={40} />
        <Skeleton height={220} radius={12} />
      </LoadingRegion>
    )
  }
  if (rounds.status === 'error') return <ErrorState title="Could not load the round overview" message={readProblem(rounds.error)} onRetry={rounds.reload} />
  if (rounds.data.length === 0) {
    return <EmptyState icon={<FileWarning size={24} aria-hidden="true" />} title="No reports yet" description="Rounds appear here once a driver has filed a report for them in Discord." />
  }

  const rows = sortRows(
    rounds.data.filter((row) => matchesQuery([row.roundKey, row.circuit, row.season, row.round], query)),
    sort,
    ROUND_GETTERS
  )
  return (
    <div className="stack stack--tight">
      <TextField label="Search rounds" type="search" value={query} placeholder="Round or circuit" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
      <div className="table-wrap">
        <table className="table table--wide" aria-describedby="rounds-count">
          <caption className="sr-only">Reports per season and round</caption>
          <thead>
            <tr>
              <SortHeader label="Round" column="round" sort={sort} onSort={onSort} />
              <SortHeader label="Circuit" column="circuit" sort={sort} onSort={onSort} />
              <SortHeader label="Reports" column="total" sort={sort} onSort={onSort} numeric />
              <SortHeader label="Open" column="open" sort={sort} onSort={onSort} numeric />
              <SortHeader label="Penalty issued" column="penalty" sort={sort} onSort={onSort} numeric />
              <SortHeader label="No further action" column="nfa" sort={sort} onSort={onSort} numeric />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="table__empty">
                  No round matches your search.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.roundKey}>
                <th scope="row" className="table__key">
                  <button type="button" className="link-btn" onClick={() => onOpenRound(row)} aria-label={`Open the reports of ${row.roundKey}, ${row.circuit}`}>
                    <span>{row.roundKey}</span>
                  </button>
                  <span className="table__note">
                    Season {row.season}, round {row.round}
                  </span>
                </th>
                <td>{row.circuit}</td>
                <td className="table__num">{row.total}</td>
                <td className="table__num">{row.pending + row.underInvestigation > 0 ? <Badge tone="primary">{row.pending + row.underInvestigation}</Badge> : <span className="muted">0</span>}</td>
                <td className="table__num">{row.penaltyIssued}</td>
                <td className="table__num">{row.noFurtherAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted table-count" id="rounds-count" aria-live="polite">
        {query.trim() !== '' ? `Showing ${rows.length} of ${plural(rounds.data.length, 'round')}` : plural(rounds.data.length, 'round')} with reports. Open reports are the ones that can still be decided.
      </p>
    </div>
  )
}

function RoundReports({ guildId, round, onBack, onOpen }: { guildId: string; round: { season: string; round: string }; onBack: () => void; onOpen: (id: string) => void }) {
  const detail = useReportRound(guildId, round)
  return (
    <div className="stack">
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={onBack}>
          All rounds
        </Button>
      </div>
      {detail.status === 'loading' ? (
        <LoadingRegion label="Loading the round" className="stack">
          <Skeleton height={32} width={280} />
          <Skeleton height={200} radius={12} />
        </LoadingRegion>
      ) : null}
      {detail.status === 'error' ? <ErrorState title="Could not load the round" message={readProblem(detail.error)} onRetry={detail.reload} /> : null}
      {detail.status === 'ready' ? (
        <>
          <h2>
            {detail.data.roundKey} <span className="muted">{detail.data.circuit}</span>
          </h2>
          {detail.data.count === 0 ? (
            <EmptyState title="No reports for this round" description={`Nobody has filed a report for season ${detail.data.season}, round ${detail.data.round}.`} />
          ) : (
            <ReportTable reports={detail.data.reports} onOpen={(report) => onOpen(report.id)} idPrefix="round-reports" caption={`Reports of ${detail.data.roundKey}`} note="in this round." />
          )}
        </>
      ) : null}
    </div>
  )
}

function ReportsScreen() {
  const { guild } = useLeague()
  const openPenaltySettings = useOpenPenaltySettings()
  const [tab, setTab] = useState<TabId>('reports')
  const [filterDraft, setFilterDraft] = useState<ReportFilterDraft>(NO_FILTERS)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [round, setRound] = useState<{ season: string; round: string; key: string } | null>(null)
  const [pointsFailures, setPointsFailures] = useState<Record<string, ManualPointsPrefill>>({})

  const setFailure = (reportId: string, prefill: ManualPointsPrefill | null): void =>
    setPointsFailures((current) => {
      const next = { ...current }
      if (prefill) next[reportId] = prefill
      else delete next[reportId]
      return next
    })

  const failedIds = Object.keys(pointsFailures)

  return (
    <div className="page">
      <PageHeader
        title="Reports"
        description={`${guild.name} - incident reports filed by drivers`}
        actions={
          <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={() => invalidateReports(guild.id)}>
            Refresh
          </Button>
        }
      />

      {selected ? (
        <ReportDetail
          key={selected.id}
          guildId={guild.id}
          reportId={selected.id}
          backLabel={selected.back}
          onBack={() => setSelected(null)}
          pointsFailures={pointsFailures}
          onPointsFailure={setFailure}
          onOpenPenaltySettings={openPenaltySettings}
        />
      ) : (
        <>
          <Notice tone="info">
            <strong>Reports are filed by drivers in Discord</strong> with <code>/f1 report</code>, which opens a private thread for the stewards. The app cannot create a report; it can review them and decide them.
          </Notice>

          {failedIds.length > 0 ? (
            <Notice tone="danger">
              <strong>{plural(failedIds.length, 'decided report')} still need their penalty points.</strong> The decision is saved but the server could not store the points. Open the report and choose &quot;Add the points now&quot;:{' '}
              {failedIds.map((id) => (
                <Button key={id} variant="secondary" size="sm" onClick={() => setSelected({ id, back: 'All reports' })}>
                  Open the report for {pointsFailures[id]?.driver ?? 'the driver'}
                </Button>
              ))}
            </Notice>
          ) : null}

          <Tabs
            label="Reports"
            idPrefix="reports"
            active={tab}
            onChange={(id) => {
              setTab(id as TabId)
              setRound(null)
            }}
            tabs={[
              { id: 'reports', label: 'All reports' },
              { id: 'rounds', label: 'By season and round' }
            ]}
          />
          <div {...tabPanelProps('reports', tab)} className="stack">
            {tab === 'reports' ? <AllReports guildId={guild.id} draft={filterDraft} setDraft={setFilterDraft} onOpen={(id) => setSelected({ id, back: 'All reports' })} /> : null}
            {tab === 'rounds' && !round ? <RoundsOverview guildId={guild.id} onOpenRound={(row) => setRound({ season: row.season, round: row.round, key: row.roundKey })} /> : null}
            {tab === 'rounds' && round ? (
              <RoundReports guildId={guild.id} round={round} onBack={() => setRound(null)} onOpen={(id) => setSelected({ id, back: `Round ${round.key}` })} />
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

export function Reports() {
  return (
    <F1Only page="reports">
      <ReportsScreen />
    </F1Only>
  )
}
