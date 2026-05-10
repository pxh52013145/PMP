import type { PmpInstallPlanV1 } from '@pixel-matrix/plugin-platform-contracts';
import type { ThemeImportCandidate } from '../../../themes/types/themeImport';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyThemeMock,
  broadcastDataUpdateMock,
  cleanupExtensionPackMaterializedSourceMock,
  commitExtensionPackExecutorPreviewMock,
  dryRunExtensionPackExecutorPreviewMock,
  readJsonMock,
  writeDurableTextMock,
} = vi.hoisted(() => ({
  applyThemeMock: vi.fn(async () => undefined),
  broadcastDataUpdateMock: vi.fn(async () => undefined),
  cleanupExtensionPackMaterializedSourceMock: vi.fn(async () => undefined),
  commitExtensionPackExecutorPreviewMock: vi.fn(async () => ({
    mode: 'commit',
    status: 'installed',
    dryRun: {},
    installedExtension: {
      manifest: {
        identity: {
          id: 'com.example.visualizer',
          version: '1.0.0',
          publisher: 'example',
          name: 'Example Visualizer',
        },
      },
    },
    diagnostics: [],
    completedStepIds: ['install-extension:com.example.visualizer'],
  })),
  dryRunExtensionPackExecutorPreviewMock: vi.fn(async () => ({
    mode: 'dry-run',
    status: 'ready',
    materializedSource: {
      rootRelativePath: 'pmp-temp/test',
      rootDir: 'C:/cache/pmp-temp/test',
      fileCount: 2,
      totalBytes: 10,
    },
    nativeInstallSource: {},
    checks: {
      packageDigestMatches: true,
      manifestIdentityMatches: true,
      fileListMatches: true,
      nativeValidationPassed: true,
    },
    diagnostics: [],
  })),
  readJsonMock: vi.fn((_key: string, fallback: unknown) => fallback),
  writeDurableTextMock: vi.fn(async () => true),
}));

vi.mock('./extensionPackExecutor', () => ({
  cleanupExtensionPackMaterializedSource: cleanupExtensionPackMaterializedSourceMock,
  commitExtensionPackExecutorPreview: commitExtensionPackExecutorPreviewMock,
  dryRunExtensionPackExecutorPreview: dryRunExtensionPackExecutorPreviewMock,
}));

vi.mock('../../../modules/storage', () => ({
  readJson: readJsonMock,
  writeDurableText: writeDurableTextMock,
}));

vi.mock('../../../utils/tauriRuntime', () => ({
  isTauriRuntime: vi.fn(() => false),
}));

vi.mock('../../../utils/windowCommunication', () => ({
  STORAGE_KEYS: {
    MAGNET_SPACES: 'spaces',
    THEME_CONFIG: 'theme',
  },
  TAURI_EVENTS: {
    MAGNET_SPACES_UPDATED: 'spaces-updated',
  },
  broadcastDataUpdate: broadcastDataUpdateMock,
}));

vi.mock('../../../modules/magnets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/magnets')>();
  return {
    ...actual,
    magnetLayoutStoreApplyPatchWithRetry: vi.fn(async () => ({ ok: true })),
    magnetLayoutStoreBootstrap: vi.fn(async () => null),
    magnetLayoutStoreGetState: vi.fn(async () => null),
  };
});

function createTheme(): ThemeImportCandidate {
  return {
    id: 'dark-stage',
    name: 'Dark Stage',
    version: '1.0.0',
    pixel: {
      shape: 'square',
      size: 20,
      opacity: 1,
      colors: {
        default: { slot: 'primary' },
        hover: { slot: 'primary', state: 'hover' },
        active: { slot: 'accent', state: 'active' },
        occupied: { slot: 'secondary' },
      },
    },
    background: {
      maximized: { type: 'color', color: '#000000' },
      windowed: { type: 'color', color: '#101010' },
    },
    fonts: {
      primary: 'Inter',
    },
  };
}

