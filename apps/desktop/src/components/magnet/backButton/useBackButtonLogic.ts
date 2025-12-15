/**
 * BackButton 逻辑层 Hook
 * 负责返回导航逻辑
 */

import { useNavigation } from '../../../contexts/NavigationContext';

export interface BackButtonLogic {
  goBack: () => void;
  getButtonTitle: (canGoBack: boolean) => string;
}

/**
 * BackButton的逻辑层
 */
export function useBackButtonLogic(): BackButtonLogic {
  const { goBack } = useNavigation();

  const handleGoBack = () => {
    console.log('Navigating back');
    goBack();
  };

  const getButtonTitle = (canGoBack: boolean): string => {
    return canGoBack ? '返回' : '已在首页';
  };

  return {
    goBack: handleGoBack,
    getButtonTitle,
  };
}
