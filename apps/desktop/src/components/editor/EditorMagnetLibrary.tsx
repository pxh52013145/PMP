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
import { Magnet } from '../../types/pixel';
import { useEditor } from '../../contexts/EditorContext';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  setupConfigSync,
  broadcastDataUpdate,
} from '../../utils/windowCommunication';
import { readJson, writeJson, writeString } from '../../modules/storage';
import { getMagnetPreviewNode, getMagnetRenderer } from '../../magnet-system/registry';
import {
  createMagnetTemplateFromPlugin,
  installPmpmPluginFromFilePath,
  loadInstalledPmpmPlugins,
  parsePmpmPluginFromFilePath,
  uninstallPmpmPlugin,
  type InstalledPmpmPlugin,
} from '../../magnet-system/plugins/pmpm';
import './EditorMagnetLibrary.css';

interface EditorMagnetLibraryProps {
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
  builtInMagnetIds: Set<string>;
  onMagnetAddToLibrary: (magnet: Magnet) => void;
  onMagnetActivate: (magnetId: string) => void;
  onMagnetDeactivate: (magnetId: string) => void;
  onMagnetDeleteFromLibrary: (magnetId: string) => void;
}

type ViewMode = 'active' | 'inactive';
type FilterMode = 'all' | 'builtin' | 'custom';

