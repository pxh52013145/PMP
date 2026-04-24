import {
  useState,
  useCallback,
  useMemo,
  memo,
  useEffect,
  useDeferredValue,
  useRef,
  useSyncExternalStore,
  isValidElement,
  type ReactNode,
} from 'react';
import { Magnet } from '../../types/pixel';
import { useEditor } from '../../contexts/EditorContext';
import { useKernel } from '../../contexts/KernelContext';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  setupConfigSync,
  broadcastDataUpdate,
} from '../../utils/windowCommunication';
import { readJson, removeKey, writeJson, writeString } from '../../modules/storage';
import { COMMANDS_SERVICE_TOKEN, dispatchRequiredCommand } from '../../services/commands';
import { getMagnetDisplayName } from '../../modules/magnets/display';
import {
  getMagnetPreviewNode,
  getMagnetRenderer,
  getMagnetRenderersRevision,
  subscribeMagnetRenderers,
} from '../../magnet-system/registry';
import { REQUIRED_MAGNET_IDS } from '../../constants/magnets';

import {
  findFirstMagnetPlacementCandidate,
  getOccupiedPixelKeys,
} from '../../utils/magnetPlacement';
import { useConfirmDialog } from '../core/ConfirmDialog';
import { useT } from '../../i18n';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import './EditorMagnetLibrary.css';

const telemetry = getTelemetryLogger('editor', 'EditorMagnetLibrary');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface EditorMagnetLibraryProps {
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
  builtInMagnetIds: Set<string>;
  onMagnetAddToLibrary: (magnet: Magnet) => void;
  onMagnetUpdate: (magnet: Magnet) => void | Promise<void>;
  onMagnetActivate: (magnetId: string) => void;
  onMagnetDeactivate: (magnetId: string) => void;
  onMagnetDeleteFromLibrary: (magnetId: string) => void;
}

type ViewMode = 'active' | 'inactive';
type FilterMode = 'all' | 'builtin' | 'custom' | 'fixed';

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

const MAGNET_RENDERER_OPACITY_MIN = 0;
const MAGNET_RENDERER_OPACITY_MAX = 1;
const MAGNET_RENDERER_OPACITY_STEP = 0.05;

function clampMagnetRendererOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(MAGNET_RENDERER_OPACITY_MIN, Math.min(MAGNET_RENDERER_OPACITY_MAX, value));
}

function getMagnetRendererOpacity(magnet: Magnet): number {
  return clampMagnetRendererOpacity(magnet.style.opacity ?? 1);
}

