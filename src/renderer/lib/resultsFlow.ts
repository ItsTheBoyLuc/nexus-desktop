import { findLedgerEntries } from '../../shared/f1Store'
import type { LedgerEntry, Standings, StandingsDriver, StandingsTeam, Team } from '../../shared/types'
import { outcomeUnknown } from './errors'

/**
 * The rules of the "Enter race results" flow, free of React so they can be tested.
 *
 * Recording a race ADDS points every time it is sent: the server stores only running totals, so it cannot tell a
 * repeat, and a lost answer may well have been recorded. Therefore:
 *  - a race already in the local ledger (same server + season + round) gets a stronger warning first,
 *  - after a lost answer the data is never offered for sending again; the only way forward is to look at the standings.
 */

export interface SubmitPlan {
  /** This server + season + round was recorded by this app before. */
  repeat: boolean
  earlier: LedgerEntry[]
}

export function planResultsSubmit(ledger: readonly LedgerEntry[], guildId: string, season: string, round: string): SubmitPlan {
  const earlier = findLedgerEntries(ledger, guildId, season, round)
  return { repeat: earlier.length > 0, earlier }
}

export type ResultsPhase = 'editing' | 'confirming' | 'saving' | 'saved' | 'lost'

export type ResultsAction = 'edit' | 'confirm' | 'cancel' | 'record' | 'refresh-standings' | 'back-to-standings' | 'enter-another'

/**
 * What the user can do in each phase. The important line: in `lost` there is no `record` and no `edit`, only
 * `refresh-standings` (and, after the standings were refreshed, the user starts over with a blank form).
 */
export function availableActions(phase: ResultsPhase): ResultsAction[] {
  switch (phase) {
    case 'editing':
      return ['edit', 'confirm']
    case 'confirming':
      return ['cancel', 'record']
    case 'saving':
      return []
    case 'saved':
      return ['back-to-standings', 'enter-another']
    case 'lost':
      return ['refresh-standings']
  }
}

/** The phase after a failed POST: an unknown outcome locks the form, a definite refusal returns to editing. */
export function phaseAfterFailure(error: unknown): ResultsPhase {
  return outcomeUnknown(error) ? 'lost' : 'editing'
}

/** Which field an `ambiguous_name` answer belongs to: the backend message may name it; otherwise every chosen field gets it. */
export function ambiguousFields(message: string, hasFastestLap: boolean, hasPole: boolean): Array<'fastestLap' | 'pole'> {
  const text = message.toLowerCase()
  const named: Array<'fastestLap' | 'pole'> = []
  if (hasFastestLap && /fastest|\bfl\b/.test(text)) named.push('fastestLap')
  if (hasPole && /\bpole\b/.test(text)) named.push('pole')
  if (named.length > 0) return named
  return [...(hasFastestLap ? (['fastestLap'] as const) : []), ...(hasPole ? (['pole'] as const) : [])]
}

export interface Candidate {
  id: string
  displayName: string
  username: string
}

/** Drivers known without a search: team rosters (with display names), then everyone in the standings. */
export function knownDrivers(teams: readonly Team[], standings: Standings | null): Candidate[] {
  const byId = new Map<string, Candidate>()
  for (const team of teams) for (const driver of team.drivers) byId.set(driver.userId, { id: driver.userId, displayName: driver.displayName, username: driver.username })
  for (const row of standings?.drivers ?? []) if (!byId.has(row.userId)) byId.set(row.userId, { id: row.userId, displayName: row.username, username: row.username })
  return [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
}

/** Move an item one place up or down; out-of-range moves leave the list as it is. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return [...items]
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item as T)
  return next
}

// ── Standings tables ────────────────────────────────────────────────────────

export type DriverStandingColumn = 'position' | 'driver' | 'team' | 'points' | 'wins' | 'podiums' | 'gap'
export type TeamStandingColumn = 'position' | 'team' | 'points' | 'drivers' | 'gap'

export const DRIVER_STANDING_GETTERS: Record<DriverStandingColumn, (row: StandingsDriver) => string | number | null> = {
  position: (row) => row.position,
  driver: (row) => row.username,
  team: (row) => (row.team === '—' ? null : row.team), // drivers without a team sort last
  points: (row) => row.points,
  wins: (row) => row.wins,
  podiums: (row) => row.podiums,
  gap: (row) => row.gap
}

export const TEAM_STANDING_GETTERS: Record<TeamStandingColumn, (row: StandingsTeam) => string | number | null> = {
  position: (row) => row.position,
  team: (row) => row.team,
  points: (row) => row.points,
  drivers: (row) => row.drivers,
  gap: (row) => row.gap
}
