import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ContextMenuItem, ContextMenu } from '../ContextMenu';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { useT } from '../../../i18n';
import {
  type DesktopLyricsOverlaySettings,
  normalizeDesktopLyricsFontSize,
  normalizeDesktopLyricsLyricOffsetMs,
  normalizeDesktopLyricsOpacityPercent,
  normalizeDesktopLyricsPositionOffset,
  normalizeDesktopLyricsRegionHeight,
  normalizeDesktopLyricsRegionWidth,
} from './DesktopLyricsButtonModel';
import { StandardDesktopLyricsButton } from './StandardDesktopLyricsButton';
import { useDesktopLyricsButtonData } from './useDesktopLyricsButtonData';
import { useDesktopLyricsButtonLogic } from './useDesktopLyricsButtonLogic';
import { TAURI_EVENTS, setupTauriListenerWithPayload } from '../../../utils/windowCommunication';

interface DesktopLyricsLayoutChangedPayload {
  offsetX: number;
  offsetY: number;
  regionWidth: number;
  regionHeight: number;
}

interface DesktopLyricsControlsChangedPayload {
  visible: boolean;
  clickThrough: boolean;
  fontSize: number;
  opacityPercent: number;
}

const CHECKMARK_ICON = '✓';
const LYRIC_OFFSET_OPTIONS: ReadonlyArray<{
  key: 'minus500' | 'minus250' | 'zero' | 'plus250' | 'plus500';
  value: number;
}> = [
  { key: 'minus500', value: -500 },
  { key: 'minus250', value: -250 },
  { key: 'zero', value: 0 },
  { key: 'plus250', value: 250 },
  { key: 'plus500', value: 500 },
];

const LYRIC_OFFSET_NUDGE_STEP = 100;

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
    setEnabled,
    clickThrough,
    setClickThrough,
    fontSize,
    setFontSize,
    opacityPercent,
    setOpacityPercent,
    positionPreset,
    positionOffsetX,
    setPositionOffsetX,
    positionOffsetY,
    setPositionOffsetY,
    regionWidth,
    setRegionWidth,
    regionHeight,
    setRegionHeight,
    lyricOffsetMs,
    setLyricOffsetMs,
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
      regionWidth,
      regionHeight,
      lyricOffsetMs,
    }),
    [
      enabled,
      clickThrough,
      fontSize,
      opacityPercent,
      positionPreset,
      positionOffsetX,
      positionOffsetY,
      regionWidth,
      regionHeight,
      lyricOffsetMs,
    ]
  );

  const initialSettingsRef = useRef(currentSettings);
  const { applyOverlaySettings } = logic;
  useEffect(() => {
    void applyOverlaySettings(initialSettingsRef.current).catch((error) => {
      console.warn('[desktop-lyrics-button] failed to sync initial desktop lyrics settings:', error);
    });
  }, [applyOverlaySettings]);

  useEffect(() => {
    let unlistenLayout: (() => void) | null = null;
    let unlistenControls: (() => void) | null = null;
    let cancelled = false;

    const sync = async () => {
      unlistenLayout = await setupTauriListenerWithPayload<DesktopLyricsLayoutChangedPayload>(
        TAURI_EVENTS.DESKTOP_LYRICS_LAYOUT_CHANGED,
        (payload) => {
          const nextOffsetX = normalizeDesktopLyricsPositionOffset(payload.offsetX);
          const nextOffsetY = normalizeDesktopLyricsPositionOffset(payload.offsetY);
          const nextRegionWidth = normalizeDesktopLyricsRegionWidth(payload.regionWidth);
          const nextRegionHeight = normalizeDesktopLyricsRegionHeight(payload.regionHeight);

          setPositionOffsetX(nextOffsetX);
          setPositionOffsetY(nextOffsetY);
          setRegionWidth(nextRegionWidth);
          setRegionHeight(nextRegionHeight);
        }
      );

      unlistenControls = await setupTauriListenerWithPayload<DesktopLyricsControlsChangedPayload>(
        TAURI_EVENTS.DESKTOP_LYRICS_CONTROLS_CHANGED,
        (payload) => {
          setEnabled(payload.visible === true);
          setClickThrough(payload.clickThrough === true);
          setFontSize(normalizeDesktopLyricsFontSize(payload.fontSize));
          setOpacityPercent(normalizeDesktopLyricsOpacityPercent(payload.opacityPercent));
        }
      );

      if (cancelled) {
        if (unlistenLayout) {
          unlistenLayout();
          unlistenLayout = null;
        }
        if (unlistenControls) {
          unlistenControls();
          unlistenControls = null;
        }
      }
    };

    void sync();

    return () => {
      cancelled = true;
      if (unlistenLayout) {
        unlistenLayout();
      }
      if (unlistenControls) {
        unlistenControls();
      }
    };
  }, [
    setClickThrough,
    setEnabled,
    setFontSize,
    setOpacityPercent,
    setPositionOffsetX,
    setPositionOffsetY,
    setRegionHeight,
    setRegionWidth,
  ]);

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

  const applyLyricOffsetMs = useCallback(
    async (next: number) => {
      const normalized = normalizeDesktopLyricsLyricOffsetMs(next);
      const previous = lyricOffsetMs;

      setLyricOffsetMs(normalized);
      try {
        await logic.applyLyricOffsetMs(normalized);
      } catch (error) {
        setLyricOffsetMs(previous);
        console.error('[desktop-lyrics-button] failed to set lyric offset:', error);
      }
    },
    [logic, lyricOffsetMs, setLyricOffsetMs]
  );

  const nudgeLyricOffset = useCallback(
    (deltaMs: number) => {
      void applyLyricOffsetMs(lyricOffsetMs + deltaMs);
    },
    [applyLyricOffsetMs, lyricOffsetMs]
  );

  const openContextMenuAt = useCallback(
    (x: number, y: number) => {
      const items: ContextMenuItem[] = [
        {
          icon: positionOffsetX === 0 && positionOffsetY === 0 ? CHECKMARK_ICON : '',
          label: t('magnet.desktopLyricsButton.contextMenu.position.resetOffset'),
          onClick: () => void applyPositionOffset(0, 0),
        },
        { divider: true } as ContextMenuItem,
        ...LYRIC_OFFSET_OPTIONS.map((option) => ({
          icon: lyricOffsetMs === option.value ? CHECKMARK_ICON : '',
          label: t(`magnet.desktopLyricsButton.contextMenu.lyricOffset.${option.key}`),
          onClick: () => void applyLyricOffsetMs(option.value),
        })),
        {
          label: t('magnet.desktopLyricsButton.contextMenu.lyricOffset.earlier'),
          onClick: () => nudgeLyricOffset(-LYRIC_OFFSET_NUDGE_STEP),
        },
        {
          label: t('magnet.desktopLyricsButton.contextMenu.lyricOffset.later'),
          onClick: () => nudgeLyricOffset(LYRIC_OFFSET_NUDGE_STEP),
        },
      ];

      setContextMenu({ x, y, items });
    },
    [
      applyPositionOffset,
      applyLyricOffsetMs,
      lyricOffsetMs,
      nudgeLyricOffset,
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

