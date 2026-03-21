import { useCallback, useEffect, useMemo, useState } from 'react';
import { readJson, readString, writeJson, writeString } from '../../../modules/storage';
import { useTheme } from '../../../themes/contexts/ThemeContextWithSync';
import {
  assignMagnetBindingFragment,
  dynamicColorConfigToCapability,
  dynamicColorCapabilityToConfig,
  materializeThemeBinding,
} from '../../../themes/importAdapters';
import type { DynamicColorConfig, DynamicColorEffect, ThemeBindingId } from '../../../themes/types/theme';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastSignal } from '../../../utils/windowCommunication';
import type { ColorThemePreset } from './stylePresets';

function normalizeCoverColorEffect(value: unknown): DynamicColorEffect {
  const allowed: DynamicColorEffect[] = ['tone', 'gradient', 'dynamic'];
  if (typeof value !== 'string') return 'tone';
  return (allowed.includes(value as DynamicColorEffect) ? value : 'tone') as DynamicColorEffect;
}

function normalizeCoverGradientAngle(value: unknown): number {
  const fallback = 120;
  if (typeof value !== 'number' || !isFinite(value)) return fallback;
  return ((value % 360) + 360) % 360;
}

function normalizeCoverDynamicSpeed(value: unknown): number {
  const fallback = 6;
  if (typeof value !== 'number' || !isFinite(value)) return fallback;
  return Math.max(2, Math.min(20, value));
}

export interface StyleEditorModel {
  // Pixel
  selectedPixelShape: string;
  pixelSize: number;
  pixelOpacity: number;
  applyPixelShape: (presetId: string) => Promise<void>;
  handlePixelSizeChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handlePixelOpacityChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;

  // Cover color
  coverColorEnabled: boolean;
  coverColorEffect: DynamicColorEffect;
  coverColorGradientAngle: number;
  coverColorDynamicSpeed: number;
  applyCoverColorConfig: (partial: Partial<DynamicColorConfig>) => Promise<void>;

  // Background / Border effect
  selectedBackgroundEffect: string;
  selectedBorderEffect: string;
  applyBackgroundEffect: (presetId: string) => Promise<void>;
  applyBorderEffect: (presetId: string) => Promise<void>;

  // Theme colors
  backgroundThemeColor: { id: string; rgb: [number, number, number] };
  borderThemeColor: { id: string; rgb: [number, number, number] };
  applyBackgroundThemeColor: (theme: ColorThemePreset) => Promise<void>;
  applyBorderThemeColor: (theme: ColorThemePreset) => Promise<void>;
  openColorPicker: (type: 'background' | 'border', event: React.MouseEvent<HTMLButtonElement>) => Promise<void>;
}

const COVER_COLOR_COMPONENT_IDS = ['track-info', 'progress-bar', 'audio-visualizer', 'btn-play-pause'] as const;

