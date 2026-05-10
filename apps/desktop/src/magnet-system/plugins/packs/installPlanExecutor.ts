import type {
  PmpInstallPlanDiagnosticV1,
  PmpInstallPlanStepV1,
  PmpInstallPlanV1,
} from '@pixel-matrix/plugin-platform-contracts';
import type { InstalledHostExtensionRecord } from '../extensions';
import {
  cleanupExtensionPackMaterializedSource,
  commitExtensionPackExecutorPreview,
  dryRunExtensionPackExecutorPreview,
} from './extensionPackExecutor';
import { createInstallPlanBackup, restoreInstallPlanBackup } from './installPlanExecutorBackup';
import {
  commitApplyProfileStep,
  commitApplySpaceLayoutStep,
  commitApplyThemeStep,
  commitInstallResourceStep,
  createBlockedStepResult,
  createCommittedStepResult,
  createReadyStepResult,
  dryRunApplyProfileStep,
  dryRunApplySpaceLayoutStep,
  dryRunApplyThemeStep,
  dryRunInstallResourceStep,
} from './installPlanExecutorSteps';
import type {
  InstallPlanCommitStatus,
  InstallPlanExecutorBackup,
  InstallPlanExecutorCommitResult,
  InstallPlanExecutorContext,
  InstallPlanExecutorDryRunResult,
  InstallPlanExecutorStepResult,
  InstallPlanExecutorStatus,
} from './installPlanExecutorTypes';

function createDiagnostic(
  severity: PmpInstallPlanDiagnosticV1['severity'],
  code: string,
  message: string,
  targetStepId?: string,
  details?: unknown
): PmpInstallPlanDiagnosticV1 {
  return {
    severity,
    code,
    message,
    ...(targetStepId ? { targetStepId } : {}),
    ...(typeof details === 'undefined' ? {} : { details }),
  };
}

function flattenDiagnostics(
  plan: PmpInstallPlanV1,
  stepResults: InstallPlanExecutorStepResult[]
): PmpInstallPlanDiagnosticV1[] {
  const diagnostics = [
    ...(plan.diagnostics ?? []),
    ...stepResults.flatMap((result) => result.diagnostics),
  ];
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = [
      diagnostic.severity,
      diagnostic.code,
      diagnostic.targetStepId ?? '',
      diagnostic.message,
    ].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveDryRunStatus(
  diagnostics: PmpInstallPlanDiagnosticV1[],
  stepResults: InstallPlanExecutorStepResult[]
): InstallPlanExecutorStatus {
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return 'blocked';
  if (stepResults.some((result) => result.status === 'blocked')) return 'blocked';
  if (stepResults.some((result) => result.status === 'pending-user-input')) return 'pending-user-input';
  return 'ready';
}

function resolveCommitStatus(
  diagnostics: PmpInstallPlanDiagnosticV1[],
  completedStepIds: string[],
  plan: PmpInstallPlanV1
): InstallPlanCommitStatus {
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return 'blocked';
  }
  return completedStepIds.length === plan.steps.length ? 'committed' : 'partial';
}

function assertDependenciesSatisfied(
  step: PmpInstallPlanStepV1,
  completedStepIds: Set<string>
): InstallPlanExecutorStepResult | null {
  const missing = (step.dependsOn ?? []).filter((stepId) => !completedStepIds.has(stepId));
  if (missing.length === 0) return null;
  return createBlockedStepResult(
    step.id,
    step.kind,
    'install-plan.executor.dependency-unsatisfied',
    `Step dependencies are not satisfied: ${missing.join(', ')}`
  );
}

function isBackupMutatingStep(step: PmpInstallPlanStepV1): boolean {
  return step.kind === 'apply-theme' || step.kind === 'apply-profile' || step.kind === 'apply-space-layout';
}

function getDryRunStepResult(
  dryRun: InstallPlanExecutorDryRunResult,
  stepId: string
): InstallPlanExecutorStepResult | undefined {
  return dryRun.stepResults.find((result) => result.stepId === stepId);
}

