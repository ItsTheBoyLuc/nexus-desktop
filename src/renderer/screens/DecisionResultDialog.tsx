import type { DecisionResult } from '../../shared/types'
import { Button, CopyButton, Modal, Notice } from '../components'
import { describePointsOutcome, describeWarning } from '../lib/decisionFlow'

/** After a decision: what the server did, in the words of the server's answer (nothing is invented). */
export function DecisionResultDialog({ result, onClose }: { result: DecisionResult; onClose: () => void }) {
  const penalty = result.decision === 'penalty_issued'
  const pointsLines = describePointsOutcome(result)
  const { points } = result
  return (
    <Modal
      open
      title="Decision recorded"
      onClose={onClose}
      footer={
        <Button data-autofocus onClick={onClose}>
          Close
        </Button>
      }
    >
      <p>
        Report <strong>#{result.report.number}</strong> ({result.report.roundKey}, {result.report.circuit}) is now <strong>{penalty ? 'Penalty issued' : 'No further action'}</strong>. The report message in Discord was updated and its buttons were removed.
      </p>
      {pointsLines.length > 0 ? (
        <ul className="plain-list">
          {pointsLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {points.banNotice && points.banNoticePosted ? <Notice tone="info">A ban threshold was reached: the automatic ban notice was posted in the report&apos;s thread.</Notice> : null}
      {points.banNotice && !points.banNoticePosted ? (
        <Notice tone="warning" action={<CopyButton text={points.banNotice} label="Copy the text" what="The ban notice" />}>
          <strong>A ban threshold was reached, but the ban notice was not posted in the report thread.</strong> Nothing has been announced in Discord about this ban. The text, for you to post:
          <blockquote className="ban-notice">{points.banNotice}</blockquote>
        </Notice>
      ) : null}

      {result.warnings.map((warning) => (
        <Notice key={warning} tone="warning">
          {describeWarning(warning)}
        </Notice>
      ))}

      <p className="muted">
        This is the answer to this one decision. Afterwards the report only shows its status: the API does not return the explanation of a decision or the points it awarded, so the full decision text stays in the Discord report message.
      </p>
    </Modal>
  )
}
