export const RELEASES_OWNER: string
export const RELEASES_REPO: string
export const FORBIDDEN_IN_BUILD: readonly string[]
export function checkPublishConfig(yamlText: string): string[]
export function findForbidden(files: Iterable<readonly [string, string]>): string[]
