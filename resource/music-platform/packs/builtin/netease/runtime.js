function unsupported(message) {
  return {
    auth: {
      async getSnapshot() {
        return {
          ok: false,
          error: {
            code: 'API_UNAVAILABLE',
            message,
          },
        };
      },
    },
    metadata: {
      source: 'platform-pack',
      mode: 'fallback',
    },
  };
}

function normalizeError(error, fallbackMessage) {
  if (error && typeof error === 'object') {
    const code =
      typeof error.code === 'string' && error.code.trim().length > 0
        ? error.code
        : 'API_UNAVAILABLE';
    const message =
      typeof error.message === 'string' && error.message.trim().length > 0
        ? error.message
        : fallbackMessage;
    return {
      code,
      message,
      details: error.details,
    };
  }

  return {
    code: 'API_UNAVAILABLE',
    message: fallbackMessage,
  };
}

function createBindingInvoker(context, bindingKey) {
  return async (method, input = {}) => {
    if (!context || typeof context.invokeBinding !== 'function') {
      return {
        ok: false,
        error: {
          code: 'API_UNAVAILABLE',
          message: 'Platform pack binding bridge is unavailable',
        },
      };
    }

    try {
      const result = await context.invokeBinding(bindingKey, method, input);
      if (result && result.ok) {
        return {
          ok: true,
          data: result.data,
        };
      }

      return {
        ok: false,
        error: normalizeError(
          result && typeof result === 'object' ? result.error : null,
          `Platform pack binding ${bindingKey}.${method} failed`
        ),
      };
    } catch (error) {
      return {
        ok: false,
        error: normalizeError(error, `Platform pack binding ${bindingKey}.${method} crashed`),
      };
    }
  };
}

export function createRuntimeApi(context) {
  if (!context || typeof context.invokeBinding !== 'function') {
    return unsupported('Default platform pack runtime bridge is unavailable');
  }

  const auth = createBindingInvoker(context, 'auth');
  const library = createBindingInvoker(context, 'library');
  const recommendations = createBindingInvoker(context, 'recommendations');
  const search = createBindingInvoker(context, 'search');
  const quality = createBindingInvoker(context, 'quality');
  const pages = createBindingInvoker(context, 'pages');

  return {
    auth: {
      getSnapshot: (input) => auth('getSnapshot', input),
      refreshSnapshot: (input) => auth('refreshSnapshot', input),
      beginQrLogin: (input) => auth('beginQrLogin', input),
      pollQrLogin: (input) => auth('pollQrLogin', input),
      logout: (input) => auth('logout', input),
      clearAuthCookies: (input) => auth('clearAuthCookies', input),
    },
    library: {
      listCollections: (input) => library('listCollections', input),
      listResources: (input) => library('listResources', input),
      listPlaylistTracks: (input) => library('listPlaylistTracks', input),
      createPlaylist: (input) => library('createPlaylist', input),
      deletePlaylist: (input) => library('deletePlaylist', input),
      addTrackToPlaylist: (input) => library('addTrackToPlaylist', input),
      removeTrackFromPlaylist: (input) => library('removeTrackFromPlaylist', input),
      preparePlayback: (input) => library('preparePlayback', input),
      resolveLyricLocator: (input) => library('resolveLyricLocator', input),
      resolveCoverAssetUrl: (input) => library('resolveCoverAssetUrl', input),
    },
    recommendations: {
      listDaily: (input) => recommendations('listDaily', input),
      listRecommendedSongs: (input) => recommendations('listRecommendedSongs', input),
      listRecommendedPlaylists: (input) =>
        recommendations('listRecommendedPlaylists', input),
    },
    search: {
      query: (input) => search('query', input),
      resolveLocator: (input) => search('resolveLocator', input),
      preparePlayback: (input) => search('preparePlayback', input),
    },
    quality: {
      listOptions: (input) => quality('listOptions', input),
      getCurrent: (input) => quality('getCurrent', input),
      setPreferred: (input) => quality('setPreferred', input),
    },
    pages: {
      getWorkspaceModel: (input) => pages('getWorkspaceModel', input),
      listPages: (input) => pages('listPages', input),
    },
    metadata: {
      source: 'platform-pack',
      mode: 'binding-runtime',
    },
  };
}

const WORKSPACE_CAPABILITY_ID = 'host.pmp.music-platform.workspace';
const CONNECTOR_AUTH_CAPABILITY_ID = 'host.pmp.connector-auth';
const I18N_CAPABILITY_ID = 'host.pmp.i18n';
const DEFAULT_LOCALE = 'zh-CN';
const STYLE_ID = 'netease-pack-workspace-style';
const MAX_RENDERED_PAGE_COUNT = 8;
const MAX_RENDERED_COLLECTION_COUNT = 48;
const MAX_RENDERED_RESOURCE_COUNT = 80;
const MAX_RENDERED_QUALITY_OPTION_COUNT = 12;

