import {
  cleanupInstallPlanDryRun,
  commitInstallPlan,
  dryRunInstallPlan,
} from './installPlanExecutor';
import type {
  InstallPlanExecutorCommitResult,
  InstallPlanExecutorContext,
  InstallPlanExecutorDryRunResult,
} from './installPlanExecutorTypes';
import type { ExperiencePackExecutorPreview } from './experiencePack';

export function createExperiencePackInstallPlanContext(
  preview: ExperiencePackExecutorPreview,
  context: Omit<
    InstallPlanExecutorContext,
    | 'extensionPreviewsByStepId'
    | 'resourceSourcesByStepId'
    | 'themeSourcesByPath'
    | 'profileSourcesByPath'
  > = {}
): InstallPlanExecutorContext {
  return {
    ...context,
    extensionPreviewsByStepId: Object.fromEntries(
      Object.entries(preview.extensionPacksByStepId).map(([stepId, parsed]) => [
        stepId,
        parsed.executorPreview,
      ])
    ),
    resourceSourcesByStepId: preview.resourceSourcesByStepId,
    themeSourcesByPath: preview.themeSourcesByPath,
    profileSourcesByPath: preview.profileSourcesByPath,
  };
}

export async function dryRunExperiencePackExecutorPreview(
  preview: ExperiencePackExecutorPreview,
  context: Parameters<typeof createExperiencePackInstallPlanContext>[1] = {}
): Promise<InstallPlanExecutorDryRunResult> {
  return await dryRunInstallPlan(
    preview.plan,
    createExperiencePackInstallPlanContext(preview, context)
  );
}

export async function commitExperiencePackExecutorPreview(
  preview: ExperiencePackExecutorPreview,
  options: Parameters<typeof createExperiencePackInstallPlanContext>[1] & {
    dryRun?: InstallPlanExecutorDryRunResult;
  } = {}
): Promise<InstallPlanExecutorCommitResult> {
  const { dryRun, ...context } = options;
  return await commitInstallPlan(
    preview.plan,
    createExperiencePackInstallPlanContext(preview, context),
    dryRun
  );
}

export async function cleanupExperiencePackExecutorDryRun(
  dryRun: InstallPlanExecutorDryRunResult | null | undefined
): Promise<void> {
  await cleanupInstallPlanDryRun(dryRun);
}
