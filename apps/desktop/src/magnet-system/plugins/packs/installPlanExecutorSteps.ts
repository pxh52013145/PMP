import type {
  PmpApplyProfileStepV1,
  PmpApplySpaceLayoutStepV1,
  PmpApplyThemeStepV1,
  PmpInstallPlanDiagnosticV1,
  PmpInstallResourceStepV1,
} from '@pixel-matrix/plugin-platform-contracts';
import { BUILTIN_MAGNET_IDS } from '../../../constants/magnets';
import {
  createDefaultMagnetSpacesState,
  createNextSpaceId,
  magnetLayoutStoreApplyPatchWithRetry,
  magnetLayoutStoreBootstrap,
  magnetLayoutStoreGetState,
  resolveMagnetConfigStorageKey,
  resolveMagnetLayoutStorageKey,
  sanitizeMagnetSpaceLayout,
  sanitizeMagnetSpacesState,
  type MagnetLayoutStorePatch,
  type MagnetSpacesState,
} from '../../../modules/magnets';
import { readJson } from '../../../modules/storage';
import { normalizeTheme } from '../../../themes/normalizeTheme';
import type { ThemeImportCandidate } from '../../../themes/types/themeImport';
import {
  filterMagnetConfigSnapshotForImportWithReport,
  filterMagnetSpaceLayoutForImportWithReport,
} from '../../../themes/packs/profilePackApply';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import { broadcastDataUpdate, STORAGE_KEYS, TAURI_EVENTS } from '../../../utils/windowCommunication';
import type {
  InstallPlanExecutorContext,
  InstallPlanExecutorStepResult,
  InstallPlanProfileSource,
} from './installPlanExecutorTypes';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createDiagnostic(
  severity: PmpInstallPlanDiagnosticV1['severity'],
  code: string,
  message: string,
  targetStepId: string,
  details?: unknown
): PmpInstallPlanDiagnosticV1 {
  return {
    severity,
    code,
    message,
    targetStepId,
    ...(typeof details === 'undefined' ? {} : { details }),
  };
}

function createStepResult(
  stepId: string,
  kind: InstallPlanExecutorStepResult['kind'],
  status: InstallPlanExecutorStepResult['status'],
  diagnostics: PmpInstallPlanDiagnosticV1[] = [],
  details?: unknown
): InstallPlanExecutorStepResult {
  return {
    stepId,
    kind,
    status,
    diagnostics,
    ...(typeof details === 'undefined' ? {} : { details }),
  };
}

function parseThemeSource(text: string): ThemeImportCandidate {
  const parsed = JSON.parse(text) as ThemeImportCandidate;
  normalizeTheme(parsed);
  return parsed;
}

function readResourceDryRunDetails(
  details: InstallPlanExecutorStepResult['details']
): { id: string; version?: string; details?: unknown } | null {
  if (!isPlainObject(details) || typeof details.id !== 'string') return null;
  return {
    id: details.id,
    ...(typeof details.version === 'string' ? { version: details.version } : {}),
    ...(typeof details.details === 'undefined' ? {} : { details: details.details }),
  };
}

function readThemeDryRunDetails(
  details: InstallPlanExecutorStepResult['details']
): { theme: ThemeImportCandidate; missingRendererIds: string[] } | null {
  if (!isPlainObject(details) || !isPlainObject(details.theme)) return null;
  const missingRendererIds = Array.isArray(details.missingRendererIds)
    ? details.missingRendererIds.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    theme: details.theme as unknown as ThemeImportCandidate,
    missingRendererIds,
  };
}

function collectMissingThemeRenderers(
  theme: ThemeImportCandidate,
  registeredRendererIds: ReadonlySet<string> | undefined
): string[] {
  if (!registeredRendererIds || !isPlainObject(theme.bindings)) return [];

  const missing = new Set<string>();
  for (const binding of Object.values(theme.bindings)) {
    if (!isPlainObject(binding)) continue;
    const renderer = typeof binding.renderer === 'string' ? binding.renderer.trim() : '';
    if (renderer && !registeredRendererIds.has(renderer)) {
      missing.add(renderer);
    }
  }

  return [...missing].sort();
}

function getProfileSource(
  context: InstallPlanExecutorContext,
  profilePath: string
): InstallPlanProfileSource | null {
  return context.profileSourcesByPath?.[profilePath] ?? null;
}

function buildAllowedMagnetIds(context: InstallPlanExecutorContext): Set<string> {
  const allowed = new Set<string>(BUILTIN_MAGNET_IDS);
  for (const magnet of context.magnetLibrary ?? []) {
    const id = magnet.id.trim();
    if (id) allowed.add(id);
  }
  return allowed;
}

