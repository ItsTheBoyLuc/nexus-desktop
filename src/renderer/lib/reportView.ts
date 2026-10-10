import { DISCORD_CDN } from '../../shared/csp'
import type { Report, ReportStatus } from '../../shared/types'
import { REPORT_STATUSES } from '../../shared/types'

/**
 * How reports are listed, labelled and linked. Free of React so the rules can be tested.
 *
 * Every text of a report (description, driver names, reporter, thread name, links) is untrusted user text:
 * these helpers never build HTML, they only choose labels and decide which links and images are safe to use.
 */

export const STATUS_LABELS: Record<ReportStatus, string> = {
  pending: 'Awaiting review',
  under_investigation: 'Under investigation',
  penalty_issued: 'Penalty issued',
  no_further_action: 'No further action'
}

export function statusLabel(status: ReportStatus): string {
  return STATUS_LABELS[status]
}

/** pending and under-investigation reports can still be decided. */
export function isOpen(report: Pick<Report, 'status' | 'decided'>): boolean {
  return !report.decided && (report.status === 'pending' || report.status === 'under_investigation')
}

export const STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: '' | ReportStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  ...REPORT_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))
]

// ── Table ───────────────────────────────────────────────────────────────────

export type ReportColumn = 'report' | 'circuit' | 'drivers' | 'reporter' | 'status' | 'filed'

const STATUS_ORDER: Record<ReportStatus, number> = { pending: 0, under_investigation: 1, penalty_issued: 2, no_further_action: 3 }

function timeOf(report: Report): number | null {
  const time = Date.parse(report.timestamp)
  return Number.isNaN(time) ? null : time
}

export const REPORT_GETTERS: Record<ReportColumn, (report: Report) => string | number | null> = {
  // "S5R3" then the number inside the round: natural order keeps S5R10 after S5R9, and #2 after #1
  report: (report) => `${report.roundKey} ${String(report.number).padStart(4, '0')}`,
  circuit: (report) => report.circuit,
  drivers: (report) => report.driversInvolved,
  reporter: (report) => report.reporter,
  status: (report) => STATUS_ORDER[report.status],
  filed: timeOf
}

/** Everything the search box looks at: plain text only. */
export function reportSearchFields(report: Report): string[] {
  return [report.roundKey, `#${report.number}`, report.circuit, report.driversInvolved, report.reporter, report.description, STATUS_LABELS[report.status], report.season, report.round]
}

/** Merge a later page into what is already loaded: newest first, a report is never listed twice. */
export function mergeReports(loaded: readonly Report[], more: readonly Report[]): Report[] {
  const seen = new Set(loaded.map((report) => report.id))
  return [...loaded, ...more.filter((report) => !seen.has(report.id))]
}

/** "Max Verstappen, Lando Norris" or "alice and bob" as separate names (used to suggest the driver who gets the points). */
export function splitDrivers(text: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const part of text.split(/,|;|&|\band\b|\n/i)) {
    const name = part.trim().replace(/^@/, '')
    const key = name.toLowerCase()
    if (name === '' || [...name].length > 100 || seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names.slice(0, 10)
}

/** The season of a report as a number, when its text is one (1-99999): the season the points go to unless another is chosen. */
export function seasonFromReport(report: Pick<Report, 'season'>): number | null {
  const text = report.season.trim()
  if (!/^[0-9]{1,5}$/.test(text)) return null
  const season = Number(text)
  return season >= 1 ? season : null
}

// ── Links and images ────────────────────────────────────────────────────────

/** The normalised URL when it is a plain https link (no credentials), else null. Used for every link the app offers to open. */
export function httpsUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw === '' || raw.length > 2048 || /\s/.test(raw)) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.hostname === '' || url.username !== '' || url.password !== '') return null
    return url.href
  } catch {
    return null
  }
}

/**
 * What to do with an evidence image URL. Only https images are ever rendered, and the app's content security policy
 * additionally lets only Discord's own CDN serve images, so anything else is offered as a link instead of an <img>
 * that the browser would block anyway.
 */
export type EvidenceImage =
  | { kind: 'inline'; src: string }
  /** https, but not on the CDN the policy allows: not shown inline. */
  | { kind: 'link-only'; url: string }
  /** Not https (or not a URL): never rendered and never made clickable. */
  | { kind: 'blocked' }
  | { kind: 'none' }

export function evidenceImage(raw: string | null): EvidenceImage {
  if (raw === null || raw === '') return { kind: 'none' }
  const url = httpsUrl(raw)
  if (url === null) return { kind: 'blocked' }
  return new URL(url).origin === DISCORD_CDN ? { kind: 'inline', src: url } : { kind: 'link-only', url }
}
