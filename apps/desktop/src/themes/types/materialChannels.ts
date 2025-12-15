/**
 * 材质通道系统类型定义
 * 定义组件的哪个部分使用着色器的哪个颜色槽位
 */

/**
 * 通道映射配置
 */
export interface ChannelMapping {
  slot: 'primary' | 'secondary' | 'accent' | 'detail';
  state?: 'base' | 'hover' | 'active' | 'disabled';
  alpha?: number; // 额外的透明度调整 (0-1)
  blend?: 'multiply' | 'overlay' | 'screen'; // 混合模式
}

/**
 * 材质通道
 * 组件定义自己的哪个部分使用着色器的哪个颜色槽位
 */
export interface MaterialChannels {
  // 组件ID或类型
  componentId: string;
  componentType: string;

  // 材质通道映射
  // CSS属性名 → 颜色槽位映射
  channels: {
    [cssProperty: string]: ChannelMapping;
  };
}