async function loadLayoutStoreState() {
  if (!isTauriRuntime()) return null;
  const bootstrapped = await magnetLayoutStoreBootstrap(BUILTIN_MAGNET_IDS, 'all-known-spaces');
  return bootstrapped?.state ?? (await magnetLayoutStoreGetState());
}

async function applyLayoutPatches(patches: MagnetLayoutStorePatch[], reason: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const store = await magnetLayoutStoreGetState();
  const response = await magnetLayoutStoreApplyPatchWithRetry({
    expectedRevision: store?.revision ?? 0,
    patches,
    reason,
  });
  return Boolean(response?.ok);
}

function collectProfileConfigDiagnostics(
  step: PmpApplyProfileStepV1,
  profileSource: InstallPlanProfileSource,
  allowedMagnetIds: ReadonlySet<string>
): PmpInstallPlanDiagnosticV1[] {
  const diagnostics: PmpInstallPlanDiagnosticV1[] = [];
  const rawConfigs = profileSource.profile.magnets?.spaceConfig?.value;
  if (!isPlainObject(rawConfigs)) return diagnostics;

  const skippedMagnetIds = new Set<string>();
  const skippedCustomMagnetIds = new Set<string>();

  for (const configValue of Object.values(rawConfigs)) {
    if (!isPlainObject(configValue)) continue;
    const filtered = filterMagnetConfigSnapshotForImportWithReport(configValue, allowedMagnetIds);
    for (const id of filtered.report.skippedMagnetIds) skippedMagnetIds.add(id);
    for (const id of filtered.report.skippedCustomMagnetIds) skippedCustomMagnetIds.add(id);
  }

  if (skippedMagnetIds.size > 0) {
    diagnostics.push(
      createDiagnostic(
        'warning',
        'install-plan.apply-profile.skipped-magnets',
        `${skippedMagnetIds.size} unknown magnet config entries will be skipped.`,
        step.id,
        { magnetIds: [...skippedMagnetIds].sort() }
      )
    );
  }
  if (skippedCustomMagnetIds.size > 0) {
    diagnostics.push(
      createDiagnostic(
        'warning',
        'install-plan.apply-profile.skipped-custom-magnets',
        `${skippedCustomMagnetIds.size} custom magnet entries will be skipped because profile import does not create custom magnets.`,
        step.id,
        { magnetIds: [...skippedCustomMagnetIds].sort() }
      )
    );
  }

  return diagnostics;
}

async function commitProfileConfigs(
  step: PmpApplyProfileStepV1,
  profileSource: InstallPlanProfileSource,
  allowedMagnetIds: ReadonlySet<string>
): Promise<PmpInstallPlanDiagnosticV1[]> {
  const diagnostics = collectProfileConfigDiagnostics(step, profileSource, allowedMagnetIds);
  if (step.applyMagnets === false) return diagnostics;

  const rawConfigs = profileSource.profile.magnets?.spaceConfig?.value;
  if (!isPlainObject(rawConfigs)) return diagnostics;

  for (const [spaceId, configValue] of Object.entries(rawConfigs)) {
    if (!isPlainObject(configValue)) continue;
    const filtered = filterMagnetConfigSnapshotForImportWithReport(configValue, allowedMagnetIds);
    await broadcastDataUpdate(resolveMagnetConfigStorageKey(spaceId), filtered.value);
  }

  return diagnostics;
}

function collectSpaceLayoutDiagnostics(
  step: PmpApplySpaceLayoutStepV1,
  profileSource: InstallPlanProfileSource,
  allowedMagnetIds: ReadonlySet<string>
): PmpInstallPlanDiagnosticV1[] {
  const diagnostics: PmpInstallPlanDiagnosticV1[] = [];
  const rawLayouts = profileSource.profile.magnets?.spaceLayout?.value;
  if (!isPlainObject(rawLayouts)) return diagnostics;

  const skippedMagnetIds = new Set<string>();
  for (const layoutValue of Object.values(rawLayouts)) {
    if (!isPlainObject(layoutValue) || layoutValue.version !== 1) continue;
    const filtered = filterMagnetSpaceLayoutForImportWithReport(
      sanitizeMagnetSpaceLayout(layoutValue),
      allowedMagnetIds
    );
    for (const id of filtered.report.skippedMagnetIds) skippedMagnetIds.add(id);
  }

  if (skippedMagnetIds.size > 0) {
    diagnostics.push(
      createDiagnostic(
        'warning',
        'install-plan.apply-space-layout.skipped-magnets',
        `${skippedMagnetIds.size} unknown magnet layout entries will be skipped.`,
        step.id,
        { magnetIds: [...skippedMagnetIds].sort() }
      )
    );
  }

  return diagnostics;
}

