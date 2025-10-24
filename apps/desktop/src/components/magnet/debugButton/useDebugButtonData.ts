/**
 * DebugButton 数据层 Hook
 * 负责管理调试窗口状态数据
 */

import { useState } from 'react';

export interface DebugButtonData {
  isOpen: boolean;
}

/**
 * 获取DebugButton的数据
 */
export function useDebugButtonData(): DebugButtonData & {
  setIsOpen: (value: boolean) => void;
} {
  const [isOpen, setIsOpen] = useState(false);

  return {
    isOpen,
    setIsOpen,
  };
}
