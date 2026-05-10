import type {
  PmpInstallPlanDiagnosticV1,
  PmpInstallPlanStepKind,
  PmpInstallPlanStepV1,
  PmpInstallPlanV1,
} from '@pixel-matrix/plugin-platform-contracts';
import type { Magnet } from '../../../types/pixel';
import type { Theme } from '../../../themes/types/theme';
import type { ThemeImportCandidate } from '../../../themes/types/themeImport';
import type { ExtensionPackExecutorDryRunResult } from './extensionPackExecutor';
import type { ExtensionPackExecutorPreview } from './extensionPack';
import type { ProfilePackProfileV1 } from '../../../themes/packs/profilePack';
import type { InstalledHostExtensionRecord } from '../extensions';

export type InstallPlanExecutorStatus = 'ready' | 'blocked' | 'pending-user-input';
export type InstallPlanCommitStatus = 'committed' | 'blocked' | 'partial';

export interface InstallPlanEmbeddedResourceSource {
  stepId: string;
  resourceId: string;
  resourceType: string;
  sourcePath: string;
  bytes: Uint8Array;
}

export interface InstallPlanThemeSource {
  path: string;
  text: string;
}

export interface InstallPlanProfileSource {
  path: string;
  text: string;
  profile: ProfilePackProfileV1;
}

export interface InstallPlanResourceValidationResult {
  id: string;
  version?: string;
  details?: unknown;
}

export interface InstallPlanExecutorStepResult {
  stepId: string;
  kind: PmpInstallPlanStepKind;
  status: 'ready' | 'blocked' | 'pending-user-input' | 'committed' | 'skipped';
  diagnostics: PmpInstallPlanDiagnosticV1[];
  details?: unknown;
}

export interface InstallPlanExecutorBackup {
  id: string;
  createdAt: number;
  durableKey: string;
  snapshotText: string;
}

export interface InstallPlanExecutorDryRunResult {
  mode: 'dry-run';
  status: InstallPlanExecutorStatus;
  plan: PmpInstallPlanV1;
  diagnostics: PmpInstallPlanDiagnosticV1[];
  stepResults: InstallPlanExecutorStepResult[];
  completedStepIds: string[];
  extensionDryRuns: Record<string, ExtensionPackExecutorDryRunResult>;
}

export interface InstallPlanExecutorCommitResult {
  mode: 'commit';
  status: InstallPlanCommitStatus;
  plan: PmpInstallPlanV1;
  dryRun: InstallPlanExecutorDryRunResult;
  diagnostics: PmpInstallPlanDiagnosticV1[];
  stepResults: InstallPlanExecutorStepResult[];
  completedStepIds: string[];
  backup?: InstallPlanExecutorBackup;
  installedExtensions: InstalledHostExtensionRecord[];
  installedResources: unknown[];
  recoveredFromBackup?: boolean;
}

export interface InstallPlanExecutorContext {
  extensionPreviewsByStepId?: Record<string, ExtensionPackExecutorPreview>;
  resourceSourcesByStepId?: Record<string, InstallPlanEmbeddedResourceSource>;
  themeSourcesByPath?: Record<string, InstallPlanThemeSource>;
  profileSourcesByPath?: Record<string, InstallPlanProfileSource>;
  currentTheme?: Theme;
  applyTheme?: (theme: ThemeImportCandidate) => Promise<void>;
  magnetLibrary?: Magnet[];
  registeredRendererIds?: ReadonlySet<string>;
  defaultEnabled?: boolean;
  dryRunResource?: (
    source: InstallPlanEmbeddedResourceSource
  ) => Promise<InstallPlanResourceValidationResult>;
  commitResource?: (source: InstallPlanEmbeddedResourceSource) => Promise<unknown>;
}

export type InstallPlanStepExecutor = (
  step: PmpInstallPlanStepV1,
  context: InstallPlanExecutorContext
) => Promise<InstallPlanExecutorStepResult>;
