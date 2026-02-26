import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ContextMenuItem, ContextMenu } from '../ContextMenu';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { useT } from '../../../i18n';
import {
  type DesktopLyricsOverlaySettings,
  type DesktopLyricsPositionPreset,
  normalizeDesktopLyricsFontSize,
  normalizeDesktopLyricsOpacityPercent,
  normalizeDesktopLyricsPositionOffset,
} from './DesktopLyricsButtonModel';
import { StandardDesktopLyricsButton } from './StandardDesktopLyricsButton';
import { useDesktopLyricsButtonData } from './useDesktopLyricsButtonData';
import { useDesktopLyricsButtonLogic } from './useDesktopLyricsButtonLogic';

const FONT_SIZE_OPTIONS: ReadonlyArray<{
  key: 'small' | 'medium' | 'large';
  value: number;
}> = [
  { key: 'small', value: 20 },
  { key: 'medium', value: 26 },
  { key: 'large', value: 32 },
];

const OPACITY_OPTIONS: ReadonlyArray<{
  key: 'p60' | 'p80' | 'p92' | 'p100';
  value: number;
}> = [
  { key: 'p60', value: 60 },
  { key: 'p80', value: 80 },
  { key: 'p92', value: 92 },
  { key: 'p100', value: 100 },
];

const POSITION_OPTIONS: ReadonlyArray<{
  key: 'bottomCenter' | 'bottomLeft' | 'bottomRight' | 'topCenter';
  value: DesktopLyricsPositionPreset;
}> = [
  { key: 'bottomCenter', value: 'bottom-center' },
  { key: 'bottomLeft', value: 'bottom-left' },
  { key: 'bottomRight', value: 'bottom-right' },
  { key: 'topCenter', value: 'top-center' },
];

const CHECKMARK_ICON = '✓';
const POSITION_NUDGE_STEP = 24;

