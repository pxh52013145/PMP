import React, { useEffect, useRef, useState } from 'react';
import './WindowBorder.css';
import { STORAGE_KEYS, TAURI_EVENTS, setupTauriListener } from '../../utils/windowCommunication';
import { readJson, readString } from '../../modules/storage';

export default function WindowBorder() {
  const topGlowRef = useRef<HTMLDivElement>(null);
  const rightGlowRef = useRef<HTMLDivElement>(null);
  const bottomGlowRef = useRef<HTMLDivElement>(null);
  const leftGlowRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 效果状态
  const [backgroundEffect, setBackgroundEffect] = useState(() => {
    return readString(STORAGE_KEYS.BACKGROUND_EFFECT) || 'none';
  });
  const [borderEffect, setBorderEffect] = useState(() => {
    return readString(STORAGE_KEYS.BORDER_EFFECT) || 'none';
  });

  // 颜色主题状态
  const [backgroundThemeColor, setBackgroundThemeColor] = useState(() => {
    return readJson(STORAGE_KEYS.BACKGROUND_THEME_COLOR, { id: 'cyan', rgb: [0, 255, 136] });
  });
  const [borderThemeColor, setBorderThemeColor] = useState(() => {
    return readJson(STORAGE_KEYS.BORDER_THEME_COLOR, { id: 'cyan', rgb: [0, 255, 136] });
  });

  useEffect(() => {
    const threshold = 40; // 鼠标靠近边缘多少像素时触发

    // 清除所有边框光效
    const clearAllGlows = () => {
      if (topGlowRef.current) {
        topGlowRef.current.style.opacity = '0';
        topGlowRef.current.style.display = 'none';
      }
      if (rightGlowRef.current) {
        rightGlowRef.current.style.opacity = '0';
        rightGlowRef.current.style.display = 'none';
      }
      if (bottomGlowRef.current) {
        bottomGlowRef.current.style.opacity = '0';
        bottomGlowRef.current.style.display = 'none';
      }
      if (leftGlowRef.current) {
        leftGlowRef.current.style.opacity = '0';
        leftGlowRef.current.style.display = 'none';
      }
    };

    let moveRaf: number | null = null;
    let pendingMove: { clientX: number; clientY: number } | null = null;

    const flushMove = () => {
      moveRaf = null;
      if (!pendingMove) return;
      const { clientX, clientY } = pendingMove;
      pendingMove = null;

      // 如果边框效果是 none，不显示鼠标悬停的边框光效
      if (borderEffect === 'none') {
        clearAllGlows();
        return;
      }

      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      // 检查鼠标是否在窗口边界内
      const isOutside =
        clientX < 0 || clientX > windowWidth || clientY < 0 || clientY > windowHeight;

      // 如果鼠标在窗口外，清除所有光效并返回
      if (isOutside) {
        clearAllGlows();
        return;
      }

      // 计算鼠标到各边的距离
      const distToTop = clientY;
      const distToRight = windowWidth - clientX;
      const distToBottom = windowHeight - clientY;
      const distToLeft = clientX;

      // 顶部边框
      if (distToTop <= threshold && topGlowRef.current) {
        const intensity = 1 - distToTop / threshold;
        topGlowRef.current.style.display = 'block';
        topGlowRef.current.style.left = `${(clientX / windowWidth) * 100}%`;
        topGlowRef.current.style.opacity = `${intensity}`;
      } else if (topGlowRef.current) {
        topGlowRef.current.style.opacity = '0';
        topGlowRef.current.style.display = 'none';
      }

      // 右侧边框
      if (distToRight <= threshold && rightGlowRef.current) {
        const intensity = 1 - distToRight / threshold;
        rightGlowRef.current.style.display = 'block';
        rightGlowRef.current.style.top = `${(clientY / windowHeight) * 100}%`;
        rightGlowRef.current.style.opacity = `${intensity}`;
      } else if (rightGlowRef.current) {
        rightGlowRef.current.style.opacity = '0';
        rightGlowRef.current.style.display = 'none';
      }

      // 底部边框
      if (distToBottom <= threshold && bottomGlowRef.current) {
        const intensity = 1 - distToBottom / threshold;
        bottomGlowRef.current.style.display = 'block';
        bottomGlowRef.current.style.left = `${(clientX / windowWidth) * 100}%`;
        bottomGlowRef.current.style.opacity = `${intensity}`;
      } else if (bottomGlowRef.current) {
        bottomGlowRef.current.style.opacity = '0';
        bottomGlowRef.current.style.display = 'none';
      }

      // 左侧边框
      if (distToLeft <= threshold && leftGlowRef.current) {
        const intensity = 1 - distToLeft / threshold;
        leftGlowRef.current.style.display = 'block';
        leftGlowRef.current.style.top = `${(clientY / windowHeight) * 100}%`;
        leftGlowRef.current.style.opacity = `${intensity}`;
      } else if (leftGlowRef.current) {
        leftGlowRef.current.style.opacity = '0';
        leftGlowRef.current.style.display = 'none';
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      pendingMove = { clientX: e.clientX, clientY: e.clientY };
      if (moveRaf !== null) return;
      moveRaf = window.requestAnimationFrame(flushMove);
    };

    // 鼠标离开窗口时清除所有光效
    const handleMouseLeave = () => {
      pendingMove = null;
      if (moveRaf !== null) {
        window.cancelAnimationFrame(moveRaf);
        moveRaf = null;
      }
      clearAllGlows();
    };

    // 窗口失焦时也清除光效（后备方案）
    const handleBlur = () => {
      pendingMove = null;
      if (moveRaf !== null) {
        window.cancelAnimationFrame(moveRaf);
        moveRaf = null;
      }
      clearAllGlows();
    };

    // 同时监听多个事件，确保在 Tauri 环境中正常工作
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('blur', handleBlur);

    // 初始化时清除所有光效
    clearAllGlows();

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('blur', handleBlur);
      if (moveRaf !== null) window.cancelAnimationFrame(moveRaf);
    };
  }, [borderEffect]);

  // 初始化时检查边框效果状态
  useEffect(() => {
    if (borderEffect === 'none') {
      // 清除所有边框光效
      if (topGlowRef.current) topGlowRef.current.style.display = 'none';
      if (rightGlowRef.current) rightGlowRef.current.style.display = 'none';
      if (bottomGlowRef.current) bottomGlowRef.current.style.display = 'none';
      if (leftGlowRef.current) leftGlowRef.current.style.display = 'none';
    }
  }, [borderEffect]);

  // 初始化和更新颜色主题
  useEffect(() => {
    // 应用背景颜色主题
    document.documentElement.style.setProperty(
      '--bg-theme-color-r',
      backgroundThemeColor.rgb[0].toString()
    );
    document.documentElement.style.setProperty(
      '--bg-theme-color-g',
      backgroundThemeColor.rgb[1].toString()
    );
    document.documentElement.style.setProperty(
      '--bg-theme-color-b',
      backgroundThemeColor.rgb[2].toString()
    );
  }, [backgroundThemeColor]);

  useEffect(() => {
    // 应用边框颜色主题
    document.documentElement.style.setProperty(
      '--border-theme-color-r',
      borderThemeColor.rgb[0].toString()
    );
    document.documentElement.style.setProperty(
      '--border-theme-color-g',
      borderThemeColor.rgb[1].toString()
    );
    document.documentElement.style.setProperty(
      '--border-theme-color-b',
      borderThemeColor.rgb[2].toString()
    );
  }, [borderThemeColor]);

  // 监听效果变化
  useEffect(() => {
    const setupListeners = async () => {
      // 监听背景效果变化
      const unlistenBg = await setupTauriListener(TAURI_EVENTS.BACKGROUND_EFFECT_UPDATED, () => {
        const effect = readString(STORAGE_KEYS.BACKGROUND_EFFECT) || 'none';
        setBackgroundEffect(effect);
      });

      // 监听边框效果变化
      const unlistenBorder = await setupTauriListener(TAURI_EVENTS.BORDER_EFFECT_UPDATED, () => {
        const effect = readString(STORAGE_KEYS.BORDER_EFFECT) || 'none';
        setBorderEffect(effect);

        // 如果切换到无效果，立即清除所有边框光效
        if (effect === 'none') {
          if (topGlowRef.current) {
            topGlowRef.current.style.opacity = '0';
            topGlowRef.current.style.display = 'none';
          }
          if (rightGlowRef.current) {
            rightGlowRef.current.style.opacity = '0';
            rightGlowRef.current.style.display = 'none';
          }
          if (bottomGlowRef.current) {
            bottomGlowRef.current.style.opacity = '0';
            bottomGlowRef.current.style.display = 'none';
          }
          if (leftGlowRef.current) {
            leftGlowRef.current.style.opacity = '0';
            leftGlowRef.current.style.display = 'none';
          }
        }
      });

      // 监听背景颜色主题变化
      const unlistenBgColor = await setupTauriListener(
        TAURI_EVENTS.BACKGROUND_THEME_COLOR_UPDATED,
        () => {
          setBackgroundThemeColor(readJson(STORAGE_KEYS.BACKGROUND_THEME_COLOR, { id: 'cyan', rgb: [0, 255, 136] }));
        }
      );

      // 监听边框颜色主题变化
      const unlistenBorderColor = await setupTauriListener(
        TAURI_EVENTS.BORDER_THEME_COLOR_UPDATED,
        () => {
          setBorderThemeColor(readJson(STORAGE_KEYS.BORDER_THEME_COLOR, { id: 'cyan', rgb: [0, 255, 136] }));
        }
      );

      return () => {
        unlistenBg();
        unlistenBorder();
        unlistenBgColor();
        unlistenBorderColor();
      };
    };

    const cleanup = setupListeners();
    return () => {
      cleanup.then((fn) => fn());
    };
  }, []);

  // 构建容器class - 使用useMemo确保依赖变化时重新计算
  const containerClass = React.useMemo(() => {
    const classes = ['window-border-container'];

    // 添加背景效果class
    if (backgroundEffect !== 'none') {
      classes.push(`bg-${backgroundEffect}`);
      // 如果背景主题是彩虹，添加彩虹动画
      if (backgroundThemeColor.id === 'rainbow') {
        classes.push('bg-rainbow-theme');
      }
    }

    // 添加边框效果class
    if (borderEffect !== 'none') {
      classes.push(`border-${borderEffect}`);
      // 如果边框主题是彩虹，添加彩虹动画
      if (borderThemeColor.id === 'rainbow') {
        classes.push('border-rainbow-theme');
      }
    }

    return classes.join(' ');
  }, [backgroundEffect, backgroundThemeColor, borderEffect, borderThemeColor]);

  return (
    <div ref={containerRef} className={containerClass}>
      {/* 顶部边框发光 */}
      <div ref={topGlowRef} className="window-border-glow window-border-glow-top" />

      {/* 右侧边框发光 */}
      <div ref={rightGlowRef} className="window-border-glow window-border-glow-right" />

      {/* 底部边框发光 */}
      <div ref={bottomGlowRef} className="window-border-glow window-border-glow-bottom" />

      {/* 左侧边框发光 */}
      <div ref={leftGlowRef} className="window-border-glow window-border-glow-left" />
    </div>
  );
}
