import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { EditorWindowApp } from './EditorWindowApp';
import './index.css';

// 根据 URL 判断渲染哪个应用
const hash = window.location.hash;
const isEditorWindow = hash.startsWith('#/editor/');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isEditorWindow ? <EditorWindowApp /> : <App />}</React.StrictMode>
);