function buildCreateNewSpacesState(
  current: MagnetSpacesState,
  imported: MagnetSpacesState
): { spaces: MagnetSpacesState; idMap: Record<string, string> } {
  const existingIds = new Set(current.spaces.map((space) => space.id));
  const idMap: Record<string, string> = {};
  const nextSpaces = [...current.spaces];

  for (const space of imported.spaces) {
    const nextId = existingIds.has(space.id)
      ? createNextSpaceId({ ...current, spaces: nextSpaces })
      : space.id;
    existingIds.add(nextId);
    idMap[space.id] = nextId;
    nextSpaces.push({
      ...space,
      id: nextId,
      name: existingIds.has(space.id) && nextId !== space.id ? `${space.name} (${nextId})` : space.name,
    });
  }

  return {
    spaces: {
      ...current,
      spaces: nextSpaces,
      activeSpaceId: idMap[imported.activeSpaceId] ?? current.activeSpaceId,
    },
    idMap,
  };
}

async function commitSpaceLayouts(
  step: PmpApplySpaceLayoutStepV1,
  profileSource: InstallPlanProfileSource,
  allowedMagnetIds: ReadonlySet<string>
): Promise<PmpInstallPlanDiagnosticV1[]> {
  const diagnostics = collectSpaceLayoutDiagnostics(step, profileSource, allowedMagnetIds);
  const rawSpaces = profileSource.profile.magnets?.spaces?.value;
  const rawLayouts = profileSource.profile.magnets?.spaceLayout?.value;

  if (!isPlainObject(rawSpaces) || rawSpaces.version !== 1) {
    return [
      ...diagnostics,
      createDiagnostic(
        'error',
        'install-plan.apply-space-layout.invalid-spaces',
        'Profile space layout entry is missing a valid spaces snapshot.',
        step.id
      ),
    ];
  }
  if (!isPlainObject(rawLayouts)) return diagnostics;

  const importedSpaces = sanitizeMagnetSpacesState(rawSpaces);
  let nextSpaces = importedSpaces;
  let idMap: Record<string, string> = Object.fromEntries(importedSpaces.spaces.map((space) => [space.id, space.id]));

  if (step.mode === 'create-new-spaces') {
    const store = await loadLayoutStoreState();
    const currentSpaces =
      store?.spaces ??
      sanitizeMagnetSpacesState(readJson(STORAGE_KEYS.MAGNET_SPACES, createDefaultMagnetSpacesState()));
    const created = buildCreateNewSpacesState(currentSpaces, importedSpaces);
    nextSpaces = created.spaces;
    idMap = created.idMap;
  }

  const spaceIds = new Set(nextSpaces.spaces.map((space) => space.id));
  const patches: MagnetLayoutStorePatch[] = [{ kind: 'setSpacesState', spaces: nextSpaces }];
  const shouldUseLayoutStore = isTauriRuntime();

  for (const [sourceSpaceId, layoutValue] of Object.entries(rawLayouts)) {
    const targetSpaceId = idMap[sourceSpaceId] ?? sourceSpaceId;
    if (!spaceIds.has(targetSpaceId)) continue;
    if (!isPlainObject(layoutValue) || layoutValue.version !== 1) continue;
    const filtered = filterMagnetSpaceLayoutForImportWithReport(
      sanitizeMagnetSpaceLayout(layoutValue),
      allowedMagnetIds
    );
    if (shouldUseLayoutStore) {
      patches.push({ kind: 'setSpaceLayout', spaceId: targetSpaceId, layout: filtered.layout });
    } else {
      await broadcastDataUpdate(resolveMagnetLayoutStorageKey(targetSpaceId), filtered.layout);
    }
  }

  if (shouldUseLayoutStore) {
    const ok = await applyLayoutPatches(patches, `installPlan.${step.mode}`);
    if (!ok) {
      return [
        ...diagnostics,
        createDiagnostic(
          'error',
          'install-plan.apply-space-layout.store-failed',
          'Failed to apply magnet layout store patches.',
          step.id
        ),
      ];
    }
  } else {
    await broadcastDataUpdate(STORAGE_KEYS.MAGNET_SPACES, nextSpaces, TAURI_EVENTS.MAGNET_SPACES_UPDATED);
  }

  return diagnostics;
}

