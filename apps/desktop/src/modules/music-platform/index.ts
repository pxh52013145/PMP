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
  beginPlatformInstanceQrLogin,
  clearPlatformInstanceAuthCookies,
  getPlatformInstanceAuthSnapshot,
  listPlatformInstanceAuthSnapshots,
  logoutPlatformInstance,
  pollPlatformInstanceQrLogin,
  refreshPlatformInstanceAuthSnapshot,
  resolvePlatformInstanceId,
  type PlatformInstanceAuthSnapshot,
  type PlatformInstanceQrLoginPollResult,
  type PlatformInstanceQrLoginSession,
} from './platformInstanceAuth';

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
  clearPlatformConnectorCookies,
  getPlatformConnectorAuthSnapshot,
  getPlatformConnectorDefinition,
  listPlatformConnectorAdapters,
  listPlatformConnectorDefinitions,
  listPlatformConnectorAuthSnapshots,
  logoutPlatformConnector,
  pollPlatformQrLogin,
  refreshAndEmitPlatformConnectorAuthSnapshot,
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
  type BuiltinPlatformCompatRegistration,
  type PlatformConnectorAdapter,
  type PlatformConnectorDefinition,
  type PlatformConnectorAvailability,
  type PlatformConnectorTemplate,
  type PlatformConnectorWorkspaceKind,
  type PlatformConnectorWorkspaceMode,
  type PlatformQrLoginPollResult,
  type PlatformQrLoginSession,
  type PlatformConnectorAuthSnapshot,
  type PlatformConnectorAuthState,
  type PlatformConnectorId,
} from './connectorAuth';

export {
  awaitBuiltinPlatformPackRegistrationsReady,
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
  preparePlatformPlayback,
  searchPlatformTracks,
  type PlatformPreparedPlayback,
  type PlatformConnectorFacadeItem,
  type PreparePlatformPlaybackOptions,
  type PreparePlatformPlaybackResult,
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
