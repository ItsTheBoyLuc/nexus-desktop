export const BUMPS: readonly string[]
export const STEPS: readonly string[]
export function isBump(value: unknown): boolean
export function nextVersion(current: string, bump: string): string
export function checkPreconditions(input: { bump?: unknown; statusOutput?: unknown; branch?: unknown; token?: unknown }): string[]
export function scrub(text: string, secret: unknown): string
