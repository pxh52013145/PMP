import { useMemo, type CSSProperties, type KeyboardEvent, type MouseEventHandler, type ReactNode } from 'react';

import { useSkinSurfaceModel } from '../../../themes/skinSurface';
import type { ThemeBindingId, ThemeSurfaceId } from '../../../themes/types/theme';
import { PmpButton } from '../../primitives';
import {
  composeEventHandlers,
  resolvePrimitiveInteractionMotion,
  usePrimitiveInteractionState,
} from '../../primitives/interactionMotion';

export type PlatformResourceCardTagTone = 'default' | 'accent' | 'success' | 'warning';

export interface PlatformResourceCardTag {
  id: string;
  label: string;
  tone?: PlatformResourceCardTagTone;
  icon?: ReactNode;
  compact?: boolean;
}

export interface PlatformResourceCardAction {
  id: string;
  label: string;
  variant?: 'default' | 'primary' | 'ghost';
  disabled?: boolean;
  onClick: () => void;
}

export interface PlatformResourceCardProps {
  surfaceId?: ThemeSurfaceId;
  accentColor?: string;
  coverUrl?: string;
  coverAlt: string;
  coverFallbackLabel: string;
  title: string;
  subtitle: string;
  detail?: string | null;
  durationLabel?: string | null;
  coverBadges?: PlatformResourceCardTag[];
  badges?: PlatformResourceCardTag[];
  actions?: PlatformResourceCardAction[];
  preparing?: boolean;
  titleHint?: string;
  onClick?: () => void;
  onContextMenu?: MouseEventHandler<HTMLElement>;
}

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function toToneClass(tone: PlatformResourceCardTagTone | undefined): string {
  switch (tone) {
    case 'accent':
      return 'platform-magnet-resource-card__tag--accent';
    case 'success':
      return 'platform-magnet-resource-card__tag--success';
    case 'warning':
      return 'platform-magnet-resource-card__tag--warning';
    default:
      return 'platform-magnet-resource-card__tag--default';
  }
}

