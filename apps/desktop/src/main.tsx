import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { EditorWindowApp } from './EditorWindowApp';
import { PluginWindowApp } from './PluginWindowApp';
import { VstEditorWindowApp } from './VstEditorWindowApp';
import { KernelProvider } from './contexts/KernelContext';
import './index.css';

// 根据 URL 判断渲染哪个应用
const hash = window.location.hash;
const isEditorWindow = hash.startsWith('#/editor/');
const isPluginWindow = hash.startsWith('#/plugin-window/');
const isVstEditorWindow = hash.startsWith('#/vst-editor/');

const RootApp = isEditorWindow
  ? EditorWindowApp
  : isPluginWindow
    ? PluginWindowApp
    : isVstEditorWindow
      ? VstEditorWindowApp
      : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <KernelProvider>
      <RootApp />
    </KernelProvider>
  </React.StrictMode>
);
