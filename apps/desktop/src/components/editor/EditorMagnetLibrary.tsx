import {
  useState,
  useCallback,
  useMemo,
  memo,
  useEffect,
  useDeferredValue,
  isValidElement,
  type ReactNode,
} from 'react';
import { Magnet, type PixelAnchor } from '../../types/pixel';
import { useEditor } from '../../contexts/EditorContext';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  setupConfigSync,
  broadcastDataUpdate,
} from '../../utils/windowCommunication';
import { readJson, removeKey, writeJson, writeString } from '../../modules/storage';
import { getMagnetPreviewNode, getMagnetRenderer } from '../../magnet-system/registry';
import { MATRIX_CONFIG } from '../../constants/config';
import {
  createMagnetTemplateFromPlugin,
  installPmpmPluginFromFilePath,
  loadInstalledPmpmPlugins,
  parsePmpmPluginFromFilePath,
  uninstallPmpmPlugin,
  type InstalledPmpmPlugin,
} from '../../magnet-system/plugins/pmpm';
import { DEFAULT_ACTIVE_MAGNET_IDS, REQUIRED_MAGNET_IDS } from '../../constants/magnets';
import {
  createDefaultMagnetSpacesState,
  ensureMagnetSpaceLayout,
  magnetLayoutStoreGetState,
  sanitizeMagnetSpacesState,
} from '../../modules/magnets';
import {
  buildMagnetPlacementCandidates,
  findFirstMagnetPlacementCandidate,
  getOccupiedPixelKeys,
  magnetHasPlacementConflict,
  type MagnetPlacementCandidate,
} from '../../utils/magnetPlacement';
import { useConfirmDialog } from '../core/ConfirmDialog';
import { useT } from '../../i18n';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import './EditorMagnetLibrary.css';

interface EditorMagnetLibraryProps {
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
  builtInMagnetIds: Set<string>;
  onMagnetAddToLibrary: (magnet: Magnet) => void;
  onMagnetActivate: (magnetId: string, options?: { anchors?: PixelAnchor[] }) => void;
  onMagnetDeactivate: (magnetId: string) => void;
  onMagnetDeleteFromLibrary: (magnetId: string) => void;
}

type ViewMode = 'active' | 'inactive';
type FilterMode = 'all' | 'builtin' | 'custom';

function estimateMagnetPixelCount(magnet: Magnet): number {
  const anchors = magnet.anchors ?? [];
  const footprint = magnet.gridFootprint;

  if (anchors.length === 0) {
    if (!footprint) return magnet.anchorType === 'single' ? 1 : 0;
    const width = Math.max(1, Math.round(footprint.width));
    const height = Math.max(1, Math.round(footprint.height));
    switch (magnet.anchorType) {
      case 'single':
        return 1;
      case 'horizontal':
        return width;
      case 'vertical':
        return height;
      case 'rectangular':
        return width * height;
      default:
        return 0;
    }
  }

  let minX = anchors[0].gridX;
  let maxX = anchors[0].gridX;
  let minY = anchors[0].gridY;
  let maxY = anchors[0].gridY;

  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i];
    if (a.gridX < minX) minX = a.gridX;
    if (a.gridX > maxX) maxX = a.gridX;
    if (a.gridY < minY) minY = a.gridY;
    if (a.gridY > maxY) maxY = a.gridY;
  }

  const width = Math.max(0, maxX - minX + 1);
  const height = Math.max(0, maxY - minY + 1);

  switch (magnet.anchorType) {
    case 'single':
      return 1;
    case 'horizontal':
      return width;
    case 'vertical':
      return height;
    case 'rectangular':
      return width * height;
    default:
      return 0;
  }
}