const MESSAGES = {
  'zh-CN': {
    title: '网易云音乐 Pack Workspace',
    subtitle: 'Provider-owned workspace UI mounted through the host runtime bridge.',
    authAuthorized: '已授权',
    authUnauthorized: '未授权',
    authPending: '登录中',
    authExpired: '已过期',
    authRevoked: '已撤销',
    authError: '异常',
    authUnknown: '未知状态',
    authAvailability: '可用性',
    authAccount: '账号',
    authRefresh: '刷新状态',
    authHint:
      '登录入口仍由 host 侧 p-login 持有。若这里显示未授权，请先用平台登录磁贴完成扫码登录。',
    tabRecommended: '推荐',
    tabLibrary: '歌单',
    tabSearch: '搜索',
    searchPlaceholder: '搜索歌曲、歌单或关键词',
    searchAction: '搜索',
    searchIdle: '输入关键词后可直接走 pack workspace provider API 搜索。',
    collectionsTitle: '我的歌单',
    recommendedCollectionsTitle: '推荐歌单',
    tracksTitle: '资源列表',
    qualityTitle: '播放质量',
    qualityEmpty: '当前 provider 没有返回质量选项。',
    preparedTitle: '最近一次 Prepare',
    preparedEmpty: '选择一首资源后可触发 preparePlayback，用于验证 provider -> host playback bridge。',
    diagnosticsTitle: '诊断',
    diagnosticsEmpty: '当前没有新的运行时诊断。',
    audioTitle: 'Host Playback',
    audioEmpty: '当前没有活动播放，说明 queue / playback 仍然由 host 持有。',
    loading: '正在加载网易云 pack workspace...',
    emptyCollections: '当前没有可展示的歌单。',
    emptyRecommendedCollections: '当前没有推荐歌单。',
    emptyRecommendedTracks: '当前没有推荐资源。',
    emptyCollectionTracks: '这个歌单目前没有返回资源。',
    emptySearch: '还没有搜索结果。',
    emptyPage: '当前页面没有可展示内容。',
    prepareAction: 'Prepare',
    preparing: 'Preparing...',
    currentQuality: '当前',
    selectedCollection: '当前歌单',
    pageSource: '数据源',
    trackOwner: '作者',
    trackAlbum: '专辑',
    trackLocator: 'Locator',
    preparedCache: '缓存',
    preparedStream: '流地址',
    preparedQuality: '已选质量',
    preparedDuration: '时长',
    diagSource: '来源',
    diagCode: '代码',
    runtimeMounted: 'Pack workspace 已接管 provider 页面渲染。',
  },
  'en-US': {
    title: 'Netease Pack Workspace',
    subtitle: 'Provider-owned workspace UI mounted through the host runtime bridge.',
    authAuthorized: 'Authorized',
    authUnauthorized: 'Unauthorized',
    authPending: 'Pending',
    authExpired: 'Expired',
    authRevoked: 'Revoked',
    authError: 'Error',
    authUnknown: 'Unknown',
    authAvailability: 'Availability',
    authAccount: 'Account',
    authRefresh: 'Refresh',
    authHint:
      'Login stays host-owned in p-login. If this workspace reports unauthorized, complete QR login from the platform login magnet first.',
    tabRecommended: 'Recommended',
    tabLibrary: 'Library',
    tabSearch: 'Search',
    searchPlaceholder: 'Search songs, playlists, or keywords',
    searchAction: 'Search',
    searchIdle: 'Run provider-owned search directly from the pack workspace.',
    collectionsTitle: 'Your Playlists',
    recommendedCollectionsTitle: 'Recommended Playlists',
    tracksTitle: 'Resources',
    qualityTitle: 'Playback Quality',
    qualityEmpty: 'The provider did not return any quality options.',
    preparedTitle: 'Latest Prepare',
    preparedEmpty:
      'Pick a resource to trigger preparePlayback and verify the provider -> host playback bridge.',
    diagnosticsTitle: 'Diagnostics',
    diagnosticsEmpty: 'No new runtime diagnostics.',
    audioTitle: 'Host Playback',
    audioEmpty: 'No active playback. Queue and playback still stay host-owned.',
    loading: 'Loading the Netease pack workspace...',
    emptyCollections: 'No playlists are available yet.',
    emptyRecommendedCollections: 'No recommended playlists are available yet.',
    emptyRecommendedTracks: 'No recommended resources are available yet.',
    emptyCollectionTracks: 'This playlist has no resources yet.',
    emptySearch: 'No search results yet.',
    emptyPage: 'Nothing to display for this page yet.',
    prepareAction: 'Prepare',
    preparing: 'Preparing...',
    currentQuality: 'Current',
    selectedCollection: 'Active Playlist',
    pageSource: 'Source',
    trackOwner: 'Owner',
    trackAlbum: 'Album',
    trackLocator: 'Locator',
    preparedCache: 'Cache',
    preparedStream: 'Stream',
    preparedQuality: 'Selected Quality',
    preparedDuration: 'Duration',
    diagSource: 'Source',
    diagCode: 'Code',
    runtimeMounted: 'The pack workspace now owns provider page rendering.',
  },
};

const WORKSPACE_STYLES = `
.netease-pack-workspace {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 18px;
  gap: 14px;
  background:
    radial-gradient(circle at top left, rgba(255, 107, 135, 0.18), transparent 32%),
    linear-gradient(180deg, rgba(19, 19, 26, 0.97), rgba(8, 8, 12, 0.98));
  color: #f8f8fc;
  font-family: "Segoe UI", "PingFang SC", sans-serif;
}

.netease-pack-banner,
.netease-pack-card,
.netease-pack-list-item,
.netease-pack-tab,
.netease-pack-search,
.netease-pack-quality-select,
.netease-pack-action {
  box-sizing: border-box;
}

.netease-pack-banner,
.netease-pack-card,
.netease-pack-tab,
.netease-pack-search,
.netease-pack-quality-select {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(18px);
}

.netease-pack-banner {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(260px, 1fr);
  gap: 16px;
  padding: 18px;
  border-radius: 20px;
}

.netease-pack-title {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
}

.netease-pack-subtitle {
  margin: 8px 0 0;
  color: rgba(248, 248, 252, 0.72);
  font-size: 13px;
  line-height: 1.5;
}

.netease-pack-badges,
.netease-pack-meta-list,
.netease-pack-diagnostic-meta,
.netease-pack-track-meta,
.netease-pack-prepared-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.netease-pack-badge,
.netease-pack-meta-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 12px;
}

.netease-pack-badge--ok {
  background: rgba(67, 214, 117, 0.2);
  color: #99f0af;
}

.netease-pack-badge--warn {
  background: rgba(255, 199, 90, 0.18);
  color: #ffd48e;
}

.netease-pack-badge--error {
  background: rgba(255, 119, 119, 0.18);
  color: #ffafaf;
}

.netease-pack-banner-copy {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.netease-pack-banner-side {
  display: flex;
  flex-direction: column;
  gap: 10px;
  justify-content: space-between;
}

.netease-pack-banner-note {
  margin: 0;
  color: rgba(248, 248, 252, 0.72);
  font-size: 12px;
  line-height: 1.6;
}

.netease-pack-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.netease-pack-tab {
  border-radius: 999px;
  border: 0;
  padding: 10px 14px;
  color: rgba(248, 248, 252, 0.78);
  cursor: pointer;
}

.netease-pack-tab--active {
  background: linear-gradient(135deg, rgba(255, 107, 135, 0.4), rgba(255, 107, 135, 0.15));
  color: #fff;
  border-color: rgba(255, 107, 135, 0.4);
}

.netease-pack-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
}

.netease-pack-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  border-radius: 16px;
  padding: 10px;
}

.netease-pack-search-input,
.netease-pack-quality-select {
  width: 100%;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.24);
  color: #fff;
  padding: 10px 12px;
}

.netease-pack-search-input::placeholder {
  color: rgba(248, 248, 252, 0.4);
}

.netease-pack-grid {
  display: grid;
  grid-template-columns: minmax(220px, 0.85fr) minmax(0, 1.8fr) minmax(250px, 0.95fr);
  gap: 14px;
  min-height: 0;
  flex: 1;
}

.netease-pack-column {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

.netease-pack-card {
  border-radius: 18px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.netease-pack-card-title {
  font-size: 13px;
  color: rgba(248, 248, 252, 0.64);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.netease-pack-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.netease-pack-list-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
}

.netease-pack-list-item--active {
  border-color: rgba(255, 107, 135, 0.42);
  background: rgba(255, 107, 135, 0.1);
}

.netease-pack-list-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.netease-pack-list-title {
  font-size: 14px;
  line-height: 1.35;
  word-break: break-word;
}

.netease-pack-list-subtitle {
  font-size: 12px;
  color: rgba(248, 248, 252, 0.62);
  word-break: break-word;
}

.netease-pack-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.netease-pack-action {
  border: 0;
  border-radius: 12px;
  padding: 10px 12px;
  background: linear-gradient(135deg, #ff6b87, #ff8d6b);
  color: #fff;
  cursor: pointer;
  font-weight: 600;
}

.netease-pack-action--secondary {
  background: rgba(255, 255, 255, 0.08);
  font-weight: 500;
}

.netease-pack-action:disabled {
  opacity: 0.55;
  cursor: default;
}

.netease-pack-empty {
  padding: 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(248, 248, 252, 0.62);
  line-height: 1.6;
}

.netease-pack-prepared-list {
  flex-direction: column;
}

.netease-pack-prepared-item {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 8px;
  font-size: 12px;
}

.netease-pack-prepared-label {
  color: rgba(248, 248, 252, 0.5);
}

.netease-pack-prepared-value {
  color: rgba(248, 248, 252, 0.88);
  word-break: break-word;
}

.netease-pack-diagnostic {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
}

.netease-pack-diagnostic-title {
  font-size: 13px;
  word-break: break-word;
}

.netease-pack-diagnostic-meta {
  font-size: 11px;
  color: rgba(248, 248, 252, 0.56);
}

.netease-pack-runtime-note {
  color: rgba(248, 248, 252, 0.64);
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 1100px) {
  .netease-pack-banner,
  .netease-pack-grid {
    grid-template-columns: 1fr;
  }
}
`;

