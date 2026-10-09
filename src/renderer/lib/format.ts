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
