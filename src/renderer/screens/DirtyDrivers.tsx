import { ArrowLeft, Lock, Plus, RotateCw, ShieldAlert, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { DirtyReport } from '../../shared/types'
import { Badge, Button, Card, EmptyState, ErrorState, EvidenceLink, LoadingRegion, Modal, Notice, PageHeader, Skeleton, SortHeader, Stagger, TextField, useToast } from '../components'
import { useDirtyDrivers, useDirtyHistory } from '../hooks/data'
import { useWriteAction } from '../hooks/useWriteAction'
import { DIRTY_GETTERS, describeRemoval, runRemoval } from '../lib/dirtyView'
import type { DirtyColumn } from '../lib/dirtyView'
import { describeError, errorCode } from '../lib/errors'
import { formatDay, formatWhen, plural } from '../lib/format'
import { invalidateDirty } from '../lib/invalidation'
import { matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'
import { DirtyReportDialog } from './DirtyReportDialog'
import { F1Only } from './F1Only'
import { useLeague } from './LeagueRoute'

/** What a read says when the staff role is gone. */
function readProblem(error: unknown): string {
  return errorCode(error) === 'forbidden' ? 'You no longer have the FIA, STAFF or Administrator role in this server, so the dirty-driver list cannot be read.' : describeError(error)
}

function DriverHistory({ guildId, driver, onBack, onAdd }: { guildId: string; driver: string; onBack: () => void; onAdd: () => void }) {
  const history = useDirtyHistory(guildId, driver)
  const toast = useToast()
  const write = useWriteAction()
  const [pending, setPending] = useState<DirtyReport | null>(null)
  const [dialogProblem, setDialogProblem] = useState<string | null>(null)
  /** A removal got no clear answer: the numbers may have moved, so no removal until the history was read again. */
  const [uncertain, setUncertain] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = (): void => {
    setUncertain(false)
    setNotice(null)
    invalidateDirty(guildId)
  }

  const remove = async (): Promise<void> => {
    if (!pending) return
    const shown = pending
    setDialogProblem(null)
    const outcome = await write.run(() => runRemoval(window.nexus.api, guildId, driver, shown))
    if (!outcome || !outcome.ok) return
    const run = outcome.value
    switch (run.kind) {
      case 'removed':
        setPending(null)
        invalidateDirty(guildId)
        toast.push({ tone: 'success', title: 'Report removed', message: describeRemoval(run.result) })
        return
      case 'changed':
        setPending(null)
        invalidateDirty(guildId)
        setNotice('The reports of this driver changed since you opened them (somebody added or removed one, possibly in Discord), so nothing was removed. The list was read again: look at it and choose the report again.')
        return
      case 'lost':
        setPending(null)
        invalidateDirty(guildId)
        setUncertain(true)
        return
      case 'unverified':
        setDialogProblem(`${run.message} Nothing was removed.`)
        return
      case 'refused':
        setDialogProblem(`${run.message} Nothing was removed.`)
        return
    }
  }

  return (
    <div className="stack">
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={onBack}>
          All dirty drivers
        </Button>
      </div>

      {history.status === 'loading' ? (
        <LoadingRegion label="Loading the reports" className="stack">
          <Skeleton height={64} radius={12} />
          <Skeleton height={180} radius={12} />
        </LoadingRegion>
      ) : null}
      {history.status === 'error' && errorCode(history.error) === 'driver_not_found' ? (
        <EmptyState
          icon={<ShieldAlert size={24} aria-hidden="true" />}
          title={`${driver} has no dirty-driver reports`}
          description="The last report was removed (or never existed), so the driver is no longer on the list."
          action={<Button onClick={onBack}>Back to the list</Button>}
        />
      ) : null}
      {history.status === 'error' && errorCode(history.error) !== 'driver_not_found' ? <ErrorState title="Could not load the reports" message={readProblem(history.error)} onRetry={history.reload} /> : null}

      {notice ? <Notice tone="warning" action={<Button variant="secondary" size="sm" onClick={() => setNotice(null)}>Dismiss</Button>}>{notice}</Notice> : null}
      {uncertain ? (
        <Notice tone="danger" action={<Button size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={refresh}>Refresh the reports</Button>}>
          <strong>Nexus did not get a clear answer, so the report may already be removed.</strong> It is not sent again, because the report numbers move up after a removal and a second request could remove a different report. Refresh the reports and look before you remove anything else.
        </Notice>
      ) : null}

      {history.status === 'ready' ? (
        <>
          <Card className="section-head">
            <div>
              <h2>{history.data.displayName}</h2>
              <p className="muted">{plural(history.data.total, 'report')} on file. The number is what removing a report goes by; it moves up when an earlier report is removed.</p>
            </div>
            <Button icon={<Plus size={16} aria-hidden="true" />} onClick={onAdd}>
              Add a report
            </Button>
          </Card>
          <Stagger as="ul" className="report-cards">
            {history.data.reports.map((report) => (
              <li key={report.index}>
                <Card className="stack stack--tight">
                  <div className="section-head">
                    <h3>Report {report.index}</h3>
                    <Button destructive variant="secondary" size="sm" icon={<Trash2 size={14} aria-hidden="true" />} disabled={uncertain || history.refreshing === true} onClick={() => { setPending(report); setDialogProblem(null) }}>
                      Remove report {report.index}
                    </Button>
                  </div>
                  <p className="muted">
                    Filed by {report.reportedBy || 'unknown'} on {formatWhen(report.timestamp)}
                    {report.relatedIncident ? ` - ${report.relatedIncident}` : ''}
                  </p>
                  <p className="plain-text">{report.reason}</p>
                  {report.evidence ? <EvidenceLink url={report.evidence} label="Open evidence" /> : <p className="muted">No evidence link.</p>}
                </Card>
              </li>
            ))}
          </Stagger>
        </>
      ) : null}

      <Modal
        open={pending !== null}
        title={pending ? `Remove report ${pending.index} of ${history.status === 'ready' ? history.data.displayName : driver}?` : 'Remove report?'}
        dismissible={!write.busy}
        onClose={() => setPending(null)}
        footer={
          <>
            {/* Cancel is the default focus: Enter never removes a report by accident. */}
            <Button variant="secondary" data-autofocus disabled={write.busy} onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button destructive loading={write.busy} onClick={() => void remove()}>
              Remove the report
            </Button>
          </>
        }
      >
        {pending ? (
          <>
            <p>
              This permanently removes <strong>report {pending.index}</strong> of <strong>{history.status === 'ready' ? history.data.displayName : driver}</strong>, filed by {pending.reportedBy || 'unknown'} on {formatDay(pending.timestamp)}:
            </p>
            <blockquote className="ban-notice">{pending.reason}</blockquote>
            <ul className="plain-list">
              <li>The reports after it move up by one number. If it is the driver&apos;s last report, the driver leaves the list.</li>
              <li>Before it is removed, the app reads the reports again and only goes ahead if this one is still at that number.</li>
              <li>It cannot be undone from the app. It is sent once; if the answer is lost, you refresh and look.</li>
            </ul>
            {dialogProblem ? <Notice tone="danger">{dialogProblem}</Notice> : null}
          </>
        ) : null}
      </Modal>
    </div>
  )
}

function DirtyDriversScreen() {
  const { guild } = useLeague()
  const list = useDirtyDrivers(guild.id)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState<DirtyColumn> | null>({ key: 'when', direction: 'desc' })
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ driver: string } | null>(null)
  const onSort = (column: DirtyColumn): void => setSort((current) => nextSort(current, column))

  const drivers = list.status === 'ready' ? list.data : []
  const rows = sortRows(
    drivers.filter((driver) => matchesQuery([driver.displayName, driver.latest.reason, driver.latest.reportedBy], query)),
    sort,
    DIRTY_GETTERS
  )
  const suggestions = drivers.map((driver) => driver.displayName)

  return (
    <div className="page">
      <PageHeader
        title="Dirty drivers"
        description={`${guild.name} - private misconduct reports`}
        actions={
          <div className="header-actions">
            <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} loading={list.status === 'ready' && list.refreshing === true} onClick={() => invalidateDirty(guild.id)}>
              Refresh
            </Button>
            <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setAdding({ driver: '' })}>
              Add a report
            </Button>
          </div>
        }
      />

      <Notice tone="warning">
        <Lock size={14} aria-hidden="true" /> <strong>Private to this server&apos;s staff.</strong> These reports are only available to people with the FIA or STAFF role, or Administrators, and they are about named drivers. Do not share this screen or copy it into public channels.
      </Notice>

      {selected !== null ? (
        <DriverHistory guildId={guild.id} driver={selected} onBack={() => setSelected(null)} onAdd={() => setAdding({ driver: selected })} />
      ) : (
        <>
          {list.status === 'loading' ? (
            <LoadingRegion label="Loading the dirty drivers" className="stack">
              <Skeleton height={40} />
              <Skeleton height={200} radius={12} />
            </LoadingRegion>
          ) : null}
          {list.status === 'error' ? <ErrorState title="Could not load the dirty drivers" message={readProblem(list.error)} onRetry={list.reload} /> : null}
          {list.status === 'ready' && drivers.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert size={24} aria-hidden="true" />}
              title="No dirty drivers"
              description="Nobody has a misconduct report on file. A report you add here also shows as Reported in the penalty overview."
              action={
                <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setAdding({ driver: '' })}>
                  Add the first report
                </Button>
              }
            />
          ) : null}
          {list.status === 'ready' && drivers.length > 0 ? (
            <div className="stack stack--tight">
              <TextField label="Search dirty drivers" type="search" value={query} placeholder="Driver, reason or who reported" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
              <div className="table-wrap">
                <table className="table table--wide" aria-describedby="dirty-count">
                  <caption className="sr-only">Dirty drivers with their latest report</caption>
                  <thead>
                    <tr>
                      <SortHeader label="Driver" column="driver" sort={sort} onSort={onSort} />
                      <SortHeader label="Reports" column="reports" sort={sort} onSort={onSort} numeric />
                      <SortHeader label="Latest reason" column="latest" sort={sort} onSort={onSort} />
                      <SortHeader label="Reported by" column="by" sort={sort} onSort={onSort} />
                      <SortHeader label="Latest" column="when" sort={sort} onSort={onSort} />
                    </tr>
                  </thead>
                  <Stagger as="tbody">
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="table__empty">
                          No driver matches your search.
                        </td>
                      </tr>
                    ) : null}
                    {rows.map((driver) => (
                      <tr key={driver.key}>
                        <th scope="row" className="table__key">
                          <button type="button" className="link-btn" onClick={() => setSelected(driver.displayName)} aria-label={`Open the reports of ${driver.displayName}`}>
                            <span>{driver.displayName}</span>
                          </button>
                        </th>
                        <td className="table__num">{driver.reportCount > 1 ? <Badge tone="danger">{driver.reportCount}</Badge> : driver.reportCount}</td>
                        <td className="cell-clamp plain-text">{driver.latest.reason}</td>
                        <td>{driver.latest.reportedBy}</td>
                        <td>{formatDay(driver.latest.timestamp)}</td>
                      </tr>
                    ))}
                  </Stagger>
                </table>
              </div>
              <p className="muted table-count" id="dirty-count" aria-live="polite">
                {query.trim() !== '' ? `Showing ${rows.length} of ${plural(drivers.length, 'driver')}` : plural(drivers.length, 'driver')}, most recently reported first by default.
              </p>
            </div>
          ) : null}
        </>
      )}

      {adding ? <DirtyReportDialog guildId={guild.id} driver={adding.driver} suggestions={suggestions} onClose={() => setAdding(null)} onAdded={() => undefined} /> : null}
    </div>
  )
}

export function DirtyDrivers() {
  return (
    <F1Only page="dirty-drivers">
      <DirtyDriversScreen />
    </F1Only>
  )
}
