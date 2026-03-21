import { DesktopLyricsButtonData } from './useDesktopLyricsButtonData';
import { DesktopLyricsButtonLogic } from './useDesktopLyricsButtonLogic';

export interface DesktopLyricsButtonVariantProps {
  data: DesktopLyricsButtonData;
  logic: DesktopLyricsButtonLogic;
  skinProps?: Record<string, unknown>;
}
