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
      listRecommendedPlaylists: (input) => recommendations('listRecommendedPlaylists', input),
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
