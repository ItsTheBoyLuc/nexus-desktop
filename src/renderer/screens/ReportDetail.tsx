import { ArrowLeft, Gavel, RotateCw } from 'lucide-react'
import { useState } from 'react'
import type { DecisionResult, Report } from '../../shared/types'
import { Badge, Button, Card, ErrorState, EvidenceImage, EvidenceLink, LoadingRegion, Notice, Skeleton, useToast } from '../components'
import { useReport } from '../hooks/data'
import { describeError } from '../lib/errors'
import { formatWhen } from '../lib/format'
import { invalidatePenalties, invalidateReports } from '../lib/invalidation'
import { isOpen, statusLabel } from '../lib/reportView'
import type { ManualPointsPrefill } from '../lib/decisionFlow'
import { DecisionDialog } from './DecisionDialog'
import type { DecisionFinish } from './DecisionDialog'
import { DecisionResultDialog } from './DecisionResultDialog'
import { ManualPointsDialog } from './ManualPointsDialog'

export function StatusBadge({ report }: { report: Pick<Report, 'status'> }) {
  const tone = report.status === 'penalty_issued' ? 'danger' : report.status === 'no_further_action' ? 'success' : 'primary'
  return <Badge tone={tone}>{statusLabel(report.status)}</Badge>
}

interface ReportDetailProps {
  guildId: string
  reportId: string
  backLabel: string
  onBack: () => void
  /** Decisions that were saved WITHOUT their penalty points: report id -> what the manual points dialog is filled with. */
  pointsFailures: Readonly<Record<string, ManualPointsPrefill>>
  onPointsFailure: (reportId: string, prefill: ManualPointsPrefill | null) => void
  onOpenPenaltySettings: () => void
}

type Notice_ = 'already_decided' | 'message_not_found' | 'lost' | null

/**
 * One report, read fresh from the server, with the evidence and the decision. Everything in it is untrusted text and is
 * shown as plain text. The decision button is the only write; after a lost answer it stays off until the report was read again.
 */
export function ReportDetail({ guildId, reportId, backLabel, onBack, pointsFailures, onPointsFailure, onOpenPenaltySettings }: ReportDetailProps) {
  const report = useReport(guildId, reportId)
  const toast = useToast()
  const [deciding, setDeciding] = useState(false)
  const [result, setResult] = useState<DecisionResult | null>(null)
  const [notice, setNotice] = useState<Notice_>(null)
  const [addingPoints, setAddingPoints] = useState(false)

  const failure = pointsFailures[reportId] ?? null
  const refresh = (): void => {
    setNotice(null)
    invalidateReports(guildId)
  }

  const finished = (run: DecisionFinish): void => {
    setDeciding(false)
    switch (run.kind) {
      case 'decided':
        invalidateReports(guildId)
        if (run.result.points.applied) invalidatePenalties(guildId)
        onPointsFailure(reportId, null)
        setResult(run.result)
        toast.push({ tone: 'success', title: 'Decision recorded', message: `Report #${run.result.report.number} (${run.result.report.roundKey})` })
        return
      case 'already_decided':
        invalidateReports(guildId) // the report is read again: it shows who decided it, nothing was applied twice
        setNotice('already_decided')
        return
      case 'message_not_found':
        setNotice('message_not_found')
        return
      case 'points_failed':
        invalidateReports(guildId) // the report IS decided now
        onPointsFailure(reportId, run.prefill)
        setNotice(null)
        return
      case 'lost':
        setNotice('lost')
        return
    }
  }

  return (
    <div className="stack">
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={onBack}>
          {backLabel}
        </Button>
      </div>

      {report.status === 'loading' ? (
        <LoadingRegion label="Loading the report" className="stack">
          <Skeleton height={64} radius={12} />
          <Skeleton height={260} radius={12} />
        </LoadingRegion>
      ) : null}
      {report.status === 'error' ? <ErrorState title="Could not load the report" message={describeError(report.error)} onRetry={report.reload} /> : null}

      {report.status === 'ready' ? (
        <>
          <ReportCard report={report.data} refreshing={report.refreshing === true} />

          {failure ? (
            <Notice
              tone="danger"
              action={
                <Button size="sm" onClick={() => setAddingPoints(true)}>
                  Add the points now
                </Button>
              }
            >
              <strong>The report is decided, but its {failure.points} penalty {failure.points === 1 ? 'point was' : 'points were'} NOT saved for {failure.driver}.</strong> The server could not store them. The decision is not sent again (it would only answer
              &quot;already decided&quot;); add the points here instead.
            </Notice>
          ) : null}

          {notice === 'already_decided' ? (
            <Notice tone="warning">This report was already decided, possibly in Discord at the same moment. Nothing was applied a second time, and the report below was read again.</Notice>
          ) : null}
          {notice === 'message_not_found' ? (
            <Notice
              tone="danger"
              action={
                <Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={refresh}>
                  Refresh the report
                </Button>
              }
            >
              <strong>Nexus cannot find this report&apos;s message or thread in Discord, so the decision was refused and nothing was changed.</strong> The thread may have been deleted or archived out of reach, or the report was never linked to a message. Check Discord, then refresh.
            </Notice>
          ) : null}
          {notice === 'lost' ? (
            <Notice
              tone="danger"
              action={
                <Button icon={<RotateCw size={14} aria-hidden="true" />} size="sm" onClick={refresh}>
                  Refresh the report
                </Button>
              }
            >
              <strong>Nexus did not get a clear answer, so the report may already be decided.</strong> The decision is not sent again from here. Refresh the report and look at its status before you decide anything else.
            </Notice>
          ) : null}

          {isOpen(report.data) ? (
            <Card className="stack">
              <div className="section-head">
                <h2 className="section-title">Decision</h2>
                <Button icon={<Gavel size={16} aria-hidden="true" />} disabled={notice === 'lost' || report.refreshing === true} onClick={() => setDeciding(true)}>
                  Decide this report
                </Button>
              </div>
              <p className="muted">
                A decision updates the report message in Discord, removes its buttons and, with penalty points, saves them (a ban notice may be posted in the report thread). A decision made in Discord at the same moment can still collide with yours: a decision window that a steward
                already had open in Discord can still be submitted after the app decided, and then edits the report message again. The app only guards against a report that was already decided.
              </p>
            </Card>
          ) : (
            <Notice tone="info">
              This report is decided. The app shows its status and the penalty text that the API returns; the explanation of a decision and the points it awarded are not returned by the API, so the <strong>full decision text is in the Discord report message</strong>.
            </Notice>
          )}
        </>
      ) : null}

      {deciding && report.status === 'ready' ? (
        <DecisionDialog guildId={guildId} report={report.data} onClose={() => setDeciding(false)} onFinished={finished} onOpenPenaltySettings={onOpenPenaltySettings} />
      ) : null}
      {result ? <DecisionResultDialog result={result} onClose={() => setResult(null)} /> : null}
      {addingPoints && failure ? (
        <ManualPointsDialog
          guildId={guildId}
          prefill={failure}
          lockDriver
          intro={<Notice tone="warning">This report was decided without its points. The driver, points and season are filled in from your decision; check them before you save.</Notice>}
          onClose={() => setAddingPoints(false)}
          onSaved={() => onPointsFailure(reportId, null)}
          onOpenPenaltySettings={onOpenPenaltySettings}
        />
      ) : null}
    </div>
  )
}