export function PlatformResourceCard({
  surfaceId = 'magnet.platform-magnet.resource-card',
  accentColor = '#8aa6ff',
  coverUrl,
  coverAlt,
  coverFallbackLabel,
  title,
  subtitle,
  detail,
  durationLabel,
  coverBadges = [],
  badges = [],
  actions = [],
  preparing = false,
  titleHint,
  onClick,
  onContextMenu,
}: PlatformResourceCardProps) {
  const surface = useSkinSurfaceModel(surfaceId);
  const interaction = usePrimitiveInteractionState({ disabled: !onClick && !onContextMenu });
  const currentState = interaction.interactionState === 'idle' ? undefined : interaction.interactionState;
  const currentRootPart = useMemo(
    () => surface.getPart('root', currentState ? { state: currentState } : undefined),
    [currentState, surface]
  );
  const transitionRootPart = useMemo(
    () =>
      interaction.transitionState !== 'idle'
        ? surface.getPart('root', { state: interaction.transitionState })
        : undefined,
    [interaction.transitionState, surface]
  );
  const interactionMotion = useMemo(
    () =>
      resolvePrimitiveInteractionMotion({
        part: currentRootPart,
        interactionState: interaction.interactionState,
        transitionState: interaction.transitionState,
        fallbackPart: transitionRootPart,
      }),
    [currentRootPart, interaction.interactionState, interaction.transitionState, transitionRootPart]
  );
  const rootProps = surface.getElementProps({
    primitive: 'card',
    bindingId: surfaceId as ThemeBindingId,
    ...(currentState ? { state: currentState } : {}),
    className: cx(
      'platform-magnet-resource-card',
      preparing && 'platform-magnet-resource-card--preparing',
      onContextMenu && 'platform-magnet-resource-card--context',
      onClick && 'platform-magnet-resource-card--interactive'
    ),
    style: {
      '--platform-resource-accent': accentColor,
      ...interactionMotion.style,
    } as CSSProperties,
  });

  const handleKeyDown = onClick
    ? (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }
    : undefined;

  return (
    <article
      {...rootProps}
      data-surface-id={surfaceId}
      data-pmp-interaction-state={interaction.interactionState}
      {...(interactionMotion.channel ? { 'data-pmp-motion-channel': interactionMotion.channel } : {})}
      {...(interactionMotion.preset ? { 'data-pmp-motion-preset': interactionMotion.preset } : {})}
      title={titleHint}
      {...(onClick
        ? {
            role: 'button' as const,
            tabIndex: 0,
            onClick,
          }
        : {})}
      onContextMenu={onContextMenu}
      onMouseEnter={composeEventHandlers(undefined, interaction.eventHandlers.onMouseEnter)}
      onMouseLeave={composeEventHandlers(undefined, interaction.eventHandlers.onMouseLeave)}
      onMouseDown={composeEventHandlers(undefined, interaction.eventHandlers.onMouseDown)}
      onMouseUp={composeEventHandlers(undefined, interaction.eventHandlers.onMouseUp)}
      onFocus={composeEventHandlers(undefined, interaction.eventHandlers.onFocus)}
      onBlur={composeEventHandlers(undefined, interaction.eventHandlers.onBlur)}
      onKeyDown={composeEventHandlers(handleKeyDown, interaction.eventHandlers.onKeyDown)}
      onKeyUp={composeEventHandlers(undefined, interaction.eventHandlers.onKeyUp)}
    >
      <div className="platform-magnet-resource-card__cover">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={coverAlt}
            loading="lazy"
            className="platform-magnet-resource-card__cover-image"
          />
        ) : (
          <span className="platform-magnet-resource-card__cover-fallback">{coverFallbackLabel}</span>
        )}

        {coverBadges.length > 0 ? (
          <div className="platform-magnet-resource-card__cover-badges">
            {coverBadges.map((badge) => (
              <span
                key={badge.id}
                className={cx(
                  'platform-magnet-resource-card__tag',
                  badge.compact && 'platform-magnet-resource-card__tag--compact',
                  toToneClass(badge.tone)
                )}
                title={badge.label}
              >
                {badge.icon ? (
                  <span className="platform-magnet-resource-card__tag-icon" aria-hidden="true">
                    {badge.icon}
                  </span>
                ) : null}
                {!badge.compact ? <span>{badge.label}</span> : null}
              </span>
            ))}
          </div>
        ) : null}

        {durationLabel ? (
          <span className="platform-magnet-resource-card__duration">{durationLabel}</span>
        ) : null}
      </div>

      <div className="platform-magnet-resource-card__body">
        <div className="platform-magnet-resource-card__content">
          <p className="platform-magnet-resource-card__title">{title}</p>
          <p className="platform-magnet-resource-card__subtitle">{subtitle}</p>
          {detail ? <p className="platform-magnet-resource-card__detail">{detail}</p> : null}
        </div>

        {badges.length > 0 ? (
          <div className="platform-magnet-resource-card__badges">
            {badges.map((badge) => (
              <span
                key={badge.id}
                className={cx(
                  'platform-magnet-resource-card__tag',
                  badge.compact && 'platform-magnet-resource-card__tag--compact',
                  toToneClass(badge.tone)
                )}
                title={badge.label}
              >
                {badge.icon ? (
                  <span className="platform-magnet-resource-card__tag-icon" aria-hidden="true">
                    {badge.icon}
                  </span>
                ) : null}
                {!badge.compact ? <span>{badge.label}</span> : null}
              </span>
            ))}
          </div>
        ) : null}

        {actions.length > 0 ? (
          <div className="platform-magnet-resource-card__actions">
            {actions.map((action) => (
              <PmpButton
                key={action.id}
                type="button"
                variant={action.variant ?? 'ghost'}
                className="platform-magnet-resource-card__action"
                disabled={action.disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  action.onClick();
                }}
              >
                {action.label}
              </PmpButton>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
