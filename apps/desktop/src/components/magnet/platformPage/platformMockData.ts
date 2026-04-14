export type PlatformKind = 'netease' | 'bilibili' | 'qqmusic';

export interface MockTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  badges: string[];
  coverUrl?: string;
  sourcePlatform?: PlatformKind | 'local';
}

export interface MockPlaylist {
  id: string;
  name: string;
  note: string;
  tracks: MockTrack[];
}

export type MockChannelIcon = 'clock' | 'chart' | 'sparkles' | 'heart' | 'radio' | 'library';

export interface MockChannel {
  id: string;
  icon: MockChannelIcon;
  titleKey: string;
  subtitleKey: string;
  tagKey: string;
  detailPlaylistId?: string;
}

export interface MockInstance {
  id: string;
  platform: PlatformKind;
  accountUid: string;
  dailyTrack: MockTrack;
  queue: MockTrack[];
  playlists: MockPlaylist[];
  channels: MockChannel[];
  qualityOptions: string[];
}

export const MOCK_INSTANCES: MockInstance[] = [
  {
    id: 'netease-main',
    platform: 'netease',
    accountUid: 'UID 284109',
    dailyTrack: {
      id: 'nm-daily',
      title: 'Night Transit',
      artist: 'Dawnwatch',
      album: 'Skylight',
      duration: '04:12',
      badges: ['Daily'],
    },
    queue: [
      {
        id: 'nm-q1',
        title: 'Night Transit',
        artist: 'Dawnwatch',
        album: 'Skylight',
        duration: '04:12',
        badges: ['HQ'],
      },
      {
        id: 'nm-q2',
        title: 'Cloudline',
        artist: 'Mika Seto',
        album: 'Skylight',
        duration: '03:41',
        badges: ['HQ'],
      },
      {
        id: 'nm-q3',
        title: 'Warm City',
        artist: 'Luna Harbor',
        album: 'Metro Echo',
        duration: '04:06',
        badges: ['Lossless'],
      },
    ],
    playlists: [
      {
        id: 'nm-p1',
        name: 'Late Replay',
        note: 'Night queue.',
        tracks: [
          {
            id: 'nm-p1-1',
            title: 'Warm City',
            artist: 'Luna Harbor',
            album: 'Metro Echo',
            duration: '04:06',
            badges: ['Lossless'],
          },
          {
            id: 'nm-p1-2',
            title: 'Blue Hall',
            artist: 'Kyo',
            album: 'Blue Hall',
            duration: '03:38',
            badges: ['HQ'],
          },
        ],
      },
      {
        id: 'nm-p2',
        name: 'Commute Cuts',
        note: 'Day queue.',
        tracks: [
          {
            id: 'nm-p2-1',
            title: 'North Gate',
            artist: 'Aster',
            album: 'Street Tape',
            duration: '03:14',
            badges: ['HQ'],
          },
          {
            id: 'nm-p2-2',
            title: 'Glass Morning',
            artist: 'Lina',
            album: 'Street Tape',
            duration: '03:57',
            badges: ['VIP'],
          },
        ],
      },
    ],
    channels: [
      {
        id: 'nm-c1',
        icon: 'clock',
        titleKey: 'magnet.platform.mock.channel.latest.title',
        subtitleKey: 'magnet.platform.mock.channel.latest.subtitle',
        tagKey: 'magnet.platform.mock.channel.tag.fresh',
        detailPlaylistId: 'nm-p2',
      },
      {
        id: 'nm-c2',
        icon: 'chart',
        titleKey: 'magnet.platform.mock.channel.chart.title',
        subtitleKey: 'magnet.platform.mock.channel.chart.subtitle',
        tagKey: 'magnet.platform.mock.channel.tag.hot',
        detailPlaylistId: 'nm-p1',
      },
      {
        id: 'nm-c3',
        icon: 'sparkles',
        titleKey: 'magnet.platform.mock.channel.roaming.title',
        subtitleKey: 'magnet.platform.mock.channel.roaming.subtitle',
        tagKey: 'magnet.platform.mock.channel.tag.daily',
      },
      {
        id: 'nm-c4',
        icon: 'heart',
        titleKey: 'magnet.platform.mock.channel.favorites.title',
        subtitleKey: 'magnet.platform.mock.channel.favorites.subtitle',
        tagKey: 'magnet.platform.mock.channel.tag.save',
        detailPlaylistId: 'nm-p1',
      },
    ],
    qualityOptions: ['Auto', 'HQ', 'Lossless'],
  },
  {
    id: 'netease-alt',
    platform: 'netease',
    accountUid: 'UID 941772',
    dailyTrack: {
      id: 'na-daily',
      title: 'Blue Archive',
      artist: 'Mitsukiyo',
      album: 'Blue Archive OST',
      duration: '03:27',
      badges: ['Daily'],
    },
    queue: [
      {
        id: 'na-q1',
        title: 'Blue Archive',
        artist: 'Mitsukiyo',
        album: 'Blue Archive OST',
        duration: '03:27',
        badges: ['Hi-Res'],
      },
      {
        id: 'na-q2',
        title: 'Aoharu',
        artist: 'Nor',
        album: 'Blue Archive OST',
        duration: '02:58',
        badges: ['HQ'],
      },
      {
        id: 'na-q3',
        title: 'Library Step',
        artist: 'Haru',
        album: 'Quiet Room',
        duration: '04:02',
        badges: ['HQ'],
      },
    ],
    playlists: [
      {
        id: 'na-p1',
        name: 'Study OST',
        note: 'Alt account.',
        tracks: [
          {
            id: 'na-p1-1',
            title: 'Aoharu',
            artist: 'Nor',
            album: 'Blue Archive OST',
            duration: '02:58',
            badges: ['HQ'],
          },
          {
            id: 'na-p1-2',
            title: 'Quiet Room',
            artist: 'Haru',
            album: 'Quiet Room',
            duration: '04:02',
            badges: ['Lossless'],
          },
        ],
      },
      {
        id: 'na-p2',
        name: 'Ending Loop',
        note: 'Voice and OST.',
        tracks: [
          {
            id: 'na-p2-1',
            title: 'Fiction',
            artist: 'sumika',
            album: 'familia',
            duration: '03:42',
            badges: ['VIP'],
          },
          {
            id: 'na-p2-2',
            title: 'Again',
            artist: 'YUI',
            album: 'again',
            duration: '04:15',
            badges: ['HQ'],
          },
        ],
      },
    ],
    channels: [
      {
        id: 'na-c1',
        icon: 'sparkles',
        titleKey: 'magnet.platform.mock.channel.roaming.title',
        subtitleKey: 'magnet.platform.mock.channel.roaming.subtitle',
        tagKey: 'magnet.platform.mock.channel.tag.daily',
      },
      {
        id: 'na-c2',
        icon: 'radio',
        titleKey: 'magnet.platform.mock.channel.soundtrack.title',
        subtitleKey: 'magnet.platform.mock.channel.soundtrack.subtitle',
        tagKey: 'magnet.platform.mock.channel.tag.topic',
        detailPlaylistId: 'na-p1',
      },
      {
        id: 'na-c3',
        icon: 'library',
        titleKey: 'magnet.platform.mock.channel.archive.title',
        subtitleKey: 'magnet.platform.mock.channel.archive.subtitle',
        tagKey: 'magnet.platform.mock.channel.tag.pick',
        detailPlaylistId: 'na-p2',
      },
      {
        id: 'na-c4',
        icon: 'heart',
        titleKey: 'magnet.platform.mock.channel.favorites.title',
        subtitleKey: 'magnet.platform.mock.channel.favorites.subtitle',
        tagKey: 'magnet.platform.mock.channel.tag.save',
        detailPlaylistId: 'na-p2',
      },
    ],
    qualityOptions: ['Auto', 'HQ', 'Hi-Res'],
  },
  {
    id: 'bilibili-main',
    platform: 'bilibili',
    accountUid: 'UID 670321',
    dailyTrack: {
      id: 'bi-daily',
      title: 'Again',
      artist: 'YUI',
      album: 'again',
      duration: '04:15',
      badges: ['Daily'],
    },
    queue: [
      {
        id: 'bi-q1',
        title: 'Again',
        artist: 'YUI',
        album: 'again',
        duration: '04:15',
        badges: ['Fav'],
      },
      {
        id: 'bi-q2',
        title: 'Only My Railgun',
        artist: 'fripSide',
        album: 'infinite synthesis',
        duration: '04:11',
        badges: ['MV'],
      },
      {
        id: 'bi-q3',
        title: 'Blessing',
        artist: 'YOASOBI',
        album: 'The Witch From Mercury',
        duration: '03:14',
        badges: ['BV'],
      },
    ],
    playlists: [
      {
        id: 'bi-p1',
        name: 'Fav ACG',
        note: 'Favorite folder.',
        tracks: [
          {
            id: 'bi-p1-1',
            title: 'Only My Railgun',
            artist: 'fripSide',
            album: 'infinite synthesis',
            duration: '04:11',
            badges: ['MV'],
          },
          {
            id: 'bi-p1-2',
            title: 'Unravel',
            artist: 'TK',
            album: 'Fantastic Magic',
            duration: '04:01',
            badges: ['BV'],
          },
        ],
      },
      {
        id: 'bi-p2',
        name: 'Cover Watch',
        note: 'Creator shelf.',
        tracks: [
          {
            id: 'bi-p2-1',
            title: 'Blessing',
            artist: 'YOASOBI',
            album: 'The Witch From Mercury',
            duration: '03:14',
            badges: ['Fav'],
          },
          {
            id: 'bi-p2-2',
            title: 'Blue Bird',
            artist: 'Ikimonogakari',
            album: 'My Song Your Song',
            duration: '03:34',
            badges: ['BV'],
          },
        ],
      },
    ],
    channels: [
      {
        id: 'bi-c1',
        icon: 'clock',
        titleKey: 'magnet.platform.mock.channel.latest.title',
        subtitleKey: 'magnet.platform.mock.channel.latest.subtitle',
        tagKey: 'magnet.platform.mock.channel.tag.fresh',
        detailPlaylistId: 'bi-p2',
      },
      {
        id: 'bi-c2',
        icon: 'chart',
        titleKey: 'magnet.platform.mock.channel.chart.title',
        subtitleKey: 'magnet.platform.mock.channel.chart.subtitle',
        tagKey: 'magnet.platform.mock.channel.tag.hot',
        detailPlaylistId: 'bi-p1',
      },
      {
        id: 'bi-c3',
        icon: 'radio',
        titleKey: 'magnet.platform.mock.channel.soundtrack.title',
        subtitleKey: 'magnet.platform.mock.channel.soundtrack.subtitle',
        tagKey: 'magnet.platform.mock.channel.tag.topic',
      },
      {
        id: 'bi-c4',
        icon: 'library',
        titleKey: 'magnet.platform.mock.channel.archive.title',
        subtitleKey: 'magnet.platform.mock.channel.archive.subtitle',
        tagKey: 'magnet.platform.mock.channel.tag.pick',
        detailPlaylistId: 'bi-p2',
      },
    ],
    qualityOptions: ['Auto', 'BV', 'Audio 192K'],
  },
];

