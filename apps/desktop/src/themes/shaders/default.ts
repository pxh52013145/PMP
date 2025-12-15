/**
 * 默认着色器
 */

import { Shader } from '../types/shader';

export const DefaultShader: Shader = {
  id: 'shader-default',
  name: '默认',
  description: '经典的绿色+紫色配色方案',
  colors: {
    primary: {
      base: '#00ff88',
      hover: '#00cc6f',
      active: '#00aa5c',
    },
    secondary: {
      base: '#1a1a2e',
      hover: '#25254a',
      active: '#16162e',
      opacity: 0.9,
    },
    accent: {
      base: '#ff0088',
      hover: '#ff3399',
      active: '#cc0066',
    },
    detail: {
      base: '#ffffff',
      hover: '#e0e0e0',
      disabled: '#666666',
    },
  },
  materials: {
    glow: 0.5,
  },
};
