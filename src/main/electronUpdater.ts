import { autoUpdater } from 'electron-updater'
import type { UpdaterLike } from './updateService'

/**
 * The real updater. This file is only ever loaded (dynamically, from index.ts) when the updater is enabled: a packaged, installed Windows
 * build. In development, in `npm run dev:mock` (which has no main process at all) and in the portable build nothing here runs.
 *
 * The feed is NOT set here: the installer carries `app-update.yml`, written by electron-builder from the `publish` block of
 * electron-builder.yml (the public releases-only repository). The renderer cannot influence it, and no token is involved: the repository is public and
 * draft releases are invisible until they are published. The download is checked against the sha512 in the release's latest.yml by
 * electron-updater itself. Nothing here sets `forceDevUpdateConfig`, and nothing logs: the library's own logger is switched off because
 * its messages can contain URLs and parts of responses.
 */
export function createElectronUpdater(): UpdaterLike {
  autoUpdater.logger = null
  return autoUpdater as unknown as UpdaterLike
}
