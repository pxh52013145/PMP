import { useCallback, useEffect, useMemo, useState } from 'react';
import { useKernel } from '../../contexts/KernelContext';
import { useT } from '../../i18n';
import { COMMANDS_SERVICE_TOKEN, canDispatchCommand, dispatchRequiredCommand } from '../../services/commands';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { PmpButton, PmpCard } from '../primitives';

const telemetry = getTelemetryLogger('settings', 'ThemeToolsSettingsPanel');

type ToolEntry = 'keyboardShortcuts' | 'themeEditor';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.platform.toLowerCase().includes('mac');
}

type ToolCardProps = {
  actionLabel: string;
  badge?: string;
  busy: boolean;
  description: string;
  disabledReason: string | null;
  error: string | null;
  note: string;
  onOpen: () => void;
  openingLabel: string;
  title: string;
};

function ToolCard({
  actionLabel,
  badge,
  busy,
  description,
  disabledReason,
  error,
  note,
  onOpen,
  openingLabel,
  title,
}: ToolCardProps) {
  return (
    <PmpCard className="settings-card" surfaceId="primitive.card.settings">
      <div className="settings-card-header">
        <div>
          <p className="settings-card-label">{title}</p>
          <p className="settings-card-desc">{description}</p>
        </div>
        {badge ? <span className="settings-card-badge">{badge}</span> : null}
      </div>

      <div className="settings-param-divider settings-param-divider--compact" />

      <p className="settings-card-note">{note}</p>

      <div className="settings-section-controls settings-section-controls--stretch">
        <PmpButton
          type="button"
          className="settings-action-btn"
          variant="default"
          onClick={onOpen}
          disabled={busy || disabledReason !== null}
        >
          {busy ? openingLabel : actionLabel}
        </PmpButton>
      </div>

      {disabledReason && <p className="settings-card-note">{disabledReason}</p>}
      {error && <p className="settings-card-note">{error}</p>}
    </PmpCard>
  );
}

export function ThemeToolsSettingsPanel() {
  const kernel = useKernel();
  const t = useT();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const isMac = useMemo(() => isMacPlatform(), []);
  const [revision, setRevision] = useState(0);
  const [busyEntry, setBusyEntry] = useState<ToolEntry | null>(null);
  const [errors, setErrors] = useState<Record<ToolEntry, string | null>>({
    keyboardShortcuts: null,
    themeEditor: null,
  });

  useEffect(() => {
    return kernel.contributions.subscribe(() => setRevision((value) => value + 1));
  }, [kernel.contributions]);

  const themeEditorCommand = useMemo(() => {
    void revision;
    return canDispatchCommand(commands, 'app:open-theme-editor-window');
  }, [commands, revision]);
  const keyboardShortcutsCommand = useMemo(() => {
    void revision;
    return canDispatchCommand(commands, 'app:open-keyboard-shortcuts-window');
  }, [commands, revision]);

  const unavailableReason = !isTauri
    ? t('settings.themeTools.desktopOnly')
    : !themeEditorCommand
      ? t('settings.themeTools.error.windowMissing')
      : null;
  const keyboardShortcutsUnavailableReason = !keyboardShortcutsCommand
    ? t('settings.tools.keyboardShortcuts.error.windowMissing')
    : null;
  const keyboardShortcutsBadge = isMac ? 'Cmd+K Cmd+S' : 'Ctrl+K Ctrl+S';

  const openTool = useCallback(
    async ({
      entry,
      open,
      missingMessage,
      openFailedMessage,
      requireDesktopRuntime = false,
    }: {
      entry: ToolEntry;
      missingMessage: string;
      openFailedMessage: (message: string) => string;
      open: (() => Promise<void>) | null;
      requireDesktopRuntime?: boolean;
    }) => {
      if (busyEntry) return;

      setErrors((current) => ({
        ...current,
        [entry]: null,
      }));

      if (requireDesktopRuntime && !isTauri) {
        setErrors((current) => ({
          ...current,
          [entry]: t('settings.themeTools.desktopOnly'),
        }));
        return;
      }

      if (!open) {
        telemetry.warn('settings.tools.window.missing', {
          fields: {
            entry,
          },
        });
        setErrors((current) => ({
          ...current,
          [entry]: missingMessage,
        }));
        return;
      }

      setBusyEntry(entry);
      telemetry.info('settings.tools.open.requested', {
        fields: {
          entry,
        },
      });

      try {
        await open();
        telemetry.info('settings.tools.open.completed', {
          fields: {
            entry,
          },
        });
      } catch (openError) {
        const message = getErrorMessage(openError);
        telemetry.error('settings.tools.open.failed', {
          message,
          fields: {
            entry,
          },
        });
        setErrors((current) => ({
          ...current,
          [entry]: openFailedMessage(message),
        }));
      } finally {
        setBusyEntry((current) => (current === entry ? null : current));
      }
    },
    [busyEntry, isTauri, t]
  );

  const handleOpenThemeEditor = useCallback(() => {
    void openTool({
      entry: 'themeEditor',
      open: themeEditorCommand
        ? () =>
            dispatchRequiredCommand(
              commands,
              'app:open-theme-editor-window',
              t('settings.themeTools.error.windowMissing')
            )
        : null,
      missingMessage: t('settings.themeTools.error.windowMissing'),
      openFailedMessage: (message) => t('settings.themeTools.error.openFailed', { message }),
      requireDesktopRuntime: true,
    });
  }, [commands, openTool, t, themeEditorCommand]);

  const handleOpenKeyboardShortcuts = useCallback(() => {
    void openTool({
      entry: 'keyboardShortcuts',
      open: keyboardShortcutsCommand
        ? () =>
            dispatchRequiredCommand(
              commands,
              'app:open-keyboard-shortcuts-window',
              t('settings.tools.keyboardShortcuts.error.windowMissing')
            )
        : null,
      missingMessage: t('settings.tools.keyboardShortcuts.error.windowMissing'),
      openFailedMessage: (message) => t('settings.tools.keyboardShortcuts.error.openFailed', { message }),
    });
  }, [commands, keyboardShortcutsCommand, openTool, t]);

  return (
    <>
      <ToolCard
        title={t('windows.editor.theme.title')}
        description={t('settings.themeTools.cardDesc')}
        note={t('settings.themeTools.note')}
        actionLabel={t('settings.themeTools.open')}
        openingLabel={t('settings.themeTools.opening')}
        busy={busyEntry === 'themeEditor'}
        disabledReason={unavailableReason}
        error={errors.themeEditor}
        onOpen={handleOpenThemeEditor}
      />

      <ToolCard
        title={t('pages.keyboard-shortcuts.title')}
        description={t('settings.tools.keyboardShortcuts.desc')}
        note={t('settings.tools.keyboardShortcuts.note', { shortcut: keyboardShortcutsBadge })}
        actionLabel={t('settings.tools.keyboardShortcuts.open')}
        openingLabel={t('settings.tools.keyboardShortcuts.opening')}
        badge={keyboardShortcutsBadge}
        busy={busyEntry === 'keyboardShortcuts'}
        disabledReason={keyboardShortcutsUnavailableReason}
        error={errors.keyboardShortcuts}
        onOpen={handleOpenKeyboardShortcuts}
      />
    </>
  );
}
