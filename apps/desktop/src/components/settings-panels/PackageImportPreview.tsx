import type { PmpInstallPlanV1 } from '@pixel-matrix/plugin-platform-contracts';
import { useT } from '../../i18n';

export interface PackageImportPreviewProps {
  plan: PmpInstallPlanV1;
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : '-';
}

export function buildPackageImportPreviewText(
  plan: PmpInstallPlanV1,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  const lines: string[] = [
    t('settings.plugins.preview.package', {
      name: plan.summary.title,
      id: plan.source.metadata?.id ?? plan.id,
      version: plan.source.metadata?.version ?? '-',
    }),
    t('settings.plugins.preview.type', { type: plan.summary.packageType }),
  ];

  if (plan.summary.description) {
    lines.push(t('settings.plugins.preview.description', { description: plan.summary.description }));
  }

  lines.push(
    t('settings.plugins.preview.counts', {
      extensions: plan.summary.extensionCount ?? 0,
      resources: plan.summary.resourceCount ?? 0,
    })
  );

  const applies: string[] = [];
  if (plan.summary.appliesTheme) applies.push(t('settings.plugins.preview.applies.theme'));
  if (plan.summary.appliesProfile) applies.push(t('settings.plugins.preview.applies.profile'));
  if (plan.summary.appliesSpaces) applies.push(t('settings.plugins.preview.applies.spaces'));
  if (applies.length > 0) {
    lines.push(t('settings.plugins.preview.applies', { applies: formatList(applies) }));
  }

  const installSteps = plan.steps.map((step) => `${step.id} (${step.kind})`);
  lines.push('', t('settings.plugins.preview.steps'), installSteps.map((step) => `- ${step}`).join('\n'));

  if ((plan.dependencies ?? []).length > 0) {
    lines.push(
      '',
      t('settings.plugins.preview.dependencies.title'),
      (plan.dependencies ?? [])
        .map((dependency) =>
          `- ${dependency.id}${dependency.versionRange ? ` ${dependency.versionRange}` : ''} ${t(
            'settings.plugins.preview.dependencies.noAutoInstall'
          )}`
        )
        .join('\n')
    );
  }

  const reviewItems = plan.reviewItems ?? [];
  if (reviewItems.length > 0) {
    lines.push(
      '',
      t('settings.plugins.preview.review.title'),
      reviewItems
        .map((item) => `- ${item.title ?? item.id}${item.message ? `: ${item.message}` : ''}`)
        .join('\n')
    );
  }

  const diagnostics = plan.diagnostics ?? [];
  if (diagnostics.length > 0) {
    lines.push(
      '',
      t('settings.plugins.preview.diagnostics.title'),
      diagnostics
        .map((diagnostic) => `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`)
        .join('\n')
    );
  }

  return lines.filter((line) => line.length > 0).join('\n');
}

export function PackageImportPreview({ plan }: PackageImportPreviewProps) {
  const t = useT();
  return <pre className="settings-package-import-preview">{buildPackageImportPreviewText(plan, t)}</pre>;
}
