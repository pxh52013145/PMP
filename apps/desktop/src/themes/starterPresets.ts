import { mergeComponentThemes } from './mergeComponentTheme';
import type { ComponentTheme, Theme, ThemeBindingId, ThemeSurfaceId, ThemeTokens } from './types/theme';

export const MUSIC_LIBRARY_THEME_TOKEN_PRESET: ThemeTokens = {
  color: {
    'surface.canvas': 'rgba(20, 20, 30, 0.98)',
    'surface.panel': 'rgba(0, 0, 0, 0.22)',
    'surface.subtle': 'rgba(255, 255, 255, 0.04)',
    'surface.subtle-strong': 'rgba(255, 255, 255, 0.08)',
    'surface.overlay': 'rgba(0, 0, 0, 0.3)',
    'surface.overlay-strong': 'rgba(0, 0, 0, 0.4)',
    'border.default': 'rgba(255, 255, 255, 0.1)',
    'border.muted': 'rgba(255, 255, 255, 0.08)',
    'border.soft': 'rgba(255, 255, 255, 0.16)',
    'text.primary': 'rgba(255, 255, 255, 0.9)',
    'text.secondary': 'rgba(255, 255, 255, 0.75)',
    'text.tertiary': 'rgba(255, 255, 255, 0.6)',
    'text.muted': 'rgba(255, 255, 255, 0.4)',
    'text.inverse': 'rgba(255, 255, 255, 0.98)',
    'accent.primary': 'rgba(108, 148, 255, 0.95)',
    'accent.soft': 'rgba(108, 148, 255, 0.12)',
    'accent.soft-strong': 'rgba(108, 148, 255, 0.18)',
    'accent.border': 'rgba(138, 170, 255, 0.38)',
    'accent.border-strong': 'rgba(138, 170, 255, 0.9)',
    'accent.glow': 'rgba(136, 182, 255, 0.12)',
    'accent.gradient': 'linear-gradient(180deg, rgba(94, 144, 255, 0.28), rgba(74, 120, 235, 0.22))',
    'accent.gradient-strong':
      'linear-gradient(180deg, rgba(94, 144, 255, 0.36), rgba(74, 120, 235, 0.28))',
    'info.soft': 'rgba(86, 228, 255, 0.16)',
    'info.text': 'rgba(170, 241, 255, 0.95)',
    'warning.text': 'rgba(255, 229, 122, 0.95)',
    'warning.soft': 'rgba(255, 208, 74, 0.12)',
    'warning.border': 'rgba(255, 208, 74, 0.28)',
    'success.text': 'rgba(104, 255, 124, 0.98)',
    'success.soft': 'rgba(104, 255, 124, 0.16)',
    'success.line': 'rgba(104, 255, 124, 0.96)',
    'success.glow': 'rgba(104, 255, 124, 0.18)',
    'danger.text': 'rgba(255, 108, 108, 0.98)',
    'danger.soft': 'rgba(255, 104, 104, 0.16)',
    'danger.line': 'rgba(255, 108, 108, 0.84)',
    'danger.glow': 'rgba(255, 92, 92, 0.22)',
    'scrollbar.track': '#000',
    'scrollbar.button':
      'radial-gradient(circle at 50% 35%, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.02) 42%, transparent 74%), linear-gradient(180deg, rgba(100, 100, 255, 0.06) 0%, rgba(100, 100, 255, 0.02) 100%)',
    'scrollbar.button-hover':
      'radial-gradient(circle at 50% 35%, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.03) 42%, transparent 74%), linear-gradient(180deg, rgba(100, 100, 255, 0.09) 0%, rgba(100, 100, 255, 0.03) 100%)',
    'scrollbar.button-active':
      'radial-gradient(circle at 50% 35%, rgba(255, 255, 255, 0.09) 0%, rgba(255, 255, 255, 0.02) 42%, transparent 74%), linear-gradient(180deg, rgba(100, 100, 255, 0.12) 0%, rgba(100, 100, 255, 0.04) 100%)',
    'scrollbar.thumb':
      'linear-gradient(180deg, rgba(100, 100, 255, 0.14) 0%, rgba(100, 100, 255, 0.06) 100%), repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.045) 0, rgba(255, 255, 255, 0.045) 3px, rgba(255, 255, 255, 0.015) 3px, rgba(255, 255, 255, 0.015) 6px)',
    'scrollbar.thumb-hover':
      'linear-gradient(180deg, rgba(100, 100, 255, 0.2) 0%, rgba(100, 100, 255, 0.1) 100%), repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.055) 0, rgba(255, 255, 255, 0.055) 3px, rgba(255, 255, 255, 0.02) 3px, rgba(255, 255, 255, 0.02) 6px)',
    'scrollbar.thumb-active':
      'linear-gradient(180deg, rgba(100, 100, 255, 0.26) 0%, rgba(100, 100, 255, 0.12) 100%), repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.07) 0, rgba(255, 255, 255, 0.07) 3px, rgba(255, 255, 255, 0.02) 3px, rgba(255, 255, 255, 0.02) 6px)',
  },
};

