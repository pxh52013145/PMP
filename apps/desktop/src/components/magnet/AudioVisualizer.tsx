/**
 * 音频可视化组件
 * 显示像素风格的频谱
 */

import React, { useEffect, useRef } from 'react';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import './AudioVisualizer.css';

interface AudioVisualizerProps {
  getFrequencyData: () => Uint8Array | null;
  isPlaying: boolean;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  getFrequencyData,
  isPlaying,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const { isActive: isWindowActive } = useWindowActivity();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      if (!isWindowActive) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      const frequencyData = getFrequencyData();

      if (!frequencyData || !isPlaying) {
        // 清空画布
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (isPlaying && isWindowActive) {
          animationRef.current = requestAnimationFrame(draw);
        }
        return;
      }

      const width = canvas.width;
      const height = canvas.height;

      // 清空背景
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(0, 0, width, height);

      // 计算条形数量和宽度
      const barCount = 32; // 像素风格：较少的条形
      const dataPointsPerBar = Math.floor(frequencyData.length / barCount);
      const barWidth = Math.floor(width / barCount);
      const gap = 2; // 条形之间的间隙

      for (let i = 0; i < barCount; i++) {
        // 计算该条形的平均频率
        let sum = 0;
        for (let j = 0; j < dataPointsPerBar; j++) {
          sum += frequencyData[i * dataPointsPerBar + j];
        }
        const average = sum / dataPointsPerBar;

        // 计算条形高度（0-255 映射到 0-height）
        const barHeight = (average / 255) * height;

        // 计算颜色（根据频率高低）
        const hue = (average / 255) * 120; // 0(红) 到 120(绿)
        const saturation = 70 + (average / 255) * 30; // 70-100%
        const lightness = 40 + (average / 255) * 20; // 40-60%

        ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;

        // 从底部向上绘制
        const x = i * barWidth;
        const y = height - barHeight;

        ctx.fillRect(x, y, barWidth - gap, barHeight);
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    if (isPlaying && isWindowActive) {
      draw();
    } else {
      // 停止时显示静态状态
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [getFrequencyData, isPlaying, isWindowActive]);

  return (
    <div className="audio-visualizer">
      <canvas ref={canvasRef} width={640} height={120} className="visualizer-canvas" />
    </div>
  );
};
