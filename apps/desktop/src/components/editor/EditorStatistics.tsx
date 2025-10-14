import { useMemo, memo } from 'react';
import { useEditor } from '../../contexts/EditorContext';
import { MATRIX_CONFIG } from '../../constants/config';
import './EditorStatistics.css';

export const EditorStatistics = memo(function EditorStatistics() {
  const { occupancyMap } = useEditor();

  const statistics = useMemo(() => {
    const totalPixels = MATRIX_CONFIG.COLUMNS * MATRIX_CONFIG.ROWS;
    let occupiedPixels = 0;

    occupancyMap.forEach((info) => {
      if (info.isOccupied) {
        occupiedPixels++;
      }
    });

    const freePixels = totalPixels - occupiedPixels;
    const occupancyRate = ((occupiedPixels / totalPixels) * 100).toFixed(1);

    return {
      totalPixels,
      occupiedPixels,
      freePixels,
      occupancyRate,
    };
  }, [occupancyMap]);

  return (
    <div className="editor-statistics">
      {/* 拖动标题栏 */}
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          ⋮⋮
        </span>
      </div>
      {/* 内容区域 */}
      <div className="editor-window-content">
        {/* 总览卡片 */}
        <div className="stats-cards-row">
          <div className="stat-card total">
            <div className="stat-label">TOTAL</div>
            <div className="stat-value">{statistics.totalPixels}</div>
            <div className="stat-detail">
              {MATRIX_CONFIG.COLUMNS} × {MATRIX_CONFIG.ROWS}
            </div>
          </div>

          <div className="stat-card occupied">
            <div className="stat-label">OCCUPIED</div>
            <div className="stat-value">{statistics.occupiedPixels}</div>
            <div className="stat-detail">{statistics.occupancyRate}%</div>
          </div>

          <div className="stat-card free">
            <div className="stat-label">FREE</div>
            <div className="stat-value">{statistics.freePixels}</div>
            <div className="stat-detail">
              {(100 - parseFloat(statistics.occupancyRate)).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* 果汁剩余效果 - 占用率可视化 */}
        <div className="juice-loader-container">
          <div
            className="juice-loader"
            style={
              {
                '--fill-percent': `${100 - parseFloat(statistics.occupancyRate)}%`,
              } as React.CSSProperties
            }
          ></div>
          <div className="juice-label">
            空间剩余 {(100 - parseFloat(statistics.occupancyRate)).toFixed(1)}%
          </div>
        </div>

        {/* 布局建议 */}
        <div className="stats-tips">
          <div className="tips-content">
            {parseFloat(statistics.occupancyRate) > 80 && (
              <div className="tip-item warning">⚠️ 占用率较高，建议清理或重新布局</div>
            )}
            {parseFloat(statistics.occupancyRate) < 30 && (
              <div className="tip-item info">✨ 空间充足，可以添加更多 Magnet</div>
            )}
            {statistics.freePixels > 0 && (
              <div className="tip-item">🎯 剩余 {statistics.freePixels} 个可用 Pixel</div>
            )}
          </div>
        </div>
      </div>{' '}
      {/* 关闭 editor-window-content */}
    </div>
  );
});