function toOpaquePreviewColor(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  if (!normalized) return value;

  const hexMatch = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 4) return `#${hex.slice(0, 3)}`;
    if (hex.length === 8) return `#${hex.slice(0, 6)}`;
    return normalized;
  }

  const rgbaMatch = normalized.match(/^rgba?\((.+)\)$/i);
  if (!rgbaMatch) return value;
  const channels = rgbaMatch[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (channels.length < 3) return value;
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

export const EditorMagnetLibrary = memo(function EditorMagnetLibrary({
  magnetLibrary,
  activeMagnetIds,
  builtInMagnetIds,
  onMagnetAddToLibrary,
  onMagnetUpdate,
  onMagnetActivate,
  onMagnetDeactivate,
  onMagnetDeleteFromLibrary,
}: EditorMagnetLibraryProps) {
  const kernel = useKernel();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const { importMagnet: validateAndImportMagnet } = useEditor();
  const t = useT();

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
  const rendererRevision = useSyncExternalStore(
    subscribeMagnetRenderers,
    getMagnetRenderersRevision,
    getMagnetRenderersRevision
  );
  const [showImport, setShowImport] = useState(false);
  const [importData, setImportData] = useState('');
  const [importError, setImportError] = useState('');
  const [creatorWindowOpen, setCreatorWindowOpen] = useState(false); // 榛樿涓?false锛岄伩鍏嶈鍒?
  const [glitchingButton, setGlitchingButton] = useState<{
    magnetId: string;
    action: 'edit' | 'remove';
  } | null>(null);
  const [pendingFocusMagnetId, setPendingFocusMagnetId] = useState<string | null>(null);
  const [highlightedMagnetId, setHighlightedMagnetId] = useState<string | null>(null);
  const lastLibraryFocusRequestIdRef = useRef<string | null>(null);
  const [magnetRendererOpacityDrafts, setMagnetRendererOpacityDrafts] = useState<Record<string, number>>(
    {}
  );
  const opacityCommitInFlightRef = useRef<Set<string>>(new Set());
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  // 鍒濆鍖栨椂娓呯悊鍙兘娈嬬暀鐨勭獥鍙ｇ姸鎬?
  useEffect(() => {
    // 纭繚鍒濆鐘舵€佹纭紙EditorMagnetLibrary 绐楀彛鎵撳紑鏃讹紝creator 涓€瀹氭槸鍏抽棴鐨勶級
    const storedValue = readJson<boolean>(STORAGE_KEYS.CREATOR_WINDOW_OPEN, false);
    if (storedValue === true) {
      // 娓呯悊娈嬬暀鐘舵€?
      writeJson(STORAGE_KEYS.CREATOR_WINDOW_OPEN, false);
    }
    setCreatorWindowOpen(false);
  }, []);

  useEffect(() => {
    const knownIds = new Set(magnetLibrary.map((magnet) => magnet.id));
    setMagnetRendererOpacityDrafts((prev) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [magnetId, draftOpacity] of Object.entries(prev)) {
        if (!knownIds.has(magnetId)) {
          changed = true;
          continue;
        }
        next[magnetId] = draftOpacity;
      }
      return changed ? next : prev;
    });
  }, [magnetLibrary]);

  // 鍒嗙被 Magnet
  const categorizedMagnets = useMemo(() => {
    const fixed = magnetLibrary.filter((m) => REQUIRED_MAGNET_IDS.has(m.id));
    const nonFixed = magnetLibrary.filter((m) => !REQUIRED_MAGNET_IDS.has(m.id));

    return {
      active: {
        all: nonFixed.filter((m) => activeMagnetIds.has(m.id)),
        builtin: nonFixed.filter((m) => activeMagnetIds.has(m.id) && builtInMagnetIds.has(m.id)),
        custom: nonFixed.filter((m) => activeMagnetIds.has(m.id) && !builtInMagnetIds.has(m.id)),
        fixed: fixed.filter((m) => activeMagnetIds.has(m.id)),
      },
      inactive: {
        all: nonFixed.filter((m) => !activeMagnetIds.has(m.id)),
        builtin: nonFixed.filter((m) => !activeMagnetIds.has(m.id) && builtInMagnetIds.has(m.id)),
        custom: nonFixed.filter((m) => !activeMagnetIds.has(m.id) && !builtInMagnetIds.has(m.id)),
        fixed: fixed.filter((m) => !activeMagnetIds.has(m.id)),
      },
    };
  }, [magnetLibrary, activeMagnetIds, builtInMagnetIds]);

  // 褰撳墠鏄剧ず鐨?Magnet锛堟敮鎸佹悳绱級
  const displayMagnets = useMemo(() => {
    void rendererRevision;
    const baseMagnets = categorizedMagnets[viewMode][filterMode];
    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) return baseMagnets;

    return baseMagnets.filter((magnet) => {
      const rendererId = magnet.renderer ?? magnet.id;
      const renderer =
        getMagnetRenderer(rendererId) ?? (rendererId === magnet.id ? null : getMagnetRenderer(magnet.id));
      const displayName = getMagnetDisplayName(magnet, t);
      const searchable: string[] = [
        magnet.id,
        rendererId,
        displayName,
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
  }, [categorizedMagnets, deferredSearchQuery, filterMode, rendererRevision, t, viewMode]);

  // 鐩戝惉 creator 绐楀彛鐘舵€?
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

  useEffect(() => {
    if (!highlightedMagnetId) return;
    const timer = window.setTimeout(() => setHighlightedMagnetId(null), 1200);
    return () => window.clearTimeout(timer);
  }, [highlightedMagnetId]);

  useEffect(() => {
    type MagnetLibraryFocusRequestV1 = { requestId: string; magnetId: string; createdAt: number };

    const focus = () => {
      const raw = readJson<unknown>(STORAGE_KEYS.MAGNET_LIBRARY_FOCUS_REQUEST_V1, null);
      if (!raw || typeof raw !== 'object') return;
      const record = raw as Partial<MagnetLibraryFocusRequestV1>;
      if (typeof record.requestId !== 'string' || record.requestId.trim().length === 0) return;
      if (record.requestId === lastLibraryFocusRequestIdRef.current) return;
      if (typeof record.magnetId !== 'string' || record.magnetId.trim().length === 0) return;
      if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) return;

      lastLibraryFocusRequestIdRef.current = record.requestId;
      removeKey(STORAGE_KEYS.MAGNET_LIBRARY_FOCUS_REQUEST_V1);

      const magnetId = record.magnetId;
      const magnet = magnetLibrary.find((m) => m.id === magnetId) ?? null;
      if (!magnet) return;

      const nextViewMode: ViewMode = activeMagnetIds.has(magnetId) ? 'active' : 'inactive';
      const nextFilterMode: FilterMode = REQUIRED_MAGNET_IDS.has(magnetId)
        ? 'fixed'
        : builtInMagnetIds.has(magnetId)
          ? 'builtin'
          : 'custom';

      setViewMode(nextViewMode);
      setFilterMode(nextFilterMode);
      setSearchQuery('');
      setPendingFocusMagnetId(magnetId);
    };

    const cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.MAGNET_LIBRARY_FOCUS_REQUEST_V1],
      [TAURI_EVENTS.MAGNET_LIBRARY_FOCUS_REQUESTED],
      focus
    );

    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [activeMagnetIds, builtInMagnetIds, magnetLibrary]);

  useEffect(() => {
    if (!pendingFocusMagnetId) return;
    const element = document.querySelector<HTMLElement>(`[data-magnet-id="${pendingFocusMagnetId}"]`);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMagnetId(pendingFocusMagnetId);
    setPendingFocusMagnetId(null);
  }, [displayMagnets, pendingFocusMagnetId]);

  // 缁熻鏁伴噺
  const counts = useMemo(() => {
    const activeAll = categorizedMagnets.active.all.length;
    const activeFixed = categorizedMagnets.active.fixed.length;
    const inactiveAll = categorizedMagnets.inactive.all.length;
    const inactiveFixed = categorizedMagnets.inactive.fixed.length;

    return {
      active: {
        total: activeAll + activeFixed,
        all: activeAll,
        builtin: categorizedMagnets.active.builtin.length,
        custom: categorizedMagnets.active.custom.length,
        fixed: activeFixed,
      },
      inactive: {
        total: inactiveAll + inactiveFixed,
        all: inactiveAll,
        builtin: categorizedMagnets.inactive.builtin.length,
        custom: categorizedMagnets.inactive.custom.length,
        fixed: inactiveFixed,
      },
    };
  }, [categorizedMagnets]);

  const requestMagnetPlacement = useCallback(
    async (magnet: Magnet) => {
      const activeMagnets = magnetLibrary.filter((m) => m.id !== magnet.id && activeMagnetIds.has(m.id));
      const occupiedKeys = getOccupiedPixelKeys(activeMagnets);

      const candidate = findFirstMagnetPlacementCandidate(magnet, occupiedKeys);
      if (!candidate) {
        await confirm({
          title: t('editor.magnet-library.placement.noSpace.title'),
          message: t('editor.magnet-library.placement.noSpace.message', {
            name: getMagnetDisplayName(magnet, t),
          }),
          confirmText: t('common.action.ok'),
        });
        return;
      }

      onMagnetActivate(magnet.id);
    },
    [activeMagnetIds, confirm, magnetLibrary, onMagnetActivate, t]
  );

  // 澶勭悊缂栬緫
  const handleEdit = useCallback(
    async (magnet: Magnet) => {
      // 濡傛灉 creator 绐楀彛宸叉墦寮€锛岃Е鍙戞晠闅滃姩鐢?
      if (creatorWindowOpen) {
        setGlitchingButton({ magnetId: magnet.id, action: 'edit' });
        setTimeout(() => setGlitchingButton(null), 500);
        return;
      }

      try {
        // 灏嗚缂栬緫鐨?magnet 瀛樺偍鍒?localStorage锛堜复鏃舵暟鎹紝涓嶉渶瑕佸箍鎾級
        writeJson(STORAGE_KEYS.MAGNET_EDITOR_DATA, magnet);
        writeString(STORAGE_KEYS.MAGNET_EDITOR_MODE, 'edit');

        // 鏍囪绐楀彛鎵撳紑
        await broadcastDataUpdate(
          STORAGE_KEYS.CREATOR_WINDOW_OPEN,
          true,
          TAURI_EVENTS.CREATOR_WINDOW_OPENED
        );

        // 绔嬪嵆鍚屾鏇存柊鏈湴鐘舵€侊紝涓嶇瓑寰呭紓姝ョ洃鍚櫒
        setCreatorWindowOpen(true);

        // 鎵撳紑 creator 绐楀彛
        await dispatchRequiredCommand(
          commands,
          'app:open-creator-editor-window',
          'Creator editor command service is not available.'
        );
      } catch (error) {
        telemetry.error('editor.creator-window.open.failed', {
          message: getErrorMessage(error),
        });
        // 鍑洪敊鏃舵竻闄ゆ爣璁?
        await broadcastDataUpdate(
          STORAGE_KEYS.CREATOR_WINDOW_OPEN,
          false,
          TAURI_EVENTS.CREATOR_WINDOW_CLOSED
        );
        // 鍚屾鏇存柊鏈湴鐘舵€?
        setCreatorWindowOpen(false);
      }
    },
    [commands, creatorWindowOpen]
  );

  // 澶勭悊瀵煎叆
  const handleImport = useCallback(() => {
    setImportError('');

    try {
      const parsed = JSON.parse(importData);

      // 妫€鏌?ID 鍐茬獊锛堝湪璋冪敤 validateAndImportMagnet 鍓嶆鏌ワ紝鍥犱负瀹冧笉妫€鏌?library 鍐茬獊锛?
      if (magnetLibrary.some((m) => m.id === parsed.id)) {
        throw new Error(t('editor.magnet-library.import.error.idExists', { id: parsed.id }));
      }

      // 浣跨敤 EditorContext 鐨勫畬鏁撮獙璇侀€昏緫
      const result = validateAndImportMagnet(parsed);

      if (!result.valid) {
        // 楠岃瘉澶辫触锛屾樉绀洪敊璇?
        const errorMessage = result.errors.join('\n');
        setImportError(errorMessage);
        return;
      }

      if (!result.magnet) {
        setImportError(t('editor.magnet-library.import.error.emptyMagnet'));
        return;
      }

      // 楠岃瘉鎴愬姛锛屾坊鍔犲埌 library
      onMagnetAddToLibrary(result.magnet);
      setImportData('');
      setShowImport(false);

      // 濡傛灉鏈夎鍛婁俊鎭紙渚嬪鑷姩绉诲姩浣嶇疆锛夛紝鏄剧ず缁欑敤鎴?
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

  const handleRendererOpacityDraftChange = useCallback((magnetId: string, rawValue: string) => {
    const nextOpacity = clampMagnetRendererOpacity(Number.parseFloat(rawValue));
    setMagnetRendererOpacityDrafts((prev) => {
      if (Math.abs((prev[magnetId] ?? -1) - nextOpacity) < 0.001) return prev;
      return {
        ...prev,
        [magnetId]: nextOpacity,
      };
    });
  }, []);

  const commitRendererOpacity = useCallback(
    async (magnet: Magnet) => {
      if (opacityCommitInFlightRef.current.has(magnet.id)) {
        return;
      }

      const draftOpacity = magnetRendererOpacityDrafts[magnet.id];
      if (typeof draftOpacity !== 'number') {
        return;
      }

      const nextOpacity = clampMagnetRendererOpacity(draftOpacity);
      const currentOpacity = getMagnetRendererOpacity(magnet);

      setMagnetRendererOpacityDrafts((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, magnet.id)) return prev;
        const next = { ...prev };
        delete next[magnet.id];
        return next;
      });

      if (Math.abs(nextOpacity - currentOpacity) < 0.001) {
        return;
      }

      opacityCommitInFlightRef.current.add(magnet.id);
      try {
        await onMagnetUpdate({
          ...magnet,
          style: {
            ...magnet.style,
            opacity: nextOpacity,
          },
        });
      } finally {
        opacityCommitInFlightRef.current.delete(magnet.id);
      }
    },
    [magnetRendererOpacityDrafts, onMagnetUpdate]
  );

  return (
    <div className="editor-magnet-library">
      {/* 鎷栧姩鏍囬鏍?*/}
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          {t('windows.editor.library.title')}
        </span>
      </div>
      {/* 鍐呭鍖哄煙 */}
      <div className="editor-window-content">
        {/* 椤堕儴鍥哄畾锛氭寜閽尯鍩?*/}
        <div className="library-header-fixed">
          {/* 绗竴琛岋細瑙嗗浘鍒囨崲锛堝凡浣跨敤/鏈娇鐢級 */}
          <div className="library-view-selector">
            <button
              className={`view-btn ${viewMode === 'active' ? 'active' : ''}`}
              onClick={() => setViewMode('active')}
            >
              {t('editor.magnet-library.view.active', { count: counts.active.total })}
            </button>
            <button
              className={`view-btn ${viewMode === 'inactive' ? 'active' : ''}`}
              onClick={() => setViewMode('inactive')}
            >
              {t('editor.magnet-library.view.inactive', { count: counts.inactive.total })}
            </button>
          </div>

          {/* 绗簩琛岋細杩囨护鍣紙鍏ㄩ儴/鍐呯疆/鑷畾涔夛級 */}
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
            <button
              className={`filter-btn ${filterMode === 'fixed' ? 'active' : ''}`}
              onClick={() => setFilterMode('fixed')}
            >
              {t('editor.magnet-library.filter.fixed', { count: counts[viewMode].fixed })}
            </button>
          </div>

          {/* 绗笁琛岋細鎼滅储 */}
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
                  脳
                </button>
              )}
            <div className="library-search-count" title={t('editor.magnet-library.search.countTitle')}>
              {displayMagnets.length}
            </div>
          </div>
        </div>

        {/* 瀵煎叆鍖哄煙 */}
        {showImport && (
          <div className="import-section">
            <div className="import-label">{t('editor.magnet-library.import.label')}</div>
            <textarea
              className="import-textarea"
              value={importData}
              onChange={(e) => setImportData(e.target.value)}
              placeholder={t('editor.magnet-library.import.placeholder')}
            />
            {importError && <div className="import-error">鉂?{importError}</div>}
            <div className="import-actions">
              <button className="import-submit-btn" onClick={handleImport}>
                {t('editor.magnet-library.import.action.importToLibrary')}
              </button>
              <div className="import-hint">{t('editor.magnet-library.import.hint')}</div>
            </div>
          </div>
        )}

        {/* Magnet 鍒楄〃 */}
        <div className="magnet-list">
          <div className="import-section" style={{ marginBottom: 6 }}>
            <div className="import-label">{t('editor.magnet-library.pluginManagerRemoved.title')}</div>
            <div className="import-hint">{t('editor.magnet-library.pluginManagerRemoved.desc')}</div>
            <div className="import-actions">
              <button
                className="import-submit-btn"
                style={{ background: 'rgba(255, 255, 255, 0.12)' }}
                disabled
                onClick={() => undefined}
              >
                {t('editor.magnet-library.pluginManagerRemoved.button')}
              </button>
            </div>
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
              const magnetDisplayName = getMagnetDisplayName(magnet, t);
              const pixelCount = estimateMagnetPixelCount(magnet);
              const chromeEnabled = magnet.chrome?.enabled !== false;
              const magnetRendererOpacity =
                magnetRendererOpacityDrafts[magnet.id] ?? getMagnetRendererOpacity(magnet);
              const magnetRendererOpacityPercent = Math.round(magnetRendererOpacity * 100);

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
                  previewContent = magnetDisplayName;
                } else {
                  previewContent = `[${magnetDisplayName}]`;
                }
              }

              return (
                <div
                  key={magnet.id}
                  className={`magnet-item ${highlightedMagnetId === magnet.id ? 'magnet-item--focused' : ''}`}
                  data-magnet-id={magnet.id}
                >
                  <div
                    className="magnet-preview"
                    style={{
                      color: chromeEnabled ? magnet.style.color : undefined,
                      borderRadius: magnet.style.borderRadius,
                    }}
                  >
                    <div
                      className="magnet-preview-underlay"
                      style={{
                        backgroundColor: chromeEnabled
                          ? toOpaquePreviewColor(magnet.style.backgroundColor)
                          : 'transparent',
                        border: chromeEnabled
                          ? magnet.style.border
                          : '1px dashed rgba(255,255,255,0.18)',
                        opacity: magnetRendererOpacity,
                      }}
                    />
                    <div className="magnet-preview-content">{previewContent}</div>
                  </div>
                  <div className="magnet-body">
                    <div className="magnet-info">
                      <div className="magnet-name">{magnetDisplayName}</div>
                      <div className="magnet-id">{magnet.id}</div>
                      {rendererDescription && (
                        <div className="magnet-description">{rendererDescription}</div>
                      )}
                      <div className="magnet-meta">
                        {rendererGroup && (
                          <span className="magnet-group">{formatRendererGroup(rendererGroup)}</span>
                        )}
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
                    {/* 缂栬緫 */}
                    <button
                      className={`magnet-action-btn edit ${creatorWindowOpen ? 'disabled' : ''} ${glitchingButton?.magnetId === magnet.id && glitchingButton.action === 'edit' ? 'glitch' : ''}`}
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

                    {/* 澶栨寮€鍏?*/}
                    <button
                      className="magnet-action-btn chrome"
                      onClick={() =>
                        void onMagnetUpdate({
                          ...magnet,
                          chrome: { ...(magnet.chrome ?? {}), enabled: !chromeEnabled },
                        })
                      }
                      title={
                        chromeEnabled
                          ? t('editor.magnet-library.magnet.tooltip.chrome.disable')
                          : t('editor.magnet-library.magnet.tooltip.chrome.enable')
                      }
                    >
                      {chromeEnabled ? '▣' : '▢'}
                    </button>

                    {/* 娣诲姞/绉婚櫎 */}
                    {isActive ? (
                      <button
                        className={`magnet-action-btn remove ${isRequired ? 'disabled' : ''} ${glitchingButton?.magnetId === magnet.id && glitchingButton.action === 'remove' ? 'glitch' : ''}`}
                        onClick={() => {
                          if (isRequired) {
                            setGlitchingButton({ magnetId: magnet.id, action: 'remove' });
                            setTimeout(() => setGlitchingButton(null), 500);
                            return;
                          }
                          onMagnetDeactivate(magnet.id);
                        }}
                        aria-disabled={isRequired}
                        title={
                          isRequired
                            ? t('editor.magnet-library.magnet.tooltip.cannotRemoveRequired')
                            : t('editor.magnet-library.magnet.tooltip.removeFromMatrix')
                        }
                        data-text="－"
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

                    {/* 鍒犻櫎锛堜粎鑷畾涔?Magnet锛屼笖鍦ㄦ湭浣跨敤鐘舵€侊級 */}
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
                  <div className="magnet-opacity-control">
                    <div className="magnet-opacity-label">
                      {t('editor.magnet-library.magnet.opacity.label')}
                    </div>
                    <div className="magnet-opacity-slider-row">
                      <div className="magnet-opacity-slider-shell">
                        <div className="magnet-opacity-slider-track">
                          <div className="magnet-opacity-slider-grid" />
                          <div
                            className="magnet-opacity-slider-fill"
                            style={{ width: `${magnetRendererOpacityPercent}%` }}
                          />
                        </div>
                        <input
                          className="magnet-opacity-slider"
                          type="range"
                          min={MAGNET_RENDERER_OPACITY_MIN}
                          max={MAGNET_RENDERER_OPACITY_MAX}
                          step={MAGNET_RENDERER_OPACITY_STEP}
                          value={magnetRendererOpacity}
                          onChange={(event) => {
                            handleRendererOpacityDraftChange(magnet.id, event.target.value);
                          }}
                          onPointerUp={() => {
                            void commitRendererOpacity(magnet);
                          }}
                          onBlur={() => {
                            void commitRendererOpacity(magnet);
                          }}
                          onKeyUp={(event) => {
                            if (event.key === 'Enter') {
                              void commitRendererOpacity(magnet);
                            }
                          }}
                        />
                      </div>
                      <span className="magnet-opacity-value">
                        {t('editor.magnet-library.magnet.opacity.value', {
                          percent: magnetRendererOpacityPercent,
                        })}
                      </span>
                    </div>
                  </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 搴曢儴鍥哄畾锛氬垱寤?瀵煎叆鎸夐挳 */}
        <div className="library-footer-fixed">
          <button
            className="create-import-btn"
            onClick={async () => {
              // 濡傛灉 creator 绐楀彛宸叉墦寮€锛屼笉鎵ц
              if (creatorWindowOpen) {
                return;
              }

              try {
                writeString(STORAGE_KEYS.MAGNET_EDITOR_MODE, 'create');
                removeKey(STORAGE_KEYS.MAGNET_EDITOR_DATA);

                // 鏍囪绐楀彛鎵撳紑
                await broadcastDataUpdate(
                  STORAGE_KEYS.CREATOR_WINDOW_OPEN,
                  true,
                  TAURI_EVENTS.CREATOR_WINDOW_OPENED
                );

                // 绔嬪嵆鍚屾鏇存柊鏈湴鐘舵€?
                setCreatorWindowOpen(true);

                await dispatchRequiredCommand(
                  commands,
                  'app:open-creator-editor-window',
                  'Creator editor command service is not available.'
                );
              } catch (error) {
                telemetry.error('editor.creator-window.open.failed', {
                  message: getErrorMessage(error),
                });
                // 鍑洪敊鏃舵竻闄ゆ爣璁?
                await broadcastDataUpdate(
                  STORAGE_KEYS.CREATOR_WINDOW_OPEN,
                  false,
                  TAURI_EVENTS.CREATOR_WINDOW_CLOSED
                );
                // 鍚屾鏇存柊鏈湴鐘舵€?
                setCreatorWindowOpen(false);
              }
            }}
          >
            {t('editor.magnet-library.action.createOrImport')}
          </button>
        </div>
      </div>{' '}
      {/* 鍏抽棴 editor-window-content */}
      {confirmDialog}
    </div>
  );
});


