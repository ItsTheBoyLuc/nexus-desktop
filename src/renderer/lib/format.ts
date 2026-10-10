/** "in 2d 5h" style countdown from whole hours (the backend sends countdown_hours). */
export function formatCountdown(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return 'now'
  if (hours < 1) return 'in less than an hour'
  if (hours < 48) return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return rest === 0 ? `in ${days} days` : `in ${days}d ${rest}h`
}

/** "1 tier" / "3 tiers". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** A timestamp from the server as local date and time; the raw text when it cannot be read (never throws). */
export function formatWhen(timestamp: string): string {
  const time = Date.parse(timestamp)
  if (Number.isNaN(time)) return timestamp
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Just the date part of a timestamp ("12 Oct 2026"); the raw text when it cannot be read. */
export function formatDay(timestamp: string): string {
  const time = Date.parse(timestamp)
  if (Number.isNaN(time)) return timestamp
  return new Date(time).toLocaleDateString(undefined, { dateStyle: 'medium' })
}
