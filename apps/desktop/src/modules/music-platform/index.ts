export {
  getPlatformCompatContract,
  getPlatformCompatRegistryRecord,
  getPlatformCompatRuntimeApi,
  listPlatformCompatContracts,
  listPlatformCompatRegistryRecords,
  reconcileBuiltinPlatformCompatRegistrations,
  registerPlatformCompatContract,
  subscribePlatformCompatContracts,
  subscribePlatformCompatRegistry,
  unregisterPlatformCompatContract,
  type PlatformCompatRegistryRecord,
  type RegisterPlatformCompatContractInput,
} from './contractRegistry';

export {
  getPlatformInstance,
  listPlatformInstances,
  refreshPlatformInstance,
  removePlatformInstance,
  subscribePlatformInstances,
  upsertPlatformInstance,
} from './instanceRegistry';

export {
  getPlatformRenderSelection,
  listPlatformRenderSelections,
  removePlatformRenderSelection,
  setPlatformRenderSelectionMounted,
  subscribePlatformRenderSelections,
  upsertPlatformRenderSelection,
} from './renderSelectionRegistry';

export {
  beginPlatformQrLogin,
  beginBilibiliQrLogin,
  clearPlatformConnectorCookies,
  emitPlatformConnectorAuthChanged,
  getPlatformConnectorAuthSnapshot,
  getBilibiliConnectorAuthSnapshot,
  getPlatformConnectorDefinition,
  listPlatformConnectorAdapters,
  listPlatformConnectorDefinitions,
  listPlatformConnectorAuthSnapshots,
  logoutPlatformConnector,
  logoutBilibiliConnector,
  pollPlatformQrLogin,
  pollBilibiliQrLogin,
  refreshAndEmitPlatformConnectorAuthSnapshot,
  refreshAndEmitBilibiliConnectorAuthSnapshot,
  registerPlatformConnectorAdapter,
  unregisterPlatformConnectorAdapter,
  resolvePlatformConnectorTemplate,
  createPassivePlatformConnectorAdapter,
  createPlatformCompatRuntimeFromConnectorAdapter,
  registerPlatformCompatRegistrationForConnector,
  unregisterPlatformCompatRegistrationForConnector,
  getBuiltinPlatformCompatContractRegistration,
  listBuiltinPlatformCompatRegistrations,
  subscribePlatformConnectorDefinitions,
  subscribePlatformConnectorCompatRegistrations,
  subscribePlatformConnectorAuthChanged,
  PLATFORM_CONNECTOR_AUTH_CHANGED_EVENT,
  type BuiltinPlatformCompatRegistration,
  type PlatformConnectorAdapter,
  type PlatformConnectorDefinition,
  type PlatformConnectorAvailability,
  type PlatformConnectorTemplate,
  type PlatformConnectorWorkspaceKind,
  type PlatformConnectorWorkspaceMode,
  type PlatformQrLoginPollResult,
  type PlatformQrLoginSession,
  type BilibiliQrLoginPollResult,
  type BilibiliQrLoginSession,
  type NeteaseQrLoginPollResult,
  type NeteaseQrLoginSession,
  type PlatformConnectorAuthSnapshot,
  type PlatformConnectorAuthState,
  type PlatformConnectorId,
} from './connectorAuth';

export {
  installPlatformPackFromFile,
  installPlatformPackFromZipBytes,
  listPlatformPackRegistrations,
  removePlatformPackRegistration,
  subscribePlatformPackRegistrations,
  type PlatformPackRegistrationRecord,
} from './platformPackRegistry';

export {
  createDefaultPlatformLoginRegistry,
  persistPlatformLoginRegistry,
  readPlatformLoginRegistry,
  removePlatformLoginRegistryEntry,
  sanitizePlatformLoginRegistry,
  setPlatformLoginRegistryEntryEnabled,
  subscribePlatformLoginRegistry,
  upsertPlatformLoginRegistryEntry,
  type PlatformLoginRegistryEntry,
} from './platformLoginRegistry';

export {
  pickMusicPlatformGlobalCacheDirectory,
} from './cacheDirectoryPicker';

export {
  getMusicPlatformGlobalCacheSettings,
  setMusicPlatformGlobalCacheSettings,
  type MusicPlatformGlobalCacheSettings,
} from './globalSettings';

export {
  listBilibiliFavoriteFolders,
  listBilibiliFavoriteResources,
  listBilibiliRecommendedResources,
  searchBilibiliResources,
  listBilibiliPlaybackQualities,
  prepareBilibiliCachedPlayback,
  resolveBilibiliCoverAssetUrl,
  resolveBilibiliLyricLocator,
  searchBilibiliResourceByBvid,
  type BilibiliFavoriteFolderItem,
  type BilibiliFavoriteResourceItem,
  type BilibiliFavoriteResourcePage,
  type BilibiliPreparedPlayback,
  type BilibiliPlaybackQualityOption,
  type BilibiliLyricLocatorResolved,
} from './bilibiliFacade';

export {
  clearNeteaseFacadeCaches,
  listNeteasePlaylistTracks,
  listNeteaseRecommendedPlaylists,
  listNeteaseRecommendedSongs,
  listNeteaseUserPlaylists,
  prepareNeteaseCachedPlayback,
  searchNeteaseSongs,
  type NeteasePreparedPlayback,
  type NeteaseRecommendedPlaylistItem,
  type NeteaseSongItem,
  type NeteaseSongPage,
  type NeteaseUserPlaylistItem,
} from './neteaseFacade';

export {
  listPlatformConnectorFacadeItems,
  searchPlatformTracks,
  type PlatformConnectorFacadeItem,
  type PlatformTrackSearchOptions,
  type PlatformTrackSearchResult,
} from './platformFacade';

export type {
  PlatformApiResult,
  PlatformCompatContractFile,
  PlatformCompatRuntimeApi,
  PlatformInstanceRecord,
  PlatformRenderSelectionRecord,
} from '@pixel-matrix/plugin-platform-contracts';
