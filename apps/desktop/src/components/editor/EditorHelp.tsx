import { memo } from 'react';
import './EditorHelp.css';

export const EditorHelp = memo(function EditorHelp() {
  return (
    <div className="editor-help">
      {/* 拖动标题栏 */}
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          ⋮⋮
        </span>
      </div>
      {/* 内容区域 */}
      <div className="editor-window-content">
        <section className="help-section">
          <h3 className="help-title">🎯 编辑器功能</h3>
          <div className="help-content">
            <p>Magnet 编辑器允许你自定义界面布局，添加、移动和删除 UI 元素（Magnet）。</p>
          </div>
        </section>

        <section className="help-section">
          <h3 className="help-title">🖱️ 基本操作</h3>
          <div className="help-list">
            <div className="help-item">
              <div className="help-icon">📍</div>
              <div className="help-text">
                <strong>选择 Pixel</strong>
                <p>在空白区域拖动鼠标可选择 Pixel 区域</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-icon">🎯</div>
              <div className="help-text">
                <strong>移动 Magnet</strong>
                <p>点击并拖动 Magnet 到新位置，释放鼠标完成移动</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-icon">🗑️</div>
              <div className="help-text">
                <strong>删除 Magnet</strong>
                <p>在 Magnet 库面板中点击删除按钮（编辑器按钮除外）</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-icon">➕</div>
              <div className="help-text">
                <strong>导入 Magnet</strong>
                <p>在 Magnet 库面板点击“导入”，粘贴 JSON 数据</p>
              </div>
            </div>
          </div>
        </section>

        <section className="help-section">
          <h3 className="help-title">🎨 Pixel 颜色说明</h3>
          <div className="help-list">
            <div className="help-item">
              <div className="help-color-indicator free" />
              <div className="help-text">
                <strong>绿色</strong>
                <p>空闲 Pixel，可以放置新 Magnet</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-color-indicator occupied" />
              <div className="help-text">
                <strong>红色</strong>
                <p>已被占用的 Pixel</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-color-indicator selected" />
              <div className="help-text">
                <strong>蓝色</strong>
                <p>已选中的 Pixel</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-color-indicator hover" />
              <div className="help-text">
                <strong>黄色边框</strong>
                <p>鼠标悬停的 Pixel</p>
              </div>
            </div>
          </div>
        </section>

        <section className="help-section">
          <h3 className="help-title">🔵 拖动反馈</h3>
          <div className="help-list">
            <div className="help-item">
              <div className="help-color-indicator drag-ok" />
              <div className="help-text">
                <strong>蓝色虚线边框</strong>
                <p>可以放置到此位置（无冲突）</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-color-indicator drag-collision" />
              <div className="help-text">
                <strong>红色虚线边框</strong>
                <p>不能放置（与其他 Magnet 重叠）</p>
              </div>
            </div>
          </div>
        </section>

        <section className="help-section">
          <h3 className="help-title">⚙️ Magnet 类型</h3>
          <div className="help-content">
            <div className="magnet-type-card">
              <h4>
                <code>single</code>
              </h4>
              <p>单锚点 Magnet，固定尺寸，适合按钮等元素</p>
            </div>

            <div className="magnet-type-card">
              <h4>
                <code>horizontal</code>
              </h4>
              <p>水平锚点 Magnet，宽度自适应，适合进度条等元素</p>
            </div>

            <div className="magnet-type-card">
              <h4>
                <code>rectangular</code>
              </h4>
              <p>矩形锚点 Magnet，宽高都自适应，适合面板等元素</p>
            </div>
          </div>
        </section>

        <section className="help-section">
          <h3 className="help-title">⚠️ 限制说明</h3>
          <div className="help-list">
            <div className="help-item">
              <div className="help-icon">🔒</div>
              <div className="help-text">
                <strong>编辑器按钮</strong>
                <p>可以移动，但不能删除（保护编辑功能）</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-icon">⛔</div>
              <div className="help-text">
                <strong>冲突检测</strong>
                <p>不能将 Magnet 放置到已被占用的位置</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-icon">📐</div>
              <div className="help-text">
                <strong>边界限制</strong>
                <p>Magnet 会自动限制在有效的 Pixel 范围内</p>
              </div>
            </div>
          </div>
        </section>

        <section className="help-section">
          <h3 className="help-title">💡 使用技巧</h3>
          <div className="help-content">
            <ul>
              <li>使用统计面板查看 Pixel 占用情况，合理规划布局</li>
              <li>拖动 Magnet 时会显示实时预览，帮助精确定位</li>
              <li>在 Magnet 库中可以导出现有 Magnet 作为模板</li>
              <li>建议保持占用率在 80% 以下，留出调整空间</li>
              <li>内置 Magnet 可以移动，但删除前请确认不影响功能</li>
            </ul>
          </div>
        </section>

        <section className="help-section">
          <h3 className="help-title">🔗 快捷键</h3>
          <div className="help-content">
            <div className="shortcut-item">
              <kbd>鼠标拖动</kbd>
              <span>移动 Magnet 或选择 Pixel</span>
            </div>
            <div className="shortcut-item">
              <kbd>Esc</kbd>
              <span>取消当前操作</span>
            </div>
          </div>
        </section>

        <div className="help-footer">
          <p>更多信息请查看项目文档 📚</p>
        </div>
      </div>{' '}
      {/* 关闭 editor-window-content */}
    </div>
  );
});