function normalizeLocale(value) {
  return value === 'en-US' ? 'en-US' : DEFAULT_LOCALE;
}

function formatMessage(template, params) {
  if (!params || typeof params !== 'object') {
    return template;
  }

  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(params, key)) {
      return `{${key}}`;
    }
    const value = params[key];
    return value == null ? '' : String(value);
  });
}

function translate(locale, key, params) {
  const bundle = MESSAGES[normalizeLocale(locale)] || MESSAGES[DEFAULT_LOCALE];
  const template =
    (bundle && Object.prototype.hasOwnProperty.call(bundle, key) && bundle[key]) ||
    (MESSAGES[DEFAULT_LOCALE] && MESSAGES[DEFAULT_LOCALE][key]) ||
    key;
  return formatMessage(String(template), params);
}

function createElement(doc, tagName, className, textContent) {
  const node = doc.createElement(tagName);
  if (className) {
    node.className = className;
  }
  if (typeof textContent !== 'undefined') {
    node.textContent = String(textContent);
  }
  return node;
}

function appendChildren(parent, children) {
  children.forEach((child) => {
    if (!child) return;
    parent.appendChild(child);
  });
  return parent;
}

function clearNode(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function injectStyles(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) {
    return;
  }
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = WORKSPACE_STYLES;
  doc.head.appendChild(style);
}

async function invokeCapability(api, capabilityId, method, payload) {
  if (!api || !api.host || typeof api.host.invokeCapability !== 'function') {
    throw new Error(`Host capability bridge is unavailable for ${capabilityId}.${method}`);
  }

  const result = await api.host.invokeCapability(capabilityId, method, payload);
  if (result && result.ok) {
    return result.data;
  }

  const normalized = normalizeError(
    result && typeof result === 'object' ? result.error : null,
    `Host capability ${capabilityId}.${method} failed`
  );
  const error = new Error(normalized.message);
  error.code = normalized.code;
  error.details = normalized.details;
  throw error;
}

function createDiagnosticEntry(source, error) {
  const normalized = normalizeError(error, `${source} failed`);
  return {
    id: `${source}:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`,
    source,
    code: normalized.code,
    message: normalized.message,
  };
}

function createDiagnosticMessageEntry(source, code, message) {
  return {
    id: `${source}:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`,
    source,
    code,
    message,
  };
}

function normalizeObjectArray(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
}

function trimArrayForRender(items, limit, onTrimmed) {
  const normalized = normalizeObjectArray(items);
  if (normalized.length <= limit) {
    return normalized;
  }

  if (typeof onTrimmed === 'function') {
    onTrimmed(normalized.length, limit);
  }

  return normalized.slice(0, limit);
}

function normalizeWorkspacePagesForRender(items, onTrimmed) {
  const normalized = trimArrayForRender(items, MAX_RENDERED_PAGE_COUNT, onTrimmed).filter(
    (item) => typeof item.pageId === 'string' && item.pageId.trim().length > 0
  );
  return normalized;
}

function normalizeCollectionsForRender(items, onTrimmed) {
  return trimArrayForRender(items, MAX_RENDERED_COLLECTION_COUNT, onTrimmed).filter(
    (item) => typeof item.collectionId === 'string' && item.collectionId.trim().length > 0
  );
}

function normalizeResourcePageForRender(page, onTrimmed) {
  if (!page || typeof page !== 'object' || Array.isArray(page)) {
    return null;
  }

  const items = trimArrayForRender(page.items, MAX_RENDERED_RESOURCE_COUNT, onTrimmed).filter(
    (item) =>
      typeof item.resourceId === 'string' &&
      item.resourceId.trim().length > 0 &&
      typeof item.sourceLocator === 'string' &&
      item.sourceLocator.trim().length > 0
  );
  const total =
    typeof page.total === 'number' && Number.isFinite(page.total) && page.total > 0
      ? page.total
      : items.length;
  const pageSize =
    typeof page.pageSize === 'number' && Number.isFinite(page.pageSize) && page.pageSize > 0
      ? page.pageSize
      : Math.max(items.length, 1);

  return {
    ...page,
    items,
    total,
    pageSize,
    hasMore: page.hasMore === true || total > items.length,
  };
}

function normalizeQualityStateForRender(state, onTrimmed) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return null;
  }

  const options = trimArrayForRender(
    state.options,
    MAX_RENDERED_QUALITY_OPTION_COUNT,
    onTrimmed
  ).filter((item) => typeof item.key === 'string' && item.key.trim().length > 0);

  return {
    ...state,
    options,
  };
}

