import type { PanelInput, PanelResult } from '../shared/types'
import { ApiError } from './apiClient'
import type { NexusApi } from './nexusApi'
import type { SettingsStore } from './settings'

/**
 * The glue between the sign-up panel API and the panel registry in the settings file.
 *
 * The API cannot find a panel that already exists, so the message id returned by `post-panel` is the
 * only handle to refresh it later. These functions keep that registry in step with what really
 * happened, and only ever change it after the API has confirmed the outcome:
 *   - a successful post / refresh remembers the panel,
 *   - a panel that is gone (deleted message, not ours) or whose tier / game is gone is forgotten,
 *   - a deleted tier or game takes its remembered panels with it,
 *   - a timeout or network failure changes nothing (the outcome is unknown).
 */
type Store = Pick<SettingsStore, 'rememberPanel' | 'forgetPanels'>
type PanelApi = Pick<NexusApi, 'postPanel' | 'deleteGame' | 'deleteTier'>

/** Backend codes that prove a remembered panel can no longer be refreshed. */
const PANEL_GONE_CODES = new Set(['message_not_found', 'not_a_bot_message', 'tier_not_found', 'game_not_found'])

export async function postPanelAndRemember(
  api: PanelApi,
  store: Store,
  guildId: string,
  gameKey: string,
  tierKey: string,
  input: PanelInput
): Promise<PanelResult> {
  try {
    const result = await api.postPanel(guildId, gameKey, tierKey, input)
    store.rememberPanel(guildId, gameKey, tierKey, { messageId: result.messageId, channelId: result.channelId })
    return result
  } catch (error) {
    if (input.messageId !== undefined && error instanceof ApiError && error.kind === 'http' && PANEL_GONE_CODES.has(error.code)) {
      store.forgetPanels(guildId, gameKey, tierKey)
    }
    throw error
  }
}

const isNotFound = (error: unknown, code: string): boolean => error instanceof ApiError && error.kind === 'http' && error.code === code

export async function deleteTierAndForget(api: PanelApi, store: Store, guildId: string, gameKey: string, tierKey: string): Promise<void> {
  try {
    await api.deleteTier(guildId, gameKey, tierKey)
  } catch (error) {
    if (isNotFound(error, 'tier_not_found')) store.forgetPanels(guildId, gameKey, tierKey) // already gone: nothing left to refresh
    throw error
  }
  store.forgetPanels(guildId, gameKey, tierKey)
}

export async function deleteGameAndForget(api: PanelApi, store: Store, guildId: string, gameKey: string): Promise<void> {
  try {
    await api.deleteGame(guildId, gameKey)
  } catch (error) {
    if (isNotFound(error, 'game_not_found')) store.forgetPanels(guildId, gameKey)
    throw error
  }
  store.forgetPanels(guildId, gameKey)
}