export async function dryRunInstallResourceStep(
  step: PmpInstallResourceStepV1,
  context: InstallPlanExecutorContext
): Promise<InstallPlanExecutorStepResult> {
  const source = context.resourceSourcesByStepId?.[step.id];
  if (!source) {
    return createStepResult(step.id, step.kind, step.required === false ? 'skipped' : 'blocked', [
      createDiagnostic('error', 'install-plan.install-resource.source-missing', 'Resource source is missing.', step.id),
    ]);
  }

  if (step.resourceType !== 'shader-pack') {
    const diagnostic = createDiagnostic(
      step.required === false ? 'warning' : 'error',
      'install-plan.install-resource.unsupported-type',
      `Resource type "${step.resourceType}" is not supported by the local executor yet.`,
      step.id
    );
    return createStepResult(step.id, step.kind, step.required === false ? 'skipped' : 'blocked', [diagnostic]);
  }

  if (!context.dryRunResource) {
    return createStepResult(step.id, step.kind, step.required === false ? 'skipped' : 'blocked', [
      createDiagnostic(
        step.required === false ? 'warning' : 'error',
        'install-plan.install-resource.executor-missing',
        'Resource dry-run callback is missing.',
        step.id
      ),
    ]);
  }

  try {
    const parsed = await context.dryRunResource(source);
    return createStepResult(step.id, step.kind, 'ready', [], {
      id: parsed.id,
      version: parsed.version,
      details: parsed.details,
    });
  } catch (error) {
    return createStepResult(step.id, step.kind, 'blocked', [
      createDiagnostic(
        'error',
        'install-plan.install-resource.validation-failed',
        error instanceof Error ? error.message : String(error),
        step.id
      ),
    ]);
  }
}

export async function commitInstallResourceStep(
  step: PmpInstallResourceStepV1,
  context: InstallPlanExecutorContext,
  dryRunStep?: InstallPlanExecutorStepResult
): Promise<InstallPlanExecutorStepResult> {
  const source = context.resourceSourcesByStepId?.[step.id];
  if (!source || step.resourceType !== 'shader-pack') {
    return await dryRunInstallResourceStep(step, context);
  }

  const readyDryRun = dryRunStep?.status === 'ready'
    ? dryRunStep
    : await dryRunInstallResourceStep(step, context);
  if (readyDryRun.status !== 'ready') return readyDryRun;

  if (!context.commitResource) {
    return createStepResult(step.id, step.kind, step.required === false ? 'skipped' : 'blocked', [
      createDiagnostic(
        step.required === false ? 'warning' : 'error',
        'install-plan.install-resource.executor-missing',
        'Resource commit callback is missing.',
        step.id
      ),
    ]);
  }

  const installed = await context.commitResource(source);
  const parsed = readResourceDryRunDetails(readyDryRun.details);
  return createStepResult(step.id, step.kind, 'committed', [], {
    id: parsed?.id ?? step.resourceId,
    version: parsed?.version ?? step.versionRange,
    details: parsed?.details,
    installedResource: installed,
  });
}

export async function dryRunApplyThemeStep(
  step: PmpApplyThemeStepV1,
  context: InstallPlanExecutorContext
): Promise<InstallPlanExecutorStepResult> {
  const source = context.themeSourcesByPath?.[step.themePath];
  if (!source) {
    return createStepResult(step.id, step.kind, 'blocked', [
      createDiagnostic('error', 'install-plan.apply-theme.source-missing', 'Theme source is missing.', step.id),
    ]);
  }

  try {
    const parsed = parseThemeSource(source.text);
    const missingRenderers = collectMissingThemeRenderers(parsed, context.registeredRendererIds);
    const diagnostics =
      missingRenderers.length > 0
        ? [
            createDiagnostic(
              'warning',
              'install-plan.apply-theme.missing-renderers',
              `${missingRenderers.length} theme renderer binding(s) reference renderers that are not currently registered.`,
              step.id,
              { rendererIds: missingRenderers }
            ),
          ]
        : [];
    return createStepResult(step.id, step.kind, 'ready', diagnostics, {
      theme: parsed,
      missingRendererIds: missingRenderers,
    });
  } catch (error) {
    return createStepResult(step.id, step.kind, 'blocked', [
      createDiagnostic(
        'error',
        'install-plan.apply-theme.invalid-theme',
        error instanceof Error ? error.message : String(error),
        step.id
      ),
    ]);
  }
}

