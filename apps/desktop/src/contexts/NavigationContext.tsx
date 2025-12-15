import { createContext, useContext, useState, ReactNode } from 'react';

/**
 * 导航页面类型
 */
export type NavigationPageType =
  | 'home'
  | 'music-library'
  | 'playlists'
  | 'play-queue'
  | 'track'
  | 'album'
  | 'artist'
  | 'native-debug';

/**
 * 导航页面数据（可携带额外参数）
 */
export interface NavigationPageData {
  type: NavigationPageType;
  params?: Record<string, any>;
}

interface NavigationContextType {
  currentPage: NavigationPageData;
  navigateTo: (page: NavigationPageType, params?: Record<string, any>) => void;
  goBack: () => void;
  history: NavigationPageData[];
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

interface NavigationProviderProps {
  children: ReactNode;
}

/**
 * 导航状态提供者
 */
export function NavigationProvider({ children }: NavigationProviderProps) {
  const [history, setHistory] = useState<NavigationPageData[]>([{ type: 'home' }]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const currentPage = history[currentIndex];

  const navigateTo = (type: NavigationPageType, params?: Record<string, any>) => {
    const newPage: NavigationPageData = { type, params };

    // 智能去重：如果当前页面和目标页面完全相同（包括参数），则忽略
    // 这样可以防止重复点击同一个按钮产生重复历史
    if (currentPage.type === type) {
      // 对于没有参数的页面（如 music-library, home），直接忽略
      if (!params && !currentPage.params) {
        console.log(`Already on ${type} page, ignoring navigation`);
        return;
      }

      // 对于有参数的页面（如 track），比较参数是否相同
      // 如果参数不同，则替换当前页面（避免历史堆积）
      // 如果参数相同，则忽略（避免重复）
      const paramsEqual = JSON.stringify(params || {}) === JSON.stringify(currentPage.params || {});
      if (paramsEqual) {
        console.log(`Already on ${type} page with same params, ignoring navigation`);
        return;
      }

      // 参数不同时，替换当前页面而不是添加新历史
      const newHistory = [...history];
      newHistory[currentIndex] = newPage;
      setHistory(newHistory);
      console.log(`Replaced ${type} page with new params`);
      return;
    }

    // 添加到历史记录
    const newHistory = history.slice(0, currentIndex + 1);
    newHistory.push(newPage);

    setHistory(newHistory);
    setCurrentIndex(newHistory.length - 1);
    console.log(`Navigated to ${type} page`);
  };

  const goBack = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  return (
    <NavigationContext.Provider
      value={{
        currentPage,
        navigateTo,
        goBack,
        history,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

/**
 * 使用导航上下文
 */
export function useNavigation() {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return context;
}