export function useStyleEditorModel(): StyleEditorModel {
  const { theme, applyTheme, getBinding } = useTheme();

  const currentCoverColorConfig: DynamicColorConfig = useMemo(() => {
    for (const componentId of COVER_COLOR_COMPONENT_IDS) {
      const bindingId = `magnet.${componentId}` as ThemeBindingId;
      const config = dynamicColorCapabilityToConfig(getBinding(bindingId).capabilities?.dynamicColor);
      if (config) {
        return config as DynamicColorConfig;
      }
    }
    return {} as DynamicColorConfig;
  }, [getBinding]);

  const coverColorEnabled = currentCoverColorConfig.extractFromCover !== false;
  const coverColorEffect = normalizeCoverColorEffect(currentCoverColorConfig.effect);
  const coverColorGradientAngle = normalizeCoverGradientAngle(currentCoverColorConfig.gradientAngle);
  const coverColorDynamicSpeed = normalizeCoverDynamicSpeed(currentCoverColorConfig.dynamicSpeed);

  const applyCoverColorConfig = useCallback(
    async (partial: Partial<DynamicColorConfig>) => {
      let nextTheme = theme;

      for (const componentId of COVER_COLOR_COMPONENT_IDS) {
        const bindingId = `magnet.${componentId}` as ThemeBindingId;
        const currentFragment = materializeThemeBinding(nextTheme, bindingId);
        const nextDynamicColor = dynamicColorConfigToCapability({
          ...(dynamicColorCapabilityToConfig(currentFragment.capabilities?.dynamicColor) ?? {}),
          ...partial,
        });
        nextTheme = assignMagnetBindingFragment(nextTheme, componentId, {
          ...currentFragment,
          ...(nextDynamicColor
            ? {
                capabilities: {
                  dynamicColor: nextDynamicColor,
                },
              }
            : {}),
        });
      }

      await applyTheme(nextTheme);
    },
    [applyTheme, theme]
  );

  const [selectedPixelShape, setSelectedPixelShape] = useState(() => readString(STORAGE_KEYS.PIXEL_SHAPE) || 'circle');
  const [selectedBackgroundEffect, setSelectedBackgroundEffect] = useState(() => readString(STORAGE_KEYS.BACKGROUND_EFFECT) || 'none');
  const [selectedBorderEffect, setSelectedBorderEffect] = useState(() => readString(STORAGE_KEYS.BORDER_EFFECT) || 'none');
  const [pixelSize, setPixelSize] = useState(() => {
    const savedSize = readString(STORAGE_KEYS.PIXEL_SIZE);
    return savedSize ? Math.round(parseFloat(savedSize) * 100) : 100;
  });
  const [pixelOpacity, setPixelOpacity] = useState(() => {
    const savedOpacity = readString(STORAGE_KEYS.PIXEL_OPACITY);
    return savedOpacity ? Math.round(parseFloat(savedOpacity) * 100) : 100;
  });
  const [backgroundThemeColor, setBackgroundThemeColor] = useState(() => {
    return readJson(STORAGE_KEYS.BACKGROUND_THEME_COLOR, { id: 'cyan', rgb: [0, 255, 136] as [number, number, number] });
  });
  const [borderThemeColor, setBorderThemeColor] = useState(() => {
    return readJson(STORAGE_KEYS.BORDER_THEME_COLOR, { id: 'cyan', rgb: [0, 255, 136] as [number, number, number] });
  });

  const applyPixelShape = useCallback(async (presetId: string) => {
    setSelectedPixelShape(presetId);
    writeString(STORAGE_KEYS.PIXEL_SHAPE, presetId);
    await broadcastSignal(TAURI_EVENTS.PIXEL_SHAPE_UPDATED);
  }, []);

  const handlePixelSizeChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    setPixelSize(value);
    writeString(STORAGE_KEYS.PIXEL_SIZE, (value / 100).toString());
    await broadcastSignal(TAURI_EVENTS.PIXEL_SIZE_UPDATED);
  }, []);

  const handlePixelOpacityChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    setPixelOpacity(value);
    writeString(STORAGE_KEYS.PIXEL_OPACITY, (value / 100).toString());
    await broadcastSignal(TAURI_EVENTS.PIXEL_OPACITY_UPDATED);
  }, []);

  const applyBackgroundEffect = useCallback(async (presetId: string) => {
    setSelectedBackgroundEffect(presetId);
    writeString(STORAGE_KEYS.BACKGROUND_EFFECT, presetId);
    await broadcastSignal(TAURI_EVENTS.BACKGROUND_EFFECT_UPDATED);
  }, []);

  const applyBorderEffect = useCallback(async (presetId: string) => {
    setSelectedBorderEffect(presetId);
    writeString(STORAGE_KEYS.BORDER_EFFECT, presetId);
    await broadcastSignal(TAURI_EVENTS.BORDER_EFFECT_UPDATED);
  }, []);

  const applyBackgroundThemeColor = useCallback(async (themePreset: ColorThemePreset) => {
    const themeData = { id: themePreset.id, rgb: themePreset.rgb };
    setBackgroundThemeColor(themeData);
    writeJson(STORAGE_KEYS.BACKGROUND_THEME_COLOR, themeData);

    document.documentElement.style.setProperty('--bg-theme-color-r', themePreset.rgb[0].toString());
    document.documentElement.style.setProperty('--bg-theme-color-g', themePreset.rgb[1].toString());
    document.documentElement.style.setProperty('--bg-theme-color-b', themePreset.rgb[2].toString());
    await broadcastSignal(TAURI_EVENTS.BACKGROUND_THEME_COLOR_UPDATED);
  }, []);

  const applyBorderThemeColor = useCallback(async (themePreset: ColorThemePreset) => {
    const themeData = { id: themePreset.id, rgb: themePreset.rgb };
    setBorderThemeColor(themeData);
    writeJson(STORAGE_KEYS.BORDER_THEME_COLOR, themeData);

    document.documentElement.style.setProperty('--border-theme-color-r', themePreset.rgb[0].toString());
    document.documentElement.style.setProperty('--border-theme-color-g', themePreset.rgb[1].toString());
    document.documentElement.style.setProperty('--border-theme-color-b', themePreset.rgb[2].toString());
    await broadcastSignal(TAURI_EVENTS.BORDER_THEME_COLOR_UPDATED);
  }, []);

  const openColorPicker = useCallback(
    async (type: 'background' | 'border', event: React.MouseEvent<HTMLButtonElement>) => {
      const input = document.createElement('input');
      input.type = 'color';
      input.className = 'color-picker-input';

      const button = event.currentTarget;
      const rect = button.getBoundingClientRect();
      input.style.position = 'fixed';
      input.style.left = `${rect.left}px`;
      input.style.top = `${rect.top}px`;
      input.style.opacity = '0';
      input.style.width = '0';
      input.style.height = '0';

      const currentColor = type === 'background' ? backgroundThemeColor.rgb : borderThemeColor.rgb;
      input.value = `#${currentColor.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

      const handleColorChange = async (e: Event) => {
        const color = (e.target as HTMLInputElement).value;
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);

        const customTheme: ColorThemePreset = {
          id: 'custom',
          nameKey: 'editor.style-editor.colorTheme.custom',
          rgb: [r, g, b],
        };

        if (type === 'background') {
          await applyBackgroundThemeColor(customTheme);
        } else {
          await applyBorderThemeColor(customTheme);
        }
      };

      const handleBlur = () => {
        setTimeout(() => {
          input.removeEventListener('change', handleColorChange);
          input.removeEventListener('blur', handleBlur);
          if (document.body.contains(input)) {
            document.body.removeChild(input);
          }
        }, 100);
      };

      input.addEventListener('change', handleColorChange);
      input.addEventListener('blur', handleBlur);
      document.body.appendChild(input);

      setTimeout(() => {
        input.click();
      }, 0);
    },
    [applyBackgroundThemeColor, applyBorderThemeColor, backgroundThemeColor.rgb, borderThemeColor.rgb]
  );

  useEffect(() => {
    document.documentElement.style.setProperty('--bg-theme-color-r', backgroundThemeColor.rgb[0].toString());
    document.documentElement.style.setProperty('--bg-theme-color-g', backgroundThemeColor.rgb[1].toString());
    document.documentElement.style.setProperty('--bg-theme-color-b', backgroundThemeColor.rgb[2].toString());

    document.documentElement.style.setProperty('--border-theme-color-r', borderThemeColor.rgb[0].toString());
    document.documentElement.style.setProperty('--border-theme-color-g', borderThemeColor.rgb[1].toString());
    document.documentElement.style.setProperty('--border-theme-color-b', borderThemeColor.rgb[2].toString());
  }, [backgroundThemeColor.rgb, borderThemeColor.rgb]);

  return {
    selectedPixelShape,
    pixelSize,
    pixelOpacity,
    applyPixelShape,
    handlePixelSizeChange,
    handlePixelOpacityChange,
    coverColorEnabled,
    coverColorEffect,
    coverColorGradientAngle,
    coverColorDynamicSpeed,
    applyCoverColorConfig,
    selectedBackgroundEffect,
    selectedBorderEffect,
    applyBackgroundEffect,
    applyBorderEffect,
    backgroundThemeColor,
    borderThemeColor,
    applyBackgroundThemeColor,
    applyBorderThemeColor,
    openColorPicker,
  };
}

