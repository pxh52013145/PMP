import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { TelemetryRecord } from '../../contracts/telemetry';
import { useT } from '../../i18n';
import {
  readCurrentTelemetrySession,
  type MagnetTelemetryProfile,
  matchesMagnetTelemetryRecord,
  resolveMagnetTelemetryProfile,
  summarizeTelemetryRecords,
} from '../../modules/debug';
import { getMagnetDisplayName, useMagnetConfig } from '../../modules/magnets';
import type { Magnet } from '../../types/pixel';
import { PmpButton, PmpCard, PmpChoiceButton, PmpSegmented } from '../primitives';
import './MagnetTelemetryWorkbench.css';

type MagnetTelemetryWorkbenchProps = {
  active?: boolean;
};

type MagnetTelemetryFilterId = 'all' | 'active' | 'with-records' | 'registry-gaps';

type MagnetTelemetryEntry = {
  magnet: Magnet;
  displayName: string;
  active: boolean;
  hitCount: number;
  lastMatchedTs: number | null;
  profile: MagnetTelemetryProfile;
  records: TelemetryRecord[];
};

function formatRecordTime(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-';
  return new Date(value).toLocaleTimeString();
}

function formatRecordDateTime(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-';
  return new Date(value).toLocaleString();
}

function formatRecordWindow(records: readonly TelemetryRecord[]): string {
  if (records.length < 1) return 'n/a';
  return `${formatRecordTime(records[0]?.ts ?? null)} -> ${formatRecordTime(
    records[records.length - 1]?.ts ?? null
  )}`;
}

function formatCountList(items: ReadonlyArray<{ key: string; count: number }>, limit = 6): string {
  if (items.length < 1) return '-';
  return items
    .slice(0, limit)
    .map((item) => `${item.key} x ${item.count}`)
    .join('\n');
}

function formatTelemetryRecordLine(record: TelemetryRecord): string {
  const parts = [
    `[${formatRecordTime(record.ts)}]`,
    record.level.toUpperCase(),
    record.moduleId,
    record.event,
  ];
  const message = typeof record.message === 'string' ? record.message.trim() : '';
  if (message) parts.push(message);
  return parts.join(' | ');
}