export const DesktopLyricsButton: React.FC = () => {
  const t = useT();
  const data = useDesktopLyricsButtonData();
  const logic = useDesktopLyricsButtonLogic();
  const themeConfig = useComponentTheme('btn-desktop-lyrics');
  const [contextMenu, setContextMenu] = useState<null | {
    x: number;
    y: number;
    items: ContextMenuItem[];
  }>(null);
  const contextMenuMouseDownRef = useRef(false);

  const {
    enabled,
    clickThrough,
    setClickThrough,
    fontSize,
    setFontSize,
    opacityPercent,
    setOpacityPercent,
    positionPreset,
    setPositionPreset,
    positionOffsetX,
    setPositionOffsetX,
    positionOffsetY,
    setPositionOffsetY,
  } = data;

  const currentSettings = useMemo<DesktopLyricsOverlaySettings>(
    () => ({
      enabled,
      clickThrough,
      fontSize,
      opacityPercent,
      positionPreset,
      positionOffsetX,
      positionOffsetY,
    }),
    [enabled, clickThrough, fontSize, opacityPercent, positionPreset, positionOffsetX, positionOffsetY]
  );

  const initialSettingsRef = useRef(currentSettings);
  const { applyOverlaySettings } = logic;
  useEffect(() => {
    void applyOverlaySettings(initialSettingsRef.current).catch((error) => {
      console.warn('[desktop-lyrics-button] failed to sync initial desktop lyrics settings:', error);
    });
  }, [applyOverlaySettings]);

  const applyClickThrough = useCallback(
    async (next: boolean) => {
      const previous = clickThrough;
      setClickThrough(next);
      try {
        await logic.applyClickThrough(next);
      } catch (error) {
        setClickThrough(previous);
        console.error('[desktop-lyrics-button] failed to set click-through:', error);
      }
    },
    [clickThrough, logic, setClickThrough]
  );

  const applyFontSize = useCallback(
    async (next: number) => {
      const normalized = normalizeDesktopLyricsFontSize(next);
      const previous = fontSize;
      setFontSize(normalized);
      try {
        await logic.applyFontSize(normalized);
      } catch (error) {
        setFontSize(previous);
        console.error('[desktop-lyrics-button] failed to set font size:', error);
      }
    },
    [fontSize, logic, setFontSize]
  );

  const applyOpacityPercent = useCallback(
    async (next: number) => {
      const normalized = normalizeDesktopLyricsOpacityPercent(next);
      const previous = opacityPercent;
      setOpacityPercent(normalized);
      try {
        await logic.applyOpacityPercent(normalized);
      } catch (error) {
        setOpacityPercent(previous);
        console.error('[desktop-lyrics-button] failed to set opacity percent:', error);
      }
    },
    [logic, opacityPercent, setOpacityPercent]
  );

  const applyPositionPreset = useCallback(
    async (next: DesktopLyricsPositionPreset) => {
      const previous = positionPreset;
      setPositionPreset(next);
      try {
        await logic.applyPositionPreset(next);
      } catch (error) {
        setPositionPreset(previous);
        console.error('[desktop-lyrics-button] failed to set position preset:', error);
      }
    },
    [logic, positionPreset, setPositionPreset]
  );

  const applyPositionOffset = useCallback(
    async (nextX: number, nextY: number) => {
      const normalizedX = normalizeDesktopLyricsPositionOffset(nextX);
      const normalizedY = normalizeDesktopLyricsPositionOffset(nextY);
      const previousX = positionOffsetX;
      const previousY = positionOffsetY;

      setPositionOffsetX(normalizedX);
      setPositionOffsetY(normalizedY);
      try {
        await logic.applyPositionOffset(normalizedX, normalizedY);
      } catch (error) {
        setPositionOffsetX(previousX);
        setPositionOffsetY(previousY);
        console.error('[desktop-lyrics-button] failed to set position offset:', error);
      }
    },
    [logic, positionOffsetX, positionOffsetY, setPositionOffsetX, setPositionOffsetY]
  );

  const nudgePositionOffset = useCallback(
    (deltaX: number, deltaY: number) => {
      void applyPositionOffset(positionOffsetX + deltaX, positionOffsetY + deltaY);
    },
    [applyPositionOffset, positionOffsetX, positionOffsetY]
  );

  const openContextMenuAt = useCallback(
    (x: number, y: number) => {
      const items: ContextMenuItem[] = [
        {
          icon: clickThrough ? CHECKMARK_ICON : '',
          label: clickThrough
            ? t('magnet.desktopLyricsButton.contextMenu.clickThrough.disable')
            : t('magnet.desktopLyricsButton.contextMenu.clickThrough.enable'),
          onClick: () => void applyClickThrough(!clickThrough),
        },
        { divider: true } as ContextMenuItem,
        ...FONT_SIZE_OPTIONS.map((option) => ({
          icon: fontSize === option.value ? CHECKMARK_ICON : '',
          label: t(`magnet.desktopLyricsButton.contextMenu.fontSize.${option.key}`),
          onClick: () => void applyFontSize(option.value),
        })),
        { divider: true } as ContextMenuItem,
        ...OPACITY_OPTIONS.map((option) => ({
          icon: opacityPercent === option.value ? CHECKMARK_ICON : '',
          label: t(`magnet.desktopLyricsButton.contextMenu.opacity.${option.key}`),
          onClick: () => void applyOpacityPercent(option.value),
        })),
        { divider: true } as ContextMenuItem,
        ...POSITION_OPTIONS.map((option) => ({
          icon: positionPreset === option.value ? CHECKMARK_ICON : '',
          label: t(`magnet.desktopLyricsButton.contextMenu.position.${option.key}`),
          onClick: () => void applyPositionPreset(option.value),
        })),
        { divider: true } as ContextMenuItem,
        {
          label: t('magnet.desktopLyricsButton.contextMenu.position.moveLeft'),
          onClick: () => nudgePositionOffset(-POSITION_NUDGE_STEP, 0),
        },
        {
          label: t('magnet.desktopLyricsButton.contextMenu.position.moveRight'),
          onClick: () => nudgePositionOffset(POSITION_NUDGE_STEP, 0),
        },
        {
          label: t('magnet.desktopLyricsButton.contextMenu.position.moveUp'),
          onClick: () => nudgePositionOffset(0, -POSITION_NUDGE_STEP),
        },
        {
          label: t('magnet.desktopLyricsButton.contextMenu.position.moveDown'),
          onClick: () => nudgePositionOffset(0, POSITION_NUDGE_STEP),
        },
        {
          icon: positionOffsetX === 0 && positionOffsetY === 0 ? CHECKMARK_ICON : '',
          label: t('magnet.desktopLyricsButton.contextMenu.position.resetOffset'),
          onClick: () => void applyPositionOffset(0, 0),
        },
      ];

      setContextMenu({ x, y, items });
    },
    [
      applyClickThrough,
      applyFontSize,
      applyOpacityPercent,
      applyPositionPreset,
      applyPositionOffset,
      clickThrough,
      fontSize,
      opacityPercent,
      nudgePositionOffset,
      positionPreset,
      positionOffsetX,
      positionOffsetY,
      t,
    ]
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (contextMenuMouseDownRef.current) {
        contextMenuMouseDownRef.current = false;
        return;
      }
      openContextMenuAt(event.clientX, event.clientY);
    },
    [openContextMenuAt]
  );

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 2) return;
      contextMenuMouseDownRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      openContextMenuAt(event.clientX, event.clientY);
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          contextMenuMouseDownRef.current = false;
        }, 450);
      }
    },
    [openContextMenuAt]
  );

  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  return (
    <>
      <div
        className="desktop-lyrics-button-host"
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
      >
        <StandardDesktopLyricsButton
          data={data}
          logic={logic}
          variantConfig={themeConfig.variantConfig}
        />
      </div>
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </>
  );
};
