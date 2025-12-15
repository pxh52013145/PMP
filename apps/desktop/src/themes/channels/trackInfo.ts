/**
 * TrackInfo 组件的材质通道定义
 */

import { MaterialChannels } from '../types/materialChannels';

export const TrackInfoChannels: MaterialChannels = {
  componentId: 'track-info',
  componentType: 'info',
  channels: {
    // 背景使用次要色
    backgroundColor: {
      slot: 'secondary',
      alpha: 0.85,
    },
    // 标题文字使用细节色
    titleColor: {
      slot: 'detail',
    },
    // 副标题使用细节色（半透明）
    subtitleColor: {
      slot: 'detail',
      alpha: 0.7,
    },
    // 封面边框使用主色
    coverBorder: {
      slot: 'primary',
    },
    // 光效使用强调色
    glowColor: {
      slot: 'accent',
    },
  },
};