export function MagnetTelemetryWorkbench({
  active = true,
}: MagnetTelemetryWorkbenchProps) {
  const t = useT();
  const { magnetLibrary, activeMagnetIds } = useMagnetConfig();
  const [records, setRecords] = useState<TelemetryRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedSession, setHasLoadedSession] = useState(false);
  const [selectedMagnetId, setSelectedMagnetId] = useState<string | null>(null);
  const [filterId, setFilterId] = useState<MagnetTelemetryFilterId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const refreshSession = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await readCurrentTelemetrySession();
      if (!session) {
        setRecords([]);
        setError(t('debug.center.magnetTelemetry.error.unavailable'));
        return;
      }
      setRecords(session.records);
    } catch (sessionError) {
      setRecords([]);
      setError(
        sessionError instanceof Error
          ? sessionError.message
          : t('debug.center.magnetTelemetry.error.unavailable')
      );
    } finally {
      setHasLoadedSession(true);
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    if (!active) return;
    if (hasLoadedSession || busy) return;
    void refreshSession();
  }, [active, busy, hasLoadedSession, refreshSession]);

  const entries = useMemo<MagnetTelemetryEntry[]>(() => {
    return magnetLibrary
      .map((magnet) => {
        const profile = resolveMagnetTelemetryProfile(magnet);
        const matchedRecords = records.filter((record) => matchesMagnetTelemetryRecord(record, profile));
        return {
          magnet,
          displayName: getMagnetDisplayName(magnet, t),
          active: activeMagnetIds.has(magnet.id),
          hitCount: matchedRecords.length,
          lastMatchedTs: matchedRecords.length > 0 ? matchedRecords[matchedRecords.length - 1]?.ts ?? null : null,
          profile,
          records: matchedRecords,
        };
      })
      .sort((left, right) => {
        if (left.active !== right.active) return left.active ? -1 : 1;
        if (left.hitCount !== right.hitCount) return right.hitCount - left.hitCount;
        return left.displayName.localeCompare(right.displayName);
      });
  }, [activeMagnetIds, magnetLibrary, records, t]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filterId === 'active' && !entry.active) return false;
      if (filterId === 'with-records' && entry.hitCount < 1) return false;
      if (filterId === 'registry-gaps' && entry.profile.source !== 'heuristic') return false;

      if (!normalizedQuery) return true;
      const haystack = [
        entry.displayName,
        entry.magnet.id,
        entry.magnet.renderer,
        entry.profile.source,
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' | ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [deferredSearchQuery, entries, filterId]);

  useEffect(() => {
    if (filteredEntries.some((entry) => entry.magnet.id === selectedMagnetId)) return;
    setSelectedMagnetId(filteredEntries[0]?.magnet.id ?? null);
  }, [filteredEntries, selectedMagnetId]);

  const selectedEntry = useMemo(
    () => filteredEntries.find((entry) => entry.magnet.id === selectedMagnetId) ?? filteredEntries[0] ?? null,
    [filteredEntries, selectedMagnetId]
  );

  const selectedSummary = useMemo(
    () => summarizeTelemetryRecords(selectedEntry?.records ?? []),
    [selectedEntry]
  );

  const registryCount = useMemo(
    () => entries.filter((entry) => entry.profile.source === 'registry').length,
    [entries]
  );
  const heuristicCount = entries.length - registryCount;
  const withRecordCount = useMemo(
    () => entries.filter((entry) => entry.hitCount > 0).length,
    [entries]
  );
  const activeCount = useMemo(() => entries.filter((entry) => entry.active).length, [entries]);

  return (
    <div className="magnet-telemetry-workbench">
      <PmpCard className="settings-card" surfaceId="primitive.card.settings">
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">{t('debug.center.magnetTelemetry.title')}</p>
            <p className="settings-card-desc">{t('debug.center.magnetTelemetry.desc')}</p>
          </div>
          <PmpButton
            variant="default"
            className="settings-action-btn"
            type="button"
            onClick={() => {
              void refreshSession();
            }}
            disabled={busy}
          >
            {busy
              ? t('debug.center.magnetTelemetry.action.refreshing')
              : t('debug.center.magnetTelemetry.action.refreshSession')}
          </PmpButton>
        </div>

        <div className="magnet-telemetry-summary">
          <div className="magnet-telemetry-stat">
            <span className="magnet-telemetry-stat-value">{entries.length}</span>
            <span className="magnet-telemetry-stat-label">{t('debug.center.magnetTelemetry.stat.total')}</span>
          </div>
          <div className="magnet-telemetry-stat">
            <span className="magnet-telemetry-stat-value">{activeCount}</span>
            <span className="magnet-telemetry-stat-label">{t('debug.center.magnetTelemetry.stat.active')}</span>
          </div>
          <div className="magnet-telemetry-stat">
            <span className="magnet-telemetry-stat-value">{withRecordCount}</span>
            <span className="magnet-telemetry-stat-label">{t('debug.center.magnetTelemetry.stat.withRecords')}</span>
          </div>
          <div className="magnet-telemetry-stat">
            <span className="magnet-telemetry-stat-value">{registryCount}</span>
            <span className="magnet-telemetry-stat-label">{t('debug.center.magnetTelemetry.stat.registry')}</span>
          </div>
          <div className="magnet-telemetry-stat">
            <span className="magnet-telemetry-stat-value">{heuristicCount}</span>
            <span className="magnet-telemetry-stat-label">{t('debug.center.magnetTelemetry.stat.heuristic')}</span>
          </div>
          <div className="magnet-telemetry-stat">
            <span className="magnet-telemetry-stat-value">{records.length}</span>
            <span className="magnet-telemetry-stat-label">{t('debug.center.magnetTelemetry.stat.sessionRecords')}</span>
          </div>
        </div>

        <p className="settings-card-note">{t('debug.center.magnetTelemetry.summary')}</p>
        {error ? (
          <p className="settings-card-note" style={{ color: 'rgba(255,120,120,0.92)' }}>
            {error}
          </p>
        ) : null}
      </PmpCard>

      <div className="magnet-telemetry-main">
        <PmpCard className="settings-card magnet-telemetry-list-card" surfaceId="primitive.card.settings">
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.magnetTelemetry.list.title')}</p>
              <p className="settings-card-desc">{t('debug.center.magnetTelemetry.list.desc')}</p>
            </div>
          </div>

          <div className="magnet-telemetry-toolbar">
            <PmpSegmented className="settings-toggle debug-center-workspace-toggle" surfaceId="primitive.segmented.toggle">
              {(
                [
                  ['all', t('debug.center.magnetTelemetry.filter.all')],
                  ['active', t('debug.center.magnetTelemetry.filter.active')],
                  ['with-records', t('debug.center.magnetTelemetry.filter.withRecords')],
                  ['registry-gaps', t('debug.center.magnetTelemetry.filter.registryGaps')],
                ] as Array<[MagnetTelemetryFilterId, string]>
              ).map(([id, label]) => (
                <PmpChoiceButton
                  key={id}
                  type="button"
                  active={filterId === id}
                  onClick={() => setFilterId(id)}
                >
                  {label}
                </PmpChoiceButton>
              ))}
            </PmpSegmented>

            <input
              className="magnet-telemetry-search"
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('debug.center.magnetTelemetry.searchPlaceholder')}
            />
          </div>

          {filteredEntries.length < 1 ? (
            <p className="settings-card-note">{t('debug.center.magnetTelemetry.empty')}</p>
          ) : (
            <div className="magnet-telemetry-list">
              {filteredEntries.map((entry) => (
                <button
                  key={entry.magnet.id}
                  type="button"
                  className={[
                    'magnet-telemetry-entry',
                    entry.magnet.id === selectedEntry?.magnet.id ? 'is-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setSelectedMagnetId(entry.magnet.id)}
                >
                  <div className="magnet-telemetry-entry-head">
                    <div>
                      <p className="magnet-telemetry-entry-title">{entry.displayName}</p>
                      <p className="magnet-telemetry-entry-meta">{entry.magnet.id}</p>
                    </div>
                    <span className="settings-card-badge">
                      {entry.active
                        ? t('debug.center.magnetTelemetry.entry.active')
                        : t('debug.center.magnetTelemetry.entry.inactive')}
                    </span>
                  </div>
                  <div className="magnet-telemetry-entry-foot">
                    <span className="magnet-telemetry-chip">
                      {entry.profile.source === 'registry'
                        ? t('debug.center.magnetTelemetry.entry.scope.registry')
                        : t('debug.center.magnetTelemetry.entry.scope.heuristic')}
                    </span>
                    <span className="magnet-telemetry-chip">
                      {t('debug.center.magnetTelemetry.entry.records', { count: entry.hitCount })}
                    </span>
                    <span className="magnet-telemetry-chip">
                      {t('debug.center.magnetTelemetry.entry.lastSeen', {
                        time: formatRecordDateTime(entry.lastMatchedTs),
                      })}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </PmpCard>

        <PmpCard className="settings-card magnet-telemetry-detail-card" surfaceId="primitive.card.settings">
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.magnetTelemetry.detail.title')}</p>
              <p className="settings-card-desc">{t('debug.center.magnetTelemetry.detail.desc')}</p>
            </div>
          </div>

          {!selectedEntry ? (
            <p className="settings-card-note">{t('debug.center.magnetTelemetry.detail.empty')}</p>
          ) : (
            <>
              <div className="magnet-telemetry-detail-head">
                <div>
                  <p className="magnet-telemetry-detail-name">{selectedEntry.displayName}</p>
                  <p className="magnet-telemetry-detail-id">{selectedEntry.magnet.id}</p>
                </div>
                <div className="magnet-telemetry-detail-badges">
                  <span className="settings-card-badge">
                    {selectedEntry.profile.source === 'registry'
                      ? t('debug.center.magnetTelemetry.entry.scope.registry')
                      : t('debug.center.magnetTelemetry.entry.scope.heuristic')}
                  </span>
                  <span className="settings-card-badge">
                    {selectedEntry.active
                      ? t('debug.center.magnetTelemetry.entry.active')
                      : t('debug.center.magnetTelemetry.entry.inactive')}
                  </span>
                </div>
              </div>

              <p className="settings-card-note">
                {t('debug.center.magnetTelemetry.detail.scope', {
                  modules:
                    selectedEntry.profile.moduleIds.length > 0
                      ? selectedEntry.profile.moduleIds.join(', ')
                      : '-',
                  events:
                    selectedEntry.profile.eventPrefixes.length > 0
                      ? selectedEntry.profile.eventPrefixes.join(', ')
                      : '-',
                  search:
                    selectedEntry.profile.searchTerms.length > 0
                      ? selectedEntry.profile.searchTerms.slice(0, 4).join(', ')
                      : '-',
                })}
              </p>

              {selectedEntry.profile.source === 'heuristic' ? (
                <p className="settings-card-note">{t('debug.center.magnetTelemetry.note.scopeFallback')}</p>
              ) : null}

              <p className="settings-card-desc">
                {t('debug.center.magnetTelemetry.detail.records', {
                  count: selectedEntry.records.length,
                  window: formatRecordWindow(selectedEntry.records),
                })}
              </p>

              {selectedEntry.records.length < 1 ? (
                <p className="settings-card-note">{t('debug.center.magnetTelemetry.detail.noRecords')}</p>
              ) : (
                <>
                  <div className="magnet-telemetry-detail-grid">
                    <div>
                      <p className="settings-card-note">{t('debug.center.telemetry.query.topEvents')}</p>
                      <pre className="magnet-telemetry-pre">
                        {formatCountList(selectedSummary.eventCounts)}
                      </pre>
                    </div>
                    <div>
                      <p className="settings-card-note">{t('debug.center.telemetry.query.topModules')}</p>
                      <pre className="magnet-telemetry-pre">
                        {formatCountList(selectedSummary.moduleCounts)}
                      </pre>
                    </div>
                    <div>
                      <p className="settings-card-note">{t('debug.center.telemetry.query.topLevels')}</p>
                      <pre className="magnet-telemetry-pre">
                        {formatCountList(selectedSummary.levelCounts)}
                      </pre>
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <p className="settings-card-note">{t('debug.center.telemetry.query.recentRecords')}</p>
                    <pre className="magnet-telemetry-pre magnet-telemetry-pre--tall">
                      {selectedEntry.records
                        .slice(-12)
                        .reverse()
                        .map((record) => formatTelemetryRecordLine(record))
                        .join('\n')}
                    </pre>
                  </div>
                </>
              )}
            </>
          )}
        </PmpCard>
      </div>
    </div>
  );
}
