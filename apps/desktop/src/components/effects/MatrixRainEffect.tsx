import { useEffect, useRef } from 'react';
import { useWindowActivity } from '../../contexts/WindowActivityContext';

interface MatrixRainEffectProps {
  color: [number, number, number];
  isRainbow?: boolean; // 是否是彩虹主题
}

export default function MatrixRainEffect({ color, isRainbow = false }: MatrixRainEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { isActive } = useWindowActivity();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true }); // 启用透明背景
    if (!ctx) return;

    // 设置canvas尺寸
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // 字符集 - 半角片假名（完全按照黑客帝国）
    const chars = 'ｦｱｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
    const fontSize = 14; // 稍微缩小字体
    const columns = Math.floor(canvas.width / fontSize);

    // 每列的信息
    interface Drop {
      y: number;
      speed: number;
      length: number; // 尾巴长度
      brightLength: number; // 亮色区长度（随机4-12）
      transitionLength: number; // 过渡区长度（随机2-7）
    }

    const drops: Drop[] = [];
    for (let i = 0; i < columns; i++) {
      drops[i] = {
        y: -Math.random() * 100,
        speed: 0.25 + Math.random() * 0.35, // 适中速度，兼顾观感和动感
        length: 12 + Math.floor(Math.random() * 15), // 稍长的尾巴
        brightLength: 4 + Math.floor(Math.random() * 9), // 亮色区4-12个字符
        transitionLength: 2 + Math.floor(Math.random() * 6), // 过渡区2-7个字符
      };
    }

    // 不初始化黑色背景，保持透明

    let lastTime = 0;
    const fps = 30; // 限制为30fps
    const fpsInterval = 1000 / fps;

    // 彩虹主题：色相旋转
    let rainbowHue = 0;

    // 将RGB颜色应用色相旋转
    const applyHueRotation = (
      rgb: [number, number, number],
      hue: number
    ): [number, number, number] => {
      // 转换为HSL
      const r = rgb[0] / 255;
      const g = rgb[1] / 255;
      const b = rgb[2] / 255;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;

      if (max === min) {
        return rgb; // 灰度颜色
      }

      const d = max - min;
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      let h = 0;
      if (max === r) {
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      } else if (max === g) {
        h = ((b - r) / d + 2) / 6;
      } else {
        h = ((r - g) / d + 4) / 6;
      }

      // 应用色相旋转
      h = (h + hue / 360) % 1;

      // HSL转回RGB
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };

      let newR, newG, newB;
      if (s === 0) {
        newR = newG = newB = l;
      } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        newR = hue2rgb(p, q, h + 1 / 3);
        newG = hue2rgb(p, q, h);
        newB = hue2rgb(p, q, h - 1 / 3);
      }

      return [Math.round(newR * 255), Math.round(newG * 255), Math.round(newB * 255)];
    };

    const draw = (currentTime: number) => {
      const deltaTime = currentTime - lastTime;

      // 帧率控制
      if (deltaTime < fpsInterval) {
        return false; // 跳过这一帧
      }

      lastTime = currentTime - (deltaTime % fpsInterval);

      // 使用透明清除产生拖尾效果
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.06)'; // 降低拖尾透明度，产生更长的尾巴
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.font = `bold ${fontSize}px Consolas, monospace`;

      return true; // 执行了绘制
    };

    const drawChars = () => {
      // 获取当前颜色（彩虹主题会动态改变）
      const currentColor = isRainbow ? applyHueRotation(color, rainbowHue) : color;

      for (let i = 0; i < drops.length; i++) {
        const drop = drops[i];

        // 绘制整列字符（产生尾巴效果）
        for (let j = 0; j < drop.length; j++) {
          const char = chars[Math.floor(Math.random() * chars.length)];
          const x = i * fontSize;
          const y = (drop.y - j) * fontSize;

          if (y > -fontSize && y < canvas.height + fontSize) {
            // 计算渐变效果
            const progress = j / drop.length;

            if (j === 0) {
              // 头部字符 - 白色最亮带光晕
              ctx.shadowBlur = 15;
              ctx.shadowColor = `rgba(${currentColor.join(',')}, 0.8)`;
              ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            } else if (j === 1) {
              // 第二个字符 - 主题色最亮
              ctx.shadowBlur = 10;
              ctx.shadowColor = `rgba(${currentColor.join(',')}, 0.7)`;
              ctx.fillStyle = `rgba(${currentColor.join(',')}, 0.85)`;
            } else if (j < drop.brightLength) {
              // 亮色区 - 主题色渐变（根据每个drop的brightLength动态调整）
              const fade = (j - 1) / (drop.brightLength - 1);
              const alpha = 0.85 - fade * 0.35; // 从0.85渐变到0.5
              ctx.shadowBlur = 10 - fade * 8; // 从10px渐变到2px
              ctx.shadowColor = `rgba(${currentColor.join(',')}, ${alpha * 0.6})`;
              ctx.fillStyle = `rgba(${currentColor.join(',')}, ${alpha})`;
            } else if (j < drop.brightLength + drop.transitionLength) {
              // 过渡区 - 从亮色区平滑过渡到拖尾区（动态长度2-7个字符）
              const transitionProgress = (j - drop.brightLength) / drop.transitionLength;
              // 透明度从0.5渐变到拖尾区起始值
              const startAlpha = 0.5;
              const tailStartProgress = (drop.brightLength + drop.transitionLength) / drop.length;
              const tailStartAlpha = Math.max(0.1, 0.7 - tailStartProgress * 0.8);
              const alpha = startAlpha - (startAlpha - tailStartAlpha) * transitionProgress;

              // 光晕从2px渐变到1px
              ctx.shadowBlur = 2 - transitionProgress;
              ctx.shadowColor = `rgba(${currentColor.join(',')}, ${alpha * 0.3})`;

              // 颜色逐渐变暗，过渡到拖尾区的暗色
              const brightnessFactor = 1 - transitionProgress * 0.5;
              const transitionColor = currentColor.map((c) =>
                Math.floor(c * brightnessFactor * alpha * 0.7)
              );
              ctx.fillStyle = `rgba(${transitionColor.join(',')}, ${alpha})`;
            } else {
              // 尾部拖尾区 - 恢复原本效果
              const alpha = Math.max(0.1, 0.7 - progress * 0.8);
              ctx.shadowBlur = 1;
              ctx.shadowColor = `rgba(${currentColor.join(',')}, ${alpha * 0.2})`;
              // 尾部颜色更暗
              const darkenedColor = currentColor.map((c) => Math.floor(c * alpha * 0.5));
              ctx.fillStyle = `rgba(${darkenedColor.join(',')}, ${alpha})`;
            }

            ctx.fillText(char, x, y);
          }
        }

        // 清除阴影效果（避免影响下一次绘制）
        ctx.shadowBlur = 0;

        // 移动位置
        drop.y += drop.speed;

        // 重置条件
        if (drop.y > canvas.height / fontSize + drop.length) {
          drop.y = -drop.length - Math.random() * 30;
          drop.speed = 0.25 + Math.random() * 0.35;
          drop.length = 12 + Math.floor(Math.random() * 15);
          drop.brightLength = 4 + Math.floor(Math.random() * 9); // 重置亮色区长度
          drop.transitionLength = 2 + Math.floor(Math.random() * 6); // 重置过渡区长度
        }
      }
    };

    let animationId: number | null = null;
    const animate = (currentTime: number) => {
      if (!isActive) return;
      const shouldDraw = draw(currentTime);
      if (shouldDraw) {
        // 彩虹主题：更新色相
        if (isRainbow) {
          rainbowHue = (rainbowHue + 2) % 360; // 每帧旋转2度
        }
        drawChars(); // 绘制字符
      }
      animationId = requestAnimationFrame(animate);
    };
    if (isActive) {
      animationId = requestAnimationFrame(animate);
    }

    // 窗口大小变化时重新计算
    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const newColumns = Math.floor(canvas.width / fontSize);

      // 调整列数
      if (newColumns > drops.length) {
        for (let i = drops.length; i < newColumns; i++) {
          drops[i] = {
            y: -Math.random() * 100,
            speed: 0.25 + Math.random() * 0.35,
            length: 12 + Math.floor(Math.random() * 15),
            brightLength: 4 + Math.floor(Math.random() * 9),
            transitionLength: 2 + Math.floor(Math.random() * 6),
          };
        }
      } else {
        drops.length = newColumns;
      }

      // 清除canvas，保持透明
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      lastTime = 0; // 重置时间
    };

    window.addEventListener('resize', handleResize);

    return () => {
      if (animationId !== null) cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
    };
  }, [color, isRainbow, isActive]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1, // 在背景层之上，在pixel和magnet之下
        opacity: 0.6, // 适中透明度，平衡视觉效果
      }}
    />
  );
}
