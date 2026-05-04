import {
  type CSSProperties,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Copy,
  FileCode2,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { InstalledHostExtensionRecord } from '../../magnet-system/plugins/extensions';
import type { PluginDevSessionRecord } from '../../magnet-system/plugins/devSessionRegistry';
import {
  buildPluginMagnetCreatorArtifacts,
  createDefaultPluginMagnetCreatorDraft,
  createPluginMagnetCreatorDraftFromInstalledExtension,
  getPluginMagnetCreatorDraftRevision,
  readPluginMagnetCreatorDraft,
  resetPluginMagnetCreatorDraft,
  savePluginMagnetCreatorDraft,
  subscribePluginMagnetCreatorDraft,
  type PluginMagnetCreatorDraft,
  type PluginMagnetCreatorIssue,
  type PluginMagnetCreatorVariantDraft,
} from '../../magnet-system/plugins/pluginMagnetCreator';
import { useT } from '../../i18n';
import { PmpButton } from '../primitives';

interface PluginMagnetCreatorWorkspaceProps {
  busy: boolean;
  installedExtensions: InstalledHostExtensionRecord[];
  devSessions: PluginDevSessionRecord[];
  selectedPluginId: string | null;
  onSelectPluginId: (pluginId: string | null) => void;
  onError: (message: string | null) => void;
}

type CodeSectionId = 'manifestPatch' | 'minimalManifest' | 'runtimeTemplate';
type EditorSectionId = 'identity' | 'layout' | 'variants' | 'style';

const EDITOR_SECTIONS: EditorSectionId[] = ['identity', 'layout', 'variants', 'style'];
const CODE_SECTIONS: CodeSectionId[] = ['manifestPatch', 'minimalManifest', 'runtimeTemplate'];
const PREVIEW_STYLE_KEYS = [
  'backgroundColor',
  'border',
  'borderRadius',
  'color',
  'fontFamily',
  'padding',
] as const;

function readInstalledExtensionDisplayName(record: InstalledHostExtensionRecord): string {
  return record.manifest.identity.displayName ?? record.manifest.identity.name;
}

function formatIssue(
  t: (key: string, params?: Record<string, unknown>) => string,
  issue: PluginMagnetCreatorIssue
): string {
  return t(`magnet.pluginDevelopmentWorkspace.pluginMagnet.validation.${issue.code}`, {
    detail: issue.detail ?? '',
    message: issue.message,
  });
}

function formatAnchorSummary(
  t: (key: string, params?: Record<string, unknown>) => string,
  draft: PluginMagnetCreatorDraft
): string {
  return t(`magnet.pluginDevelopmentWorkspace.pluginMagnet.anchor.${draft.anchorMode}`, {
    x: draft.originX,
    y: draft.originY,
    width: draft.width,
    height: draft.height,
  });
}

function stringifyCode(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function readCodeTitleKey(codeId: CodeSectionId): string {
  switch (codeId) {
    case 'manifestPatch':
      return 'magnet.pluginDevelopmentWorkspace.pluginMagnet.output.manifestPatch';
    case 'minimalManifest':
      return 'magnet.pluginDevelopmentWorkspace.pluginMagnet.output.minimalManifest';
    case 'runtimeTemplate':
      return 'magnet.pluginDevelopmentWorkspace.pluginMagnet.output.runtimeTemplate';
    default: {
      const exhaustive: never = codeId;
      return String(exhaustive);
    }
  }
}

function readPreviewStyle(defaultStyleText: string): CSSProperties {
  const base: CSSProperties = {
    backgroundColor: 'rgba(8, 20, 38, 0.74)',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: '8px',
    color: 'rgba(248,250,252,0.96)',
    padding: '10px',
  };

  try {
    const parsed = JSON.parse(defaultStyleText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base;
    const style = parsed as Record<string, unknown>;
    const next: CSSProperties = { ...base };
    for (const key of PREVIEW_STYLE_KEYS) {
      const value = style[key];
      if (typeof value === 'string' || typeof value === 'number') {
        (next as Record<string, string | number>)[key] = value;
      }
    }
    return next;
  } catch {
    return base;
  }
}

function readIssueEditorSection(issue: PluginMagnetCreatorIssue): EditorSectionId {
  if (
    issue.field === 'pluginId' ||
    issue.field === 'publisher' ||
    issue.field === 'version' ||
    issue.field === 'runtimeId' ||
    issue.field === 'runtimeEntry' ||
    issue.field === 'manifest'
  ) {
    return 'identity';
  }
  if (issue.field === 'anchor' || issue.field === 'defaultVariant') return 'layout';
  if (issue.field === 'variants') return 'variants';
  if (issue.field === 'defaultStyle') return 'style';
  return 'identity';
}

export function PluginMagnetCreatorWorkspace({
  busy,
  installedExtensions,
  devSessions,
  selectedPluginId,
  onSelectPluginId,
  onError,
}: PluginMagnetCreatorWorkspaceProps) {
  const t = useT();
  const draftRevision = useSyncExternalStore(
    subscribePluginMagnetCreatorDraft,
    getPluginMagnetCreatorDraftRevision,
    getPluginMagnetCreatorDraftRevision
  );
  const draft = useMemo(() => {
    void draftRevision;
    return readPluginMagnetCreatorDraft();
  }, [draftRevision]);
  const artifacts = useMemo(() => buildPluginMagnetCreatorArtifacts(draft), [draft]);
  const manifestPatchCode = useMemo(
    () => stringifyCode(artifacts.manifestPatch),
    [artifacts.manifestPatch]
  );
  const minimalManifestCode = useMemo(
    () => stringifyCode(artifacts.minimalManifest),
    [artifacts.minimalManifest]
  );
  const runtimeTemplateCode = artifacts.runtimeTemplate;
  const codeValues = useMemo<Record<CodeSectionId, string>>(
    () => ({
      manifestPatch: manifestPatchCode,
      minimalManifest: minimalManifestCode,
      runtimeTemplate: runtimeTemplateCode,
    }),
    [manifestPatchCode, minimalManifestCode, runtimeTemplateCode]
  );
  const errorCount = artifacts.validation.issues.filter(
    (issue) => issue.severity === 'error'
  ).length;
  const warningCount = artifacts.validation.issues.length - errorCount;
  const previewStyle = useMemo(
    () => readPreviewStyle(draft.defaultStyleText),
    [draft.defaultStyleText]
  );
  const issueCountsByEditorSection = useMemo(() => {
    const counts: Record<EditorSectionId, number> = {
      identity: 0,
      layout: 0,
      variants: 0,
      style: 0,
    };
    for (const issue of artifacts.validation.issues) {
      counts[readIssueEditorSection(issue)] += 1;
    }
    return counts;
  }, [artifacts.validation.issues]);
  const [copiedCode, setCopiedCode] = useState<CodeSectionId | null>(null);
  const [editorSection, setEditorSection] = useState<EditorSectionId>('identity');
  const [activeCodeSection, setActiveCodeSection] =
    useState<CodeSectionId>('manifestPatch');

  const sessionPluginIds = useMemo(
    () => new Set(devSessions.map((session) => session.pluginId)),
    [devSessions]
  );
  const sourceRecords = useMemo(
    () =>
      installedExtensions
        .filter((record) => record.manifest.runtimes.some((runtime) => runtime.kind === 'webview'))
        .sort((left, right) =>
          readInstalledExtensionDisplayName(left).localeCompare(
            readInstalledExtensionDisplayName(right)
          )
        ),
    [installedExtensions]
  );
  const sourceSelectValue =
    selectedPluginId && sourceRecords.some((record) => record.manifest.identity.id === selectedPluginId)
      ? selectedPluginId
      : '__draft';

  const updateDraft = useCallback(
    (patch: Partial<PluginMagnetCreatorDraft>) => {
      savePluginMagnetCreatorDraft({ ...draft, ...patch });
      onError(null);
    },
    [draft, onError]
  );

  const updateVariant = useCallback(
    (index: number, patch: Partial<PluginMagnetCreatorVariantDraft>) => {
      const variants = draft.variants.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, ...patch } : variant
      );
      savePluginMagnetCreatorDraft({ ...draft, variants });
      onError(null);
    },
    [draft, onError]
  );

  const addVariant = useCallback(() => {
    const index = draft.variants.length + 1;
    savePluginMagnetCreatorDraft({
      ...draft,
      variants: [
        ...draft.variants,
        {
          id: `variant-${index}`,
          label: `Variant ${index}`,
          description: '',
        },
      ],
    });
    onError(null);
  }, [draft, onError]);

  const removeVariant = useCallback(
    (index: number) => {
      if (draft.variants.length <= 1) return;
      const variants = draft.variants.filter((_, variantIndex) => variantIndex !== index);
      savePluginMagnetCreatorDraft({ ...draft, variants });
      onError(null);
    },
    [draft, onError]
  );

  const seedFromRecord = useCallback(
    (record: InstalledHostExtensionRecord) => {
      savePluginMagnetCreatorDraft(createPluginMagnetCreatorDraftFromInstalledExtension(record));
      onSelectPluginId(record.manifest.identity.id);
      onError(null);
    },
    [onError, onSelectPluginId]
  );

  const selectSource = useCallback(
    (value: string) => {
      if (value === '__draft') {
        onSelectPluginId(null);
        onError(null);
        return;
      }
      const record = sourceRecords.find((item) => item.manifest.identity.id === value);
      if (record) seedFromRecord(record);
    },
    [onError, onSelectPluginId, seedFromRecord, sourceRecords]
  );

  const resetDraft = useCallback(() => {
    resetPluginMagnetCreatorDraft();
    onError(null);
  }, [onError]);

  const resetStyle = useCallback(() => {
    savePluginMagnetCreatorDraft({
      ...draft,
      defaultStyleText: createDefaultPluginMagnetCreatorDraft().defaultStyleText,
    });
    onError(null);
  }, [draft, onError]);

  const copyCode = useCallback(
    async (codeId: CodeSectionId, value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopiedCode(codeId);
        window.setTimeout(() => setCopiedCode(null), 1400);
        onError(null);
      } catch (error) {
        onError(
          t('magnet.pluginDevelopmentWorkspace.pluginMagnet.error.copyFailed', {
            message: error instanceof Error ? error.message : String(error),
          })
        );
      }
    },
    [onError, t]
  );

  const renderCodeSection = (value: string) => (
    <div className="plugin-dev-workspace__code-panel plugin-dev-workspace__code-panel--details">
      <pre className="plugin-dev-workspace__code-block">{value}</pre>
    </div>
  );

  return (
    <div className="plugin-dev-workspace__creator-quick-shell">
      <div className="plugin-dev-workspace__creator-commandbar">
        <label className="plugin-dev-workspace__creator-control">
          <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.toolbar.source')}</span>
          <select value={sourceSelectValue} onChange={(event) => selectSource(event.target.value)}>
            <option value="__draft">
              {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.source.currentDraft')}
            </option>
            {sourceRecords.map((record) => (
              <option key={record.manifest.identity.id} value={record.manifest.identity.id}>
                {readInstalledExtensionDisplayName(record)}
                {' / '}
                {sessionPluginIds.has(record.manifest.identity.id)
                  ? t('magnet.pluginDevelopmentWorkspace.pluginMagnet.state.devSession')
                  : t('magnet.pluginDevelopmentWorkspace.pluginMagnet.state.installed')}
              </option>
            ))}
          </select>
        </label>
        <label className="plugin-dev-workspace__creator-control">
          <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.toolbar.configure')}</span>
          <select
            value={editorSection}
            onChange={(event) => setEditorSection(event.target.value as EditorSectionId)}
          >
            {EDITOR_SECTIONS.map((section) => (
              <option key={section} value={section}>
                {t(`magnet.pluginDevelopmentWorkspace.pluginMagnet.editorTab.${section}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="plugin-dev-workspace__creator-control">
          <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.toolbar.variant')}</span>
          <select
            value={draft.defaultVariant}
            onChange={(event) => updateDraft({ defaultVariant: event.target.value })}
          >
            {draft.variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label || variant.id}
              </option>
            ))}
          </select>
        </label>
        <label className="plugin-dev-workspace__creator-control">
          <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.toolbar.artifact')}</span>
          <select
            value={activeCodeSection}
            onChange={(event) => setActiveCodeSection(event.target.value as CodeSectionId)}
          >
            {CODE_SECTIONS.map((codeId) => (
              <option key={codeId} value={codeId}>
                {t(readCodeTitleKey(codeId))}
              </option>
            ))}
          </select>
        </label>
        <div className="plugin-dev-workspace__creator-command-actions">
          <PmpButton
            type="button"
            variant="default"
            disabled={busy}
            onClick={() => void copyCode(activeCodeSection, codeValues[activeCodeSection])}
          >
            <Copy size={14} />
            {copiedCode === activeCodeSection
              ? t('magnet.pluginDevelopmentWorkspace.pluginMagnet.action.copied')
              : t('magnet.pluginDevelopmentWorkspace.pluginMagnet.action.copyArtifact')}
          </PmpButton>
          <PmpButton type="button" variant="default" disabled={busy} onClick={resetDraft}>
            <RotateCcw size={14} />
            {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.action.reset')}
          </PmpButton>
        </div>
      </div>

      <div className="plugin-dev-workspace__creator-quick-workbench">
        <main className="plugin-dev-workspace__creator-test-surface">
          <div className="plugin-dev-workspace__creator-preview-head">
            <div>
              <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.panel.testSurface')}</span>
              <strong>{draft.displayName}</strong>
            </div>
            <span
              className={[
                'plugin-dev-workspace__tag',
                artifacts.validation.ok
                  ? 'plugin-dev-workspace__tag--info'
                  : 'plugin-dev-workspace__tag--warn',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {artifacts.validation.ok
                ? t('magnet.pluginDevelopmentWorkspace.pluginMagnet.state.ready')
                : t('magnet.pluginDevelopmentWorkspace.pluginMagnet.state.needsFix')}
            </span>
          </div>
          <div className="plugin-dev-workspace__creator-preview-canvas">
            <div className="plugin-dev-workspace__creator-preview-surface" style={previewStyle}>
              <strong>{draft.displayName}</strong>
              <span>{draft.pluginId}</span>
              <small>{draft.defaultVariant}</small>
            </div>
          </div>
          <div className="plugin-dev-workspace__creator-preview-status">
            <span>{draft.pluginId}</span>
            <span>{formatAnchorSummary(t, draft)}</span>
            <span>{draft.runtimeEntry}</span>
            <span>
              {errorCount} {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.summary.errors')} /{' '}
              {warningCount} {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.summary.warnings')}
            </span>
          </div>
        </main>

        <aside className="plugin-dev-workspace__creator-quick-inspector">
          <section className="plugin-dev-workspace__creator-quick-panel">
            <div className="plugin-dev-workspace__creator-panel-heading">
              <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.panel.quickSettings')}</span>
              {issueCountsByEditorSection[editorSection] > 0 ? (
                <span className="plugin-dev-workspace__creator-issue-count">
                  {issueCountsByEditorSection[editorSection]}
                </span>
              ) : null}
            </div>
            <div className="plugin-dev-workspace__creator-editor-surface plugin-dev-workspace__creator-editor-surface--quick">
              {editorSection === 'identity' ? (
              <div className="plugin-dev-workspace__field-grid">
                <label className="plugin-dev-workspace__field">
                  <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.pluginId')}</span>
                  <input
                    value={draft.pluginId}
                    onChange={(event) => updateDraft({ pluginId: event.target.value })}
                  />
                </label>
                <label className="plugin-dev-workspace__field">
                  <span>
                    {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.displayName')}
                  </span>
                  <input
                    value={draft.displayName}
                    onChange={(event) => updateDraft({ displayName: event.target.value })}
                  />
                </label>
                <label className="plugin-dev-workspace__field">
                  <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.publisher')}</span>
                  <input
                    value={draft.publisher}
                    onChange={(event) => updateDraft({ publisher: event.target.value })}
                  />
                </label>
                <label className="plugin-dev-workspace__field">
                  <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.version')}</span>
                  <input
                    value={draft.version}
                    onChange={(event) => updateDraft({ version: event.target.value })}
                  />
                </label>
                <label className="plugin-dev-workspace__field">
                  <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.runtimeId')}</span>
                  <input
                    value={draft.runtimeId}
                    onChange={(event) => updateDraft({ runtimeId: event.target.value })}
                  />
                </label>
                <label className="plugin-dev-workspace__field">
                  <span>
                    {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.runtimeEntry')}
                  </span>
                  <input
                    value={draft.runtimeEntry}
                    onChange={(event) => updateDraft({ runtimeEntry: event.target.value })}
                  />
                </label>
                <label className="plugin-dev-workspace__field plugin-dev-workspace__field--wide">
                  <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.description')}</span>
                  <input
                    value={draft.description}
                    onChange={(event) => updateDraft({ description: event.target.value })}
                  />
                </label>
              </div>
              ) : null}

              {editorSection === 'layout' ? (
              <div className="plugin-dev-workspace__creator-editor-stack">
                <div className="plugin-dev-workspace__inline-summary">
                  <span>
                    {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.anchorMode')}
                  </span>
                  <strong>{formatAnchorSummary(t, draft)}</strong>
                </div>
                <div className="plugin-dev-workspace__field-grid">
                  <label className="plugin-dev-workspace__field">
                    <span>
                      {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.anchorMode')}
                    </span>
                    <select
                      value={draft.anchorMode}
                      onChange={(event) =>
                        updateDraft({
                          anchorMode: event.target.value as PluginMagnetCreatorDraft['anchorMode'],
                        })
                      }
                    >
                      <option value="single">
                        {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.option.anchor.single')}
                      </option>
                      <option value="horizontal">
                        {t(
                          'magnet.pluginDevelopmentWorkspace.pluginMagnet.option.anchor.horizontal'
                        )}
                      </option>
                      <option value="vertical">
                        {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.option.anchor.vertical')}
                      </option>
                      <option value="rectangular">
                        {t(
                          'magnet.pluginDevelopmentWorkspace.pluginMagnet.option.anchor.rectangular'
                        )}
                      </option>
                    </select>
                  </label>
                  <label className="plugin-dev-workspace__field">
                    <span>
                      {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.defaultVariant')}
                    </span>
                    <select
                      value={draft.defaultVariant}
                      onChange={(event) => updateDraft({ defaultVariant: event.target.value })}
                    >
                      {draft.variants.map((variant) => (
                        <option key={variant.id} value={variant.id}>
                          {variant.label || variant.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="plugin-dev-workspace__field">
                    <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.originX')}</span>
                    <input
                      type="number"
                      min={0}
                      max={29}
                      value={draft.originX}
                      onChange={(event) => updateDraft({ originX: Number(event.target.value) })}
                    />
                  </label>
                  <label className="plugin-dev-workspace__field">
                    <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.originY')}</span>
                    <input
                      type="number"
                      min={0}
                      max={29}
                      value={draft.originY}
                      onChange={(event) => updateDraft({ originY: Number(event.target.value) })}
                    />
                  </label>
                  <label className="plugin-dev-workspace__field">
                    <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.width')}</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={draft.width}
                      onChange={(event) => updateDraft({ width: Number(event.target.value) })}
                    />
                  </label>
                  <label className="plugin-dev-workspace__field">
                    <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.height')}</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={draft.height}
                      onChange={(event) => updateDraft({ height: Number(event.target.value) })}
                    />
                  </label>
                </div>
              </div>
              ) : null}

              {editorSection === 'variants' ? (
              <div className="plugin-dev-workspace__variant-editor">
                <div className="plugin-dev-workspace__variant-editor-header">
                  <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.variants')}</span>
                  <PmpButton type="button" variant="default" disabled={busy} onClick={addVariant}>
                    <Plus size={14} />
                    {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.action.addVariant')}
                  </PmpButton>
                </div>
                {draft.variants.map((variant, index) => (
                  <div key={`${variant.id}:${index}`} className="plugin-dev-workspace__variant-row">
                    <label className="plugin-dev-workspace__field">
                      <span>
                        {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.variantId')}
                      </span>
                      <input
                        value={variant.id}
                        onChange={(event) => updateVariant(index, { id: event.target.value })}
                      />
                    </label>
                    <label className="plugin-dev-workspace__field">
                      <span>
                        {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.variantLabel')}
                      </span>
                      <input
                        value={variant.label}
                        onChange={(event) => updateVariant(index, { label: event.target.value })}
                      />
                    </label>
                    <label className="plugin-dev-workspace__field">
                      <span>
                        {t(
                          'magnet.pluginDevelopmentWorkspace.pluginMagnet.label.variantDescription'
                        )}
                      </span>
                      <input
                        value={variant.description}
                        onChange={(event) =>
                          updateVariant(index, { description: event.target.value })
                        }
                      />
                    </label>
                    <PmpButton
                      type="button"
                      variant="danger"
                      disabled={busy || draft.variants.length <= 1}
                      onClick={() => removeVariant(index)}
                    >
                      <Trash2 size={14} />
                      {t('common.action.remove')}
                    </PmpButton>
                  </div>
                ))}
              </div>
              ) : null}

              {editorSection === 'style' ? (
              <div className="plugin-dev-workspace__style-editor">
                <label className="plugin-dev-workspace__field plugin-dev-workspace__field--wide">
                  <span>
                    {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.label.defaultStyle')}
                  </span>
                  <textarea
                    value={draft.defaultStyleText}
                    spellCheck={false}
                    onChange={(event) => updateDraft({ defaultStyleText: event.target.value })}
                  />
                </label>
                <div className="plugin-dev-workspace__editor-actions">
                  <PmpButton type="button" variant="default" disabled={busy} onClick={resetStyle}>
                    <RotateCcw size={14} />
                    {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.action.resetStyle')}
                  </PmpButton>
                </div>
              </div>
              ) : null}
            </div>
          </section>

          <section className="plugin-dev-workspace__creator-quick-panel">
            <div className="plugin-dev-workspace__creator-panel-heading">
              <span>
                {artifacts.validation.ok
                  ? t('magnet.pluginDevelopmentWorkspace.pluginMagnet.validation.ready')
                  : t('magnet.pluginDevelopmentWorkspace.pluginMagnet.validation.needsFix')}
              </span>
            </div>
            <div className="plugin-dev-workspace__issue-list">
              {artifacts.validation.issues.length > 0 ? (
                artifacts.validation.issues.map((issue, index) => (
                  <button
                    key={`${issue.code}:${index}`}
                    type="button"
                    className={[
                      'plugin-dev-workspace__issue-row',
                      issue.severity === 'error'
                        ? 'plugin-dev-workspace__issue-row--error'
                        : 'plugin-dev-workspace__issue-row--warn',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setEditorSection(readIssueEditorSection(issue))}
                  >
                    <span>{issue.field}</span>
                    <strong>{formatIssue(t, issue)}</strong>
                  </button>
                ))
              ) : (
                <div className="plugin-dev-workspace__empty">
                  {t('magnet.pluginDevelopmentWorkspace.pluginMagnet.validation.empty')}
                </div>
              )}
            </div>
          </section>

          <section className="plugin-dev-workspace__creator-quick-panel">
            <div className="plugin-dev-workspace__creator-panel-heading">
              <span>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.section.output')}</span>
              <FileCode2 size={16} />
            </div>
            <div className="plugin-dev-workspace__creator-artifact-actions">
              <span>{t(readCodeTitleKey(activeCodeSection))}</span>
              <PmpButton
                type="button"
                variant="default"
                disabled={busy}
                onClick={() => void copyCode(activeCodeSection, codeValues[activeCodeSection])}
              >
                <Copy size={14} />
                {copiedCode === activeCodeSection
                  ? t('magnet.pluginDevelopmentWorkspace.pluginMagnet.action.copied')
                  : t('magnet.pluginDevelopmentWorkspace.pluginMagnet.action.copy')}
              </PmpButton>
            </div>
            <details className="plugin-dev-workspace__creator-artifact-details">
              <summary>{t('magnet.pluginDevelopmentWorkspace.pluginMagnet.artifact.preview')}</summary>
              {renderCodeSection(codeValues[activeCodeSection])}
            </details>
          </section>
        </aside>
      </div>
    </div>
  );
}