function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return '--:--';
  }
  const totalSeconds = Math.floor(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function readAudioTrack(audioState) {
  if (!audioState || typeof audioState !== 'object') {
    return null;
  }
  return audioState.currentTrack || audioState.track || null;
}

function buildAudioRenderSignature(audioState) {
  const track = readAudioTrack(audioState);
  const trackId =
    track &&
    typeof track === 'object' &&
    (track.resourceId || track.id || track.sourceLocator || track.title || '');
  const title =
    track && typeof track === 'object' && typeof track.title === 'string' ? track.title : '';
  const artist =
    track && typeof track === 'object'
      ? track.artist || track.artistNames || track.ownerName || ''
      : '';
  const playbackState =
    audioState &&
    typeof audioState === 'object' &&
    typeof audioState.playbackState === 'string'
      ? audioState.playbackState
      : '';

  return [playbackState, trackId || '', title, artist].join('\u001f');
}

function readAuthLabelKey(authState) {
  switch (String(authState || '').trim().toLowerCase()) {
    case 'authorized':
      return 'authAuthorized';
    case 'pending':
      return 'authPending';
    case 'expired':
      return 'authExpired';
    case 'revoked':
      return 'authRevoked';
    case 'error':
      return 'authError';
    case 'unauthorized':
      return 'authUnauthorized';
    default:
      return 'authUnknown';
  }
}

function readBadgeClass(authState) {
  switch (String(authState || '').trim().toLowerCase()) {
    case 'authorized':
      return 'netease-pack-badge netease-pack-badge--ok';
    case 'pending':
    case 'expired':
      return 'netease-pack-badge netease-pack-badge--warn';
    case 'error':
    case 'revoked':
      return 'netease-pack-badge netease-pack-badge--error';
    default:
      return 'netease-pack-badge';
  }
}

function normalizeMountTarget(api, pageId) {
  const snapshot =
    api &&
    api.host &&
    typeof api.host.getViewMountRequestSnapshot === 'function'
      ? api.host.getViewMountRequestSnapshot()
      : null;
  const mountMetadata =
    snapshot && typeof snapshot === 'object' && snapshot.mountMetadata
      ? snapshot.mountMetadata
      : null;
  const connectorId =
    mountMetadata && typeof mountMetadata.connectorId === 'string'
      ? mountMetadata.connectorId
      : '';
  const instanceId =
    mountMetadata && typeof mountMetadata.instanceId === 'string'
      ? mountMetadata.instanceId
      : undefined;

  if (!connectorId) {
    throw new Error(
      'Netease workspace mount metadata is missing connectorId, so the pack cannot resolve provider-scoped APIs.'
    );
  }

  return {
    connectorId,
    instanceId,
    rootViewId:
      mountMetadata &&
      mountMetadata.root &&
      typeof mountMetadata.root.viewId === 'string'
        ? mountMetadata.root.viewId
        : pageId || 'netease.workspace.root',
  };
}

function defaultPageItems(locale) {
  return [
    {
      pageId: 'recommended',
      kind: 'recommended',
      title: translate(locale, 'tabRecommended'),
      enabled: true,
    },
    {
      pageId: 'instance',
      kind: 'workspace',
      title: translate(locale, 'tabLibrary'),
      enabled: true,
    },
    {
      pageId: 'search',
      kind: 'search',
      title: translate(locale, 'tabSearch'),
      enabled: true,
    },
  ];
}

function selectInitialPage(state) {
  const enabledPages = (state.pages || []).filter((item) => item && item.enabled !== false);
  if (enabledPages.some((item) => item.pageId === state.activePageId)) {
    return state.activePageId;
  }
  if (state.model && typeof state.model.defaultPageId === 'string') {
    return state.model.defaultPageId;
  }
  return enabledPages[0] ? enabledPages[0].pageId : 'recommended';
}

export function mountPage(container, api, pageId) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new Error('Netease workspace mountPage requires a DOM container');
  }

  const doc = container.ownerDocument || document;
  injectStyles(doc);

  const target = normalizeMountTarget(api, pageId);
  const root = createElement(doc, 'div', 'netease-pack-workspace');
  clearNode(container);
  container.appendChild(root);

  let disposed = false;
  let collectionRequestId = 0;
  let searchRequestId = 0;
  let renderQueued = false;
  let renderTimer = 0;
  let audioRenderSignature = '';
  let renderFailureReported = false;

  const state = {
    locale: DEFAULT_LOCALE,
    loading: true,
    model: null,
    pages: defaultPageItems(DEFAULT_LOCALE),
    activePageId: 'recommended',
    auth: null,
    authRefreshing: false,
    collections: [],
    selectedCollectionId: '',
    collectionResources: null,
    collectionLoading: false,
    recommendedCollections: [],
    recommendedResources: null,
    searchQuery: '',
    searchResults: null,
    searchLoading: false,
    qualityState: null,
    qualityUpdating: false,
    preparedPlayback: null,
    preparedResourceTitle: '',
    preparingSourceLocator: '',
    diagnostics: [],
    audioState:
      api && api.audio && typeof api.audio.getState === 'function'
        ? api.audio.getState()
        : null,
  };

  audioRenderSignature = buildAudioRenderSignature(state.audioState);

  const t = (key, params) => translate(state.locale, key, params);

  const pushDiagnosticMessage = (source, code, message) => {
    state.diagnostics = [
      createDiagnosticMessageEntry(source, code, message),
      ...state.diagnostics,
    ].slice(0, 6);
  };

  const pushDiagnostic = (source, error) => {
    state.diagnostics = [createDiagnosticEntry(source, error), ...state.diagnostics].slice(0, 6);
  };

  const pushTrimmedPayloadDiagnostic = (source, label, receivedCount, limit) => {
    pushDiagnosticMessage(
      source,
      'PAYLOAD_TRUNCATED',
      `${label} trimmed to the first ${limit} items (received ${receivedCount}).`
    );
  };

  const cancelScheduledRender = () => {
    if (!renderTimer) {
      return;
    }
    const view = doc.defaultView;
    if (view && typeof view.cancelAnimationFrame === 'function') {
      view.cancelAnimationFrame(renderTimer);
    } else {
      clearTimeout(renderTimer);
    }
    renderTimer = 0;
  };

  const renderRuntimeFailure = (error) => {
    const normalized = normalizeError(error, 'Workspace render failed');
    clearNode(root);
    const card = createElement(doc, 'section', 'netease-pack-card');
    card.appendChild(createElement(doc, 'div', 'netease-pack-card-title', t('diagnosticsTitle')));
    card.appendChild(
      createElement(doc, 'div', 'netease-pack-diagnostic-title', normalized.message)
    );
    const meta = createElement(doc, 'div', 'netease-pack-diagnostic-meta');
    meta.appendChild(createElement(doc, 'span', '', `${t('diagSource')}: render`));
    meta.appendChild(createElement(doc, 'span', '', `${t('diagCode')}: ${normalized.code}`));
    card.appendChild(meta);
    root.appendChild(card);
  };

  const performRender = () => {
    renderQueued = false;
    renderTimer = 0;
    if (disposed) {
      return;
    }

    try {
      render();
      renderFailureReported = false;
    } catch (error) {
      if (!renderFailureReported) {
        pushDiagnostic('music-platform.workspace.render', error);
        renderFailureReported = true;
      }
      renderRuntimeFailure(error);
    }
  };

  const safeRender = () => {
    if (disposed || renderQueued) {
      return;
    }

    renderQueued = true;
    const view = doc.defaultView;
    if (view && typeof view.requestAnimationFrame === 'function') {
      renderTimer = view.requestAnimationFrame(() => {
        performRender();
      });
      return;
    }

    renderTimer = setTimeout(() => {
      performRender();
    }, 0);
  };

  const callWorkspace = async (method, payload) =>
    invokeCapability(api, WORKSPACE_CAPABILITY_ID, method, {
      connectorId: target.connectorId,
      instanceId: target.instanceId,
      ...payload,
    });

  const refreshAuth = async (forceRefresh) => {
    state.authRefreshing = true;
    safeRender();
    try {
      const payload = await invokeCapability(api, CONNECTOR_AUTH_CAPABILITY_ID, 'getAuthSnapshot', {
        connectorId: target.connectorId,
        instanceId: target.instanceId,
        refresh: forceRefresh === true,
      });
      state.auth = payload && payload.snapshot ? payload.snapshot : null;
    } catch (error) {
      pushDiagnostic('connector-auth.getAuthSnapshot', error);
    } finally {
      state.authRefreshing = false;
      safeRender();
    }
  };

  const loadCollection = async (collectionId) => {
    const normalizedCollectionId =
      typeof collectionId === 'string' ? collectionId.trim() : '';
    if (!normalizedCollectionId) {
      state.collectionResources = null;
      safeRender();
      return;
    }

    const requestId = ++collectionRequestId;
    state.selectedCollectionId = normalizedCollectionId;
    state.collectionLoading = true;
    safeRender();

    try {
      const payload = await callWorkspace('listCollectionResources', {
        collectionId: normalizedCollectionId,
      });
      if (disposed || requestId !== collectionRequestId) {
        return;
      }
      state.collectionResources = normalizeResourcePageForRender(
        payload && payload.page ? payload.page : null,
        (receivedCount, limit) => {
          pushTrimmedPayloadDiagnostic(
            'music-platform.workspace.listCollectionResources',
            'Playlist resources',
            receivedCount,
            limit
          );
        }
      );
    } catch (error) {
      if (!disposed && requestId === collectionRequestId) {
        state.collectionResources = null;
        pushDiagnostic('music-platform.workspace.listCollectionResources', error);
      }
    } finally {
      if (!disposed && requestId === collectionRequestId) {
        state.collectionLoading = false;
        safeRender();
      }
    }
  };

  const runSearch = async () => {
    const query = String(state.searchQuery || '').trim();
    if (!query) {
      state.searchResults = null;
      safeRender();
      return;
    }

    const requestId = ++searchRequestId;
    state.searchLoading = true;
    safeRender();

    try {
      const payload = await callWorkspace('searchResources', {
        query,
      });
      if (disposed || requestId !== searchRequestId) {
        return;
      }
      state.searchResults = normalizeResourcePageForRender(
        payload && payload.page ? payload.page : null,
        (receivedCount, limit) => {
          pushTrimmedPayloadDiagnostic(
            'music-platform.workspace.searchResources',
            'Search results',
            receivedCount,
            limit
          );
        }
      );
    } catch (error) {
      if (!disposed && requestId === searchRequestId) {
        state.searchResults = null;
        pushDiagnostic('music-platform.workspace.searchResources', error);
      }
    } finally {
      if (!disposed && requestId === searchRequestId) {
        state.searchLoading = false;
        safeRender();
      }
    }
  };

  const updateQualityPreference = async (qualityKey) => {
    const normalizedQualityKey =
      typeof qualityKey === 'string' ? qualityKey.trim() : '';
    if (!normalizedQualityKey) {
      return;
    }

    state.qualityUpdating = true;
    safeRender();
    try {
      const payload = await callWorkspace('setQualityPreference', {
        qualityKey: normalizedQualityKey,
      });
      state.qualityState =
        normalizeQualityStateForRender(payload && payload.state ? payload.state : null) ??
        state.qualityState;
    } catch (error) {
      pushDiagnostic('music-platform.workspace.setQualityPreference', error);
    } finally {
      state.qualityUpdating = false;
      safeRender();
    }
  };

  const prepareResource = async (resource) => {
    if (!resource || typeof resource !== 'object') {
      return;
    }

    const sourceLocator =
      typeof resource.sourceLocator === 'string' ? resource.sourceLocator.trim() : '';
    if (!sourceLocator) {
      pushDiagnostic(
        'music-platform.workspace.preparePlayback',
        new Error('Resource sourceLocator is missing')
      );
      safeRender();
      return;
    }

    state.preparingSourceLocator = sourceLocator;
    safeRender();
    try {
      const payload = await callWorkspace('preparePlayback', {
        sourceLocator,
        qualityHint:
          state.qualityState && typeof state.qualityState.currentKey === 'string'
            ? state.qualityState.currentKey
            : undefined,
      });
      state.preparedPlayback = payload && payload.prepared ? payload.prepared : null;
      state.preparedResourceTitle =
        typeof resource.title === 'string' ? resource.title : sourceLocator;
    } catch (error) {
      pushDiagnostic('music-platform.workspace.preparePlayback', error);
    } finally {
      state.preparingSourceLocator = '';
      safeRender();
    }
  };

  const loadWorkspace = async () => {
    state.loading = true;
    safeRender();

    try {
      try {
        const localeState = await invokeCapability(api, I18N_CAPABILITY_ID, 'getState');
        state.locale = normalizeLocale(localeState && localeState.activeLocale);
      } catch {
        state.locale = DEFAULT_LOCALE;
      }

      const [
        modelPayload,
        pagesPayload,
        collectionsPayload,
        recommendedCollectionsPayload,
        recommendedResourcesPayload,
        qualityPayload,
      ] = await Promise.all([
        callWorkspace('getWorkspaceModel').catch((error) => {
          pushDiagnostic('music-platform.workspace.getWorkspaceModel', error);
          return null;
        }),
        callWorkspace('listPages').catch((error) => {
          pushDiagnostic('music-platform.workspace.listPages', error);
          return null;
        }),
        callWorkspace('listCollections').catch((error) => {
          pushDiagnostic('music-platform.workspace.listCollections', error);
          return null;
        }),
        callWorkspace('listRecommendedCollections').catch((error) => {
          pushDiagnostic('music-platform.workspace.listRecommendedCollections', error);
          return null;
        }),
        callWorkspace('listRecommendedResources').catch((error) => {
          pushDiagnostic('music-platform.workspace.listRecommendedResources', error);
          return null;
        }),
        callWorkspace('listQualityState').catch((error) => {
          pushDiagnostic('music-platform.workspace.listQualityState', error);
          return null;
        }),
      ]);

      state.model = modelPayload && modelPayload.model ? modelPayload.model : null;
      const defaultPages = defaultPageItems(state.locale);
      const nextPages = normalizeWorkspacePagesForRender(
        pagesPayload && Array.isArray(pagesPayload.items) && pagesPayload.items.length > 0
          ? pagesPayload.items
          : state.model && Array.isArray(state.model.pages) && state.model.pages.length > 0
            ? state.model.pages
            : defaultPages,
        (receivedCount, limit) => {
          pushTrimmedPayloadDiagnostic(
            'music-platform.workspace.listPages',
            'Workspace pages',
            receivedCount,
            limit
          );
        }
      );
      state.pages = nextPages.length > 0 ? nextPages : defaultPages;
      state.activePageId = selectInitialPage(state);
      state.collections = normalizeCollectionsForRender(
        collectionsPayload && Array.isArray(collectionsPayload.items)
          ? collectionsPayload.items
          : [],
        (receivedCount, limit) => {
          pushTrimmedPayloadDiagnostic(
            'music-platform.workspace.listCollections',
            'Collections',
            receivedCount,
            limit
          );
        }
      );
      state.recommendedCollections = normalizeCollectionsForRender(
        recommendedCollectionsPayload &&
          Array.isArray(recommendedCollectionsPayload.items)
          ? recommendedCollectionsPayload.items
          : [],
        (receivedCount, limit) => {
          pushTrimmedPayloadDiagnostic(
            'music-platform.workspace.listRecommendedCollections',
            'Recommended collections',
            receivedCount,
            limit
          );
        }
      );
      state.recommendedResources = normalizeResourcePageForRender(
        recommendedResourcesPayload && recommendedResourcesPayload.page
          ? recommendedResourcesPayload.page
          : null,
        (receivedCount, limit) => {
          pushTrimmedPayloadDiagnostic(
            'music-platform.workspace.listRecommendedResources',
            'Recommended resources',
            receivedCount,
            limit
          );
        }
      );
      state.qualityState = normalizeQualityStateForRender(
        qualityPayload && qualityPayload.state ? qualityPayload.state : null,
        (receivedCount, limit) => {
          pushTrimmedPayloadDiagnostic(
            'music-platform.workspace.listQualityState',
            'Quality options',
            receivedCount,
            limit
          );
        }
      );

      if (!state.selectedCollectionId && state.collections[0]) {
        state.selectedCollectionId = state.collections[0].collectionId;
      }

      if (state.activePageId === 'instance' && state.selectedCollectionId) {
        await loadCollection(state.selectedCollectionId);
      }
    } finally {
      state.loading = false;
      safeRender();
    }
  };

  function createBanner() {
    const track = readAudioTrack(state.audioState);
    const authState = state.auth
      ? state.auth.authState
      : state.authRefreshing || state.loading
        ? 'pending'
        : 'unauthorized';
    const accountLabel =
      (state.auth && (state.auth.accountUid || state.auth.accountName)) ||
      (state.authRefreshing || state.loading ? '...' : '-');

    const title = createElement(doc, 'h1', 'netease-pack-title', t('title'));
    const subtitle = createElement(doc, 'p', 'netease-pack-subtitle', t('subtitle'));
    const runtimeNote = createElement(
      doc,
      'div',
      'netease-pack-runtime-note',
      t('runtimeMounted')
    );

    const badgeRow = createElement(doc, 'div', 'netease-pack-badges');
    badgeRow.appendChild(
      createElement(doc, 'div', readBadgeClass(authState), t(readAuthLabelKey(authState)))
    );
    badgeRow.appendChild(
      createElement(
        doc,
        'div',
        'netease-pack-meta-pill',
        `${t('authAvailability')}: ${state.auth && state.auth.availability ? state.auth.availability : '-'}`
      )
    );
    badgeRow.appendChild(
      createElement(
        doc,
        'div',
        'netease-pack-meta-pill',
        `${t('authAccount')}: ${accountLabel}`
      )
    );

    const bannerCopy = createElement(doc, 'div', 'netease-pack-banner-copy');
    appendChildren(bannerCopy, [title, subtitle, badgeRow, runtimeNote]);

    const bannerSide = createElement(doc, 'div', 'netease-pack-banner-side');
    const qualityText =
      state.qualityState && typeof state.qualityState.currentKey === 'string'
        ? `${t('currentQuality')}: ${state.qualityState.currentLabel || state.qualityState.currentKey}`
        : t('qualityEmpty');
    const audioText = track
      ? `${track.title || 'Unknown'}${track.artist ? ` · ${track.artist}` : ''}`
      : t('audioEmpty');

    const sideMeta = createElement(doc, 'div', 'netease-pack-meta-list');
    sideMeta.appendChild(createElement(doc, 'div', 'netease-pack-meta-pill', qualityText));
    sideMeta.appendChild(createElement(doc, 'div', 'netease-pack-meta-pill', audioText));

    const refreshButton = createElement(
      doc,
      'button',
      'netease-pack-action netease-pack-action--secondary',
      state.authRefreshing ? `${t('authRefresh')}...` : t('authRefresh')
    );
    refreshButton.type = 'button';
    refreshButton.disabled = state.authRefreshing;
    refreshButton.addEventListener('click', () => {
      void refreshAuth(true);
    });

    const authHint = createElement(doc, 'p', 'netease-pack-banner-note', t('authHint'));
    appendChildren(bannerSide, [sideMeta, refreshButton, authHint]);

    return appendChildren(createElement(doc, 'section', 'netease-pack-banner'), [
      bannerCopy,
      bannerSide,
    ]);
  }

  function createTabs() {
    const tabs = createElement(doc, 'div', 'netease-pack-tabs');
    state.pages.forEach((page) => {
      const button = createElement(
        doc,
        'button',
        page.pageId === state.activePageId
          ? 'netease-pack-tab netease-pack-tab--active'
          : 'netease-pack-tab',
        page.title || page.pageId
      );
      button.type = 'button';
      button.disabled = page.enabled === false;
      button.addEventListener('click', () => {
        state.activePageId = page.pageId;
        safeRender();
        if (page.pageId === 'instance' && state.selectedCollectionId && !state.collectionResources) {
          void loadCollection(state.selectedCollectionId);
        }
      });
      tabs.appendChild(button);
    });
    return tabs;
  }

  function createToolbar() {
    const toolbar = createElement(doc, 'div', 'netease-pack-toolbar');
    const form = createElement(doc, 'form', 'netease-pack-search');
    const input = createElement(doc, 'input', 'netease-pack-search-input');
    input.type = 'search';
    input.value = state.searchQuery;
    input.placeholder = t('searchPlaceholder');
    input.addEventListener('input', (event) => {
      state.searchQuery = event.target && typeof event.target.value === 'string'
        ? event.target.value
        : '';
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      state.activePageId = 'search';
      safeRender();
      void runSearch();
    });
    const submit = createElement(doc, 'button', 'netease-pack-action', t('searchAction'));
    submit.type = 'submit';
    submit.disabled = state.searchLoading;
    appendChildren(form, [input, submit]);

    const refresh = createElement(
      doc,
      'button',
      'netease-pack-action netease-pack-action--secondary',
      state.loading ? `${t('loading')}` : t('authRefresh')
    );
    refresh.type = 'button';
    refresh.disabled = state.loading;
    refresh.addEventListener('click', () => {
      void (async () => {
        await refreshAuth(true);
        await loadWorkspace();
      })();
    });

    appendChildren(toolbar, [form, refresh]);
    return toolbar;
  }

  function createCollectionList(title, items, activeCollectionId) {
    const card = createElement(doc, 'section', 'netease-pack-card');
    card.appendChild(createElement(doc, 'div', 'netease-pack-card-title', title));

    if (!Array.isArray(items) || items.length < 1) {
      card.appendChild(
        createElement(
          doc,
          'div',
          'netease-pack-empty',
          title === t('collectionsTitle') ? t('emptyCollections') : t('emptyRecommendedCollections')
        )
      );
      return card;
    }

    const list = createElement(doc, 'div', 'netease-pack-list');
    items.forEach((item) => {
      const button = createElement(
        doc,
        'button',
        item.collectionId === activeCollectionId
          ? 'netease-pack-list-item netease-pack-list-item--active'
          : 'netease-pack-list-item'
      );
      button.type = 'button';
      const copy = createElement(doc, 'div', 'netease-pack-list-copy');
      copy.appendChild(createElement(doc, 'div', 'netease-pack-list-title', item.title || item.collectionId));
      copy.appendChild(
        createElement(
          doc,
          'div',
          'netease-pack-list-subtitle',
          `${item.trackCount || 0} tracks`
        )
      );
      button.appendChild(copy);
      button.addEventListener('click', () => {
        state.activePageId = 'instance';
        safeRender();
        void loadCollection(item.collectionId);
      });
      list.appendChild(button);
    });
    card.appendChild(list);
    return card;
  }

  function createTrackList(title, page, emptyMessage) {
    const card = createElement(doc, 'section', 'netease-pack-card');
    card.appendChild(createElement(doc, 'div', 'netease-pack-card-title', title));

    if (state.loading) {
      card.appendChild(createElement(doc, 'div', 'netease-pack-empty', t('loading')));
      return card;
    }

    if (!page || !Array.isArray(page.items) || page.items.length < 1) {
      card.appendChild(createElement(doc, 'div', 'netease-pack-empty', emptyMessage));
      return card;
    }

    const sourceNote = createElement(
      doc,
      'div',
      'netease-pack-runtime-note',
      `${t('pageSource')}: ${page.sourceKind || '-'} / ${page.sourceId || '-'}`
    );
    card.appendChild(sourceNote);

    const list = createElement(doc, 'div', 'netease-pack-list');
    page.items.forEach((item) => {
      const row = createElement(doc, 'div', 'netease-pack-list-item');
      const copy = createElement(doc, 'div', 'netease-pack-list-copy');
      copy.appendChild(createElement(doc, 'div', 'netease-pack-list-title', item.title || item.resourceId));

      const meta = createElement(doc, 'div', 'netease-pack-track-meta');
      if (item.artistNames) {
        meta.appendChild(createElement(doc, 'span', 'netease-pack-list-subtitle', item.artistNames));
      }
      if (item.albumName) {
        meta.appendChild(createElement(doc, 'span', 'netease-pack-list-subtitle', item.albumName));
      }
      if (item.ownerName) {
        meta.appendChild(createElement(doc, 'span', 'netease-pack-list-subtitle', item.ownerName));
      }
      meta.appendChild(
        createElement(doc, 'span', 'netease-pack-list-subtitle', formatDuration(item.durationSeconds))
      );
      copy.appendChild(meta);
      copy.appendChild(
        createElement(
          doc,
          'div',
          'netease-pack-list-subtitle',
          `${t('trackLocator')}: ${item.sourceLocator || '-'}`
        )
      );

      const prepareButton = createElement(
        doc,
        'button',
        'netease-pack-action',
        state.preparingSourceLocator === item.sourceLocator
          ? t('preparing')
          : t('prepareAction')
      );
      prepareButton.type = 'button';
      prepareButton.disabled = state.preparingSourceLocator === item.sourceLocator;
      prepareButton.addEventListener('click', () => {
        void prepareResource(item);
      });

      appendChildren(row, [copy, prepareButton]);
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  }

  function createMainContent() {
    if (state.activePageId === 'search') {
      return createTrackList(
        t('tracksTitle'),
        state.searchResults,
        state.searchLoading ? t('loading') : state.searchQuery ? t('emptySearch') : t('searchIdle')
      );
    }

    if (state.activePageId === 'instance') {
      const title = state.selectedCollectionId
        ? `${t('selectedCollection')}: ${state.selectedCollectionId}`
        : t('tracksTitle');
      return createTrackList(
        title,
        state.collectionResources,
        state.collectionLoading ? t('loading') : t('emptyCollectionTracks')
      );
    }

    return createTrackList(
      t('tracksTitle'),
      state.recommendedResources,
      t('emptyRecommendedTracks')
    );
  }

  function createQualityCard() {
    const card = createElement(doc, 'section', 'netease-pack-card');
    card.appendChild(createElement(doc, 'div', 'netease-pack-card-title', t('qualityTitle')));

    if (!state.qualityState || !Array.isArray(state.qualityState.options) || state.qualityState.options.length < 1) {
      card.appendChild(createElement(doc, 'div', 'netease-pack-empty', t('qualityEmpty')));
      return card;
    }

    const select = createElement(doc, 'select', 'netease-pack-quality-select');
    state.qualityState.options.forEach((option) => {
      const node = doc.createElement('option');
      node.value = option.key;
      node.textContent = option.label || option.key;
      node.selected = option.key === state.qualityState.currentKey;
      node.disabled = option.available === false;
      select.appendChild(node);
    });
    select.disabled = state.qualityUpdating;
    select.addEventListener('change', (event) => {
      const value =
        event.target && typeof event.target.value === 'string'
          ? event.target.value
          : '';
      void updateQualityPreference(value);
    });

    card.appendChild(select);
    return card;
  }

  function createPreparedCard() {
    const card = createElement(doc, 'section', 'netease-pack-card');
    card.appendChild(createElement(doc, 'div', 'netease-pack-card-title', t('preparedTitle')));

    if (!state.preparedPlayback) {
      card.appendChild(createElement(doc, 'div', 'netease-pack-empty', t('preparedEmpty')));
      return card;
    }

    if (state.preparedResourceTitle) {
      card.appendChild(createElement(doc, 'div', 'netease-pack-list-title', state.preparedResourceTitle));
    }

    const list = createElement(doc, 'div', 'netease-pack-prepared-list');
    const rows = [
      [t('preparedQuality'), state.preparedPlayback.selectedQualityLabel || state.preparedPlayback.selectedQualityKey || '-'],
      [t('preparedDuration'), formatDuration(state.preparedPlayback.durationSeconds)],
      [t('preparedCache'), state.preparedPlayback.cachePath || '-'],
      [t('preparedStream'), state.preparedPlayback.streamUrl || '-'],
    ];

    rows.forEach(([label, value]) => {
      const row = createElement(doc, 'div', 'netease-pack-prepared-item');
      row.appendChild(createElement(doc, 'div', 'netease-pack-prepared-label', label));
      row.appendChild(createElement(doc, 'div', 'netease-pack-prepared-value', value));
      list.appendChild(row);
    });

    card.appendChild(list);
    return card;
  }

  function createDiagnosticsCard() {
    const card = createElement(doc, 'section', 'netease-pack-card');
    card.appendChild(createElement(doc, 'div', 'netease-pack-card-title', t('diagnosticsTitle')));

    if (!Array.isArray(state.diagnostics) || state.diagnostics.length < 1) {
      card.appendChild(createElement(doc, 'div', 'netease-pack-empty', t('diagnosticsEmpty')));
      return card;
    }

    const list = createElement(doc, 'div', 'netease-pack-list');
    state.diagnostics.forEach((item) => {
      const row = createElement(doc, 'div', 'netease-pack-diagnostic');
      row.appendChild(createElement(doc, 'div', 'netease-pack-diagnostic-title', item.message));
      const meta = createElement(doc, 'div', 'netease-pack-diagnostic-meta');
      meta.appendChild(
        createElement(doc, 'span', '', `${t('diagSource')}: ${item.source}`)
      );
      meta.appendChild(
        createElement(doc, 'span', '', `${t('diagCode')}: ${item.code}`)
      );
      row.appendChild(meta);
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  }

  function createAudioCard() {
    const card = createElement(doc, 'section', 'netease-pack-card');
    card.appendChild(createElement(doc, 'div', 'netease-pack-card-title', t('audioTitle')));
    const track = readAudioTrack(state.audioState);
    if (!track) {
      card.appendChild(createElement(doc, 'div', 'netease-pack-empty', t('audioEmpty')));
      return card;
    }
    card.appendChild(createElement(doc, 'div', 'netease-pack-list-title', track.title || 'Unknown'));
    card.appendChild(
      createElement(
        doc,
        'div',
        'netease-pack-list-subtitle',
        `${track.artist || track.artistNames || '-'}`
      )
    );
    card.appendChild(
      createElement(
        doc,
        'div',
        'netease-pack-list-subtitle',
        `${state.audioState && state.audioState.playbackState ? state.audioState.playbackState : '-'}`
      )
    );
    return card;
  }

  function render() {
    clearNode(root);
    appendChildren(root, [createBanner(), createTabs(), createToolbar()]);

    const layout = createElement(doc, 'div', 'netease-pack-grid');
    const left = createElement(doc, 'div', 'netease-pack-column');
    const center = createElement(doc, 'div', 'netease-pack-column');
    const right = createElement(doc, 'div', 'netease-pack-column');

    left.appendChild(
      createCollectionList(t('collectionsTitle'), state.collections, state.selectedCollectionId)
    );
    left.appendChild(
      createCollectionList(
        t('recommendedCollectionsTitle'),
        state.recommendedCollections,
        ''
      )
    );

    center.appendChild(createMainContent());
    right.appendChild(createQualityCard());
    right.appendChild(createPreparedCard());
    right.appendChild(createAudioCard());
    right.appendChild(createDiagnosticsCard());

    appendChildren(layout, [left, center, right]);
    root.appendChild(layout);
  }

  const unsubscribeAudio =
    api &&
    api.audio &&
    typeof api.audio.onStateChange === 'function'
      ? api.audio.onStateChange((nextState) => {
          state.audioState = nextState;
          const nextAudioRenderSignature = buildAudioRenderSignature(nextState);
          if (nextAudioRenderSignature === audioRenderSignature) {
            return;
          }
          audioRenderSignature = nextAudioRenderSignature;
          safeRender();
        })
      : () => {};

  void (async () => {
    // Seed banner/account state from the cached host snapshot first so an already
    // authorized instance does not sit in a long-lived "pending" badge while the
    // slower sidecar refresh repopulates in-memory auth and workspace data.
    await refreshAuth(false);
    await refreshAuth(true);
    await loadWorkspace();
  })().catch((error) => {
    pushDiagnostic('music-platform.workspace.bootstrap', error);
    state.loading = false;
    safeRender();
  });

  performRender();

  return () => {
    disposed = true;
    cancelScheduledRender();
    try {
      unsubscribeAudio();
    } catch {
      // Best-effort cleanup.
    }
    clearNode(container);
  };
}
