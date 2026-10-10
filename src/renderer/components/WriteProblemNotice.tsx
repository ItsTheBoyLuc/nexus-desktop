import { RotateCw } from 'lucide-react'
import type { WriteProblem } from '../lib/errors'
import { Button } from './Button'
import { Notice } from './Notice'

interface WriteProblemNoticeProps {
  problem: WriteProblem | null
  /** Re-reads what the server really holds. Offered only when the write may still have happened. */
  onRefresh: () => void
  refreshLabel?: string
}

/** The notice after a failed write. After a lost answer it says the action may already have happened and offers a refresh. */
export function WriteProblemNotice({ problem, onRefresh, refreshLabel = 'Refresh' }: WriteProblemNoticeProps) {
  if (!problem) return null
  return (
    <Notice
      tone="danger"
      action={
        problem.uncertain ? (
          <Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={onRefresh}>
            {refreshLabel}
          </Button>
        ) : undefined
      }
    >
      {problem.text}
    </Notice>
  )
}
