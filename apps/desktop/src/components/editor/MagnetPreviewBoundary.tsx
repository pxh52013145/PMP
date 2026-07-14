import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';

const telemetry = getTelemetryLogger('editor', 'MagnetPreviewBoundary');

export class MagnetPreviewBoundary extends Component<
  { magnetId: string; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    telemetry.warn('editor.magnet-preview.render.failed', {
      message: error.message,
      fields: {
        magnetId: this.props.magnetId,
        componentStack: info.componentStack,
      },
    });
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
