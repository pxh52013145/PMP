/* eslint-disable no-restricted-imports */
import type { VisualizerSceneDescriptor } from './types';
import { REFERENCE_COMPONENT_IDS } from './components/reference';

export const AUDIO_VISUALIZER_SCENE_ID = 'audio-visualizer';

export const VISUALIZER_SCENES: Record<string, VisualizerSceneDescriptor> = {
  [AUDIO_VISUALIZER_SCENE_ID]: {
    id: AUDIO_VISUALIZER_SCENE_ID,
    title: 'Audio Visualizer',
    components: [
      {
        id: REFERENCE_COMPONENT_IDS.phase,
        transform: {
          position: { x: 0, y: 0 },
          scale: 1,
          rotation: 0,
          zIndex: 0,
          opacity: 1,
          visible: true,
        },
      },
      {
        id: REFERENCE_COMPONENT_IDS.freq,
        transform: {
          position: { x: 0, y: 0 },
          scale: 1,
          rotation: 0,
          zIndex: 1,
          opacity: 1,
          visible: true,
        },
      },
      {
        id: REFERENCE_COMPONENT_IDS.chords,
        transform: {
          position: { x: 0, y: 0 },
          scale: 1,
          rotation: 0,
          zIndex: 2,
          opacity: 1,
          visible: true,
        },
      },
      {
        id: REFERENCE_COMPONENT_IDS.progress,
        transform: {
          position: { x: 0, y: 0 },
          scale: 1,
          rotation: 0,
          zIndex: 3,
          opacity: 1,
          visible: true,
        },
      },
      {
        id: REFERENCE_COMPONENT_IDS.particles,
        transform: {
          position: { x: 0, y: 0 },
          scale: 1,
          rotation: 0,
          zIndex: 4,
          opacity: 1,
          visible: true,
        },
      },
      {
        id: REFERENCE_COMPONENT_IDS.morse,
        transform: {
          position: { x: 0, y: 0 },
          scale: 1,
          rotation: 0,
          zIndex: 5,
          opacity: 1,
          visible: true,
        },
      },
      {
        id: REFERENCE_COMPONENT_IDS.center,
        transform: {
          position: { x: 0, y: 0 },
          scale: 1,
          rotation: 0,
          zIndex: 6,
          opacity: 1,
          visible: true,
        },
      },
      {
        id: REFERENCE_COMPONENT_IDS.hud,
        transform: {
          position: { x: -280, y: -200 },
          scale: 1,
          rotation: 0,
          zIndex: 9,
          opacity: 1,
          visible: true,
        },
      },
    ],
  },
};

export function resolveVisualizerScene(sceneId: string): VisualizerSceneDescriptor {
  return VISUALIZER_SCENES[sceneId] ?? VISUALIZER_SCENES[AUDIO_VISUALIZER_SCENE_ID];
}