export const MUSIC_LIBRARY_SURFACE_STARTER: ComponentTheme = {
  metadata: {
    description: 'Starter semantic surface mapping for the music library page.',
  },
  tokens: {
    'music-library-surface-bg': '{color.surface.canvas}',
    'music-library-surface-border': '{color.border.default}',
    'music-library-section-border': '{color.border.muted}',
    'music-library-surface-subtle': '{color.surface.subtle}',
    'music-library-surface-subtle-strong': '{color.surface.subtle-strong}',
    'music-library-surface-overlay': '{color.surface.overlay}',
    'music-library-surface-overlay-strong': '{color.surface.overlay-strong}',
    'music-library-panel-bg': '{color.surface.panel}',
    'music-library-text-primary': '{color.text.primary}',
    'music-library-text-secondary': '{color.text.secondary}',
    'music-library-text-tertiary': '{color.text.tertiary}',
    'music-library-text-muted': '{color.text.muted}',
    'music-library-text-inverse': '{color.text.inverse}',
    'music-library-accent': '{color.accent.primary}',
    'music-library-accent-soft': '{color.accent.soft}',
    'music-library-accent-soft-strong': '{color.accent.soft-strong}',
    'music-library-accent-border': '{color.accent.border}',
    'music-library-accent-border-strong': '{color.accent.border-strong}',
    'music-library-accent-line': 'rgba(255, 255, 255, 0.46)',
    'music-library-accent-glow': '{color.accent.glow}',
    'music-library-accent-gradient': '{color.accent.gradient}',
    'music-library-accent-gradient-strong': '{color.accent.gradient-strong}',
    'music-library-info-soft': '{color.info.soft}',
    'music-library-info-text': '{color.info.text}',
    'music-library-warning-text': '{color.warning.text}',
    'music-library-warning-soft': '{color.warning.soft}',
    'music-library-warning-border': '{color.warning.border}',
    'music-library-success-text': '{color.success.text}',
    'music-library-success-soft': '{color.success.soft}',
    'music-library-success-line': '{color.success.line}',
    'music-library-success-glow': '{color.success.glow}',
    'music-library-danger-text': '{color.danger.text}',
    'music-library-danger-soft': '{color.danger.soft}',
    'music-library-danger-line': '{color.danger.line}',
    'music-library-danger-glow': '{color.danger.glow}',
    'music-library-search-bg': '{color.surface.overlay}',
    'music-library-search-border': '{color.border.soft}',
    'music-library-search-icon': '{color.text.muted}',
    'music-library-search-icon-glow': '{color.accent.glow}',
    'music-library-row-border': 'rgba(255, 255, 255, 0.04)',
    'music-library-row-shadow': 'none',
    'music-library-action-bg':
      'linear-gradient(180deg, rgba(34, 40, 56, 0.72), rgba(20, 24, 36, 0.66))',
    'music-library-action-bg-hover':
      'linear-gradient(180deg, rgba(56, 66, 92, 0.82), rgba(28, 34, 50, 0.76))',
    'music-library-action-border': 'rgba(255, 255, 255, 0.22)',
    'music-library-action-border-hover': 'rgba(255, 255, 255, 0.34)',
    'music-library-action-text': 'rgba(245, 248, 255, 0.9)',
    'music-library-state-accent': 'rgba(255, 255, 255, 0.62)',
    'music-library-state-glow': 'rgba(255, 255, 255, 0.04)',
    'music-library-popover-bg':
      'linear-gradient(180deg, rgba(18, 22, 34, 0.98), rgba(12, 16, 28, 0.98))',
    'music-library-popover-title': 'rgba(240, 246, 255, 0.94)',
    'music-library-popover-note': 'rgba(192, 206, 228, 0.72)',
    'music-library-popover-help': 'rgba(180, 196, 223, 0.72)',
    'music-library-priority-bg': '{color.accent.soft}',
    'music-library-priority-text': 'rgba(218, 228, 255, 0.9)',
    'music-library-scrollbar-track': '{color.scrollbar.track}',
    'music-library-scrollbar-button': '{color.scrollbar.button}',
    'music-library-scrollbar-button-hover': '{color.scrollbar.button-hover}',
    'music-library-scrollbar-button-active': '{color.scrollbar.button-active}',
    'music-library-scrollbar-thumb': '{color.scrollbar.thumb}',
    'music-library-scrollbar-thumb-hover': '{color.scrollbar.thumb-hover}',
    'music-library-scrollbar-thumb-active': '{color.scrollbar.thumb-active}',
  },
  parts: {
    search: {
      states: {
        focus: {
          tokens: {
            'music-library-search-bg': '{color.surface.overlay-strong}',
            'music-library-search-border': '{color.accent.border-strong}',
            'music-library-search-icon': 'rgba(198, 214, 255, 0.8)',
          },
        },
      },
    },
    'column-label': {
      states: {
        hover: {
          tokens: {
            'music-library-accent-line': 'rgba(255, 255, 255, 0.62)',
          },
        },
        focus: {
          tokens: {
            'music-library-accent-line': '{color.accent.border-strong}',
          },
        },
        dragging: {
          tokens: {
            'music-library-accent-line': '{color.danger.line}',
            'music-library-text-primary': '{color.danger.text}',
          },
        },
        'drop-target': {
          tokens: {
            'music-library-accent-line': '{color.success.line}',
            'music-library-text-primary': '{color.success.text}',
          },
        },
      },
    },
    'column-drag-handle': {
      states: {
        hover: {
          tokens: {
            'music-library-state-accent': 'rgba(255, 255, 255, 0.82)',
            'music-library-state-glow': 'rgba(255, 255, 255, 0.12)',
          },
        },
        dragging: {
          tokens: {
            'music-library-state-accent': '{color.danger.text}',
            'music-library-state-glow': '{color.danger.glow}',
          },
        },
        'drop-target': {
          tokens: {
            'music-library-state-accent': '{color.success.text}',
            'music-library-state-glow': '{color.success.glow}',
          },
        },
      },
    },
    row: {
      states: {
        hover: {
          tokens: {
            'music-library-row-border': 'rgba(138, 170, 255, 0.18)',
            'music-library-row-shadow': 'inset 2px 0 0 rgba(138, 170, 255, 0.3)',
          },
        },
        selected: {
          tokens: {
            'music-library-row-border': 'rgba(138, 170, 255, 0.28)',
            'music-library-row-shadow':
              'inset 2px 0 0 rgba(138, 170, 255, 0.78), inset 0 -1px 0 rgba(138, 170, 255, 0.28)',
          },
        },
      },
    },
    'action-button': {
      states: {
        hover: {
          tokens: {
            'music-library-action-bg':
              'linear-gradient(180deg, rgba(56, 66, 92, 0.82), rgba(28, 34, 50, 0.76))',
            'music-library-action-border': 'rgba(255, 255, 255, 0.34)',
            'music-library-action-text': '{color.text.inverse}',
          },
        },
      },
    },
  },
};

export function isMusicLibrarySurfaceBinding(bindingId: ThemeBindingId): boolean {
  return bindingId === 'page.music-library';
}

export function applyMusicLibraryStarterTheme(theme: Theme, surfaceId: ThemeSurfaceId): Theme {
  const nextColorTokens = {
    ...(MUSIC_LIBRARY_THEME_TOKEN_PRESET.color ?? {}),
    ...(theme.tokens?.color ?? {}),
  };

  return {
    ...theme,
    tokens: {
      ...(theme.tokens ?? {}),
      color: nextColorTokens,
    },
    surfaces: {
      ...(theme.surfaces ?? {}),
      [surfaceId]: mergeComponentThemes(MUSIC_LIBRARY_SURFACE_STARTER, theme.surfaces?.[surfaceId] ?? {}),
    },
  };
}
