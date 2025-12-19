import { useMemo, memo, useState, useEffect } from 'react';
import { useEditor } from '../../contexts/EditorContext';
import { MATRIX_CONFIG } from '../../constants/config';
import { STORAGE_KEYS, TAURI_EVENTS, setupTauriListener } from '../../utils/windowCommunication';
import { readJson } from '../../modules/storage';
import './EditorStatistics.css';

interface SerializableEditorState {
  selectedPixels: string[];
  mode?: string;
  isEditing?: boolean;
  selectedMagnetId?: string | null;
}

export const EditorStatistics = memo(function EditorStatistics() {
  const { occupancyMap } = useEditor();
  const defaultEditorState: SerializableEditorState = {
    selectedPixels: [],
    mode: 'view',
    isEditing: false,
    selectedMagnetId: null,
  };

  // 从localStorage/事件监听获取editorState（用于跨窗口通信）
  const [editorState, setEditorState] = useState<SerializableEditorState>(() => {
    return readJson<SerializableEditorState>(STORAGE_KEYS.EDITOR_STATE, defaultEditorState);
  });

  // 监听editorState更新
  useEffect(() => {
    const unlistenPromise = setupTauriListener(TAURI_EVENTS.EDITOR_STATE_UPDATED, () => {
      const newState = readJson<SerializableEditorState | null>(STORAGE_KEYS.EDITOR_STATE, null);
      if (!newState) return;
      setEditorState(newState);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

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

  // 计算选中区域信息
  const selectionInfo = useMemo(() => {
    if (editorState.selectedPixels.length === 0) {
      return null;
    }

    const selectedPixels = editorState.selectedPixels.map((key) => {
      const [x, y] = key.split(',').map(Number);
      return { x, y, key };
    });

    // 检查是否所有选中pixels属于同一个magnet
    const occupiedBy = new Set<string>();
    selectedPixels.forEach((pixel) => {
      const occupancy = occupancyMap.get(pixel.key);
      if (occupancy?.isOccupied && occupancy.occupiedBy) {
        occupiedBy.add(occupancy.occupiedBy);
      }
    });

    // 计算边界
    const xs = selectedPixels.map((p) => p.x);
    const ys = selectedPixels.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // 根据区域形状确定锚点类型
    const isSingle = minX === maxX && minY === maxY;
    const isHorizontal = minY === maxY && minX !== maxX;
    const isVertical = minX === maxX && minY !== maxY;

    let anchorType: 'single' | 'horizontal' | 'vertical' | 'rectangular';
    let anchorPoints: Array<{ x: number; y: number; label: string }>;

    if (isSingle) {
      // 单点：只显示1个锚点
      anchorType = 'single';
      anchorPoints = [{ x: minX, y: minY, label: '锚点' }];
    } else if (isHorizontal) {
      // 水平线：显示左右2个锚点
      anchorType = 'horizontal';
      anchorPoints = [
        { x: minX, y: minY, label: '左端' },
        { x: maxX, y: minY, label: '右端' },
      ];
    } else if (isVertical) {
      // 垂直线：显示上下2个锚点
      anchorType = 'vertical';
      anchorPoints = [
        { x: minX, y: minY, label: '上端' },
        { x: minX, y: maxY, label: '下端' },
      ];
    } else {
      // 矩形：显示4个角锚点
      anchorType = 'rectangular';
      anchorPoints = [
        { x: minX, y: minY, label: '左上' },
        { x: maxX, y: minY, label: '右上' },
        { x: minX, y: maxY, label: '左下' },
        { x: maxX, y: maxY, label: '右下' },
      ];
    }

    return {
      count: selectedPixels.length,
      magnetId: occupiedBy.size === 1 ? Array.from(occupiedBy)[0] : null,
      bounds: { minX, maxX, minY, maxY },
      anchorType,
      anchorPoints,
    };
  }, [editorState.selectedPixels, occupancyMap]);

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
        {/* 选中区域信息 */}
        {selectionInfo && (
          <div className="selection-info-card">
            <div className="selection-header">
              <span className="selection-icon"></span>
              <span className="selection-title">选中区域</span>
              <span className="selection-count">{selectionInfo.count} pixels</span>
            </div>

            <div className="selection-details">
              {selectionInfo.magnetId && (
                <div className="info-row">
                  <span className="info-label">Magnet ID:</span>
                  <span className="info-value magnet-id">{selectionInfo.magnetId}</span>
                </div>
              )}

              <div className="info-row">
                <span className="info-label">区域大小:</span>
                <span className="info-value">
                  {selectionInfo.bounds.maxX - selectionInfo.bounds.minX + 1} ×{' '}
                  {selectionInfo.bounds.maxY - selectionInfo.bounds.minY + 1} ({selectionInfo.count}{' '}
                  pixels)
                </span>
              </div>

              <div className="info-row">
                <span className="info-label">
                  {selectionInfo.anchorType === 'single'
                    ? '坐标:'
                    : selectionInfo.anchorType === 'horizontal'
                      ? '左右端点:'
                      : selectionInfo.anchorType === 'vertical'
                        ? '上下端点:'
                        : '四角锚点:'}
                </span>
                <div
                  className="anchor-grid"
                  style={{
                    gridTemplateColumns:
                      selectionInfo.anchorType === 'single'
                        ? '1fr'
                        : selectionInfo.anchorType === 'horizontal' ||
                            selectionInfo.anchorType === 'vertical'
                          ? '1fr 1fr'
                          : '1fr 1fr',
                  }}
                >
                  {selectionInfo.anchorPoints.map((anchor) => (
                    <div key={anchor.label} className="anchor-point">
                      <span className="anchor-coord">
                        ({anchor.x}, {anchor.y})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

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
      </div>{' '}
      {/* 关闭 editor-window-content */}
    </div>
  );
});
