/** IPC channel names: the complete surface between renderer and main. */
export const IPC = {
  authGetState: 'auth:get-state',
  authLogin: 'auth:login',
  authCancel: 'auth:cancel',
  authRetry: 'auth:retry',
  authLogout: 'auth:logout',
  authStateChanged: 'auth:state-changed',

  apiMe: 'api:me',
  apiGuilds: 'api:guilds',
  apiGames: 'api:games',
  apiChannels: 'api:channels',
  apiAnnouncement: 'api:announcement',
  apiRoles: 'api:roles',
  apiOverview: 'api:overview',
  apiServerSettingsGet: 'api:server-settings-get',
  apiServerSettingsPut: 'api:server-settings-put',
  apiLeagueGames: 'api:league-games',
  apiGameCreate: 'api:game-create',
  apiGameSetActive: 'api:game-set-active',
  apiGameDelete: 'api:game-delete',
  apiTierCreate: 'api:tier-create',
  apiTierUpdate: 'api:tier-update',
  apiTierDelete: 'api:tier-delete',
  apiPostPanel: 'api:post-panel',
  apiGetStatus: 'api:get-status',
  apiStatusChanged: 'api:status-changed',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',

  openExternal: 'system:open-external'
} as const
