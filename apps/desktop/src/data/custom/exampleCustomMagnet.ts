// 示例自定义磁贴
// TODO: 在feature/add-new-magnet分支上实现新功能

import { MagnetDefinition } from '../../types/pixel';

const exampleMagnet: MagnetDefinition = {
  id: 'example-custom',
  name: '示例磁贴',
  category: 'custom',
  defaultConfig: {
    rows: 2,
    cols: 2,
    position: { x: 0, y: 0 }
  },
  render: (ctx, config, state) => {
    // 绘制逻辑
    ctx.fillStyle = '#4CAF50';
    ctx.fillRect(0, 0, config.cols * 10, config.rows * 10);
  }
};

export default exampleMagnet;