function estimateMagnetPixelCount(magnet: Magnet): number {
  const anchors = magnet.anchors ?? [];
  if (anchors.length === 0) return 0;

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
        throw new Error(`Magnet ID "${parsed.id}" 已存在，请使用不同的 ID`);
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
        setImportError('验证通过但 Magnet 数据为空');
        return;
      }

      // 验证成功，添加到 library
      onMagnetAddToLibrary(result.magnet);
      setImportData('');
      setShowImport(false);

      // 如果有警告信息（例如自动移动位置），显示给用户
      if (result.warnings.length > 0) {
        alert(`成功导入 Magnet: ${result.magnet.id}\n\n提示：\n${result.warnings.join('\n')}`);
      } else {
        alert(`成功导入 Magnet: ${result.magnet.id}`);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        setImportError('JSON 格式错误，请检查格式');
      } else {
        setImportError(error instanceof Error ? error.message : '导入失败');
      }
    }
  }, [importData, magnetLibrary, onMagnetAddToLibrary, validateAndImportMagnet]);

  const handleImportPmpmPlugin = useCallback(async () => {
    if (pluginBusy) return;
    setPluginBusy(true);
    setPluginError('');

    try {
      const dialog = await import('@tauri-apps/api/dialog');
      const selected = await dialog.open({
        multiple: false,
        filters: [{ name: '.pmpm plugin', extensions: ['pmpm'] }],
      });

      if (!selected) return;
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof filePath !== 'string') {
        throw new Error('无法解析选中的 .pmpm 文件路径');
      }

      const plugin = await parsePmpmPluginFromFilePath(filePath);
      const meta = plugin.manifest.metadata;
      const permissions = plugin.manifest.permissions ?? [];
      const isUpdate = installedPlugins.some((p) => p.manifest.metadata.id === meta.id);

      if (!isUpdate && magnetLibrary.some((m) => m.id === meta.id)) {
        throw new Error(`Magnet ID "${meta.id}" 已存在，无法安装同名插件（请先删除/重命名该 Magnet）`);
      }

      const confirmText = [
        `安装 .pmpm 插件：${meta.name}`,
        `${meta.id}@${meta.version}`,
        meta.author ? `作者：${meta.author}` : null,
        meta.description ? `说明：${meta.description}` : null,
        '',
        '权限声明：',
        permissions.length > 0 ? permissions.map((p) => `- ${p}`).join('\n') : '(无)',
        '',
        plugin.entrySha256 ? `entrySha256: ${plugin.entrySha256}` : null,
        '',
        '确认安装？',
      ]
        .filter((line): line is string => typeof line === 'string' && line.length > 0)
        .join('\n');

      if (!window.confirm(confirmText)) return;

      await installPmpmPluginFromFilePath(filePath);
      reloadPlugins();

      if (!magnetLibrary.some((m) => m.id === meta.id)) {
        onMagnetAddToLibrary(createMagnetTemplateFromPlugin(plugin));
      }

      setShowPlugins(true);
      alert(`插件已安装：${meta.id}`);
    } catch (error) {
      setPluginError(error instanceof Error ? error.message : String(error));
    } finally {
      setPluginBusy(false);
    }
  }, [installedPlugins, magnetLibrary, onMagnetAddToLibrary, pluginBusy, reloadPlugins]);

  const handleUninstallPmpmPlugin = useCallback(
    async (id: string) => {
      if (pluginBusy) return;
      setPluginBusy(true);
      setPluginError('');

      try {
        if (activeMagnetIds.has(id)) {
          alert(`请先停用 Magnet "${id}"，再卸载插件。`);
          return;
        }

        if (!window.confirm(`确认卸载插件 "${id}"？`)) return;

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
    [activeMagnetIds, magnetLibrary, onMagnetDeleteFromLibrary, pluginBusy, reloadPlugins]
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
              ✓ 已使用 ({counts.active.all})
            </button>
            <button
              className={`view-btn ${viewMode === 'inactive' ? 'active' : ''}`}
              onClick={() => setViewMode('inactive')}
            >
              ○ 未使用 ({counts.inactive.all})
            </button>
          </div>

          {/* 第二行：过滤器（全部/内置/自定义） */}
          <div className="library-filter-row">
            <button
              className={`filter-btn ${filterMode === 'all' ? 'active' : ''}`}
              onClick={() => setFilterMode('all')}
            >
              全部 ({counts[viewMode].all})
            </button>
            <button
              className={`filter-btn ${filterMode === 'builtin' ? 'active' : ''}`}
              onClick={() => setFilterMode('builtin')}
            >
              内置 ({counts[viewMode].builtin})
            </button>
            <button
              className={`filter-btn ${filterMode === 'custom' ? 'active' : ''}`}
              onClick={() => setFilterMode('custom')}
            >
              自定义 ({counts[viewMode].custom})
            </button>
          </div>

          {/* 第三行：搜索 */}
          <div className="library-search-row">
            <input
              className="library-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索 id / 名称 / 描述 / tag"
            />
            {searchQuery.trim().length > 0 && (
              <button
                className="library-search-clear-btn"
                onClick={() => setSearchQuery('')}
                title="清空搜索"
              >
                ×
              </button>
            )}
            <div className="library-search-count" title="搜索结果数量">
              {displayMagnets.length}
            </div>
          </div>
        </div>

        {/* 导入区域 */}
        {showImport && (
          <div className="import-section">
            <div className="import-label">粘贴 Magnet JSON 数据：</div>
            <textarea
              className="import-textarea"
              value={importData}
              onChange={(e) => setImportData(e.target.value)}
              placeholder={`{
  "id": "my-button",
  "content": "按钮",
  "anchorType": "single",
  "anchors": [{ "id": "anchor", "gridX": 10, "gridY": 10, "role": "anchor" }],
  "style": {
    "width": "80px",
    "height": "32px",
    "backgroundColor": "rgba(0, 122, 255, 0.8)",
    ...
  }
}`}
            />
            {importError && <div className="import-error">❌ {importError}</div>}
            <div className="import-actions">
              <button className="import-submit-btn" onClick={handleImport}>
                导入到库
              </button>
              <div className="import-hint">💡 导入后需要手动添加到点阵</div>
            </div>
          </div>
        )}

        {/* Magnet 列表 */}
        <div className="magnet-list">
          <div className="import-section" style={{ marginBottom: 6 }}>
            <div className="import-label">.pmpm 插件</div>
            {pluginError && <div className="import-error">⚠ {pluginError}</div>}
            <div className="import-actions">
              <button
                className="import-submit-btn"
                onClick={() => void handleImportPmpmPlugin()}
                disabled={pluginBusy}
              >
                导入 .pmpm
              </button>
              <button
                className="import-submit-btn"
                style={{ background: 'rgba(255, 255, 255, 0.12)' }}
                onClick={() => setShowPlugins((prev) => !prev)}
              >
                {showPlugins ? '隐藏' : '查看'}已安装 ({installedPlugins.length})
              </button>
            </div>

            {showPlugins && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {installedPlugins.length === 0 ? (
                  <div className="import-hint">暂无已安装插件</div>
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
                            权限：{permissions.length > 0 ? permissions.join(', ') : '(无)'}
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
                          title={isActive ? '请先从点阵停用该 Magnet' : '卸载插件'}
                        >
                          卸载
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
              {viewMode === 'active' ? '没有已使用的 Magnet' : '没有未使用的 Magnet'}
              {filterMode !== 'all' && <div className="empty-hint">尝试切换到“全部”查看</div>}
            </div>
          ) : (
            displayMagnets.map((magnet) => {
              const isBuiltIn = builtInMagnetIds.has(magnet.id);
              const isActive = activeMagnetIds.has(magnet.id);
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
                      {rendererGroup && <span className="magnet-group">{rendererGroup}</span>}
                      <span className="magnet-type">{magnet.type}</span>
                      <span className="magnet-anchor">{magnet.anchorType}</span>
                      <span className="magnet-pixels">{pixelCount} pixels</span>
                      {isBuiltIn && <span className="magnet-badge builtin">内置</span>}
                    </div>
                  </div>
                  <div className="magnet-actions">
                    {/* 编辑 */}
                    <button
                      className={`magnet-action-btn edit ${creatorWindowOpen ? 'disabled' : ''} ${glitchingButton === magnet.id ? 'glitch' : ''}`}
                      onClick={() => handleEdit(magnet)}
                      title={creatorWindowOpen ? 'Creator 窗口已打开' : '编辑磁贴'}
                      data-text="◈"
                    >
                      ◈
                    </button>

                    {/* 添加/移除 */}
                    {isActive ? (
                      <button
                        className="magnet-action-btn remove"
                        onClick={() => onMagnetDeactivate(magnet.id)}
                        title="从点阵移除"
                      >
                        －
                      </button>
                    ) : (
                      <button
                        className="magnet-action-btn add"
                        onClick={() => onMagnetActivate(magnet.id)}
                        title="添加到点阵"
                      >
                        ＋
                      </button>
                    )}

                    {/* 删除（仅自定义 Magnet，且在未使用状态） */}
                    {!isBuiltIn && !isActive && (
                      <button
                        className="magnet-action-btn delete"
                        onClick={() => onMagnetDeleteFromLibrary(magnet.id)}
                        title="从库中删除"
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
            ✨ 创建/导入
          </button>
        </div>
      </div>{' '}
      {/* 关闭 editor-window-content */}
    </div>
  );
});
