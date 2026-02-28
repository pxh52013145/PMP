import {
  LOCAL_TRACK_COLUMN_DEFINITIONS,
  normalizeLocalTrackColumnWidth,
  type LocalTrackColumnConfig,
  type LocalTrackColumnId,
} from './localTrackColumns';

const LOCAL_TRACK_INDEX_COLUMN_WIDTH_PX = 40;
const LOCAL_TRACK_ACTIONS_COLUMN_WIDTH_PX = 72;
const LOCAL_TRACK_GRID_GAP_PX = 10;
const LOCAL_TRACK_TITLE_MAX_VIEWPORT_RATIO = 0.5;

function resolveLocalTrackResponsiveWidth(localTrackLayoutWidth: number, mainViewportClientWidth: number): number {
  if (localTrackLayoutWidth > 0) return localTrackLayoutWidth;
  if (mainViewportClientWidth > 0) return mainViewportClientWidth;
  return 960;
}

function resolveLocalTrackColumnWidths(
  renderedLocalTrackColumns: LocalTrackColumnConfig[],
  localTrackResponsiveWidth: number
): Map<LocalTrackColumnId, number> {
  const widthById = new Map<LocalTrackColumnId, number>();

  for (const column of renderedLocalTrackColumns) {
    widthById.set(column.id, normalizeLocalTrackColumnWidth(column.id, column.widthPx));
  }

  if (renderedLocalTrackColumns.length === 0) {
    return widthById;
  }

  const totalColumnCount = renderedLocalTrackColumns.length + 2;
  const gapTotal = Math.max(0, totalColumnCount - 1) * LOCAL_TRACK_GRID_GAP_PX;
  const reservedWidth = LOCAL_TRACK_INDEX_COLUMN_WIDTH_PX + LOCAL_TRACK_ACTIONS_COLUMN_WIDTH_PX + gapTotal;
  const contentWidthBudget = Math.max(0, localTrackResponsiveWidth - reservedWidth);
  const totalMinWidth = renderedLocalTrackColumns.reduce((sum, column) => {
    return sum + LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].minWidthPx;
  }, 0);

  const titleColumn = renderedLocalTrackColumns.find((column) => column.id === 'title');
  if (titleColumn) {
    const titleDefinition = LOCAL_TRACK_COLUMN_DEFINITIONS.title;
    const nonTitleMinimumWidth = totalMinWidth - titleDefinition.minWidthPx;
    const titleSoftMax = Math.floor(contentWidthBudget * LOCAL_TRACK_TITLE_MAX_VIEWPORT_RATIO);
    const titleHardMax = contentWidthBudget - nonTitleMinimumWidth;
    const definitionMax = titleDefinition.maxWidthPx ?? Number.POSITIVE_INFINITY;
    const cappedTitleMax = Math.max(
      titleDefinition.minWidthPx,
      Math.min(definitionMax, Math.min(titleSoftMax, titleHardMax))
    );

    const currentTitleWidth = widthById.get('title') ?? titleDefinition.defaultWidthPx;
    widthById.set('title', Math.min(currentTitleWidth, cappedTitleMax));
  }

  const totalAdjustedWidth = renderedLocalTrackColumns.reduce((sum, column) => {
    return sum + (widthById.get(column.id) ?? LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].defaultWidthPx);
  }, 0);

  if (totalAdjustedWidth <= contentWidthBudget) {
    return widthById;
  }

  if (totalMinWidth >= contentWidthBudget) {
    for (const column of renderedLocalTrackColumns) {
      widthById.set(column.id, LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].minWidthPx);
    }
    return widthById;
  }

  const shrinkableWidth = renderedLocalTrackColumns.reduce((sum, column) => {
    const minWidth = LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].minWidthPx;
    const currentWidth = widthById.get(column.id) ?? LOCAL_TRACK_COLUMN_DEFINITIONS[column.id].defaultWidthPx;
    return sum + Math.max(0, currentWidth - minWidth);
  }, 0);

  if (shrinkableWidth <= 0) {
    return widthById;
  }

  const reduceWidth = totalAdjustedWidth - contentWidthBudget;
  for (const column of renderedLocalTrackColumns) {
    const definition = LOCAL_TRACK_COLUMN_DEFINITIONS[column.id];
    const currentWidth = widthById.get(column.id) ?? definition.defaultWidthPx;
    const capacity = Math.max(0, currentWidth - definition.minWidthPx);
    if (capacity <= 0) continue;
    const ratio = capacity / shrinkableWidth;
    const nextWidth = currentWidth - reduceWidth * ratio;
    widthById.set(column.id, Math.max(definition.minWidthPx, Math.round(nextWidth)));
  }

  return widthById;
}

function buildLocalTrackGridTemplate(
  renderedLocalTrackColumns: LocalTrackColumnConfig[],
  resolvedLocalTrackColumnWidths: Map<LocalTrackColumnId, number>
): string {
  const columnWidths = renderedLocalTrackColumns
    .map((item) => {
      const definition = LOCAL_TRACK_COLUMN_DEFINITIONS[item.id];
      const widthPx =
        resolvedLocalTrackColumnWidths.get(item.id) ?? normalizeLocalTrackColumnWidth(item.id, item.widthPx);
      return `minmax(${definition.minWidthPx}px, ${widthPx}px)`;
    })
    .join(' ');

  return `${LOCAL_TRACK_INDEX_COLUMN_WIDTH_PX}px ${columnWidths} ${LOCAL_TRACK_ACTIONS_COLUMN_WIDTH_PX}px`;
}

export interface LocalTrackLayoutModel {
  renderedLocalTrackColumns: LocalTrackColumnConfig[];
  visibleLocalTrackColumnCount: number;
  localTrackCardMetaColumns: LocalTrackColumnConfig[];
  localTrackGridTemplate: string;
}

export function deriveLocalTrackLayoutModel(input: {
  localTrackColumnSettings: LocalTrackColumnConfig[];
  localTrackLayoutWidth: number;
  mainViewportClientWidth: number;
}): LocalTrackLayoutModel {
  const renderedLocalTrackColumns = input.localTrackColumnSettings.filter((item) => item.visible);
  const localTrackResponsiveWidth = resolveLocalTrackResponsiveWidth(
    input.localTrackLayoutWidth,
    input.mainViewportClientWidth
  );

  const resolvedLocalTrackColumnWidths = resolveLocalTrackColumnWidths(
    renderedLocalTrackColumns,
    localTrackResponsiveWidth
  );
  const localTrackGridTemplate = buildLocalTrackGridTemplate(
    renderedLocalTrackColumns,
    resolvedLocalTrackColumnWidths
  );

  return {
    renderedLocalTrackColumns,
    visibleLocalTrackColumnCount: renderedLocalTrackColumns.length,
    localTrackCardMetaColumns: renderedLocalTrackColumns.filter((column) => column.id !== 'title').slice(0, 4),
    localTrackGridTemplate,
  };
}
