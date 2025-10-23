import React from 'react';
import './HomePage.css';

/**
 * 首页组件
 */
export const HomePage: React.FC = () => {
  return (
    <div className="page-home">
      <div className="home-welcome">
        <div className="home-icon">♪</div>
        <h1 className="home-title">欢迎使用音乐播放器</h1>
        <p className="home-subtitle">点击右侧按钮访问音乐库、歌单等功能</p>
      </div>
    </div>
  );
};
