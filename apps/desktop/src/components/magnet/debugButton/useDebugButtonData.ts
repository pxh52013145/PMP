/**
 * DebugButton 数据层 Hook
 * 历史为调试按钮（id: btn-debug），现用于 Settings 页面切换状态
 */

import { useEffect, useState } from 'react';
import { useNavigation } from '../../../contexts/NavigationContext';

export interface DebugButtonData {
  isOpen: boolean;
}

/**
 * 获取DebugButton的数据
 */
export function useDebugButtonData(): DebugButtonData & {
  setIsOpen: (value: boolean) => void;
} {
  const navigation = useNavigation();
  const [isOpen, setIsOpen] = useState(() => navigation.currentPage.type === 'settings');

  useEffect(() => {
    setIsOpen(navigation.currentPage.type === 'settings');
  }, [navigation.currentPage.type]);

  return {
    isOpen,
    setIsOpen,
  };
}
