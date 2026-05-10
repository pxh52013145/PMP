import type { Magnet } from '../../types/pixel';

interface MagnetCreatorProps {
  mode: 'create' | 'edit';
  editingMagnet?: Magnet;
  defaultMagnet?: Magnet;
  onSave: (magnet: Magnet) => void;
  onCancel: () => void;
}

export function MagnetCreator(_props: MagnetCreatorProps) {
  return null;
}