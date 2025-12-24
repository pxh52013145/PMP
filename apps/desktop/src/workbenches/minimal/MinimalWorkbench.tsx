import { MatrixWorkbench } from '../matrix/MatrixWorkbench';

export function MinimalWorkbench() {
  return <MatrixWorkbench showEditorOverlay={false} showEditorPanel={false} showWindowBorder />;
}