async function dryRunStep(
  step: PmpInstallPlanStepV1,
  context: InstallPlanExecutorContext,
  extensionDryRuns: InstallPlanExecutorDryRunResult['extensionDryRuns']
): Promise<InstallPlanExecutorStepResult> {
  switch (step.kind) {
    case 'verify-integrity':
      return createReadyStepResult(step.id, step.kind);
    case 'install-extension': {
      const preview = context.extensionPreviewsByStepId?.[step.id];
      if (!preview) {
        return createBlockedStepResult(
          step.id,
          step.kind,
          'install-plan.install-extension.preview-missing',
          'Embedded extension preview is missing.'
        );
      }
      const dryRun = await dryRunExtensionPackExecutorPreview(preview);
      extensionDryRuns[step.id] = dryRun;
      return {
        stepId: step.id,
        kind: step.kind,
        status: dryRun.status === 'ready' ? 'ready' : 'blocked',
        diagnostics: dryRun.diagnostics,
        details: {
          fileCount: dryRun.materializedSource.fileCount,
          totalBytes: dryRun.materializedSource.totalBytes,
        },
      };
    }
    case 'install-resource':
      return await dryRunInstallResourceStep(step, context);
    case 'refresh-plugin-registries':
      return createReadyStepResult(step.id, step.kind);
    case 'apply-theme':
      return await dryRunApplyThemeStep(step, context);
    case 'apply-profile':
      return await dryRunApplyProfileStep(step, context);
    case 'apply-space-layout':
      return await dryRunApplySpaceLayoutStep(step, context);
    case 'report':
      return {
        stepId: step.id,
        kind: step.kind,
        status: step.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
          ? 'blocked'
          : 'ready',
        diagnostics: step.diagnostics,
      };
    default: {
      const unsupportedStep = step as { id: string; kind: string };
      return createBlockedStepResult(
        unsupportedStep.id,
        'report',
        'install-plan.executor.unsupported-step',
        `Unsupported install plan step kind: ${unsupportedStep.kind}`
      );
    }
  }
}

async function commitStep(
  step: PmpInstallPlanStepV1,
  context: InstallPlanExecutorContext,
  dryRun: InstallPlanExecutorDryRunResult,
  installedExtensions: InstalledHostExtensionRecord[]
): Promise<InstallPlanExecutorStepResult> {
  switch (step.kind) {
    case 'verify-integrity':
      return createCommittedStepResult(step.id, step.kind);
    case 'install-extension': {
      const preview = context.extensionPreviewsByStepId?.[step.id];
      const extensionDryRun = dryRun.extensionDryRuns[step.id];
      if (!preview || !extensionDryRun) {
        return createBlockedStepResult(
          step.id,
          step.kind,
          'install-plan.install-extension.preview-missing',
          'Embedded extension dry-run is missing.'
        );
      }
      const commit = await commitExtensionPackExecutorPreview(preview, {
        dryRun: extensionDryRun,
        defaultEnabled: context.defaultEnabled,
      });
      if (commit.status !== 'installed' || !commit.installedExtension) {
        return {
          stepId: step.id,
          kind: step.kind,
          status: 'blocked',
          diagnostics: commit.diagnostics.length > 0
            ? commit.diagnostics
            : [
                createDiagnostic(
                  'error',
                  'install-plan.install-extension.commit-blocked',
                  'Extension commit was blocked by executor validation.',
                  step.id
                ),
              ],
        };
      }
      installedExtensions.push(commit.installedExtension);
      return {
        stepId: step.id,
        kind: step.kind,
        status: 'committed',
        diagnostics: commit.diagnostics,
        details: {
          pluginId: commit.installedExtension.manifest.identity.id,
          version: commit.installedExtension.manifest.identity.version,
        },
      };
    }
    case 'install-resource':
      return await commitInstallResourceStep(step, context, getDryRunStepResult(dryRun, step.id));
    case 'refresh-plugin-registries':
      return createCommittedStepResult(step.id, step.kind);
    case 'apply-theme':
      return await commitApplyThemeStep(step, context, getDryRunStepResult(dryRun, step.id));
    case 'apply-profile':
      return await commitApplyProfileStep(step, context);
    case 'apply-space-layout':
      return await commitApplySpaceLayoutStep(step, context);
    case 'report':
      return {
        stepId: step.id,
        kind: step.kind,
        status: step.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
          ? 'blocked'
          : 'committed',
        diagnostics: step.diagnostics,
      };
    default: {
      const unsupportedStep = step as { id: string; kind: string };
      return createBlockedStepResult(
        unsupportedStep.id,
        'report',
        'install-plan.executor.unsupported-step',
        `Unsupported install plan step kind: ${unsupportedStep.kind}`
      );
    }
  }
}

export async function cleanupInstallPlanDryRun(
  dryRun: InstallPlanExecutorDryRunResult | null | undefined
): Promise<void> {
  if (!dryRun) return;
  await Promise.all(
    Object.values(dryRun.extensionDryRuns).map((extensionDryRun) =>
      cleanupExtensionPackMaterializedSource(extensionDryRun.materializedSource)
    )
  );
}

