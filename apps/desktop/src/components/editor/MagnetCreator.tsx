import { useState, useEffect, useMemo, useCallback } from 'react';
import { Magnet, PixelAnchor, AnchorType, MagnetStyle } from '../../types/pixel';
import { open } from '@tauri-apps/api/dialog';
import { readTextFile } from '@tauri-apps/api/fs';
import { useEditor } from '../../contexts/EditorContext';
import { getMagnetOccupiedPixels } from '../../utils/magnetEditor';
import './MagnetCreator.css';

interface MagnetCreatorProps {
  mode: 'create' | 'edit';
  editingMagnet?: Magnet;
  defaultMagnet?: Magnet; // 默认配置（用于还原）
  onSave: (magnet: Magnet) => void;
  onCancel: () => void;
}

// 历史记录接口
interface MagnetHistory {
  id: string;
  timestamp: number;
  magnet: Magnet;
  description: string;
}

// 历史记录管理
const HISTORY_STORAGE_KEY = 'magnet-creator-history';
const MAX_HISTORY_ITEMS = 20; // 每个 Magnet 最多保存 20 条历史

const loadHistory = (magnetId: string): MagnetHistory[] => {
  try {
    const data = localStorage.getItem(`${HISTORY_STORAGE_KEY}-${magnetId}`);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

const saveHistory = (magnetId: string, history: MagnetHistory[]) => {
  try {
    localStorage.setItem(`${HISTORY_STORAGE_KEY}-${magnetId}`, JSON.stringify(history));
  } catch (error) {
    console.error('Failed to save history:', error);
  }
};

const addHistoryItem = (magnet: Magnet, description: string = '手动保存') => {
  const history = loadHistory(magnet.id);
  const newItem: MagnetHistory = {
    id: `${magnet.id}-${Date.now()}`,
    timestamp: Date.now(),
    magnet: JSON.parse(JSON.stringify(magnet)), // 深拷贝
    description,
  };

  history.unshift(newItem); // 添加到开头
  if (history.length > MAX_HISTORY_ITEMS) {
    history.splice(MAX_HISTORY_ITEMS); // 限制数量
  }

  saveHistory(magnet.id, history);
};

export function MagnetCreator({
  mode,
  editingMagnet,
  defaultMagnet,
  onSave,
  onCancel,
}: MagnetCreatorProps) {
  // 获取编辑器上下文（用于冲突检测）
  const { occupancyMap } = useEditor();

  // 表单字段状态
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [anchorType, setAnchorType] = useState<AnchorType>('single');
  const [content, setContent] = useState('');

  // 锚点配置 - pixel 尺寸
  const [horizontalPixels, setHorizontalPixels] = useState(5); // 水平方向 pixel 数量
  const [verticalPixels, setVerticalPixels] = useState(3); // 垂直方向 pixel 数量
  const [rectWidth, setRectWidth] = useState(5); // 矩形宽度（pixel）
  const [rectHeight, setRectHeight] = useState(3); // 矩形高度（pixel）

  // 样式配置（JSON 字符串）
  const [styleJson, setStyleJson] = useState<string>(`{
  "width": "36px",
  "height": "36px",
  "backgroundColor": "rgba(0, 0, 0, 0.7)",
  "borderRadius": "4px",
  "display": "flex",
  "alignItems": "center",
  "justifyContent": "center",
  "cursor": "pointer"
}`);

  // 动画配置（JSON 字符串）
  const [animationJson, setAnimationJson] = useState<string>(`{
  "transition": "all 0.2s ease",
  "hoverStyle": {
    "transform": "scale(1.05)",
    "filter": "brightness(1.1)"
  },
  "activeStyle": {
    "transform": "scale(0.95)",
    "filter": "brightness(0.9)"
  }
}`);

  // 样式解析错误
  const [styleError, setStyleError] = useState('');
  const [animationError, setAnimationError] = useState('');

  // 导入状态
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState('');

  // 历史记录相关
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<MagnetHistory[]>([]);

  // 是否为内置 Magnet（判断是否显示还原按钮）
  const isBuiltinMagnet = useMemo(() => {
    return mode === 'edit' && defaultMagnet !== undefined;
  }, [mode, defaultMagnet]);

  // 解析样式 JSON
  const parsedStyle = useMemo(() => {
    try {
      const parsed = JSON.parse(styleJson);
      setStyleError('');
      return parsed;
    } catch (error) {
      setStyleError('JSON 格式错误');
      return {};
    }
  }, [styleJson]);

  // 解析动画 JSON
  const parsedAnimation = useMemo(() => {
    try {
      const parsed = JSON.parse(animationJson);
      setAnimationError('');
      return parsed;
    } catch (error) {
      setAnimationError('JSON 格式错误');
      return undefined;
    }
  }, [animationJson]);

  // 加载 Magnet 配置的辅助函数
  const loadMagnetConfig = useCallback((magnet: Magnet) => {
    setId(magnet.id);
    setName(magnet.name);
    setAnchorType(magnet.anchorType);
    setContent(typeof magnet.content === 'string' ? magnet.content : '');

    // 加载锚点配置并计算 pixel 尺寸
    if (magnet.anchors.length >= 2) {
      if (magnet.anchorType === 'horizontal') {
        const width = Math.abs(magnet.anchors[1].gridX - magnet.anchors[0].gridX) + 1;
        setHorizontalPixels(width);
      } else if (magnet.anchorType === 'vertical') {
        const height = Math.abs(magnet.anchors[1].gridY - magnet.anchors[0].gridY) + 1;
        setVerticalPixels(height);
      } else if (magnet.anchorType === 'rectangular') {
        const width = Math.abs(magnet.anchors[1].gridX - magnet.anchors[0].gridX) + 1;
        const height = Math.abs(magnet.anchors[2].gridY - magnet.anchors[0].gridY) + 1;
        setRectWidth(width);
        setRectHeight(height);
      }
    }

    // 加载样式 JSON
    if (magnet.style) {
      setStyleJson(JSON.stringify(magnet.style, null, 2));
    }

    // 加载动画 JSON
    if (magnet.animation) {
      setAnimationJson(JSON.stringify(magnet.animation, null, 2));
    }
  }, []);

  // 加载编辑数据
  useEffect(() => {
    if (mode === 'edit' && editingMagnet) {
      loadMagnetConfig(editingMagnet);
      // 加载历史记录
      setHistory(loadHistory(editingMagnet.id));
    }
  }, [mode, editingMagnet, loadMagnetConfig]);

  // 根据锚点类型和 pixel 尺寸生成锚点
  const generateAnchors = useMemo((): PixelAnchor[] => {
    const baseX = 10; // 基准起始 X (预览中心区域)
    const baseY = 10; // 基准起始 Y (预览中心区域)

    switch (anchorType) {
      case 'single':
        return [{ id: 'anchor', gridX: baseX, gridY: baseY, role: 'anchor' }];

      case 'horizontal':
        // 水平方向：从 baseX 开始，占据 horizontalPixels 个 pixel
        return [
          { id: 'left', gridX: baseX, gridY: baseY, role: 'anchor' },
          { id: 'right', gridX: baseX + horizontalPixels - 1, gridY: baseY, role: 'boundary' },
        ];

      case 'vertical':
        // 垂直方向：从 baseY 开始，占据 verticalPixels 个 pixel
        return [
          { id: 'top', gridX: baseX, gridY: baseY, role: 'anchor' },
          { id: 'bottom', gridX: baseX, gridY: baseY + verticalPixels - 1, role: 'boundary' },
        ];

      case 'rectangular':
        // 矩形：从 (baseX, baseY) 开始，占据 rectWidth × rectHeight 个 pixel
        return [
          { id: 'top-left', gridX: baseX, gridY: baseY, role: 'anchor' },
          { id: 'top-right', gridX: baseX + rectWidth - 1, gridY: baseY, role: 'boundary' },
          { id: 'bottom-left', gridX: baseX, gridY: baseY + rectHeight - 1, role: 'boundary' },
          {
            id: 'bottom-right',
            gridX: baseX + rectWidth - 1,
            gridY: baseY + rectHeight - 1,
            role: 'boundary',
          },
        ];

      default:
        return [];
    }
  }, [anchorType, horizontalPixels, verticalPixels, rectWidth, rectHeight]);

  // 验证锚点是否超出网格边界
  const anchorsValidation = useMemo(() => {
    const maxX = 26; // 网格最大 X 坐标
    const maxY = 19; // 网格最大 Y 坐标
    const errors: string[] = [];
    const warnings: string[] = [];

    // 在编辑模式下，基于实际位置验证；在创建模式下，基于尺寸验证
    let anchorsToValidate: PixelAnchor[];

    if (mode === 'edit' && editingMagnet) {
      // 编辑模式：基于实际位置生成锚点进行验证
      const baseAnchor = editingMagnet.anchors[0];
      const baseX = baseAnchor.gridX;
      const baseY = baseAnchor.gridY;

      switch (anchorType) {
        case 'single':
          anchorsToValidate = [{ id: 'anchor', gridX: baseX, gridY: baseY, role: 'anchor' }];
          break;
        case 'horizontal':
          anchorsToValidate = [
            { id: 'left', gridX: baseX, gridY: baseY, role: 'anchor' },
            { id: 'right', gridX: baseX + horizontalPixels - 1, gridY: baseY, role: 'boundary' },
          ];
          break;
        case 'vertical':
          anchorsToValidate = [
            { id: 'top', gridX: baseX, gridY: baseY, role: 'anchor' },
            { id: 'bottom', gridX: baseX, gridY: baseY + verticalPixels - 1, role: 'boundary' },
          ];
          break;
        case 'rectangular':
          anchorsToValidate = [
            { id: 'top-left', gridX: baseX, gridY: baseY, role: 'anchor' },
            { id: 'top-right', gridX: baseX + rectWidth - 1, gridY: baseY, role: 'boundary' },
            { id: 'bottom-left', gridX: baseX, gridY: baseY + rectHeight - 1, role: 'boundary' },
            {
              id: 'bottom-right',
              gridX: baseX + rectWidth - 1,
              gridY: baseY + rectHeight - 1,
              role: 'boundary',
            },
          ];
          break;
        default:
          anchorsToValidate = [];
      }
    } else {
      // 创建模式：使用预览锚点验证
      anchorsToValidate = generateAnchors;
    }

    // 验证锚点坐标
    anchorsToValidate.forEach((anchor) => {
      if (anchor.gridX < 0 || anchor.gridX > maxX) {
        errors.push(`锚点 "${anchor.id}" 的 X 坐标超出范围 (${anchor.gridX})`);
      }
      if (anchor.gridY < 0 || anchor.gridY > maxY) {
        errors.push(`锚点 "${anchor.id}" 的 Y 坐标超出范围 (${anchor.gridY})`);
      }
    });

    // 在编辑模式下，检查是否与其他 magnet 冲突
    if (mode === 'edit' && editingMagnet && anchorsToValidate.length > 0) {
      // 创建临时 magnet 对象，使用新的锚点和类型
      const tempMagnet: Magnet = {
        ...editingMagnet,
        anchorType,
        anchors: anchorsToValidate,
      };

      // 计算新尺寸下占用的 pixels
      const occupiedPixels = getMagnetOccupiedPixels(tempMagnet);

      // 检查冲突
      const conflictingPixels: Array<{ x: number; y: number; occupiedBy: string }> = [];
      occupiedPixels.forEach((pixel) => {
        const key = `${pixel.x},${pixel.y}`;
        const occupancy = occupancyMap.get(key);

        // 如果 pixel 被占用，且不是被当前编辑的 magnet 占用
        if (
          occupancy?.isOccupied &&
          occupancy.occupiedBy &&
          occupancy.occupiedBy !== editingMagnet.id
        ) {
          conflictingPixels.push({
            x: pixel.x,
            y: pixel.y,
            occupiedBy: occupancy.occupiedBy,
          });
        }
      });

      // 如果有冲突，添加错误信息
      if (conflictingPixels.length > 0) {
        // 统计冲突的 magnet
        const conflictingMagnets = new Set(conflictingPixels.map((p) => p.occupiedBy));
        errors.push(
          `调整后会与 ${conflictingMagnets.size} 个 Magnet 冲突 (${conflictingPixels.length} 个 pixel 重叠)`
        );
      }
    }

    // 创建模式下的预览位置提示
    if (mode === 'create') {
      if (anchorType === 'horizontal' && horizontalPixels > 17) {
        warnings.push('宽度较大，实际使用时可能需要调整位置');
      }
      if (anchorType === 'vertical' && verticalPixels > 10) {
        warnings.push('高度较大，实际使用时可能需要调整位置');
      }
      if (anchorType === 'rectangular') {
        if (rectWidth > 17) warnings.push('宽度较大，实际使用时可能需要调整位置');
        if (rectHeight > 10) warnings.push('高度较大，实际使用时可能需要调整位置');
      }
    }

    return { hasErrors: errors.length > 0, errors, warnings };
  }, [
    mode,
    editingMagnet,
    generateAnchors,
    anchorType,
    horizontalPixels,
    verticalPixels,
    rectWidth,
    rectHeight,
    occupancyMap,
  ]);

  // 动态生成预览用的 pixelPositions（使用较小的间距以适应预览区域）
  const previewPixelPositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const pixelSize = 8; // 预览用的 pixel 尺寸（比实际的 18px 小）

    // 生成 30x30 的网格
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 30; x++) {
        positions.set(`${x},${y}`, { x: x * pixelSize, y: y * pixelSize });
      }
    }
    return positions;
  }, []);

  // 计算预览缩放比例（确保内容不超出预览区域）
  const previewScale = useMemo(() => {
    const maxPreviewWidth = 230; // 预览区域可用宽度（280px - padding）
    const maxPreviewHeight = 250; // 预览区域可用高度
    const pixelSize = 8;

    let contentWidth = pixelSize;
    let contentHeight = pixelSize;

    switch (anchorType) {
      case 'horizontal':
        contentWidth = horizontalPixels * pixelSize;
        contentHeight = pixelSize;
        break;
      case 'vertical':
        contentWidth = pixelSize;
        contentHeight = verticalPixels * pixelSize;
        break;
      case 'rectangular':
        contentWidth = rectWidth * pixelSize;
        contentHeight = rectHeight * pixelSize;
        break;
      default:
        return 1;
    }

    const scaleX = maxPreviewWidth / contentWidth;
    const scaleY = maxPreviewHeight / contentHeight;
    const scale = Math.min(scaleX, scaleY, 1); // 不放大，只缩小

    return scale;
  }, [anchorType, horizontalPixels, verticalPixels, rectWidth, rectHeight]);

  // 预览 Magnet（用于显示）
  const previewMagnet = useMemo<Magnet | null>(() => {
    if (!id || !name) return null;

    return {
      id,
      type: 'custom',
      name,
      anchorType,
      anchors: generateAnchors,
      content: content,
      style: parsedStyle,
      animation: parsedAnimation,
      state: 'idle',
      interactions: {
        draggable: false,
        clickable: true,
      },
    };
  }, [id, name, anchorType, content, parsedStyle, parsedAnimation, generateAnchors]);

  // 保存处理
  const handleSave = () => {
    if (!id || !name) return;

    // 计算实际保存的锚点（保留原始位置或使用用户设置的尺寸）
    let anchorsToSave: PixelAnchor[];

    if (mode === 'edit' && editingMagnet) {
      // 编辑模式：基于原始锚点位置，只更新尺寸
      const baseAnchor = editingMagnet.anchors[0];
      const baseX = baseAnchor.gridX;
      const baseY = baseAnchor.gridY;

      switch (anchorType) {
        case 'single':
          anchorsToSave = [{ id: 'anchor', gridX: baseX, gridY: baseY, role: 'anchor' }];
          break;

        case 'horizontal':
          anchorsToSave = [
            { id: 'left', gridX: baseX, gridY: baseY, role: 'anchor' },
            { id: 'right', gridX: baseX + horizontalPixels - 1, gridY: baseY, role: 'boundary' },
          ];
          break;

        case 'vertical':
          anchorsToSave = [
            { id: 'top', gridX: baseX, gridY: baseY, role: 'anchor' },
            { id: 'bottom', gridX: baseX, gridY: baseY + verticalPixels - 1, role: 'boundary' },
          ];
          break;

        case 'rectangular':
          anchorsToSave = [
            { id: 'top-left', gridX: baseX, gridY: baseY, role: 'anchor' },
            { id: 'top-right', gridX: baseX + rectWidth - 1, gridY: baseY, role: 'boundary' },
            { id: 'bottom-left', gridX: baseX, gridY: baseY + rectHeight - 1, role: 'boundary' },
            {
              id: 'bottom-right',
              gridX: baseX + rectWidth - 1,
              gridY: baseY + rectHeight - 1,
              role: 'boundary',
            },
          ];
          break;

        default:
          anchorsToSave = editingMagnet.anchors;
      }
    } else {
      // 创建模式：使用预览锚点（会在主窗口中重新定位）
      anchorsToSave = generateAnchors;
    }

    // 保存时使用真实的 content，不使用占位符
    const magnetToSave: Magnet = {
      id,
      type: editingMagnet?.type || 'custom',
      name,
      anchorType,
      anchors: anchorsToSave,
      content, // 真实的 content，可以是空字符串
      style: parsedStyle,
      animation: parsedAnimation,
      state: 'idle',
      interactions: editingMagnet?.interactions || {
        draggable: false,
        clickable: true,
      },
    };

    // 检查是否有实际修改（仅在编辑模式下）
    let hasChanges = true;
    if (mode === 'edit' && history.length > 0) {
      const lastHistory = history[0]; // 最新的历史记录
      const lastMagnet = lastHistory.magnet;

      // 比较关键配置是否改变
      const configChanged =
        lastMagnet.name !== magnetToSave.name ||
        lastMagnet.anchorType !== magnetToSave.anchorType ||
        JSON.stringify(lastMagnet.anchors) !== JSON.stringify(magnetToSave.anchors) ||
        JSON.stringify(lastMagnet.style) !== JSON.stringify(magnetToSave.style) ||
        JSON.stringify(lastMagnet.animation) !== JSON.stringify(magnetToSave.animation) ||
        lastMagnet.content !== magnetToSave.content;

      hasChanges = configChanged;
    }

    // 只有在有修改或创建新 Magnet 时才添加历史记录
    if (hasChanges) {
      addHistoryItem(magnetToSave, mode === 'create' ? '创建' : '编辑保存');
    }

    onSave(magnetToSave);

    // 保存后关闭窗口
    onCancel();
  };

  // 还原到默认配置
  const handleRestore = () => {
    if (!defaultMagnet) return;
    loadMagnetConfig(defaultMagnet);
    addHistoryItem(defaultMagnet, '还原默认配置');
  };

  // 应用历史记录
  const handleApplyHistory = (historyItem: MagnetHistory) => {
    loadMagnetConfig(historyItem.magnet);
    setShowHistory(false);
  };

  // 导入配置（从文本框）
  const handleImport = () => {
    try {
      const data = JSON.parse(importJson);

      // 验证必填字段
      if (!data.id) throw new Error('缺少必填字段: id');
      if (!data.name) throw new Error('缺少必填字段: name');
      if (!data.anchorType) throw new Error('缺少必填字段: anchorType');
      if (!data.style) throw new Error('缺少必填字段: style');

      // 加载配置
      loadMagnetConfig(data as Magnet);
      setShowImport(false);
      setImportJson('');
      setImportError('');
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '导入失败');
    }
  };

  // 从文件导入
  const handleImportFromFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'JSON',
            extensions: ['json'],
          },
        ],
        title: '选择 Magnet 配置文件',
      });

      if (selected && typeof selected === 'string') {
        const content = await readTextFile(selected);
        setImportJson(content);
        setImportError('');
      }
    } catch (error) {
      console.error('File import error:', error);
      setImportError(error instanceof Error ? error.message : '读取文件失败');
    }
  };

  // 导出配置
  const handleExport = () => {
    if (!previewMagnet) return;

    const exportData = {
      id: previewMagnet.id,
      type: previewMagnet.type,
      name: previewMagnet.name,
      anchorType: previewMagnet.anchorType,
      anchors: previewMagnet.anchors,
      content: previewMagnet.content,
      style: previewMagnet.style,
      animation: previewMagnet.animation,
      state: previewMagnet.state,
      interactions: {
        draggable: previewMagnet.interactions.draggable,
        clickable: previewMagnet.interactions.clickable,
      },
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    navigator.clipboard
      .writeText(jsonStr)
      .then(() => {
        alert('配置已复制到剪贴板！');
      })
      .catch(() => {
        alert('复制失败，请手动复制');
        console.log(jsonStr);
      });
  };

  // 删除历史记录
  const handleDeleteHistory = (historyId: string) => {
    const newHistory = history.filter((h) => h.id !== historyId);
    setHistory(newHistory);
    if (editingMagnet) {
      saveHistory(editingMagnet.id, newHistory);
    }
  };

  // 验证表单
  const isValid = id && name && !anchorsValidation.hasErrors;

  // 简化的预览组件（不依赖 MATRIX_CONFIG）
  const PreviewMagnet = ({ magnet }: { magnet: Magnet }) => {
    const [isHovering, setIsHovering] = useState(false);
    const [isActive, setIsActive] = useState(false);
    const pixelSize = 8; // 预览用的 pixel 尺寸

    // 计算预览位置和尺寸
    const bounds = useMemo(() => {
      const { anchors, anchorType, style } = magnet;

      switch (anchorType) {
        case 'single': {
          const pos = previewPixelPositions.get(`${anchors[0].gridX},${anchors[0].gridY}`);
          if (!pos) return null;
          const magnetWidth = parseFloat(style.width || '36px');
          const magnetHeight = parseFloat(style.height || '36px');
          const offsetX = (pixelSize - magnetWidth) / 2;
          const offsetY = (pixelSize - magnetHeight) / 2;
          return {
            x: pos.x + offsetX,
            y: pos.y + offsetY,
            width: magnetWidth,
            height: magnetHeight,
          };
        }

        case 'horizontal': {
          const left = previewPixelPositions.get(`${anchors[0].gridX},${anchors[0].gridY}`);
          const right = previewPixelPositions.get(`${anchors[1].gridX},${anchors[1].gridY}`);
          if (!left || !right) return null;
          const magnetHeight = parseFloat(style.height || '36px');
          const offsetY = (pixelSize - magnetHeight) / 2;
          return {
            x: left.x,
            y: left.y + offsetY,
            width: right.x - left.x + pixelSize,
            height: magnetHeight,
          };
        }

        case 'vertical': {
          const top = previewPixelPositions.get(`${anchors[0].gridX},${anchors[0].gridY}`);
          const bottom = previewPixelPositions.get(`${anchors[1].gridX},${anchors[1].gridY}`);
          if (!top || !bottom) return null;
          const magnetWidth = parseFloat(style.width || '36px');
          const offsetX = (pixelSize - magnetWidth) / 2;
          return {
            x: top.x + offsetX,
            y: top.y,
            width: magnetWidth,
            height: bottom.y - top.y + pixelSize,
          };
        }

        case 'rectangular': {
          const topLeft = previewPixelPositions.get(`${anchors[0].gridX},${anchors[0].gridY}`);
          const topRight = previewPixelPositions.get(`${anchors[1].gridX},${anchors[1].gridY}`);
          const bottomLeft = previewPixelPositions.get(`${anchors[2].gridX},${anchors[2].gridY}`);
          if (!topLeft || !topRight || !bottomLeft) return null;
          return {
            x: topLeft.x,
            y: topLeft.y,
            width: topRight.x - topLeft.x + pixelSize,
            height: bottomLeft.y - topLeft.y + pixelSize,
          };
        }

        default:
          return null;
      }
    }, [magnet, previewPixelPositions]);

    if (!bounds) return null;

    // 计算当前应用的样式
    const currentStyle: MagnetStyle = useMemo(() => {
      let appliedStyle = { ...magnet.style };
      if (isHovering && magnet.animation?.hoverStyle) {
        appliedStyle = { ...appliedStyle, ...magnet.animation.hoverStyle };
      }
      if (isActive && magnet.animation?.activeStyle) {
        appliedStyle = { ...appliedStyle, ...magnet.animation.activeStyle };
      }
      return appliedStyle;
    }, [magnet.style, magnet.animation, isHovering, isActive]);

    const finalStyle = {
      position: 'absolute' as const,
      left: `${bounds.x}px`,
      top: `${bounds.y}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      transition: magnet.animation?.transition || 'all 0.2s ease',
      ...currentStyle,
    };

    return (
      <div
        className="magnet"
        style={finalStyle}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => {
          setIsHovering(false);
          setIsActive(false);
        }}
        onMouseDown={() => setIsActive(true)}
        onMouseUp={() => setIsActive(false)}
      >
        {typeof magnet.content === 'string' ? (
          <span className="magnet-text">{magnet.content}</span>
        ) : (
          magnet.content
        )}
      </div>
    );
  };

  return (
    <div className="editor-creator">
      {/* 拖动标题栏 */}
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          ⋮⋮
        </span>
      </div>

      {/* 固定预览区域 */}
      <div className="creator-preview-fixed">
        <div className="creator-section-title">实时预览</div>
        {previewMagnet ? (
          <>
            <div className="creator-preview">
              <div
                className="creator-preview-content"
                style={{
                  transform: `scale(${previewScale})`,
                  transition: 'transform 0.2s ease',
                }}
              >
                <PreviewMagnet magnet={previewMagnet} />
              </div>
            </div>
            <div className="creator-preview-hint">
              💡 移动鼠标查看 hover 效果
              <br />
              点击查看 active 效果
              {previewScale < 1 && (
                <>
                  <br />
                  <span style={{ color: 'rgba(255, 204, 0, 0.9)' }}>
                    ⚡ 预览已缩放至 {Math.round(previewScale * 100)}%
                  </span>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="creator-preview-empty">填写必填字段后显示预览</div>
        )}
      </div>

      {/* 内容区域 */}
      <div className="editor-window-content">
        {/* 模式标题 */}
        <div className="creator-mode-title">{mode === 'edit' ? '编辑 Magnet' : '创建 Magnet'}</div>

        {/* 必填字段 */}
        <div className="creator-section">
          <div className="creator-section-title">基础配置</div>
          <div className="creator-form">
            {/* ID */}
            <div className="creator-form-row">
              <label className="creator-label">
                ID <span className="creator-required">*</span>
              </label>
              <input
                type="text"
                className="creator-input"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="my-magnet"
                disabled={mode === 'edit'}
              />
            </div>

            {/* Name */}
            <div className="creator-form-row">
              <label className="creator-label">
                名称 <span className="creator-required">*</span>
              </label>
              <input
                type="text"
                className="creator-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="我的 Magnet"
              />
            </div>

            {/* Content */}
            <div className="creator-form-row">
              <label className="creator-label">内容</label>
              <input
                type="text"
                className="creator-input"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="按钮文字或内容"
              />
            </div>

            {/* Anchor Type */}
            <div className="creator-form-row">
              <label className="creator-label">
                锚点类型 <span className="creator-required">*</span>
              </label>
              <select
                className="creator-select"
                value={anchorType}
                onChange={(e) => setAnchorType(e.target.value as AnchorType)}
              >
                <option value="single">Single (固定位置)</option>
                <option value="horizontal">Horizontal (水平拉伸)</option>
                <option value="vertical">Vertical (垂直拉伸)</option>
                <option value="rectangular">Rectangular (矩形区域)</option>
              </select>
            </div>

            {/* Horizontal Pixel Count */}
            {anchorType === 'horizontal' && (
              <>
                <div className="creator-form-row">
                  <label className="creator-label">水平 Pixel 数</label>
                  <div className="creator-slider-group">
                    <input
                      type="range"
                      className="creator-slider"
                      value={horizontalPixels}
                      onChange={(e) => setHorizontalPixels(parseInt(e.target.value))}
                      min="1"
                      max="27"
                      step="1"
                    />
                    <input
                      type="number"
                      className="creator-input creator-input-number"
                      value={horizontalPixels}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1;
                        setHorizontalPixels(Math.max(1, Math.min(27, val)));
                      }}
                      min="1"
                      max="27"
                    />
                  </div>
                </div>
                {/* 验证提示 - 水平 */}
                {anchorsValidation.hasErrors && (
                  <div className="creator-validation-error">
                    ⚠️ 尺寸超出网格范围！
                    {anchorsValidation.errors.map((err, i) => (
                      <div key={i}>{err}</div>
                    ))}
                  </div>
                )}
                {!anchorsValidation.hasErrors && anchorsValidation.warnings.length > 0 && (
                  <div className="creator-validation-warning">
                    ⚡ 提示：
                    {anchorsValidation.warnings.map((warn, i) => (
                      <div key={i}>{warn}</div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Vertical Pixel Count */}
            {anchorType === 'vertical' && (
              <>
                <div className="creator-form-row">
                  <label className="creator-label">垂直 Pixel 数</label>
                  <div className="creator-slider-group">
                    <input
                      type="range"
                      className="creator-slider"
                      value={verticalPixels}
                      onChange={(e) => setVerticalPixels(parseInt(e.target.value))}
                      min="1"
                      max="20"
                      step="1"
                    />
                    <input
                      type="number"
                      className="creator-input creator-input-number"
                      value={verticalPixels}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1;
                        setVerticalPixels(Math.max(1, Math.min(20, val)));
                      }}
                      min="1"
                      max="20"
                    />
                  </div>
                </div>
                {/* 验证提示 - 垂直 */}
                {anchorsValidation.hasErrors && (
                  <div className="creator-validation-error">
                    ⚠️ 尺寸超出网格范围！
                    {anchorsValidation.errors.map((err, i) => (
                      <div key={i}>{err}</div>
                    ))}
                  </div>
                )}
                {!anchorsValidation.hasErrors && anchorsValidation.warnings.length > 0 && (
                  <div className="creator-validation-warning">
                    ⚡ 提示：
                    {anchorsValidation.warnings.map((warn, i) => (
                      <div key={i}>{warn}</div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Rectangular Dimensions */}
            {anchorType === 'rectangular' && (
              <>
                <div className="creator-form-row">
                  <label className="creator-label">矩形宽度 (Pixel)</label>
                  <div className="creator-slider-group">
                    <input
                      type="range"
                      className="creator-slider"
                      value={rectWidth}
                      onChange={(e) => setRectWidth(parseInt(e.target.value))}
                      min="1"
                      max="27"
                      step="1"
                    />
                    <input
                      type="number"
                      className="creator-input creator-input-number"
                      value={rectWidth}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1;
                        setRectWidth(Math.max(1, Math.min(27, val)));
                      }}
                      min="1"
                      max="27"
                    />
                  </div>
                </div>
                <div className="creator-form-row">
                  <label className="creator-label">矩形高度 (Pixel)</label>
                  <div className="creator-slider-group">
                    <input
                      type="range"
                      className="creator-slider"
                      value={rectHeight}
                      onChange={(e) => setRectHeight(parseInt(e.target.value))}
                      min="1"
                      max="20"
                      step="1"
                    />
                    <input
                      type="number"
                      className="creator-input creator-input-number"
                      value={rectHeight}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1;
                        setRectHeight(Math.max(1, Math.min(20, val)));
                      }}
                      min="1"
                      max="20"
                    />
                  </div>
                </div>
                {/* 验证提示 - 矩形 */}
                {anchorsValidation.hasErrors && (
                  <div className="creator-validation-error">
                    ⚠️ 尺寸超出网格范围！
                    {anchorsValidation.errors.map((err, i) => (
                      <div key={i}>{err}</div>
                    ))}
                  </div>
                )}
                {!anchorsValidation.hasErrors && anchorsValidation.warnings.length > 0 && (
                  <div className="creator-validation-warning">
                    ⚡ 提示：
                    {anchorsValidation.warnings.map((warn, i) => (
                      <div key={i}>{warn}</div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 样式配置 */}
        <div className="creator-section">
          <div className="creator-section-title">样式配置（JSON）</div>
          <div className="creator-form">
            <div className="creator-form-column">
              <label className="creator-label">
                Style JSON <span className="creator-required">*</span>
              </label>
              <textarea
                className="creator-textarea"
                value={styleJson}
                onChange={(e) => setStyleJson(e.target.value)}
                placeholder='{"width": "36px", "height": "36px", ...}'
                rows={10}
              />
              {styleError && <div className="creator-error">{styleError}</div>}
              <div className="creator-hint">
                常用样式：width, height, backgroundColor, borderRadius, border, boxShadow, color,
                fontSize
              </div>
            </div>
          </div>
        </div>

        {/* 动画配置 */}
        <div className="creator-section">
          <div className="creator-section-title">动画配置（JSON）</div>
          <div className="creator-form">
            <div className="creator-form-column">
              <label className="creator-label">Animation JSON</label>
              <textarea
                className="creator-textarea"
                value={animationJson}
                onChange={(e) => setAnimationJson(e.target.value)}
                placeholder='{"transition": "all 0.2s ease", "hoverStyle": {...}, "activeStyle": {...}}'
                rows={12}
              />
              {animationError && <div className="creator-error">{animationError}</div>}
              <div className="creator-hint">
                💡 动画配置说明：
                <br />• <strong>transition</strong>: 过渡动画，如 "all 0.2s ease"
                <br />• <strong>hoverStyle</strong>: 鼠标悬停时的样式（可包含任何 CSS 属性）
                <br />• <strong>activeStyle</strong>: 点击/按下时的样式（可包含任何 CSS 属性）
                <br />
                <br />
                常用动画属性：transform (scale, translate), filter (brightness, blur), boxShadow,
                opacity
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 底部固定按钮 */}
      <div className="creator-footer-fixed">
        <button className="creator-btn creator-btn-cancel" onClick={onCancel}>
          取消
        </button>
        {isBuiltinMagnet && (
          <button className="creator-btn creator-btn-restore" onClick={handleRestore}>
            还原默认
          </button>
        )}
        {mode === 'edit' && (
          <button
            className="creator-btn creator-btn-history"
            onClick={() => setShowHistory(!showHistory)}
          >
            历史记录 {history.length > 0 && `(${history.length})`}
          </button>
        )}
        {/* 创建模式：显示导入按钮 */}
        {mode === 'create' && (
          <button
            className="creator-btn creator-btn-import"
            onClick={() => setShowImport(!showImport)}
          >
            导入配置
          </button>
        )}
        {/* 编辑模式：显示导出按钮 */}
        {mode === 'edit' && (
          <button
            className="creator-btn creator-btn-export"
            onClick={handleExport}
            disabled={!previewMagnet}
          >
            导出配置
          </button>
        )}
        <button className="creator-btn creator-btn-save" onClick={handleSave} disabled={!isValid}>
          {mode === 'edit' ? '完成' : '创建'}
        </button>
      </div>

      {/* 历史记录面板 */}
      {showHistory && mode === 'edit' && (
        <div className="creator-history-panel">
          <div className="creator-history-header">
            <h3>历史记录</h3>
          </div>
          <div className="creator-history-list">
            {history.length === 0 ? (
              <div className="creator-history-empty">暂无历史记录</div>
            ) : (
              history.map((item) => (
                <div key={item.id} className="creator-history-item">
                  <div className="creator-history-item-info">
                    <div className="creator-history-item-desc">{item.description}</div>
                    <div className="creator-history-item-time">
                      {new Date(item.timestamp).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <div className="creator-history-item-actions">
                    <button
                      className="creator-history-btn creator-history-btn-apply"
                      onClick={() => handleApplyHistory(item)}
                      title="应用此配置"
                    >
                      应用
                    </button>
                    <button
                      className="creator-history-btn creator-history-btn-delete"
                      onClick={() => handleDeleteHistory(item.id)}
                      title="删除此记录"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 导入面板 - 仅在创建模式显示 */}
      {showImport && mode === 'create' && (
        <div className="creator-import-panel">
          <div className="creator-import-header">
            <h3>导入 Magnet 配置</h3>
            <button
              className="creator-import-close"
              onClick={() => {
                setShowImport(false);
                setImportJson('');
                setImportError('');
              }}
            >
              ✕
            </button>
          </div>
          <div className="creator-import-content">
            <div className="creator-import-file-select">
              <button className="creator-btn creator-btn-import" onClick={handleImportFromFile}>
                📁 选择文件
              </button>
              <span className="creator-import-or">或手动粘贴配置</span>
            </div>
            <textarea
              className="creator-import-textarea"
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder="粘贴 Magnet JSON 配置，或点击上方按钮选择 .json 文件..."
              rows={15}
            />
            {importError && <div className="creator-import-error">{importError}</div>}
            <div className="creator-import-hint">
              💡 使用说明：
              <br />• 点击"选择文件"按钮，选择 .json 配置文件
              <br />• 或手动粘贴从其他 Magnet 导出的 JSON 配置
              <br />• 配置必须包含 id, name, anchorType, style 等字段
              <br />
              <br />
              ⚠️ 重要限制：
              <br />• 仅导入样式和动画配置
              <br />• 功能代码（onClick、onHover等）无法通过JSON导入
              <br />• 如需添加功能，请导入后在代码中手动添加（见文档）
              <br />
              <br />
              📖 如何添加功能代码？
              <br />• 查看：<code>apps/desktop/src/data/custom/exampleCustomMagnet.ts</code>
              <br />• 文档：<code>mannual/Magnet/how-to-add-magnets.md</code>
            </div>
          </div>
          <div className="creator-import-actions">
            <button
              className="creator-btn creator-btn-cancel"
              onClick={() => {
                setShowImport(false);
                setImportJson('');
                setImportError('');
              }}
            >
              取消
            </button>
            <button
              className="creator-btn creator-btn-save"
              onClick={handleImport}
              disabled={!importJson.trim()}
            >
              导入并编辑
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