export const EditorMagnetLibrary = memo(function EditorMagnetLibrary({
  magnetLibrary,
  activeMagnetIds,
  builtInMagnetIds,
  onMagnetAddToLibrary,
  onMagnetActivate,
  onMagnetDeactivate,
  onMagnetDeleteFromLibrary,
}: EditorMagnetLibraryProps) {
  const { importMagnet: validateAndImportMagnet } = useEditor();
  const t = useT();
  const isTauri = useMemo(() => isTauriRuntime(), []);

  const formatRendererGroup = useCallback(
    (group: string) => {
      const key = `magnet.groups.${group}`;
      const translated = t(key);
      return translated === key ? group : translated;
    },
    [t]
  );
  const [viewMode, setViewMode] = useState<ViewMode>('active');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [showImport, setShowImport] = useState(false);
  const [importData, setImportData] = useState('');
  const [importError, setImportError] = useState('');
  const [creatorWindowOpen, setCreatorWindowOpen] = useState(false); // 默认为 false，避免误判
  const [glitchingButton, setGlitchingButton] = useState<string | null>(null);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPmpmPlugin[]>(() =>
    loadInstalledPmpmPlugins()
  );
  const [showPlugins, setShowPlugins] = useState(false);
  const [pluginError, setPluginError] = useState('');
  const [pluginBusy, setPluginBusy] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const readActiveSpaceIdFromStorage = useCallback((): string => {
    const raw = readJson(STORAGE_KEYS.MAGNET_SPACES, createDefaultMagnetSpacesState());
    return sanitizeMagnetSpacesState(raw).activeSpaceId;
  }, []);
  const [placementDialog, setPlacementDialog] = useState<
    | {
        magnetId: string;
        magnetName: string;
        occupiedKeys: Set<string>;
        candidates: MagnetPlacementCandidate[];
        selectedCandidateId: string | null;
      }
    | null
  >(null);

  const closePlacementDialog = useCallback(() => {
    setPlacementDialog(null);
  }, []);

  useEffect(() => {
    if (!placementDialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePlacementDialog();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closePlacementDialog, placementDialog]);

  // 初始化时清理可能残留的窗口状态
  useEffect(() => {
    // 确保初始状态正确（EditorMagnetLibrary 窗口打开时，creator 一定是关闭的）
    const storedValue = readJson<boolean>(STORAGE_KEYS.CREATOR_WINDOW_OPEN, false);
    if (storedValue === true) {
      // 清理残留状态
      writeJson(STORAGE_KEYS.CREATOR_WINDOW_OPEN, false);
    }
    setCreatorWindowOpen(false);
  }, []);

  // 分类 Magnet
  const categorizedMagnets = useMemo(() => {
    const active = magnetLibrary.filter((m) => activeMagnetIds.has(m.id));
    const inactive = magnetLibrary.filter((m) => !activeMagnetIds.has(m.id));

    return {
      active: {
        all: active,
        builtin: active.filter((m) => builtInMagnetIds.has(m.id)),
        custom: active.filter((m) => !builtInMagnetIds.has(m.id)),
      },
      inactive: {
        all: inactive,
        builtin: inactive.filter((m) => builtInMagnetIds.has(m.id)),
        custom: inactive.filter((m) => !builtInMagnetIds.has(m.id)),
      },
    };
  }, [magnetLibrary, activeMagnetIds, builtInMagnetIds]);

  // 当前显示的 Magnet（支持搜索）
  const displayMagnets = useMemo(() => {
    const baseMagnets = categorizedMagnets[viewMode][filterMode];
    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) return baseMagnets;

    return baseMagnets.filter((magnet) => {
      const rendererId = magnet.renderer ?? magnet.id;
      const renderer =
        getMagnetRenderer(rendererId) ?? (rendererId === magnet.id ? null : getMagnetRenderer(magnet.id));
      const searchable: string[] = [
        magnet.id,
        rendererId,
        magnet.name,
        magnet.type,
        magnet.anchorType,
        magnet.description,
        renderer?.description,
        renderer?.group,
        ...(magnet.tags ?? []),
        ...(renderer?.tags ?? []),
      ]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .map((value) => value.toLowerCase());

      return searchable.some((value) => value.includes(normalizedQuery));
    });
  }, [categorizedMagnets, deferredSearchQuery, filterMode, viewMode]);

  // 监听 creator 窗口状态
  useEffect(() => {
    const reloadStatus = () => {
      const isOpen = readJson<boolean>(STORAGE_KEYS.CREATOR_WINDOW_OPEN, false);
      setCreatorWindowOpen(isOpen);
    };

    const cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.CREATOR_WINDOW_OPEN],
      [TAURI_EVENTS.CREATOR_WINDOW_OPENED, TAURI_EVENTS.CREATOR_WINDOW_CLOSED],
      reloadStatus
    );

    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, []);

  const reloadPlugins = useCallback(() => {
    setInstalledPlugins(loadInstalledPmpmPlugins());
  }, []);

  useEffect(() => {
    reloadPlugins();
    const cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.PMPM_PLUGINS],
      [TAURI_EVENTS.PMPM_PLUGINS_UPDATED],
      reloadPlugins
    );
    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [reloadPlugins]);

  // 统计数量
  const counts = useMemo(() => {
    return {
      active: {
        all: categorizedMagnets.active.all.length,
        builtin: categorizedMagnets.active.builtin.length,
        custom: categorizedMagnets.active.custom.length,
      },
      inactive: {
        all: categorizedMagnets.inactive.all.length,
        builtin: categorizedMagnets.inactive.builtin.length,
        custom: categorizedMagnets.inactive.custom.length,
      },
    };
  }, [categorizedMagnets]);

  const requestMagnetPlacement = useCallback(
    async (magnet: Magnet) => {
      const activeMagnets = magnetLibrary.filter((m) => m.id !== magnet.id && activeMagnetIds.has(m.id));
      const occupiedKeys = getOccupiedPixelKeys(activeMagnets);

      let hasStoredAnchors = false;
      if (isTauri) {
        const store = await magnetLayoutStoreGetState();
        const activeSpaceId = store?.spaces.activeSpaceId ?? readActiveSpaceIdFromStorage();
        const layout = store?.layoutsBySpaceId?.[activeSpaceId] ?? null;
        hasStoredAnchors =
          Array.isArray(layout?.anchorsByMagnetId?.[magnet.id]) && layout.anchorsByMagnetId[magnet.id]!.length > 0;
      } else {
        const activeSpaceId = readActiveSpaceIdFromStorage();
        const layout = ensureMagnetSpaceLayout(activeSpaceId, { defaultActiveMagnetIds: DEFAULT_ACTIVE_MAGNET_IDS }).layout;
        hasStoredAnchors = Array.isArray(layout.anchorsByMagnetId?.[magnet.id]) && layout.anchorsByMagnetId[magnet.id]!.length > 0;
      }

      if (!hasStoredAnchors) {
        const candidate = findFirstMagnetPlacementCandidate(magnet, occupiedKeys);
        if (!candidate) {
          await confirm({
            title: t('editor.magnet-library.placement.noSpace.title'),
            message: t('editor.magnet-library.placement.noSpace.message', { name: magnet.name || magnet.id }),
            confirmText: t('common.action.ok'),
          });
          return;
        }
        onMagnetActivate(magnet.id, { anchors: candidate.anchors });
        return;
      }

      if (!isTauri) {
        onMagnetActivate(magnet.id);
        return;
      }

      if (!magnetHasPlacementConflict(magnet, occupiedKeys)) {
        onMagnetActivate(magnet.id);
        return;
      }

      const candidates = buildMagnetPlacementCandidates(magnet, occupiedKeys, {
        maxCandidates: magnet.anchorType === 'horizontal' ? MATRIX_CONFIG.ROWS : 24,
      });

      if (candidates.length === 0) {
        await confirm({
          title: t('editor.magnet-library.placement.noSpace.title'),
          message: t('editor.magnet-library.placement.noSpace.message', { name: magnet.name || magnet.id }),
          confirmText: t('common.action.ok'),
        });
        return;
      }

      setPlacementDialog({
        magnetId: magnet.id,
        magnetName: magnet.name || magnet.id,
        occupiedKeys,
        candidates,
        selectedCandidateId: null,
      });
    },
    [
      activeMagnetIds,
      confirm,
      isTauri,
      magnetLibrary,
      onMagnetActivate,
      readActiveSpaceIdFromStorage,
      t,
    ]
  );

  const placementGridKeys = useMemo(() => {
    const keys: string[] = [];
    for (let y = 0; y < MATRIX_CONFIG.ROWS; y++) {
      for (let x = 0; x < MATRIX_CONFIG.COLUMNS; x++) {
        keys.push(`${x},${y}`);
      }
    }
    return keys;
  }, []);

  const placementCandidateByPixelKey = useMemo(() => {
    if (!placementDialog) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const candidate of placementDialog.candidates) {
      for (const key of candidate.footprintKeys) {
        map.set(key, candidate.id);
      }
    }
    return map;
  }, [placementDialog]);

  const applyPlacementSelection = useCallback(() => {
    if (!placementDialog?.selectedCandidateId) return;
    const selected = placementDialog.candidates.find((candidate) => candidate.id === placementDialog.selectedCandidateId);
    if (!selected) return;
    onMagnetActivate(placementDialog.magnetId, { anchors: selected.anchors });
    closePlacementDialog();
  }, [closePlacementDialog, onMagnetActivate, placementDialog]);

  // 处理编辑
  const handleEdit = useCallback(
    async (magnet: Magnet) => {
      // 如果 creator 窗口已打开，触发故障动画
      if (creatorWindowOpen) {
        setGlitchingButton(magnet.id);
        setTimeout(() => setGlitchingButton(null), 500);
        return;
      }

      try {
        // 将要编辑的 magnet 存储到 localStorage（临时数据，不需要广播）
        writeJson(STORAGE_KEYS.MAGNET_EDITOR_DATA, magnet);
        writeString(STORAGE_KEYS.MAGNET_EDITOR_MODE, 'edit');

        // 标记窗口打开
        await broadcastDataUpdate(
          STORAGE_KEYS.CREATOR_WINDOW_OPEN,
          true,
          TAURI_EVENTS.CREATOR_WINDOW_OPENED
        );

        // 立即同步更新本地状态，不等待异步监听器
        setCreatorWindowOpen(true);

        // 打开 creator 窗口
        const { openEditorWindow, calculateWindowPosition } = await import(
          '../../utils/editorWindows'
        );
        const position = await calculateWindowPosition('creator');
        await openEditorWindow({
          type: 'creator',
          ...position,
        });
      } catch (error) {
        console.error('Failed to open editor window:', error);
        // 出错时清除标记
        await broadcastDataUpdate(
          STORAGE_KEYS.CREATOR_WINDOW_OPEN,
          false,
          TAURI_EVENTS.CREATOR_WINDOW_CLOSED
        );
        // 同步更新本地状态
        setCreatorWindowOpen(false);
      }
    },
    [creatorWindowOpen]
  );

  // 处理导入
  const handleImport = useCallback(() => {
    setImportError('');

    try {
      const parsed = JSON.parse(importData);

      // 检查 ID 冲突（在调用 validateAndImportMagnet 前检查，因为它不检查 library 冲突）
      if (magnetLibrary.some((m) => m.id === parsed.id)) {
        throw new Error(t('editor.magnet-library.import.error.idExists', { id: parsed.id }));
      }

      // 使用 EditorContext 的完整验证逻辑
      const result = validateAndImportMagnet(parsed);

      if (!result.valid) {
        // 验证失败，显示错误
        const errorMessage = result.errors.join('\n');
        setImportError(errorMessage);
        return;
      }

      if (!result.magnet) {
        setImportError(t('editor.magnet-library.import.error.emptyMagnet'));
        return;
      }

      // 验证成功，添加到 library
      onMagnetAddToLibrary(result.magnet);
      setImportData('');
      setShowImport(false);

      // 如果有警告信息（例如自动移动位置），显示给用户
      if (result.warnings.length > 0) {
        alert(
          t('editor.magnet-library.import.successWithWarnings', {
            id: result.magnet.id,
            warnings: result.warnings.join('\n'),
          })
        );
      } else {
        alert(t('editor.magnet-library.import.success', { id: result.magnet.id }));
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        setImportError(t('editor.magnet-library.import.error.invalidJson'));
      } else {
        setImportError(
          error instanceof Error ? error.message : t('editor.magnet-library.import.error.failed')
        );
      }
    }
  }, [importData, magnetLibrary, onMagnetAddToLibrary, t, validateAndImportMagnet]);

  const handleImportPmpmPlugin = useCallback(async () => {
    if (pluginBusy) return;
    setPluginBusy(true);
    setPluginError('');

    try {
      const dialog = await import('@tauri-apps/api/dialog');
      const selected = await dialog.open({
        multiple: false,
        filters: [{ name: t('editor.magnet-library.plugins.fileFilter.pmpm'), extensions: ['pmpm'] }],
      });

      if (!selected) return;
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof filePath !== 'string') {
        throw new Error(t('editor.magnet-library.plugins.import.invalidFilePath'));
      }

      const plugin = await parsePmpmPluginFromFilePath(filePath);
      const meta = plugin.manifest.metadata;
      const permissions = plugin.manifest.permissions ?? [];
      const isUpdate = installedPlugins.some((p) => p.manifest.metadata.id === meta.id);

      if (!isUpdate && magnetLibrary.some((m) => m.id === meta.id)) {
        throw new Error(t('editor.magnet-library.plugins.import.idExists', { id: meta.id }));
      }

      const confirmText = [
        t('editor.magnet-library.plugins.install.summaryTitle', { name: meta.name }),
        `${meta.id}@${meta.version}`,
        meta.author ? t('editor.magnet-library.plugins.install.author', { author: meta.author }) : null,
        meta.description
          ? t('editor.magnet-library.plugins.install.description', { description: meta.description })
          : null,
        '',
        t('editor.magnet-library.plugins.install.permissionsTitle'),
        permissions.length > 0
          ? permissions.map((p) => `- ${p}`).join('\n')
          : t('editor.magnet-library.plugins.install.permissionsNone'),
        '',
        plugin.entrySha256 ? `entrySha256: ${plugin.entrySha256}` : null,
        '',
        t('editor.magnet-library.plugins.install.confirmQuestion'),
      ]
        .filter((line): line is string => typeof line === 'string' && line.length > 0)
        .join('\n');

      const ok = await confirm({
        title: t('editor.magnet-library.plugins.install.confirmTitle'),
        message: confirmText,
        confirmText: t('common.action.install'),
        cancelText: t('common.action.cancel'),
      });
      if (!ok) return;

      await installPmpmPluginFromFilePath(filePath);
      reloadPlugins();

      if (!magnetLibrary.some((m) => m.id === meta.id)) {
        onMagnetAddToLibrary(createMagnetTemplateFromPlugin(plugin));
      }

      setShowPlugins(true);
      alert(t('editor.magnet-library.plugins.install.installed', { id: meta.id }));
    } catch (error) {
      setPluginError(error instanceof Error ? error.message : String(error));
    } finally {
      setPluginBusy(false);
    }
  }, [confirm, installedPlugins, magnetLibrary, onMagnetAddToLibrary, pluginBusy, reloadPlugins, t]);

  const handleUninstallPmpmPlugin = useCallback(
    async (id: string) => {
      if (pluginBusy) return;
      setPluginBusy(true);
      setPluginError('');

      try {
        if (activeMagnetIds.has(id)) {
          alert(t('editor.magnet-library.plugins.uninstall.mustDeactivate', { id }));
          return;
        }

        const ok = await confirm({
          title: t('editor.magnet-library.plugins.uninstall.confirmTitle'),
          message: t('editor.magnet-library.plugins.uninstall.confirmMessage', { id }),
          confirmText: t('common.action.uninstall'),
          cancelText: t('common.action.cancel'),
          danger: true,
        });
        if (!ok) return;

        uninstallPmpmPlugin(id);
        reloadPlugins();

        if (magnetLibrary.some((m) => m.id === id)) {
          onMagnetDeleteFromLibrary(id);
        }
      } catch (error) {
        setPluginError(error instanceof Error ? error.message : String(error));
      } finally {
        setPluginBusy(false);
      }
    },
    [activeMagnetIds, confirm, magnetLibrary, onMagnetDeleteFromLibrary, pluginBusy, reloadPlugins, t]
  );

  return (
    <div className="editor-magnet-library">
      {/* 拖动标题栏 */}
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          ⋮⋮
        </span>
      </div>
      {/* 内容区域 */}
      <div className="editor-window-content">
        {/* 顶部固定：按钮区域 */}
        <div className="library-header-fixed">
          {/* 第一行：视图切换（已使用/未使用） */}
          <div className="library-view-selector">
            <button
              className={`view-btn ${viewMode === 'active' ? 'active' : ''}`}
              onClick={() => setViewMode('active')}
            >
              {t('editor.magnet-library.view.active', { count: counts.active.all })}
            </button>
            <button
              className={`view-btn ${viewMode === 'inactive' ? 'active' : ''}`}
              onClick={() => setViewMode('inactive')}
            >
              {t('editor.magnet-library.view.inactive', { count: counts.inactive.all })}
            </button>
          </div>

          {/* 第二行：过滤器（全部/内置/自定义） */}
          <div className="library-filter-row">
            <button
              className={`filter-btn ${filterMode === 'all' ? 'active' : ''}`}
              onClick={() => setFilterMode('all')}
            >
              {t('editor.magnet-library.filter.all', { count: counts[viewMode].all })}
            </button>
            <button
              className={`filter-btn ${filterMode === 'builtin' ? 'active' : ''}`}
              onClick={() => setFilterMode('builtin')}
            >
              {t('editor.magnet-library.filter.builtin', { count: counts[viewMode].builtin })}
            </button>
            <button
              className={`filter-btn ${filterMode === 'custom' ? 'active' : ''}`}
              onClick={() => setFilterMode('custom')}
            >
              {t('editor.magnet-library.filter.custom', { count: counts[viewMode].custom })}
            </button>
          </div>

          {/* 第三行：搜索 */}
          <div className="library-search-row">
            <input
              className="library-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('editor.magnet-library.search.placeholder')}
            />
            {searchQuery.trim().length > 0 && (
                <button
                  className="library-search-clear-btn"
                  onClick={() => setSearchQuery('')}
                  title={t('editor.magnet-library.search.clearTitle')}
                >
                  ×
                </button>
              )}
            <div className="library-search-count" title={t('editor.magnet-library.search.countTitle')}>
              {displayMagnets.length}
            </div>
          </div>
        </div>

        {/* 导入区域 */}
        {showImport && (
          <div className="import-section">
            <div className="import-label">{t('editor.magnet-library.import.label')}</div>
            <textarea
              className="import-textarea"
              value={importData}
              onChange={(e) => setImportData(e.target.value)}
              placeholder={t('editor.magnet-library.import.placeholder')}
            />
            {importError && <div className="import-error">❌ {importError}</div>}
            <div className="import-actions">
              <button className="import-submit-btn" onClick={handleImport}>
                {t('editor.magnet-library.import.action.importToLibrary')}
              </button>
              <div className="import-hint">{t('editor.magnet-library.import.hint')}</div>
            </div>
          </div>
        )}

        {/* Magnet 列表 */}
        <div className="magnet-list">
          <div className="import-section" style={{ marginBottom: 6 }}>
            <div className="import-label">{t('editor.magnet-library.plugins.title')}</div>
            {pluginError && <div className="import-error">⚠ {pluginError}</div>}
            <div className="import-actions">
              <button
                className="import-submit-btn"
                onClick={() => void handleImportPmpmPlugin()}
                disabled={pluginBusy}
              >
                {t('editor.magnet-library.plugins.action.import')}
              </button>
              <button
                className="import-submit-btn"
                style={{ background: 'rgba(255, 255, 255, 0.12)' }}
                onClick={() => setShowPlugins((prev) => !prev)}
              >
                {showPlugins
                  ? t('editor.magnet-library.plugins.action.hideInstalledWithCount', {
                      count: installedPlugins.length,
                    })
                  : t('editor.magnet-library.plugins.action.showInstalledWithCount', {
                      count: installedPlugins.length,
                    })}
              </button>
            </div>

            {showPlugins && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {installedPlugins.length === 0 ? (
                  <div className="import-hint">{t('editor.magnet-library.plugins.empty')}</div>
                ) : (
                  installedPlugins.map((plugin) => {
                    const { id, name, version } = plugin.manifest.metadata;
                    const permissions = plugin.manifest.permissions ?? [];
                    const isActive = activeMagnetIds.has(id);
                    return (
                      <div
                        key={id}
                        style={{
                          padding: 10,
                          border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: 8,
                          background: 'rgba(0,0,0,0.2)',
                          display: 'flex',
                          gap: 10,
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                            {name} <span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.55)' }}>({id}@{version})</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                            {permissions.length > 0
                              ? t('editor.magnet-library.plugins.permissions', {
                                  permissions: permissions.join(', '),
                                })
                              : t('editor.magnet-library.plugins.permissionsEmpty')}
                          </div>
                          {plugin.entrySha256 && (
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                              entrySha256: {plugin.entrySha256.slice(0, 12)}…
                            </div>
                          )}
                        </div>

                        <button
                          className="import-submit-btn"
                          style={{
                            background: isActive ? 'rgba(255, 69, 58, 0.35)' : 'rgba(255, 69, 58, 0.9)',
                          }}
                          disabled={pluginBusy || isActive}
                          onClick={() => void handleUninstallPmpmPlugin(id)}
                          title={
                            isActive
                              ? t('editor.magnet-library.plugins.tooltip.uninstall.disabled')
                              : t('editor.magnet-library.plugins.tooltip.uninstall')
                          }
                        >
                          {t('common.action.uninstall')}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {displayMagnets.length === 0 ? (
            <div className="empty-state">
              {viewMode === 'active'
                ? t('editor.magnet-library.empty.active')
                : t('editor.magnet-library.empty.inactive')}
              {filterMode !== 'all' && (
                <div className="empty-hint">{t('editor.magnet-library.empty.hint')}</div>
              )}
            </div>
          ) : (
            displayMagnets.map((magnet) => {
              const isBuiltIn = builtInMagnetIds.has(magnet.id);
              const isActive = activeMagnetIds.has(magnet.id);
              const isRequired = REQUIRED_MAGNET_IDS.has(magnet.id);
              const pixelCount = estimateMagnetPixelCount(magnet);

              const rendererId = magnet.renderer ?? magnet.id;
              const renderer =
                getMagnetRenderer(rendererId) ??
                (rendererId === magnet.id ? null : getMagnetRenderer(magnet.id));
              const rendererGroup = renderer?.group;
              const rendererDescription = renderer?.description;

              const registryPreview = getMagnetPreviewNode(magnet);
              let previewContent: ReactNode = registryPreview ?? null;
              if (!previewContent) {
                const content = magnet.content;
                if (typeof content === 'string' || typeof content === 'number') {
                  previewContent = content;
                } else if (isValidElement(content)) {
                  previewContent = content;
                } else if (content === null || content === undefined) {
                  previewContent = magnet.name || magnet.id;
                } else {
                  previewContent = `[${magnet.name || magnet.id}]`;
                }
              }

              return (
                <div key={magnet.id} className="magnet-item">
                  <div
                    className="magnet-preview"
                    style={{
                      backgroundColor: magnet.style.backgroundColor,
                      color: magnet.style.color,
                      borderRadius: magnet.style.borderRadius,
                      border: magnet.style.border,
                    }}
                  >
                    {previewContent}
                  </div>
                  <div className="magnet-info">
                    <div className="magnet-name">{magnet.name || magnet.id}</div>
                    <div className="magnet-id">{magnet.id}</div>
                    {rendererDescription && (
                      <div className="magnet-description">{rendererDescription}</div>
                    )}
                    <div className="magnet-meta">
                      {rendererGroup && <span className="magnet-group">{formatRendererGroup(rendererGroup)}</span>}
                      <span className="magnet-type">{magnet.type}</span>
                      <span className="magnet-anchor">{magnet.anchorType}</span>
                      <span className="magnet-pixels">
                        {t('editor.magnet-library.magnet.pixels', { count: pixelCount })}
                      </span>
                      {isRequired && (
                        <span className="magnet-badge builtin">
                          {t('editor.magnet-library.badge.required')}
                        </span>
                      )}
                      {isBuiltIn && (
                        <span className="magnet-badge builtin">
                          {t('editor.magnet-library.badge.builtin')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="magnet-actions">
                    {/* 编辑 */}
                    <button
                      className={`magnet-action-btn edit ${creatorWindowOpen ? 'disabled' : ''} ${glitchingButton === magnet.id ? 'glitch' : ''}`}
                      onClick={() => handleEdit(magnet)}
                      title={
                        creatorWindowOpen
                          ? t('editor.magnet-library.magnet.tooltip.creatorWindowOpen')
                          : t('editor.magnet-library.magnet.tooltip.edit')
                      }
                      data-text="◈"
                    >
                      ◈
                    </button>

                    {/* 添加/移除 */}
                    {isActive ? (
                      <button
                        className="magnet-action-btn remove"
                        onClick={() => onMagnetDeactivate(magnet.id)}
                        disabled={isRequired}
                        title={
                          isRequired
                            ? t('editor.magnet-library.magnet.tooltip.cannotRemoveRequired')
                            : t('editor.magnet-library.magnet.tooltip.removeFromMatrix')
                        }
                      >
                        －
                      </button>
                    ) : (
                      <button
                        className="magnet-action-btn add"
                        onClick={() => void requestMagnetPlacement(magnet)}
                        title={t('editor.magnet-library.magnet.tooltip.addToMatrix')}
                      >
                        ＋
                      </button>
                    )}

                    {/* 删除（仅自定义 Magnet，且在未使用状态） */}
                    {!isBuiltIn && !isActive && (
                      <button
                        className="magnet-action-btn delete"
                        onClick={() => onMagnetDeleteFromLibrary(magnet.id)}
                        title={t('editor.magnet-library.magnet.tooltip.deleteFromLibrary')}
                      >
                        ╳
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 底部固定：创建/导入按钮 */}
        <div className="library-footer-fixed">
          <button
            className="create-import-btn"
            onClick={async () => {
              // 如果 creator 窗口已打开，不执行
              if (creatorWindowOpen) {
                return;
              }

              try {
                writeString(STORAGE_KEYS.MAGNET_EDITOR_MODE, 'create');
                removeKey(STORAGE_KEYS.MAGNET_EDITOR_DATA);

                // 标记窗口打开
                await broadcastDataUpdate(
                  STORAGE_KEYS.CREATOR_WINDOW_OPEN,
                  true,
                  TAURI_EVENTS.CREATOR_WINDOW_OPENED
                );

                // 立即同步更新本地状态
                setCreatorWindowOpen(true);

                const { openEditorWindow, calculateWindowPosition } = await import(
                  '../../utils/editorWindows'
                );
                const position = await calculateWindowPosition('creator');
                await openEditorWindow({
                  type: 'creator',
                  ...position,
                });
              } catch (error) {
                console.error('Failed to open creator window:', error);
                // 出错时清除标记
                await broadcastDataUpdate(
                  STORAGE_KEYS.CREATOR_WINDOW_OPEN,
                  false,
                  TAURI_EVENTS.CREATOR_WINDOW_CLOSED
                );
                // 同步更新本地状态
                setCreatorWindowOpen(false);
              }
            }}
          >
            {t('editor.magnet-library.action.createOrImport')}
          </button>
        </div>
      </div>{' '}
      {/* 关闭 editor-window-content */}
      {placementDialog && (
        <div className="magnet-placement-overlay" role="dialog" aria-modal="true" onClick={closePlacementDialog}>
          <div className="magnet-placement-modal" onClick={(e) => e.stopPropagation()}>
            <div className="magnet-placement-header">
              <div className="magnet-placement-title">{t('editor.magnet-library.placement.title')}</div>
              <div className="magnet-placement-subtitle">
                {t('editor.magnet-library.placement.subtitle', { name: placementDialog.magnetName })}
              </div>
            </div>

            <div className="magnet-placement-legend">
              <span className="magnet-placement-legend-item magnet-placement-legend-item--occupied">
                {t('editor.magnet-library.placement.legend.occupied')}
              </span>
              <span className="magnet-placement-legend-item magnet-placement-legend-item--candidate">
                {t('editor.magnet-library.placement.legend.candidate')}
              </span>
              <span className="magnet-placement-hint">{t('editor.magnet-library.placement.hint')}</span>
            </div>

            <div
              className="magnet-placement-grid"
              style={{
                gridTemplateColumns: `repeat(${MATRIX_CONFIG.COLUMNS}, 1fr)`,
              }}
            >
              {placementGridKeys.map((key) => {
                const isOccupied = placementDialog.occupiedKeys.has(key);
                const candidateId = placementCandidateByPixelKey.get(key) ?? null;
                const isCandidate = candidateId !== null;
                const isSelected = candidateId !== null && candidateId === placementDialog.selectedCandidateId;
                const className = [
                  'magnet-placement-cell',
                  isOccupied ? 'magnet-placement-cell--occupied' : '',
                  isCandidate ? 'magnet-placement-cell--candidate' : '',
                  isSelected ? 'magnet-placement-cell--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <button
                    key={key}
                    type="button"
                    className={className}
                    onClick={() => {
                      if (!candidateId) return;
                      setPlacementDialog((prev) => (prev ? { ...prev, selectedCandidateId: candidateId } : prev));
                    }}
                    title={key}
                    aria-label={key}
                  />
                );
              })}
            </div>

            <div className="magnet-placement-footer">
              <button type="button" className="magnet-placement-btn" onClick={closePlacementDialog}>
                {t('common.action.cancel')}
              </button>
              <button
                type="button"
                className="magnet-placement-btn magnet-placement-btn--primary"
                onClick={applyPlacementSelection}
                disabled={!placementDialog.selectedCandidateId}
              >
                {t('editor.magnet-library.placement.action.place')}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
});