export async function commitApplyThemeStep(
  step: PmpApplyThemeStepV1,
  context: InstallPlanExecutorContext,
  dryRunStep?: InstallPlanExecutorStepResult
): Promise<InstallPlanExecutorStepResult> {
  const dryRun = dryRunStep?.status === 'ready'
    ? dryRunStep
    : await dryRunApplyThemeStep(step, context);
  if (dryRun.status !== 'ready') return dryRun;
  if (!context.applyTheme) {
    return createStepResult(step.id, step.kind, 'blocked', [
      createDiagnostic('error', 'install-plan.apply-theme.executor-missing', 'Theme apply callback is missing.', step.id),
    ]);
  }
  const dryRunDetails = readThemeDryRunDetails(dryRun.details);
  if (!dryRunDetails) {
    return createStepResult(step.id, step.kind, 'blocked', [
      createDiagnostic(
        'error',
        'install-plan.apply-theme.dry-run-details-missing',
        'Theme dry-run result is missing parsed theme details.',
        step.id
      ),
    ]);
  }
  await context.applyTheme(dryRunDetails.theme);
  return createStepResult(step.id, step.kind, 'committed', dryRun.diagnostics);
}

export async function dryRunApplyProfileStep(
  step: PmpApplyProfileStepV1,
  context: InstallPlanExecutorContext
): Promise<InstallPlanExecutorStepResult> {
  const source = getProfileSource(context, step.profilePath);
  if (!source) {
    return createStepResult(step.id, step.kind, 'blocked', [
      createDiagnostic('error', 'install-plan.apply-profile.source-missing', 'Profile source is missing.', step.id),
    ]);
  }
  const diagnostics = collectProfileConfigDiagnostics(step, source, buildAllowedMagnetIds(context));
  return createStepResult(step.id, step.kind, 'ready', diagnostics);
}

export async function commitApplyProfileStep(
  step: PmpApplyProfileStepV1,
  context: InstallPlanExecutorContext
): Promise<InstallPlanExecutorStepResult> {
  const source = getProfileSource(context, step.profilePath);
  if (!source) return await dryRunApplyProfileStep(step, context);
  const diagnostics = await commitProfileConfigs(step, source, buildAllowedMagnetIds(context));
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return createStepResult(step.id, step.kind, 'blocked', diagnostics);
  }
  return createStepResult(step.id, step.kind, 'committed', diagnostics);
}

export async function dryRunApplySpaceLayoutStep(
  step: PmpApplySpaceLayoutStepV1,
  context: InstallPlanExecutorContext
): Promise<InstallPlanExecutorStepResult> {
  const source = getProfileSource(context, step.profilePath);
  if (!source) {
    return createStepResult(step.id, step.kind, 'blocked', [
      createDiagnostic('error', 'install-plan.apply-space-layout.source-missing', 'Profile source is missing.', step.id),
    ]);
  }

  if (step.mode === 'prompt' || step.mode === 'map-one-space') {
    return createStepResult(step.id, step.kind, 'pending-user-input', [
      createDiagnostic(
        'warning',
        'install-plan.apply-space-layout.pending-user-input',
        `Space layout mode "${step.mode}" requires an explicit UI mapping before commit.`,
        step.id
      ),
    ]);
  }

  const diagnostics = collectSpaceLayoutDiagnostics(step, source, buildAllowedMagnetIds(context));
  return createStepResult(step.id, step.kind, 'ready', diagnostics);
}

export async function commitApplySpaceLayoutStep(
  step: PmpApplySpaceLayoutStepV1,
  context: InstallPlanExecutorContext
): Promise<InstallPlanExecutorStepResult> {
  const source = getProfileSource(context, step.profilePath);
  if (!source) return await dryRunApplySpaceLayoutStep(step, context);
  if (step.mode === 'prompt' || step.mode === 'map-one-space') {
    return await dryRunApplySpaceLayoutStep(step, context);
  }
  const diagnostics = await commitSpaceLayouts(step, source, buildAllowedMagnetIds(context));
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return createStepResult(step.id, step.kind, 'blocked', diagnostics);
  }
  return createStepResult(step.id, step.kind, 'committed', diagnostics);
}

export function createReadyStepResult(stepId: string, kind: InstallPlanExecutorStepResult['kind']) {
  return createStepResult(stepId, kind, 'ready');
}

export function createCommittedStepResult(stepId: string, kind: InstallPlanExecutorStepResult['kind']) {
  return createStepResult(stepId, kind, 'committed');
}

export function createBlockedStepResult(
  stepId: string,
  kind: InstallPlanExecutorStepResult['kind'],
  code: string,
  message: string
) {
  return createStepResult(stepId, kind, 'blocked', [createDiagnostic('error', code, message, stepId)]);
}
