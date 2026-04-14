import React, { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { exists } from '@tauri-apps/api/fs';
import { resolve as resolvePath } from '@tauri-apps/api/path';

import {
  BarChart3,
  ChevronLeft,
  Check,
  Clock3,
  Compass,
  Disc3,
  Filter,
  Heart,
  LayoutGrid,
  Library,
  Mic,
  MoreHorizontal,
  Music,
  Play,
  Plus,
  Radio,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Tv,
  X,
} from 'lucide-react';

import { useAudioService } from '../../../contexts/AudioEngineContext';
import { useT } from '../../../i18n';
import type { Playlist as AudioPlaylist, Track as AudioTrack } from '../../../services/audio';
import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';
import {
  PLATFORM_MAGNET_VARIANT_PRESETS,
  parsePlatformMagnetSkinProps,
  type PlatformMagnetDefaultMode,
} from './platformMagnetSkin';
import {
  MOCK_INSTANCES,
  MOCK_LOCAL_PLAYLISTS,
  MOCK_LOADED_STATE,
  type MockChannel,
  type MockChannelIcon,
  type MockInstance,
  type MockPlaylist,
  type MockTrack,
  type PlatformKind,
} from './platformMockData';

import './PlatformMagnet.css';

type IconComponent = ComponentType<{ className?: string; style?: React.CSSProperties }>;
type PageId = 'daily' | 'local' | 'config' | string;
type SearchScope = 'loaded' | 'local' | string;
type SettingsTabId = 'host' | string;
type CreateView = 'create' | 'existing';
type ContentTransitionPhase = 'entered' | 'entering' | 'exiting';
type ParsedPageId =
  | { kind: 'daily' }
  | { kind: 'local' }
  | { kind: 'config' }
  | { kind: 'instance'; instanceId: string }
  | { kind: 'detail'; instanceId: string; detailId: string };

type SearchResult = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  badges: string[];
  sourceId: string;
  playlistName: string;
  platform: PlatformKind | 'local';
  coverUrl?: string;
};

type SearchSnapshot = {
  query: string;
  results: SearchResult[];
  emptyText: string;
};

type DetailPageContent = {
  kicker: string;
  title: string;
  subtitle: string;
  tracks: MockTrack[];
};

type CreateStagedTrack = MockTrack & {
  platform: PlatformKind;
};

type PlatformMagnetRendererProps = {
  skinProps?: Record<string, unknown>;
};

const PLATFORM_META: Record<
  PlatformKind,
  { labelKey: string; accent: string; Icon: IconComponent }
> = {
  netease: {
    labelKey: 'magnet.platform-login.platform.netease',
    accent: '#ff6b87',
    Icon: Disc3,
  },
  bilibili: {
    labelKey: 'magnet.platform-login.platform.bilibili',
    accent: '#67c7ff',
    Icon: Tv,
  },
  qqmusic: {
    labelKey: 'magnet.platform-login.platform.qqmusic',
    accent: '#56db8d',
    Icon: Music,
  },
};

const ACTIVE_MOCK_PLATFORM_KINDS = Array.from(
  new Set(MOCK_INSTANCES.map((instance) => instance.platform))
) as PlatformKind[];

const CHANNEL_ICON_MAP: Record<MockChannelIcon, IconComponent> = {
  clock: Clock3,
  chart: BarChart3,
  sparkles: Sparkles,
  heart: Heart,
  radio: Radio,
  library: Library,
};

const HOST_SETTINGS = {
  aggregation: ['Loaded', 'Daily', 'Pinned'],
  search: ['All', 'Loaded', 'Scoped'],
  identify: ['Slot', 'Mic'],
} as const;

const MOCK_PLAYBACK_SAMPLE_CANDIDATES = [
  ['..', '..', 'Eagles_Hotel_California.flac'],
  ['..', 'Eagles_Hotel_California.flac'],
  ['Eagles_Hotel_California.flac'],
] as const;

let mockPlaybackSamplePathPromise: Promise<string | null> | null = null;
const PLATFORM_DETAIL_PAGE_PREFIX = 'detail:';

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function readTelemetryErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatDurationSeconds(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '00:00';
  }
  const wholeSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function parseDurationLabel(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const [minutesText, secondsText] = trimmed.split(':');
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return undefined;
  return minutes * 60 + seconds;
}

