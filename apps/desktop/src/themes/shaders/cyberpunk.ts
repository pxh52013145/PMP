/**
 * 赛博朋克着色器
 */

import { Shader } from '../types/shader';

export const CyberpunkShader: Shader = {
  id: 'shader-cyberpunk',
  name: '赛博朋克',
  description: '充满未来感的品红+青色配色',
  colors: {
    primary: {
      base: '#ff00ff', // 品红
      hover: '#ff33ff',
      active: '#cc00cc',
    },
    secondary: {
      base: '#0a0a1e', // 深蓝黑
      hover: '#1a1a3e',
      opacity: 0.95,
    },
    accent: {
      base: '#00ffff', // 青色
      hover: '#33ffff',
      active: '#00cccc',
    },
    detail: {
      base: '#ff9900', // 橙色
      hover: '#ffaa33',
    },
  },
  materials: {
    metallic: 0.8,
    glow: 0.6,
  },
  effects: {
    gradient: true,
    animation: 'pulse',
  },
};