export async function dryRunInstallPlan(
  plan: PmpInstallPlanV1,
  context: InstallPlanExecutorContext = {}
): Promise<InstallPlanExecutorDryRunResult> {
  const stepResults: InstallPlanExecutorStepResult[] = [];
  const completedStepIds = new Set<string>();
  const extensionDryRuns: InstallPlanExecutorDryRunResult['extensionDryRuns'] = {};

  for (const step of plan.steps) {
    const dependencyFailure = assertDependenciesSatisfied(step, completedStepIds);
    if (dependencyFailure) {
      stepResults.push(dependencyFailure);
      break;
    }

    const result = await dryRunStep(step, context, extensionDryRuns);
    stepResults.push(result);
    if (result.status === 'ready' || result.status === 'skipped') {
      completedStepIds.add(step.id);
    }
    if (result.status === 'blocked' || result.status === 'pending-user-input') {
      break;
    }
  }

  const diagnostics = flattenDiagnostics(plan, stepResults);
  const status = resolveDryRunStatus(diagnostics, stepResults);
  const result: InstallPlanExecutorDryRunResult = {
    mode: 'dry-run',
    status,
    plan,
    diagnostics,
    stepResults,
    completedStepIds: [...completedStepIds],
    extensionDryRuns,
  };

  if (status !== 'ready') {
    await cleanupInstallPlanDryRun(result);
  }

  return result;
}

export async function commitInstallPlan(
  plan: PmpInstallPlanV1,
  context: InstallPlanExecutorContext = {},
  dryRun?: InstallPlanExecutorDryRunResult
): Promise<InstallPlanExecutorCommitResult> {
  const readyDryRun = dryRun ?? (await dryRunInstallPlan(plan, context));
  if (readyDryRun.status !== 'ready') {
    await cleanupInstallPlanDryRun(readyDryRun);
    return {
      mode: 'commit',
      status: 'blocked',
      plan,
      dryRun: readyDryRun,
      diagnostics: readyDryRun.diagnostics,
      stepResults: readyDryRun.stepResults,
      completedStepIds: [],
      installedExtensions: [],
      installedResources: [],
    };
  }

  const stepResults: InstallPlanExecutorStepResult[] = [];
  const completedStepIds = new Set<string>();
  const installedExtensions: InstalledHostExtensionRecord[] = [];
  const installedResources: unknown[] = [];
  let backup: InstallPlanExecutorBackup | undefined;
  let recoveredFromBackup = false;

  try {
    for (const step of plan.steps) {
      const dependencyFailure = assertDependenciesSatisfied(step, completedStepIds);
      if (dependencyFailure) {
        stepResults.push(dependencyFailure);
        break;
      }

      if (!backup && isBackupMutatingStep(step)) {
        backup = await createInstallPlanBackup(plan.id, context);
      }

      const result = await commitStep(step, context, readyDryRun, installedExtensions);
      stepResults.push(result);
      if (result.kind === 'install-resource' && result.status === 'committed') {
        const detail = result.details as { installedResource?: unknown } | undefined;
        if (detail?.installedResource) installedResources.push(detail.installedResource);
      }
      if (result.status === 'committed' || result.status === 'skipped') {
        completedStepIds.add(step.id);
      }
      if (result.status === 'blocked' || result.status === 'pending-user-input') {
        break;
      }
    }
  } catch (error) {
    stepResults.push({
      stepId: 'executor',
      kind: 'report',
      status: 'blocked',
      diagnostics: [
        createDiagnostic(
          'error',
          'install-plan.executor.commit-failed',
          error instanceof Error ? error.message : String(error)
        ),
      ],
    });

    if (backup) {
      try {
        await restoreInstallPlanBackup(backup.snapshotText, context);
        recoveredFromBackup = true;
      } catch (restoreError) {
        stepResults.push({
          stepId: 'executor:backup-restore',
          kind: 'report',
          status: 'blocked',
          diagnostics: [
            createDiagnostic(
              'error',
              'install-plan.executor.backup-restore-failed',
              restoreError instanceof Error ? restoreError.message : String(restoreError)
            ),
          ],
        });
      }
    }
  }

  const diagnostics = flattenDiagnostics(plan, stepResults);
  const status = resolveCommitStatus(diagnostics, [...completedStepIds], plan);

  await cleanupInstallPlanDryRun(readyDryRun);

  return {
    mode: 'commit',
    status,
    plan,
    dryRun: readyDryRun,
    diagnostics,
    stepResults,
    completedStepIds: [...completedStepIds],
    backup,
    installedExtensions,
    installedResources,
    recoveredFromBackup,
  };
}