/** The fields of a report. All texts are rendered as plain text (React escapes them; nothing here ever builds HTML). */
function ReportCard({ report, refreshing }: { report: Report; refreshing: boolean }) {
  return (
    <Card className="stack" aria-busy={refreshing || undefined}>
      <div className="section-head">
        <h2>
          Report #{report.number} <span className="muted">{report.roundKey}</span>
        </h2>
        <StatusBadge report={report} />
      </div>
      <dl className="facts facts--grid">
        <div>
          <dt>Circuit</dt>
          <dd>{report.circuit || <span className="muted">Not given</span>}</dd>
        </div>
        <div>
          <dt>Season / round (as typed)</dt>
          <dd>
            {report.season || '-'} / {report.round || '-'}
          </dd>
        </div>
        <div>
          <dt>Filed by</dt>
          <dd>{report.reporter || <span className="muted">Unknown</span>}</dd>
        </div>
        <div>
          <dt>Filed</dt>
          <dd>{formatWhen(report.timestamp)}</dd>
        </div>
        <div>
          <dt>Drivers involved</dt>
          <dd>{report.driversInvolved || <span className="muted">Not given</span>}</dd>
        </div>
        <div>
          <dt>Lap</dt>
          <dd>{report.lap || <span className="muted">Not given</span>}</dd>
        </div>
        {report.decided ? (
          <div className="facts__wide">
            <dt>Decision</dt>
            <dd>
              {statusLabel(report.status)}
              {report.penalty ? <span className="table__note">Penalty: {report.penalty}</span> : null}
            </dd>
          </div>
        ) : null}
        <div className="facts__wide">
          <dt>Description</dt>
          <dd className="plain-text">{report.description || <span className="muted">No description</span>}</dd>
        </div>
        <div className="facts__wide">
          <dt>Discord thread</dt>
          <dd>{report.threadName || <span className="muted">Not known</span>}</dd>
        </div>
      </dl>

      <div className="stack stack--tight">
        <h3 className="section-title">Evidence</h3>
        {report.evidenceUrl ? <EvidenceLink url={report.evidenceUrl} label="Open evidence link" /> : <p className="muted">No evidence link was given.</p>}
        {report.evidenceImg ? <EvidenceImage url={report.evidenceImg} /> : <p className="muted">No evidence image was attached.</p>}
      </div>
    </Card>
  )
}
