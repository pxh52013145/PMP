/**
 * BackButton 数据层 Hook
 * 负责获取导航历史数据
 */

import { useNavigation } from '../../../contexts/NavigationContext';

export interface BackButtonData {
  canGoBack: boolean;
  historyLength: number;
}

/**
 * 获取BackButton的数据
 */
export function useBackButtonData(): BackButtonData {
  const { history } = useNavigation();
  
  return {
    canGoBack: history.length > 1,
    historyLength: history.length,
  };
}
