/* eslint-disable no-restricted-imports */
import type { VisualizerSceneDescriptor } from './types';
import { ORBITAL_COMPONENT_IDS } from './components/orbital';

export const AUDIO_VISUALIZER_SCENE_ID = 'audio-visualizer';

export const VISUALIZER_SCENES: Record<string, VisualizerSceneDescriptor> = {
  [AUDIO_VISUALIZER_SCENE_ID]: {
    id: AUDIO_VISUALIZER_SCENE_ID,
    title: 'Audio Visualizer',
    components: [
      {
        id: ORBITAL_COMPONENT_IDS.phaseScope,
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
        id: ORBITAL_COMPONENT_IDS.frequencyRing,
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
        id: ORBITAL_COMPONENT_IDS.chordWheel,
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
        id: ORBITAL_COMPONENT_IDS.progressOrbit,
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
        id: ORBITAL_COMPONENT_IDS.particleFlow,
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
        id: ORBITAL_COMPONENT_IDS.morseTelemetry,
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
        id: ORBITAL_COMPONENT_IDS.centerConsole,
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
        id: ORBITAL_COMPONENT_IDS.trackHeader,
        transform: {
          position: { x: 0, y: -320 },
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