function createBasePlan(steps: PmpInstallPlanV1['steps']): PmpInstallPlanV1 {
  return {
    formatVersion: '1.0',
    id: 'experience-pack:test:1.0.0',
    status: 'ready',
    source: {
      packageType: 'experience-pack',
      source: { kind: 'memory' },
    },
    summary: {
      title: 'Test Pack',
      packageType: 'experience-pack',
    },
    steps,
  };
}

describe('installPlanExecutor', () => {
  beforeEach(() => {
    applyThemeMock.mockClear();
    broadcastDataUpdateMock.mockClear();
    cleanupExtensionPackMaterializedSourceMock.mockClear();
    commitExtensionPackExecutorPreviewMock.mockClear();
    dryRunExtensionPackExecutorPreviewMock.mockClear();
    readJsonMock.mockClear();
    writeDurableTextMock.mockClear();
  });

  it('dry-runs and commits extension steps serially through the extension-pack executor', async () => {
    const { commitInstallPlan, dryRunInstallPlan } = await import('./installPlanExecutor');
    const plan = createBasePlan([
      { id: 'verify-integrity', kind: 'verify-integrity', source: { kind: 'memory' } },
      {
        id: 'install-extension:com.example.visualizer',
        kind: 'install-extension',
        dependsOn: ['verify-integrity'],
        pluginId: 'com.example.visualizer',
        manifestPath: 'extension/manifest.v2.json',
        source: { kind: 'embedded', path: 'plugins/visualizer.pmpe' },
      },
      {
        id: 'refresh-plugin-registries',
        kind: 'refresh-plugin-registries',
        dependsOn: ['install-extension:com.example.visualizer'],
      },
    ]);
    const context = {
      extensionPreviewsByStepId: {
        'install-extension:com.example.visualizer': {} as never,
      },
    };

    const dryRun = await dryRunInstallPlan(plan, context);
    expect(dryRun.status).toBe('ready');
    expect(dryRun.completedStepIds).toEqual([
      'verify-integrity',
      'install-extension:com.example.visualizer',
      'refresh-plugin-registries',
    ]);

    const commit = await commitInstallPlan(plan, context, dryRun);
    expect(commit.status).toBe('committed');
    expect(commit.completedStepIds).toEqual([
      'verify-integrity',
      'install-extension:com.example.visualizer',
      'refresh-plugin-registries',
    ]);
    expect(commitExtensionPackExecutorPreviewMock).toHaveBeenCalledTimes(1);
    expect(cleanupExtensionPackMaterializedSourceMock).toHaveBeenCalled();
  });

  it('blocks when semantic step dependencies are not satisfied', async () => {
    const { dryRunInstallPlan } = await import('./installPlanExecutor');
    const plan = createBasePlan([
      {
        id: 'apply-theme',
        kind: 'apply-theme',
        dependsOn: ['install-extension:com.example.visualizer'],
        source: { kind: 'embedded', path: 'theme.pmpt' },
        themePath: 'theme.pmpt',
      },
    ]);

    const dryRun = await dryRunInstallPlan(plan, {
      themeSourcesByPath: { 'theme.pmpt': { path: 'theme.pmpt', text: JSON.stringify(createTheme()) } },
    });

    expect(dryRun.status).toBe('blocked');
    expect(dryRun.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'install-plan.executor.dependency-unsatisfied',
      })
    );
  });

  it('returns pending-user-input for prompt space layout steps', async () => {
    const { dryRunInstallPlan } = await import('./installPlanExecutor');
    const plan = createBasePlan([
      {
        id: 'apply-space-layout',
        kind: 'apply-space-layout',
        source: { kind: 'embedded', path: 'profile.json' },
        profilePath: 'profile.json',
        mode: 'prompt',
      },
    ]);

    const dryRun = await dryRunInstallPlan(plan, {
      profileSourcesByPath: {
        'profile.json': {
          path: 'profile.json',
          text: '{}',
          profile: { formatVersion: '1.0' },
        },
      },
    });

    expect(dryRun.status).toBe('pending-user-input');
    expect(dryRun.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'install-plan.apply-space-layout.pending-user-input',
      })
    );
  });

  it('commits resource steps with the existing dry-run validation result', async () => {
    const { commitInstallPlan, dryRunInstallPlan } = await import('./installPlanExecutor');
    const dryRunResource = vi.fn(async () => ({ id: 'shader.stage', version: '1.0.0' }));
    const commitResource = vi.fn(async () => ({ installed: true }));
    const plan = createBasePlan([
      {
        id: 'install-resource:shader.stage',
        kind: 'install-resource',
        resourceId: 'shader.stage',
        resourceType: 'shader-pack',
        versionRange: '1.0.0',
        source: { kind: 'embedded', path: 'resources/shader.pmps' },
      },
    ]);
    const context = {
      resourceSourcesByStepId: {
        'install-resource:shader.stage': {
          stepId: 'install-resource:shader.stage',
          resourceId: 'shader.stage',
          resourceType: 'shader-pack',
          sourcePath: 'resources/shader.pmps',
          bytes: new Uint8Array([1, 2, 3]),
        },
      },
      dryRunResource,
      commitResource,
    };

    const dryRun = await dryRunInstallPlan(plan, context);
    const commit = await commitInstallPlan(plan, context, dryRun);

    expect(commit.status).toBe('committed');
    expect(dryRunResource).toHaveBeenCalledTimes(1);
    expect(commitResource).toHaveBeenCalledTimes(1);
    expect(commit.installedResources).toEqual([{ installed: true }]);
  });

  it('applies the parsed theme captured during dry-run', async () => {
    const { commitInstallPlan, dryRunInstallPlan } = await import('./installPlanExecutor');
    const themeText = JSON.stringify(createTheme());
    const plan = createBasePlan([
      {
        id: 'apply-theme',
        kind: 'apply-theme',
        source: { kind: 'embedded', path: 'theme.pmpt' },
        themePath: 'theme.pmpt',
      },
    ]);
    const context = {
      currentTheme: createTheme(),
      applyTheme: applyThemeMock,
      themeSourcesByPath: {
        'theme.pmpt': { path: 'theme.pmpt', text: themeText },
      },
    };

    const dryRun = await dryRunInstallPlan(plan, context);
    const dryRunTheme = (dryRun.stepResults[0].details as { theme: ThemeImportCandidate }).theme;
    const commit = await commitInstallPlan(plan, context, dryRun);

    expect(commit.status).toBe('committed');
    expect(applyThemeMock).toHaveBeenCalledTimes(1);
    const applyThemeCalls = applyThemeMock.mock.calls as unknown as [[ThemeImportCandidate]];
    expect(applyThemeCalls[0][0]).toBe(dryRunTheme);
  });

  it('creates a backup before the first mutating step commits', async () => {
    const { commitInstallPlan, dryRunInstallPlan } = await import('./installPlanExecutor');
    const themeText = JSON.stringify(createTheme());
    const plan = createBasePlan([
      { id: 'verify-integrity', kind: 'verify-integrity', source: { kind: 'memory' } },
      {
        id: 'apply-theme',
        kind: 'apply-theme',
        dependsOn: ['verify-integrity'],
        source: { kind: 'embedded', path: 'theme.pmpt' },
        themePath: 'theme.pmpt',
      },
    ]);
    const context = {
      currentTheme: createTheme(),
      applyTheme: applyThemeMock,
      themeSourcesByPath: {
        'theme.pmpt': { path: 'theme.pmpt', text: themeText },
      },
    };

    const dryRun = await dryRunInstallPlan(plan, context);
    const commit = await commitInstallPlan(plan, context, dryRun);

    expect(commit.status).toBe('committed');
    expect(writeDurableTextMock).toHaveBeenCalledWith(
      'install-plan-backup',
      expect.stringMatching(/^experience-pack-test-1.0.0-/),
      expect.any(String)
    );
    expect(writeDurableTextMock.mock.invocationCallOrder[0]).toBeLessThan(
      applyThemeMock.mock.invocationCallOrder[0]
    );
  });
});
