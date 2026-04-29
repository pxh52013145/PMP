use tauri::AppHandle;

#[derive(Clone)]
pub(crate) enum MusicPlatformRuntimeHost {
    TauriApp(AppHandle),
}

pub(crate) struct MusicPlatformRuntimePathResolver<'a> {
    host: &'a MusicPlatformRuntimeHost,
}

impl MusicPlatformRuntimeHost {
    pub(crate) fn from_app_handle(app: &AppHandle) -> Self {
        Self::TauriApp(app.clone())
    }

    pub(crate) fn path_resolver(&self) -> MusicPlatformRuntimePathResolver<'_> {
        MusicPlatformRuntimePathResolver { host: self }
    }

    fn app_data_dir(&self) -> Option<std::path::PathBuf> {
        match self {
            Self::TauriApp(app) => app.path_resolver().app_data_dir(),
        }
    }
}

impl MusicPlatformRuntimePathResolver<'_> {
    pub(crate) fn app_data_dir(&self) -> Option<std::path::PathBuf> {
        self.host.app_data_dir()
    }
}