export const MOCK_LOADED_STATE: Record<string, boolean> = {
  'netease-main': true,
  'netease-alt': false,
  'bilibili-main': true,
};

export const MOCK_LOCAL_PLAYLISTS: MockPlaylist[] = [
  {
    id: 'local-1',
    name: 'Late Save',
    note: 'Cross-platform local list.',
    tracks: [
      {
        id: 'local-1-1',
        title: 'Night Transit',
        artist: 'Dawnwatch',
        album: 'Skylight',
        duration: '04:12',
        badges: ['HQ'],
        sourcePlatform: 'netease',
      },
      {
        id: 'local-1-2',
        title: 'Again',
        artist: 'YUI',
        album: 'again',
        duration: '04:15',
        badges: ['MV'],
        sourcePlatform: 'bilibili',
      },
    ],
  },
  {
    id: 'local-2',
    name: 'Desk Loop',
    note: 'Mock local queue.',
    tracks: [
      {
        id: 'local-2-1',
        title: 'Blue Archive',
        artist: 'Mitsukiyo',
        album: 'Blue Archive OST',
        duration: '03:27',
        badges: ['Hi-Res'],
        sourcePlatform: 'netease',
      },
      {
        id: 'local-2-2',
        title: 'Cloudline',
        artist: 'Mika Seto',
        album: 'Skylight',
        duration: '03:41',
        badges: ['Lossless'],
        sourcePlatform: 'netease',
      },
    ],
  },
];