function filterLocalAudioPlaylists(playlists: AudioPlaylist[]): AudioPlaylist[] {
  return playlists.filter((playlist) => playlist.kind !== 'platform' && playlist.kind !== 'smart');
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function audioTrackToMockTrack(track: AudioTrack): MockTrack {
  const sourcePlatform = Array.isArray(track.tags)
    ? (track.tags.find((tag): tag is PlatformKind | 'local' =>
        tag === 'netease' || tag === 'bilibili' || tag === 'qqmusic' || tag === 'local'
      ) ?? 'local')
    : 'local';

  return {
    id: typeof track.id === 'string' && track.id.trim().length > 0 ? track.id : `track-${Date.now()}`,
    title: track.title,
    artist: track.artist ?? '',
    album: track.album ?? '',
    duration: formatDurationSeconds(track.duration),
    badges: Array.isArray(track.tags) && track.tags.length > 0 ? track.tags.slice(0, 3) : ['Local'],
    coverUrl: track.coverUrl,
    sourcePlatform,
  };
}

function audioPlaylistToMockPlaylist(playlist: AudioPlaylist): MockPlaylist {
  return {
    id: playlist.id,
    name: playlist.name,
    note: playlist.description ?? '',
    tracks: Array.isArray(playlist.tracks) ? playlist.tracks.map(audioTrackToMockTrack) : [],
  };
}

async function resolveMockPlaybackSamplePath(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  if (!mockPlaybackSamplePathPromise) {
    mockPlaybackSamplePathPromise = (async () => {
      for (const candidate of MOCK_PLAYBACK_SAMPLE_CANDIDATES) {
        try {
          const absolutePath = await resolvePath(...candidate);
          if (await exists(absolutePath)) {
            return absolutePath;
          }
        } catch {
          continue;
        }
      }
      return null;
    })();
  }

  return mockPlaybackSamplePathPromise;
}

function mockTrackToAudioTrack(
  track: MockTrack,
  instance: MockInstance,
  samplePath: string | null
): AudioTrack {
  return {
    id: `platform-mock:${instance.id}:${track.id}`,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: parseDurationLabel(track.duration),
    tags: ['Platform Mock', instance.platform],
    comment: 'platform-magnet mock playback sample',
    ...(samplePath
      ? {
          path: samplePath,
          filePath: samplePath,
          originalPath: samplePath,
        }
      : {}),
  };
}

function resolveInitialPage(defaultMode: PlatformMagnetDefaultMode): PageId {
  if (defaultMode === 'bilibili') return 'bilibili-main';
  if (defaultMode === 'netease') return 'netease-main';
  return 'daily';
}

function createDetailPageId(instanceId: string, detailId: string): PageId {
  return `${PLATFORM_DETAIL_PAGE_PREFIX}${instanceId}:${detailId}`;
}

function parsePlatformPageId(pageId: PageId): ParsedPageId {
  if (pageId === 'daily') return { kind: 'daily' };
  if (pageId === 'local') return { kind: 'local' };
  if (pageId === 'config') return { kind: 'config' };
  if (pageId.startsWith(PLATFORM_DETAIL_PAGE_PREFIX)) {
    const detailPath = pageId.slice(PLATFORM_DETAIL_PAGE_PREFIX.length);
    const [instanceId, ...detailParts] = detailPath.split(':');
    const detailId = detailParts.join(':');
    if (instanceId && detailId) {
      return { kind: 'detail', instanceId, detailId };
    }
  }
  return { kind: 'instance', instanceId: pageId };
}

function getPlatformName(
  t: (key: string, params?: Record<string, unknown>) => string,
  platform: PlatformKind
): string {
  return t(PLATFORM_META[platform].labelKey);
}

function resolveChannelTracks(instance: MockInstance, channel: MockChannel): MockTrack[] {
  if (channel.detailPlaylistId) {
    return instance.playlists.find((playlist) => playlist.id === channel.detailPlaylistId)?.tracks ?? instance.queue;
  }
  return instance.queue;
}

function resolveDetailPageContent(
  t: (key: string, params?: Record<string, unknown>) => string,
  instance: MockInstance,
  detailId: string
): DetailPageContent {
  const platformName = getPlatformName(t, instance.platform);

  if (detailId === 'daily') {
    return {
      kicker: t('magnet.platform.daily.title'),
      title: t('magnet.platform.mock.detail.daily.title', { platform: platformName }),
      subtitle: t('magnet.platform.mock.detail.daily.subtitle'),
      tracks: instance.queue,
    };
  }

  const channel = instance.channels.find((item) => item.id === detailId);
  if (!channel) {
    return {
      kicker: t('magnet.platform.daily.title'),
      title: t('magnet.platform.mock.detail.daily.title', { platform: platformName }),
      subtitle: t('magnet.platform.mock.detail.daily.subtitle'),
      tracks: instance.queue,
    };
  }

  return {
    kicker: t(channel.titleKey),
    title: `${platformName} ${t(channel.titleKey)}`,
    subtitle: t(channel.subtitleKey),
    tracks: resolveChannelTracks(instance, channel),
  };
}

function collectSearchResults(
  scope: SearchScope,
  query: string,
  loadedInstances: MockInstance[],
  instancesById: Record<string, MockInstance>,
  localPlaylists: MockPlaylist[],
  selectedPlatforms: PlatformKind[],
  limit: number
): SearchResult[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return [];

  const results: SearchResult[] = [];
  const pushTracks = (
    tracks: MockTrack[],
    playlistName: string,
    sourceId: string,
    platform: PlatformKind | 'local'
  ): void => {
    for (const track of tracks) {
      const haystack = `${track.title} ${track.artist} ${track.album} ${playlistName}`.toLowerCase();
      if (!haystack.includes(keyword)) continue;
      results.push({
        id: `${sourceId}-${playlistName}-${track.id}`,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        badges: track.badges,
        coverUrl: track.coverUrl,
        sourceId,
        playlistName,
        platform: track.sourcePlatform ?? platform,
      });
    }
  };

  if (scope === 'local') {
    for (const playlist of localPlaylists) {
      pushTracks(playlist.tracks, playlist.name, 'local', 'local');
    }
    return results.slice(0, limit);
  }

  const targetInstances =
    scope === 'loaded'
      ? loadedInstances.filter((instance) => selectedPlatforms.includes(instance.platform))
      : instancesById[scope]
        ? [instancesById[scope]]
        : [];

  for (const instance of targetInstances) {
    pushTracks(instance.queue, 'Daily', instance.id, instance.platform);
    for (const playlist of instance.playlists) {
      pushTracks(playlist.tracks, playlist.name, instance.id, instance.platform);
    }
  }

  return results.slice(0, limit);
}

function getTrackDisplayBadges(track: Pick<MockTrack, 'badges'> | Pick<SearchResult, 'badges'>): string[] {
  const filtered = track.badges.filter((badge) => badge.trim().length > 0 && badge !== 'Daily');
  return filtered.slice(0, 2);
}

function getTrackCoverLabel(track: { album: string; title: string }): string {
  const seed = track.album.trim() || track.title.trim();
  return seed.slice(0, 1).toUpperCase() || 'M';
}

function getTrackCoverStyle(platform: PlatformKind | 'local', seed: string): React.CSSProperties {
  const accent = platform === 'local' ? '#a1a1aa' : PLATFORM_META[platform].accent;
  const hueRotate = hashString(seed) % 36;
  return {
    background: `linear-gradient(145deg, color-mix(in srgb, ${accent} 48%, #ffffff 8%), color-mix(in srgb, ${accent} 22%, #0d131b 78%))`,
    filter: `hue-rotate(${hueRotate}deg) saturate(0.96)`,
  };
}

function PlatformGlyph({
  platform,
  active = false,
  compact = false,
}: {
  platform: PlatformKind;
  active?: boolean;
  compact?: boolean;
}): JSX.Element {
  const meta = PLATFORM_META[platform];
  const Icon = meta.Icon;

  return (
    <span
      className={cx(
        'platform-preview-soft-ring inline-flex shrink-0 items-center justify-center rounded-full',
        compact ? 'h-9 w-9' : 'h-11 w-11'
      )}
      style={{
        color: meta.accent,
        background: active ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
        boxShadow: active
          ? 'inset 0 0 0 1px rgba(255,255,255,0.12)'
          : 'inset 0 0 0 1px rgba(255,255,255,0.06)',
      }}
    >
      <Icon className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
    </span>
  );
}

function TrackCover({
  track,
  platform,
  sizeClassName = 'h-11 w-11',
  shapeClassName = 'rounded-[14px]',
  labelClassName = 'text-sm',
}: {
  track: { album: string; title: string; coverUrl?: string };
  platform: PlatformKind | 'local';
  sizeClassName?: string;
  shapeClassName?: string;
  labelClassName?: string;
}): JSX.Element {
  const label = getTrackCoverLabel(track);

  if (track.coverUrl && track.coverUrl.trim().length > 0) {
    return (
      <span
        className={cx(
          'platform-preview-track-cover inline-flex shrink-0 overflow-hidden',
          sizeClassName,
          shapeClassName
        )}
        style={{ backgroundImage: `url("${track.coverUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />
    );
  }

  return (
    <span
      className={cx(
        'platform-preview-track-cover inline-flex shrink-0 items-center justify-center font-semibold text-white/86',
        sizeClassName,
        shapeClassName,
        labelClassName
      )}
      style={getTrackCoverStyle(platform, `${track.album}:${track.title}`)}
    >
      {label}
    </span>
  );
}

function PlatformTag({ platform }: { platform: PlatformKind | 'local' }): JSX.Element {
  if (platform === 'local') {
    return <Library className="h-3.5 w-3.5 shrink-0 text-white/58" />;
  }

  const Icon = PLATFORM_META[platform].Icon;
  return <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: PLATFORM_META[platform].accent }} />;
}

function TrackRows({
  rows,
  empty,
  platform,
}: {
  rows: MockTrack[];
  empty: string;
  platform?: PlatformKind | 'local';
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-white/3 text-sm text-white/42">
        {empty}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((track) => {
        const trackPlatform = track.sourcePlatform ?? platform ?? 'local';
        const badges = getTrackDisplayBadges(track);
        const subtitle = [track.artist, track.album].filter(Boolean).join(' / ');

        return (
          <div
            key={track.id}
            className="platform-preview-card grid grid-cols-[auto,minmax(0,1fr),auto] items-center gap-3 rounded-[20px] px-4 py-3"
          >
            <TrackCover track={track} platform={trackPlatform} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{track.title}</div>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <div className="min-w-0 truncate text-xs text-white/42">{subtitle}</div>
                <div className="flex shrink-0 items-center gap-1">
                  <PlatformTag platform={trackPlatform} />
                  {badges.length > 0
                    ? badges.map((badge) => (
                        <span
                          key={`${track.id}-${badge}`}
                          className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[10px] text-white/58"
                        >
                          {badge}
                        </span>
                      ))
                    : null}
                </div>
              </div>
            </div>
            <div className="text-xs text-white/42">{track.duration}</div>
          </div>
        );
      })}
    </div>
  );
}

function RecordCard({
  t,
  instance,
  active,
  onOpen,
  onPlay,
}: {
  t: (key: string, params?: Record<string, unknown>) => string;
  instance: MockInstance;
  active: boolean;
  onOpen: () => void;
  onPlay: () => void;
}): JSX.Element {
  const meta = PLATFORM_META[instance.platform];
  const Icon = meta.Icon;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer flex-col items-center gap-3 text-center outline-none"
    >
      <div
        className={cx(
          'platform-preview-record relative flex h-[176px] w-[176px] items-center justify-center overflow-hidden rounded-full transition-transform duration-200 group-hover:scale-[1.01]',
          active ? 'platform-preview-record-active' : ''
        )}
      >
        <div className="platform-preview-record-center relative flex h-[68px] w-[68px] items-center justify-center rounded-full">
          <div className="platform-preview-record-core flex h-[68px] w-[68px] items-center justify-center rounded-full">
            <span
              className="platform-preview-record-icon inline-flex h-10 w-10 items-center justify-center rounded-full"
              style={{ color: meta.accent }}
            >
              <Icon className="h-5 w-5" />
            </span>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPlay();
            }}
            className="platform-preview-record-play absolute left-1/2 top-1/2 inline-flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/18 bg-white/8 text-white shadow-xl backdrop-blur-md transition-all duration-200 hover:scale-105 hover:bg-white/14"
            title={t('common.action.play')}
            aria-label={t('common.action.play')}
          >
            <Play className="h-6 w-6 translate-x-[1px] fill-current" />
          </button>
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium text-white">{getPlatformName(t, instance.platform)}</div>
        <div className="text-xs text-white/42">{instance.dailyTrack.title}</div>
      </div>
    </div>
  );
}

function ChannelCard({
  t,
  channel,
  platform,
  onOpen,
}: {
  t: (key: string, params?: Record<string, unknown>) => string;
  channel: MockChannel;
  platform: PlatformKind;
  onOpen: () => void;
}): JSX.Element {
  const Icon = CHANNEL_ICON_MAP[channel.icon];
  const accent = PLATFORM_META[platform].accent;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="platform-preview-channel-card platform-preview-card w-full rounded-[22px] px-4 py-4 text-left transition-transform hover:-translate-y-[1px]"
    >
      <div className="flex items-start gap-4">
        <span className="platform-preview-channel-icon inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px]">
          <Icon className="h-5 w-5" style={{ color: accent }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="truncate text-sm font-medium text-white">{t(channel.titleKey)}</div>
            <span className="platform-preview-channel-tag shrink-0 rounded-full px-2 py-1 text-[10px] text-white/56">
              {t(channel.tagKey)}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-white/42">{t(channel.subtitleKey)}</p>
        </div>
      </div>
    </button>
  );
}

function ChannelTrackCard({
  track,
  platform,
  onPlay,
}: {
  track: MockTrack;
  platform: PlatformKind;
  onPlay: () => void;
}): JSX.Element {
  const trackPlatform = track.sourcePlatform ?? platform;
  const badges = getTrackDisplayBadges(track);

  return (
    <button
      type="button"
      onClick={onPlay}
      className="platform-preview-channel-song-card platform-preview-card group flex w-full items-center gap-4 rounded-[22px] px-4 py-4 text-left transition-transform hover:-translate-y-[1px]"
    >
      <div className="platform-preview-channel-song-cover relative shrink-0">
        <TrackCover
          track={track}
          platform={trackPlatform}
          sizeClassName="h-14 w-14"
          shapeClassName="rounded-full"
          labelClassName="text-base"
        />
        <span className="platform-preview-channel-song-play absolute inset-0 inline-flex items-center justify-center rounded-full bg-black/42 text-white">
          <Play className="h-4 w-4 translate-x-[1px] fill-current" />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-white">{track.title}</div>
        <div className="mt-1 truncate text-xs text-white/42">{track.artist}</div>
        <div className="mt-2 flex min-w-0 items-center gap-2">
          <PlatformTag platform={trackPlatform} />
          <span className="truncate text-[11px] text-white/34">{track.album}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {badges.map((badge) => (
          <span
            key={`${track.id}-${badge}`}
            className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[10px] text-white/58"
          >
            {badge}
          </span>
        ))}
      </div>
    </button>
  );
}

function InstanceTemplatePage({
  t,
  instance,
  onOpenChannel,
}: {
  t: (key: string, params?: Record<string, unknown>) => string;
  instance: MockInstance;
  onOpenChannel: (channelId: string) => void;
}): JSX.Element {
  const platformName = getPlatformName(t, instance.platform);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <section className="platform-preview-instance-header platform-preview-card rounded-[24px] px-5 py-5">
        <div className="flex items-center gap-4">
          <PlatformGlyph platform={instance.platform} active />
          <div className="min-w-0">
            <div className="truncate text-[11px] uppercase tracking-[0.18em] text-white/30">
              {instance.accountUid}
            </div>
            <div className="mt-1 truncate text-base font-medium text-white">{platformName}</div>
          </div>
        </div>
        <p className="mt-4 max-w-[560px] text-sm leading-6 text-white/46">
          {t('magnet.platform.mock.instance.exploreSubtitle')}
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-white">{t('magnet.platform.mock.instance.exploreTitle')}</div>
            <div className="mt-1 text-xs text-white/38">{platformName}</div>
          </div>
          <PlatformTag platform={instance.platform} />
        </div>

        {instance.channels.length > 0 ? (
          <div className="platform-preview-channel-grid grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {instance.channels.map((channel) => (
              <ChannelCard
                key={channel.id}
                t={t}
                channel={channel}
                platform={instance.platform}
                onOpen={() => onOpenChannel(channel.id)}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[220px] items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-white/3 text-sm text-white/42">
            {t('magnet.platform.mock.instance.emptyChannels')}
          </div>
        )}
      </section>
    </div>
  );
}

function DetailPage({
  t,
  instance,
  detailId,
  onPlayAll,
  onPlayTrack,
}: {
  t: (key: string, params?: Record<string, unknown>) => string;
  instance: MockInstance;
  detailId: string;
  onPlayAll: () => void;
  onPlayTrack: (trackIndex: number) => void;
}): JSX.Element {
  const meta = PLATFORM_META[instance.platform];
  const Icon = meta.Icon;
  const content = resolveDetailPageContent(t, instance, detailId);
  const tracks = content.tracks;

  return (
    <div className="mx-auto max-w-6xl">
      <section className="platform-preview-detail-hero relative overflow-hidden rounded-[28px] px-6 pb-6 pt-8">
        <div
          className="platform-preview-detail-backdrop absolute inset-x-0 top-0 h-[220px]"
          style={
            {
              '--platform-detail-accent': meta.accent,
            } as React.CSSProperties
          }
        />
        <div className="relative z-[1]">
          <div className="flex items-start gap-6">
            <div className="platform-preview-detail-cover flex h-24 w-24 shrink-0 items-center justify-center rounded-[18px]">
              <span className="platform-preview-detail-cover-core inline-flex h-12 w-12 items-center justify-center rounded-full">
                <Icon className="h-7 w-7" style={{ color: meta.accent }} />
              </span>
            </div>
            <div className="min-w-0 flex-1 pt-2">
              <div className="text-sm text-white/56">{content.kicker}</div>
              <h2 className="mt-2 text-[44px] font-semibold tracking-[-0.04em] text-white">{content.title}</h2>
              <p className="mt-3 text-sm text-white/48">{content.subtitle}</p>
            </div>
          </div>

          <div className="mt-8 flex items-center gap-3">
            <button
              type="button"
              onClick={onPlayAll}
              className="platform-preview-detail-primary inline-flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: meta.accent }}
              title={t('common.action.play')}
            >
              <Play className="h-5 w-5 translate-x-[1px] fill-current text-white" />
            </button>
            <button
              type="button"
              className="platform-preview-detail-ghost inline-flex h-11 w-11 items-center justify-center rounded-full"
              title={t('magnet.platform.mock.detail.action.favorite')}
            >
              <Heart className="h-5 w-5 text-white/72" />
            </button>
            <button
              type="button"
              className="platform-preview-detail-ghost inline-flex h-11 w-11 items-center justify-center rounded-full"
              title={t('magnet.platform.mock.detail.action.more')}
            >
              <MoreHorizontal className="h-5 w-5 text-white/72" />
            </button>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <div className="platform-preview-detail-table-header grid grid-cols-[56px,minmax(0,1.5fr),minmax(0,0.9fr),44px,72px] items-center gap-4 px-4 py-3 text-xs text-white/34">
          <div className="text-center">{t('magnet.platform.mock.detail.column.index')}</div>
          <div>{t('magnet.platform.mock.detail.column.title')}</div>
          <div>{t('magnet.platform.mock.detail.column.album')}</div>
          <div />
          <div className="text-right">{t('magnet.platform.mock.detail.column.duration')}</div>
        </div>

        {tracks.length > 0 ? (
          <div className="space-y-1">
            {tracks.map((track, index) => {
              const badges = getTrackDisplayBadges(track);
              return (
                <div
                  key={`${detailId}-${track.id}`}
                  className="platform-preview-detail-row group grid grid-cols-[56px,minmax(0,1.5fr),minmax(0,0.9fr),44px,72px] items-center gap-4 rounded-[18px] px-4 py-3"
                >
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => onPlayTrack(index)}
                      className="platform-preview-detail-row-trigger relative inline-flex h-9 w-9 items-center justify-center rounded-full text-sm text-white/38"
                      title={t('common.action.play')}
                    >
                      <span className="platform-preview-detail-row-number">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <Play className="platform-preview-detail-row-play absolute h-4 w-4 translate-x-[1px] fill-current text-white" />
                    </button>
                  </div>
                  <div className="flex min-w-0 items-center gap-4">
                    <TrackCover track={track} platform={instance.platform} />
                    <div className="min-w-0">
                      <div className="truncate text-[15px] text-white">{track.title}</div>
                      <div className="mt-1 flex min-w-0 items-center gap-2">
                        <div className="min-w-0 truncate text-xs text-white/40">{track.artist}</div>
                        <div className="flex shrink-0 items-center gap-1">
                          <PlatformTag platform={instance.platform} />
                          {badges.map((badge) => (
                            <span
                              key={`${track.id}-${badge}`}
                              className="rounded-full border border-white/10 bg-white/6 px-1.5 py-0.5 text-[10px] text-white/58"
                            >
                              {badge}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="truncate text-sm text-white/46">{track.album}</div>
                  <button
                    type="button"
                    className="platform-preview-detail-row-action inline-flex h-9 w-9 items-center justify-center rounded-full"
                    title={t('magnet.platform.mock.detail.action.favorite')}
                  >
                    <Heart className="h-4.5 w-4.5 text-white/46" />
                  </button>
                  <div className="text-right text-sm text-white/42">{track.duration}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-[260px] items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/3 text-sm text-white/42">
            {t('magnet.platform.mock.detail.empty')}
          </div>
        )}
      </section>
    </div>
  );
}

function ChannelDetailPage({
  t,
  instance,
  detailId,
  onPlayTrack,
}: {
  t: (key: string, params?: Record<string, unknown>) => string;
  instance: MockInstance;
  detailId: string;
  onPlayTrack: (trackIndex: number) => void;
}): JSX.Element {
  const meta = PLATFORM_META[instance.platform];
  const channel = instance.channels.find((item) => item.id === detailId);
  const Icon = channel ? CHANNEL_ICON_MAP[channel.icon] : meta.Icon;
  const content = resolveDetailPageContent(t, instance, detailId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="flex items-center gap-4">
        <span className="platform-preview-channel-icon inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full">
          <Icon className="h-5 w-5" style={{ color: meta.accent }} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[11px] uppercase tracking-[0.18em] text-white/30">
            {getPlatformName(t, instance.platform)}
          </div>
          <div className="mt-1 truncate text-[28px] font-semibold tracking-[-0.04em] text-white">
            {content.title}
          </div>
          <div className="mt-1 text-sm text-white/42">{content.subtitle}</div>
        </div>
      </section>

      {content.tracks.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {content.tracks.map((track, index) => (
            <ChannelTrackCard
              key={`${detailId}-${track.id}`}
              track={track}
              platform={instance.platform}
              onPlay={() => onPlayTrack(index)}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-[260px] items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/3 text-sm text-white/42">
          {t('magnet.platform.mock.detail.empty')}
        </div>
      )}
    </div>
  );
}

function ConfigPlaceholderPage({
  t,
  loadedCount,
}: {
  t: (key: string, params?: Record<string, unknown>) => string;
  loadedCount: number;
}): JSX.Element {
  const configGroups = [
    {
      id: 'aggregation',
      label: t('magnet.platform.mock.settings.groupAggregation'),
      values: HOST_SETTINGS.aggregation,
      Icon: Disc3,
    },
    {
      id: 'search',
      label: t('magnet.platform.mock.settings.groupSearch'),
      values: HOST_SETTINGS.search,
      Icon: Search,
    },
    {
      id: 'identify',
      label: t('magnet.platform.mock.settings.groupIdentify'),
      values: HOST_SETTINGS.identify,
      Icon: Mic,
    },
  ] as const;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center gap-3">
        <span className="platform-preview-soft-ring inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/4 text-white/72">
          <SlidersHorizontal className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium text-white">{t('magnet.platform.mock.config.title')}</div>
          <div className="text-xs text-white/42">
            {t('magnet.platform.mock.config.subtitle', { count: loadedCount })}
          </div>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        {configGroups.map(({ id, label, values, Icon }) => (
          <section key={id} className="platform-preview-card rounded-[22px] p-4">
            <div className="mb-4 flex items-center gap-3">
              <span className="platform-preview-soft-ring inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/4 text-white/62">
                <Icon className="h-4 w-4" />
              </span>
              <div className="text-sm text-white/72">{label}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {values.map((item, index) => (
                <span
                  key={item}
                  className={cx(
                    'rounded-full border px-3 py-1.5 text-xs',
                    index === 0 ? 'border-white/18 bg-white/10 text-white' : 'border-white/10 text-white/48'
                  )}
                >
                  {item}
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="platform-preview-card rounded-[22px] px-4 py-4 text-sm text-white/52">
        {t('magnet.platform.mock.settings.mockNote')}
      </section>
    </div>
  );
}

const PlatformMagnetDefaultRenderer: React.FC<PlatformMagnetRendererProps> = ({ skinProps: rawSkinProps }) => {
  const skinProps = useMemo(() => parsePlatformMagnetSkinProps(rawSkinProps), [rawSkinProps]);
  const t = useT();
  const audioService = useAudioService();
  const telemetry = getTelemetryLogger('magnet.platform', 'PlatformMagnet');

  const instancesById = useMemo(
    () => Object.fromEntries(MOCK_INSTANCES.map((instance) => [instance.id, instance])) as Record<string, MockInstance>,
    []
  );
  const initialAudioLocalPlaylists = filterLocalAudioPlaylists(audioService.getPlaylists());
  const [loadedById, setLoadedById] = useState<Record<string, boolean>>({ ...MOCK_LOADED_STATE });
  const [activePage, setActivePage] = useState<PageId>(() => resolveInitialPage(skinProps.defaultMode));
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createView, setCreateView] = useState<CreateView>('create');
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('host');
  const [createName, setCreateName] = useState('');
  const [createNameEditing, setCreateNameEditing] = useState(false);
  const [audioLocalPlaylists, setAudioLocalPlaylists] = useState<AudioPlaylist[]>(initialAudioLocalPlaylists);
  const [selectedSearchPlatforms, setSelectedSearchPlatforms] = useState<PlatformKind[]>(() =>
    ACTIVE_MOCK_PLATFORM_KINDS
  );
  const [displayedPage, setDisplayedPage] = useState<PageId>(() => resolveInitialPage(skinProps.defaultMode));
  const [displayedSearch, setDisplayedSearch] = useState<SearchSnapshot | null>(null);
  const [displayedContentKey, setDisplayedContentKey] = useState<string>(() => {
    const initialPage = resolveInitialPage(skinProps.defaultMode);
    return `page:${initialPage}`;
  });
  const [contentTransitionPhase, setContentTransitionPhase] = useState<ContentTransitionPhase>('entered');
  const createNameInputRef = useRef<HTMLInputElement | null>(null);
  const localPlaylistHydrationRef = useRef<Set<string>>(new Set());
  const [selectedPlaylistByScope, setSelectedPlaylistByScope] = useState<Record<string, string>>(() => ({
    local: initialAudioLocalPlaylists[0]?.id ?? MOCK_LOCAL_PLAYLISTS[0]?.id ?? '',
    ...Object.fromEntries(MOCK_INSTANCES.map((instance) => [instance.id, instance.playlists[0]?.id ?? ''])),
  }));

  const loadedInstances = useMemo(
    () => MOCK_INSTANCES.filter((instance) => loadedById[instance.id]),
    [loadedById]
  );
  const persistedLocalPlaylists = useMemo(
    () => audioLocalPlaylists.map(audioPlaylistToMockPlaylist),
    [audioLocalPlaylists]
  );
  const localPlaylists = useMemo(
    () =>
      persistedLocalPlaylists.length > 0 ? persistedLocalPlaylists : MOCK_LOCAL_PLAYLISTS,
    [persistedLocalPlaylists]
  );
  const activePageState = useMemo(() => parsePlatformPageId(activePage), [activePage]);
  const displayedPageState = useMemo(() => parsePlatformPageId(displayedPage), [displayedPage]);
  const activeInstance =
    activePageState.kind === 'instance' || activePageState.kind === 'detail'
      ? instancesById[activePageState.instanceId] ?? null
      : null;
  const searchScope: SearchScope = activePageState.kind === 'local' ? 'local' : activeInstance ? activeInstance.id : 'loaded';
  const searchPlatformOptions = useMemo(() => ACTIVE_MOCK_PLATFORM_KINDS, []);
  const currentLocalPlaylist =
    localPlaylists.find((playlist) => playlist.id === selectedPlaylistByScope.local) ?? localPlaylists[0] ?? null;
  const defaultCreateName = t('magnet.platform.mock.create.defaultName');
  const primaryNavItems = useMemo(
    () =>
      [
        { id: 'daily' as const, label: t('magnet.platform.daily.title'), Icon: Disc3 },
        { id: 'local' as const, label: t('magnet.platform.mock.nav.local'), Icon: Library },
        { id: 'config' as const, label: t('magnet.platform.mock.nav.config'), Icon: SlidersHorizontal },
      ] satisfies Array<{ id: 'daily' | 'local' | 'config'; label: string; Icon: IconComponent }>,
    [t]
  );

  const searchResults = useMemo(
    () =>
      collectSearchResults(
        searchScope,
        submittedQuery,
        loadedInstances,
        instancesById,
        localPlaylists,
        selectedSearchPlatforms,
        skinProps.searchLimit
      ),
    [instancesById, loadedInstances, localPlaylists, searchScope, selectedSearchPlatforms, skinProps.searchLimit, submittedQuery]
  );
  const stagedCreateTracks = useMemo<CreateStagedTrack[]>(
    () =>
      loadedInstances.slice(0, 6).map((instance) => ({
        ...instance.dailyTrack,
        id: `${instance.id}-${instance.dailyTrack.id}`,
        platform: instance.platform,
      })),
    [loadedInstances]
  );

  useEffect(() => {
    const syncLocalPlaylists = (playlists: AudioPlaylist[]): void => {
      setAudioLocalPlaylists(filterLocalAudioPlaylists(playlists));
    };

    syncLocalPlaylists(audioService.getState().playlists);
    return audioService.onStateChange((state) => {
      syncLocalPlaylists(state.playlists);
    });
  }, [audioService]);

  useEffect(() => {
    const hydratePlaylistTracks = audioService.hydratePlaylistTracks;
    if (typeof hydratePlaylistTracks !== 'function') return;

    for (const playlist of audioLocalPlaylists) {
      if (playlist.tracksHydrated !== false) continue;
      if ((playlist.trackCount ?? 0) <= 0) continue;
      if (localPlaylistHydrationRef.current.has(playlist.id)) continue;

      localPlaylistHydrationRef.current.add(playlist.id);
      void hydratePlaylistTracks.call(audioService, playlist.id).finally(() => {
        localPlaylistHydrationRef.current.delete(playlist.id);
      });
    }
  }, [audioLocalPlaylists, audioService]);

  useEffect(() => {
    if (localPlaylists.length === 0) return;
    if (localPlaylists.some((playlist) => playlist.id === selectedPlaylistByScope.local)) return;

    setSelectedPlaylistByScope((prev) => ({
      ...prev,
      local: localPlaylists[0]?.id ?? '',
    }));
  }, [localPlaylists, selectedPlaylistByScope.local]);

  useEffect(() => {
    if (activePageState.kind !== 'instance' && activePageState.kind !== 'detail') return;
    if (!loadedById[activePageState.instanceId]) {
      setActivePage('daily');
    }
  }, [activePageState, loadedById]);

  useEffect(() => {
    if (!settingsOpen) return;
    setSettingsTab(activeInstance ? activeInstance.id : 'host');
  }, [activeInstance, settingsOpen]);

  useEffect(() => {
    if (!createOpen || createView !== 'create' || !createNameEditing) return;

    const frameId = window.requestAnimationFrame(() => {
      createNameInputRef.current?.focus();
      createNameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [createNameEditing, createOpen, createView]);

  const closeMenus = (): void => {
    setLauncherOpen(false);
    setNavOpen(false);
    setFilterOpen(false);
  };

  const closeCreateDialog = (): void => {
    setCreateOpen(false);
    setCreateView('create');
    setCreateName('');
    setCreateNameEditing(false);
  };

  const openCreateDialog = (): void => {
    setCreateOpen(true);
    setCreateView('create');
    setCreateName('');
    setCreateNameEditing(false);
  };

  const commitCreateName = (): void => {
    setCreateName((prev) => prev.trim());
    setCreateNameEditing(false);
  };

  const drawerGroups = [
    ...(activePageState.kind === 'daily'
      ? loadedInstances.map((instance) => ({
          id: instance.id,
          label: getPlatformName(t, instance.platform),
          platform: instance.platform,
          scopeId: instance.id,
          playlists: instance.playlists,
        }))
      : []),
    ...(activePageState.kind === 'local'
      ? [{ id: 'local', label: t('magnet.platform.mock.drawer.local'), platform: null, scopeId: 'local', playlists: localPlaylists }]
      : []),
    ...(activeInstance
      ? [
          {
            id: activeInstance.id,
            label: getPlatformName(t, activeInstance.platform),
            platform: activeInstance.platform,
            scopeId: activeInstance.id,
            playlists: activeInstance.playlists,
          },
        ]
      : []),
    ...(activePageState.kind === 'daily'
      ? [{ id: 'local-all', label: t('magnet.platform.mock.drawer.local'), platform: null, scopeId: 'local', playlists: localPlaylists }]
      : []),
  ];

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmittedQuery(query.trim());
    closeMenus();
  };

  const handleCreateLocal = (): void => {
    const nextPlaylist = audioService.createPlaylist(createName.trim() || defaultCreateName, '', {
      kind: 'manual',
    });

    setSelectedPlaylistByScope((prev) => ({ ...prev, local: nextPlaylist.id }));
    setActivePage('local');
    closeCreateDialog();
  };

  const handlePlayDaily = (instance: MockInstance): void => {
    void (async () => {
      const samplePath = await resolveMockPlaybackSamplePath();
      if (isTauriRuntime() && !samplePath) {
        telemetry.warn('platform.mock.daily-playback.sample-missing', {
          fields: {
            instanceId: instance.id,
            platform: instance.platform,
          },
        });
        return;
      }

      const track = mockTrackToAudioTrack(instance.dailyTrack, instance, samplePath);
      audioService.clearQueue();
      audioService.addToQueue(track);
      await audioService.playTrackAtIndex(0);
    })().catch((error) => {
      telemetry.warn('platform.mock.daily-playback.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          instanceId: instance.id,
          platform: instance.platform,
        },
      });
    });
  };

  const handlePlayTrackSet = (
    instance: MockInstance,
    tracks: MockTrack[],
    startIndex: number = 0
  ): void => {
    if (tracks.length === 0) return;

    void (async () => {
      const samplePath = await resolveMockPlaybackSamplePath();
      if (isTauriRuntime() && !samplePath) {
        telemetry.warn('platform.mock.queue-playback.sample-missing', {
          fields: {
            instanceId: instance.id,
            platform: instance.platform,
            trackCount: tracks.length,
          },
        });
        return;
      }

      const safeStartIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
      const audioTracks = tracks.map((track) => mockTrackToAudioTrack(track, instance, samplePath));
      audioService.clearQueue();
      audioService.addMultipleToQueue(audioTracks);
      await audioService.playTrackAtIndex(safeStartIndex);
    })().catch((error) => {
      telemetry.warn('platform.mock.queue-playback.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          instanceId: instance.id,
          platform: instance.platform,
          trackCount: tracks.length,
          startIndex,
        },
      });
    });
  };

  const searchEmptyText =
    searchScope === 'local'
      ? t('magnet.platform.mock.search.emptyLocal')
      : searchScope === 'loaded'
        ? loadedInstances.length === 0
          ? t('magnet.platform.mock.search.noLoaded')
          : t('magnet.platform.mock.search.emptyGlobal')
        : t('magnet.platform.mock.search.emptyInstance');
  const showDailyFilter = activePageState.kind === 'daily';
  const showBackButton = submittedQuery.length > 0 || activePageState.kind !== 'daily';
  const targetContentKey = submittedQuery ? `search:${searchScope}:${submittedQuery}` : `page:${activePage}`;
  const displayedActiveInstance =
    displayedPageState.kind === 'instance' || displayedPageState.kind === 'detail'
      ? instancesById[displayedPageState.instanceId] ?? null
      : null;

  useEffect(() => {
    if (!showDailyFilter && filterOpen) {
      setFilterOpen(false);
    }
  }, [filterOpen, showDailyFilter]);

  useEffect(() => {
    if (targetContentKey === displayedContentKey) {
      if (contentTransitionPhase !== 'entered') {
        setContentTransitionPhase('entered');
      }

      if (submittedQuery.length > 0) {
        setDisplayedSearch((prev) => {
          if (
            prev &&
            prev.query === submittedQuery &&
            prev.emptyText === searchEmptyText &&
            prev.results === searchResults
          ) {
            return prev;
          }

          return {
            query: submittedQuery,
            results: searchResults,
            emptyText: searchEmptyText,
          };
        });
      } else if (displayedSearch !== null) {
        setDisplayedSearch(null);
      }
      return;
    }

    let enterFrame = 0;
    const exitTimer = window.setTimeout(() => {
      setDisplayedPage(activePage);
      setDisplayedSearch(
        submittedQuery.length > 0
          ? {
              query: submittedQuery,
              results: searchResults,
              emptyText: searchEmptyText,
            }
          : null
      );
      setDisplayedContentKey(targetContentKey);
      setContentTransitionPhase('entering');
      enterFrame = window.requestAnimationFrame(() => {
        setContentTransitionPhase('entered');
      });
    }, 140);

    setContentTransitionPhase('exiting');

    return () => {
      window.clearTimeout(exitTimer);
      if (enterFrame) {
        window.cancelAnimationFrame(enterFrame);
      }
    };
  }, [
    activePage,
    contentTransitionPhase,
    displayedContentKey,
    displayedSearch,
    searchEmptyText,
    searchResults,
    searchScope,
    submittedQuery,
    targetContentKey,
  ]);

  const handleGoBack = (): void => {
    if (submittedQuery) {
      setSubmittedQuery('');
      setQuery('');
      return;
    }

    if (activePageState.kind === 'detail') {
      setActivePage(activePageState.instanceId);
      closeMenus();
      return;
    }

    if (activePage !== 'daily') {
      setActivePage('daily');
      closeMenus();
    }
  };

  const renderedContent = displayedSearch ? (
    <div className="mx-auto max-w-5xl space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-white/62">
          <Search className="h-4 w-4" />
          <span>{displayedSearch.query}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setSubmittedQuery('');
            setQuery('');
          }}
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/62"
        >
          {t('magnet.platform.mock.action.clearSearch')}
        </button>
      </div>

      {displayedSearch.results.length > 0 ? (
        <div className="space-y-2">
          {displayedSearch.results.map((result) => (
            <div
              key={result.id}
              className="platform-preview-card grid grid-cols-[auto,minmax(0,1fr),auto] items-center gap-3 rounded-[18px] px-4 py-3"
            >
              <TrackCover track={result} platform={result.platform} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">{result.title}</div>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <div className="min-w-0 truncate text-xs text-white/42">
                      {[result.artist, result.album, result.playlistName].filter(Boolean).join(' / ')}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <PlatformTag platform={result.platform} />
                    {getTrackDisplayBadges(result).length > 0
                      ? getTrackDisplayBadges(result).map((badge) => (
                          <span
                            key={`${result.id}-${badge}`}
                            className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[10px] text-white/58"
                          >
                            {badge}
                          </span>
                        ))
                      : null}
                  </div>
                </div>
              </div>
              <div className="text-xs text-white/42">{result.duration}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-[280px] items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/3 text-sm text-white/42">
          {displayedSearch.emptyText}
        </div>
      )}
    </div>
  ) : displayedPageState.kind === 'daily' ? (
    <div className="mx-auto max-w-5xl space-y-6">
      {skinProps.showSummary ? (
        <div className="flex items-center gap-4 text-[11px] uppercase tracking-[0.18em] text-white/32">
          <span>{t('magnet.platform.mock.summary.loaded', { count: loadedInstances.length })}</span>
          <span>{t('magnet.platform.mock.summary.localPlaylists', { count: localPlaylists.length })}</span>
        </div>
      ) : null}

      {loadedInstances.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-8">
          {loadedInstances.map((instance) => (
            <RecordCard
              key={instance.id}
              t={t}
              instance={instance}
              active={activeInstance?.id === instance.id}
              onOpen={() => setActivePage(createDetailPageId(instance.id, 'daily'))}
              onPlay={() => handlePlayDaily(instance)}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-[320px] items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/3 text-sm text-white/42">
          {t('magnet.platform.daily.emptyHint')}
        </div>
      )}
    </div>
  ) : displayedPageState.kind === 'config' ? (
    <ConfigPlaceholderPage t={t} loadedCount={loadedInstances.length} />
  ) : displayedPageState.kind === 'local' ? (
    <div className="mx-auto grid max-w-6xl gap-4 xl:grid-cols-[280px,1fr]">
      <section className="space-y-2">
        {localPlaylists.map((playlist) => (
          <button
            key={playlist.id}
            type="button"
            onClick={() => setSelectedPlaylistByScope((prev) => ({ ...prev, local: playlist.id }))}
            className={cx(
              'flex w-full items-center gap-3 rounded-[18px] px-3 py-3 text-left transition-colors',
              currentLocalPlaylist?.id === playlist.id
                ? 'platform-preview-card-active text-white'
                : 'platform-preview-card text-white/62'
            )}
          >
            <span className="platform-preview-soft-ring inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/6">
              <Library className="h-4 w-4" />
            </span>
            <span className="truncate text-sm">{playlist.name}</span>
          </button>
        ))}
      </section>

      <section className="space-y-3">
        <div className="text-sm text-white/62">{currentLocalPlaylist?.name ?? t('magnet.platform.mock.local.title')}</div>
        <TrackRows
          rows={currentLocalPlaylist?.tracks ?? []}
          empty={t('magnet.platform.mock.emptyNoLocalTracks')}
          platform="local"
        />
      </section>
    </div>
  ) : displayedPageState.kind === 'detail' && displayedActiveInstance ? (
    displayedPageState.detailId === 'daily' ? (
      <DetailPage
        t={t}
        instance={displayedActiveInstance}
        detailId={displayedPageState.detailId}
        onPlayAll={() => handlePlayTrackSet(displayedActiveInstance, resolveDetailPageContent(t, displayedActiveInstance, displayedPageState.detailId).tracks)}
        onPlayTrack={(trackIndex) =>
          handlePlayTrackSet(
            displayedActiveInstance,
            resolveDetailPageContent(t, displayedActiveInstance, displayedPageState.detailId).tracks,
            trackIndex
          )
        }
      />
    ) : (
      <ChannelDetailPage
        t={t}
        instance={displayedActiveInstance}
        detailId={displayedPageState.detailId}
        onPlayTrack={(trackIndex) =>
          handlePlayTrackSet(
            displayedActiveInstance,
            resolveDetailPageContent(t, displayedActiveInstance, displayedPageState.detailId).tracks,
            trackIndex
          )
        }
      />
    )
  ) : displayedPageState.kind === 'instance' && displayedActiveInstance ? (
    <InstanceTemplatePage
      t={t}
      instance={displayedActiveInstance}
      onOpenChannel={(channelId) => setActivePage(createDetailPageId(displayedActiveInstance.id, channelId))}
    />
  ) : null;

  return (
    <div className="platform-preview-magnet relative h-full w-full overflow-hidden rounded-[24px] text-white">
      <div className="platform-preview-shell relative flex h-full flex-col">
        <header className="platform-preview-header relative z-30 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-4">
          <div className="relative flex items-center justify-self-start">
            <button
              type="button"
              onClick={() => {
                setLauncherOpen((prev) => !prev);
                setNavOpen(false);
                setFilterOpen(false);
              }}
              className={cx(
                'platform-preview-launcher-trigger inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors',
                launcherOpen ? 'platform-preview-launcher-trigger-open' : 'platform-preview-launcher-trigger-closed'
              )}
              title={t('magnet.platform.mock.launcher.title')}
              aria-pressed={launcherOpen}
            >
              <LayoutGrid className="h-5 w-5" />
            </button>

            <div
              className={cx(
                'platform-preview-launcher-strip absolute left-[3.4rem] top-1/2 flex -translate-y-1/2 items-center',
                launcherOpen
                  ? 'translate-x-0 opacity-100 blur-0'
                  : 'pointer-events-none -translate-x-3 opacity-0 blur-[4px]'
              )}
            >
              {MOCK_INSTANCES.map((instance) => {
                const meta = PLATFORM_META[instance.platform];
                const Icon = meta.Icon;
                const loaded = loadedById[instance.id];

                return (
                  <button
                    key={instance.id}
                    type="button"
                    onClick={() => setLoadedById((prev) => ({ ...prev, [instance.id]: !prev[instance.id] }))}
                    title={`${getPlatformName(t, instance.platform)} / ${instance.accountUid}`}
                    aria-pressed={loaded}
                    className="platform-preview-launcher-item group relative inline-flex items-center justify-center"
                  >
                    <Icon
                      className={cx(
                        'platform-preview-launcher-item-icon h-6 w-6 transition-all duration-200',
                        loaded ? 'opacity-100' : 'opacity-78'
                      )}
                      style={{ color: meta.accent }}
                    />
                    <span
                      className={cx(
                        'platform-preview-launcher-status',
                        loaded ? 'platform-preview-launcher-status-on' : 'platform-preview-launcher-status-off'
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-[560px] items-center justify-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNavOpen((prev) => !prev);
                  setLauncherOpen(false);
                  setFilterOpen(false);
                }}
                className={cx(
                  'platform-preview-soft-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors',
                  navOpen || activePage !== 'daily' ? 'bg-white/10 text-white' : 'bg-white/4 text-white/62'
                )}
                title={t('magnet.platform.nav.channels')}
              >
                <Compass className="h-4 w-4" />
              </button>

              <div
                className={cx(
                  'platform-preview-popover platform-preview-nav-panel absolute left-0 top-12 z-20 w-[244px] rounded-[22px] p-2.5 transition-all duration-150',
                  navOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'
                )}
              >
                <div className="platform-preview-nav-section">
                  {primaryNavItems.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setActivePage(id);
                        setSubmittedQuery('');
                        setNavOpen(false);
                      }}
                      className={cx(
                        'platform-preview-nav-entry flex w-full items-center gap-3 rounded-[16px] px-3.5 py-3 text-left text-sm transition-colors',
                        activePage === id
                          ? 'platform-preview-nav-entry-active text-white'
                          : 'text-white/62 hover:text-white/88'
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>

                {loadedInstances.length > 0 ? (
                  <>
                    <div className="platform-preview-nav-divider" />
                    <div className="platform-preview-nav-caption px-2">
                      {t('magnet.platform.mock.nav.loaded')}
                    </div>
                    <div className="platform-preview-nav-section">
                      {loadedInstances.map((instance) => {
                        const meta = PLATFORM_META[instance.platform];
                        const Icon = meta.Icon;

                        return (
                          <button
                            key={instance.id}
                            type="button"
                            onClick={() => {
                              setActivePage(instance.id);
                              setSubmittedQuery('');
                              setNavOpen(false);
                            }}
                            className={cx(
                              'platform-preview-nav-instance flex w-full items-center justify-between gap-3 rounded-full px-4 py-3 text-left text-sm transition-colors',
                              activeInstance?.id === instance.id
                                ? 'platform-preview-nav-instance-active text-white'
                                : 'text-white/64 hover:text-white/88'
                            )}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <Icon className="h-4 w-4 shrink-0" style={{ color: meta.accent }} />
                              <span className="truncate">{instance.accountUid}</span>
                            </div>
                            <span
                              className="platform-preview-nav-instance-status inline-flex h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ background: meta.accent }}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            <form
              onSubmit={handleSearchSubmit}
              className="platform-preview-searchbar flex min-w-0 w-full max-w-[360px] items-center gap-2 rounded-full px-3 py-1.5 sm:max-w-[390px]"
            >
              <Search className="h-4 w-4 shrink-0 text-white/35" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t('magnet.platform.nav.search')}
                className="h-8 min-w-0 flex-1 bg-transparent text-sm text-white outline-none"
              />
              <div
                className={cx(
                  'platform-preview-filter-slot relative',
                  showDailyFilter ? 'platform-preview-filter-slot-visible' : 'platform-preview-filter-slot-hidden'
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!showDailyFilter) return;
                    setFilterOpen((prev) => !prev);
                    setLauncherOpen(false);
                    setNavOpen(false);
                  }}
                  disabled={!showDailyFilter}
                  tabIndex={showDailyFilter ? 0 : -1}
                  aria-hidden={!showDailyFilter}
                  className={cx(
                    'platform-preview-soft-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
                    filterOpen ? 'bg-white/10 text-white' : 'bg-white/4 text-white/62'
                  )}
                  title={t('magnet.platform.search.filterTitle')}
                >
                  <Filter className="h-4 w-4" />
                </button>

                <div
                  className={cx(
                    'platform-preview-filter-panel absolute right-0 top-10 z-20 w-[220px] overflow-hidden rounded-[18px] transition-all duration-150',
                    showDailyFilter && filterOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'
                  )}
                >
                  <div className="border-b border-white/6 px-4 py-3 text-xs text-white/38">
                    {t('magnet.platform.search.filterPanelTitle')}
                  </div>
                  <div className="p-2">
                    {searchPlatformOptions.map((platform) => {
                      const selected = selectedSearchPlatforms.includes(platform);
                      const meta = PLATFORM_META[platform];
                      const Icon = meta.Icon;

                      return (
                        <button
                          key={platform}
                          type="button"
                          onClick={() => {
                            setSelectedSearchPlatforms((prev) => {
                              if (selected && prev.length === 1) return prev;
                              return selected ? prev.filter((item) => item !== platform) : [...prev, platform];
                            });
                          }}
                          className="flex w-full items-center justify-between rounded-[14px] px-3 py-3 text-left transition-colors hover:bg-white/6"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <Icon className="h-4 w-4 shrink-0" style={{ color: meta.accent }} />
                            <span className="truncate text-sm text-white/78">{getPlatformName(t, platform)}</span>
                          </div>
                          <span
                            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                            style={{
                              background: selected ? meta.accent : 'transparent',
                              borderColor: selected ? meta.accent : 'rgba(255,255,255,0.16)',
                            }}
                          >
                            {selected ? <Check className="h-3 w-3 text-white" /> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </form>

            <button
              type="button"
              className="platform-preview-soft-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/4 text-white/62"
              title={t('magnet.platform.mock.search.identify')}
            >
              <Mic className="h-4 w-4" />
            </button>
          </div>

          <div className="justify-self-end">
            <button
            type="button"
            onClick={() => {
              setSettingsOpen(true);
              closeMenus();
            }}
            className="platform-preview-soft-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/4 text-white/62"
            title={t('magnet.platform.mock.action.openSettings')}
          >
            <Settings className="h-4 w-4" />
          </button>
          </div>
        </header>

        <main className="relative min-h-0 flex-1 overflow-hidden">
          {launcherOpen || navOpen || filterOpen ? (
            <button
              type="button"
              className="absolute inset-0 z-10"
              aria-label={t('common.action.close')}
              onClick={closeMenus}
            />
          ) : null}

          {showBackButton ? (
            <div className="platform-preview-back-region group absolute left-2 top-2 z-20">
              <button
                type="button"
                onClick={handleGoBack}
                className="platform-preview-back-button platform-preview-soft-ring inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#131922] text-white/72"
                title={t('magnet.platform.mock.action.goBack')}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            </div>
          ) : null}

          <div
            className={cx(
              'platform-preview-scroll platform-preview-page-stage relative z-[1] h-full overflow-y-auto px-5 pb-24 pt-5',
              contentTransitionPhase === 'exiting'
                ? 'platform-preview-page-stage-exiting'
                : contentTransitionPhase === 'entering'
                  ? 'platform-preview-page-stage-entering'
                  : 'platform-preview-page-stage-entered'
            )}
          >
            {renderedContent}
          </div>

          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="platform-preview-fab platform-preview-fab-left absolute bottom-4 left-4 z-20 inline-flex h-11 shrink-0 items-center rounded-full text-white/72"
            title={t('magnet.platform.mock.action.openDrawer')}
          >
            <Library className="h-5 w-5 shrink-0" />
            <span className="platform-preview-fab-label">{t('magnet.platform.mock.fab.playlists')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              openCreateDialog();
            }}
            className="platform-preview-fab platform-preview-fab-right absolute bottom-4 right-4 z-20 inline-flex h-11 shrink-0 items-center rounded-full text-white/72"
            title={t('magnet.platform.mock.action.createLocal')}
          >
            <span className="platform-preview-fab-label">{t('magnet.platform.mock.fab.create')}</span>
            <Plus className="h-5 w-5 shrink-0" />
          </button>

          {drawerOpen || settingsOpen || createOpen ? (
            <button
              type="button"
              className="platform-preview-overlay absolute inset-0 z-30"
              aria-label={t('common.action.close')}
              onClick={() => {
                setDrawerOpen(false);
                setSettingsOpen(false);
                closeCreateDialog();
              }}
            />
          ) : null}

          <aside
            className={cx(
              'platform-preview-sheet absolute inset-y-3 left-3 z-40 flex w-[320px] max-w-[calc(100%-1.5rem)] flex-col rounded-[24px] border border-white/10 p-4 transition-all duration-150',
              drawerOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-[105%] opacity-0'
            )}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm text-white/72">{t('magnet.platform.mock.drawer.title')}</div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="text-white/52">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="platform-preview-scroll flex-1 space-y-4 overflow-y-auto pr-1">
              {drawerGroups.map((group) => (
                <div key={group.id} className="space-y-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/28">{group.label}</div>
                  {group.playlists.map((playlist) => (
                    <button
                      key={playlist.id}
                      type="button"
                      onClick={() => {
                        setSelectedPlaylistByScope((prev) => ({ ...prev, [group.scopeId]: playlist.id }));
                        setActivePage(group.scopeId === 'local' ? 'local' : group.scopeId);
                        setDrawerOpen(false);
                      }}
                      className="platform-preview-card flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left text-sm text-white/68"
                    >
                      {group.platform ? <PlatformGlyph platform={group.platform} compact /> : <Library className="h-4 w-4" />}
                      <span className="truncate">{playlist.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </aside>

          <section
            className={cx(
              'platform-preview-dialog absolute left-1/2 top-1/2 z-40 flex h-[460px] max-h-[calc(100%-1.5rem)] w-[720px] max-w-[calc(100%-1.5rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[26px] border border-white/10 transition-all duration-150',
              settingsOpen ? 'scale-100 opacity-100' : 'pointer-events-none scale-[0.96] opacity-0'
            )}
          >
            <div className="w-[210px] border-r border-white/10 bg-white/2 p-3">
              <button
                type="button"
                onClick={() => setSettingsTab('host')}
                className={cx(
                  'flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left text-sm transition-colors',
                  settingsTab === 'host' ? 'bg-white/10 text-white' : 'text-white/62 hover:bg-white/6'
                )}
              >
                <Settings className="h-4 w-4" />
                Host
              </button>
              {MOCK_INSTANCES.map((instance) => (
                <button
                  key={instance.id}
                  type="button"
                  onClick={() => setSettingsTab(instance.id)}
                  className={cx(
                    'mt-2 flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left text-sm transition-colors',
                    settingsTab === instance.id ? 'bg-white/10 text-white' : 'text-white/62 hover:bg-white/6'
                  )}
                >
                  <PlatformGlyph platform={instance.platform} compact active={settingsTab === instance.id} />
                  <span className="truncate">{instance.accountUid}</span>
                </button>
              ))}
            </div>

            <div className="platform-preview-scroll flex-1 overflow-y-auto p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm text-white/72">
                  {settingsTab === 'host'
                    ? t('magnet.platform.mock.settings.titleHost')
                    : instancesById[settingsTab]
                      ? getPlatformName(t, instancesById[settingsTab].platform)
                      : ''}
                </div>
                <button type="button" onClick={() => setSettingsOpen(false)} className="text-white/52">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {settingsTab === 'host' ? (
                <div className="space-y-4">
                  <div>
                    <div className="mb-2 text-xs text-white/32">{t('magnet.platform.mock.settings.groupAggregation')}</div>
                    <div className="flex flex-wrap gap-2">
                      {HOST_SETTINGS.aggregation.map((item, index) => (
                        <span key={item} className={cx('rounded-full border px-3 py-1.5 text-xs', index === 0 ? 'border-white/18 bg-white/10 text-white' : 'border-white/10 text-white/48')}>
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-xs text-white/32">{t('magnet.platform.mock.settings.groupSearch')}</div>
                    <div className="flex flex-wrap gap-2">
                      {HOST_SETTINGS.search.map((item, index) => (
                        <span key={item} className={cx('rounded-full border px-3 py-1.5 text-xs', index === 0 ? 'border-white/18 bg-white/10 text-white' : 'border-white/10 text-white/48')}>
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : instancesById[settingsTab] ? (
                <div className="space-y-4">
                  <div className="mb-2 text-xs text-white/32">{t('magnet.platform.mock.settings.groupQuality')}</div>
                  <div className="flex flex-wrap gap-2">
                    {instancesById[settingsTab].qualityOptions.map((item, index) => (
                      <span key={item} className={cx('rounded-full border px-3 py-1.5 text-xs', index === 0 ? 'border-white/18 bg-white/10 text-white' : 'border-white/10 text-white/48')}>
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section
            className={cx(
              'platform-preview-dialog platform-preview-create-dialog absolute left-1/2 top-1/2 z-40 flex max-h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[24px] border border-white/10 p-5',
              createOpen ? 'scale-100 opacity-100' : 'pointer-events-none scale-[0.96] opacity-0',
              createView === 'create'
                ? 'platform-preview-create-dialog-create'
                : 'platform-preview-create-dialog-existing'
            )}
          >
            <div className="mb-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setCreateView((prev) => (prev === 'create' ? 'existing' : 'create'));
                  setCreateNameEditing(false);
                }}
                className="platform-preview-create-toggle platform-preview-soft-ring inline-flex h-9 shrink-0 items-center rounded-full bg-white/4 text-white/62"
                title={
                  createView === 'create'
                    ? t('magnet.platform.mock.create.selectExisting')
                    : t('magnet.platform.mock.create.backToCreate')
                }
              >
                {createView === 'create' ? (
                  <>
                    <Library className="h-4 w-4" />
                    <span className="text-xs">{t('magnet.platform.mock.fab.playlists')}</span>
                  </>
                ) : (
                  <>
                    <ChevronLeft className="h-4 w-4" />
                    <span className="text-xs">{t('magnet.platform.mock.fab.create')}</span>
                  </>
                )}
              </button>
              <div className="min-w-0 flex-1 px-2 text-center">
                {createView === 'create' ? (
                  createNameEditing ? (
                    <input
                      ref={createNameInputRef}
                      value={createName}
                      onChange={(event) => setCreateName(event.target.value)}
                      onBlur={commitCreateName}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitCreateName();
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setCreateNameEditing(false);
                        }
                      }}
                      placeholder={defaultCreateName}
                      className="platform-preview-create-title-input w-full rounded-full border border-white/10 bg-white/4 px-4 py-2 text-center text-sm text-white outline-none placeholder:text-white/28"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCreateNameEditing(true)}
                      className="platform-preview-create-title-button max-w-full truncate rounded-full px-4 py-2 text-sm text-white"
                      title={t('magnet.platform.mock.create.nameLabel')}
                    >
                      {createName.trim() || defaultCreateName}
                    </button>
                  )
                ) : (
                  <div className="truncate text-sm text-white/72">
                    {t('magnet.platform.mock.create.existingTitle')}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={closeCreateDialog}
                className="platform-preview-soft-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/4 text-white/52"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="platform-preview-scroll min-h-0 flex-1">
              {createView === 'create' ? (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <div className="platform-preview-create-canvas platform-preview-scroll min-h-0 flex-1 rounded-[20px] px-3 py-3">
                    {stagedCreateTracks.length > 0 ? (
                      <div className="space-y-2">
                        {stagedCreateTracks.map((track) => (
                          <div
                            key={track.id}
                            className="platform-preview-card grid grid-cols-[auto,minmax(0,1fr),auto] items-center gap-3 rounded-[18px] px-3 py-3"
                          >
                            <PlatformGlyph platform={track.platform} compact />
                            <div className="min-w-0">
                              <div className="truncate text-sm text-white">{track.title}</div>
                              <div className="truncate text-xs text-white/42">{track.artist}</div>
                            </div>
                            <div className="text-xs text-white/36">{track.duration}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[180px] items-center justify-center text-xs text-white/36">
                        {t('magnet.platform.mock.create.itemsEmpty')}
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleCreateLocal}
                      className="rounded-full border border-white bg-white px-4 py-2 text-sm text-black"
                    >
                      {t('common.action.create')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 pr-1">
                  {audioLocalPlaylists.length > 0 ? (
                    audioLocalPlaylists.map((playlist) => (
                      <button
                        key={playlist.id}
                        type="button"
                        onClick={() => {
                          setSelectedPlaylistByScope((prev) => ({ ...prev, local: playlist.id }));
                          setActivePage('local');
                          closeCreateDialog();
                        }}
                        className="platform-preview-card flex w-full items-center gap-3 rounded-[18px] px-3 py-3 text-left text-white/72 transition-colors hover:text-white"
                      >
                        <span className="platform-preview-soft-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/4">
                          <Library className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-white">{playlist.name}</div>
                        </div>
                        <div className="shrink-0 text-xs text-white/36">
                          {playlist.trackCount ?? playlist.tracks.length}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="flex min-h-[220px] items-center justify-center rounded-[20px] border border-dashed border-white/10 bg-white/3 px-6 text-center text-sm text-white/42">
                      {t('magnet.platform.mock.create.existingEmpty')}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

const PLATFORM_MAGNET_RENDERERS = {
  ...buildMagnetVariantRenderers(PlatformMagnetDefaultRenderer, PLATFORM_MAGNET_VARIANT_PRESETS),
} satisfies Record<string, ComponentType<PlatformMagnetRendererProps>>;

export const PlatformMagnet: React.FC = () => {
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('platform-magnet', PLATFORM_MAGNET_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer skinProps={skin.props} />;
};
