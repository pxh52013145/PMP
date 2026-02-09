import React from 'react';
import { useWindowPinDataWithSetter } from './useWindowPinData';
import { useWindowPinLogic } from './useWindowPinLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { StandardWindowPin } from './StandardWindowPin';

export const WindowPinButton: React.FC = () => {
  const [data, setIsPinned] = useWindowPinDataWithSetter();
  const logic = useWindowPinLogic(data.isPinned, setIsPinned);
  const themeConfig = useComponentTheme('btn-window-pin');

  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  return <StandardWindowPin data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
