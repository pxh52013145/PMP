export type OrnamentLayer = 'background' | 'foreground';

export type OrnamentAnchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export type OrnamentMedia = {
  type: 'image';
  url: string;
};

export type OrnamentTransform = {
  anchor: OrnamentAnchor;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  opacity: number;
  layer: OrnamentLayer;
};

export type OrnamentItem = {
  id: string;
  name: string;
  enabled: boolean;
  media: OrnamentMedia;
  transform: OrnamentTransform;
};

export type OrnamentsConfigV1 = {
  version: 1;
  items: OrnamentItem[];
};

export type OrnamentsConfig = OrnamentsConfigV1;
