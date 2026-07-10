import { isTauriRuntime } from '../../utils/tauriRuntime';
import { getTelemetryLogger } from '../telemetry/TelemetryService';
import { invokeWithTelemetry } from '../telemetry/tauriInvokeTelemetry';
import {
  decodeNativeAudioSpectrumBinaryFrame,
  type NativeAudioSpectrumBinaryFrame,
} from './nativeAudioSpectrumPayloadAdapter';

const telemetry = getTelemetryLogger('audio', 'NativeAudioSpectrumStream');
const RETRY_DELAY_MS = 1_000;

type SpectrumStreamEndpoint = {
  url: string;
  protocolVersion: number;
};

export class NativeAudioSpectrumStreamClient {
  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private failureReported = false;

  constructor(
    private readonly onFrame: (frame: NativeAudioSpectrumBinaryFrame) => void
  ) {}

  start(): void {
    if (!isTauriRuntime() || typeof WebSocket !== 'function' || !this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  destroy(): void {
    this.stopped = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.close();
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.socket) return;

    let endpoint: SpectrumStreamEndpoint;
    try {
      endpoint = await invokeWithTelemetry<SpectrumStreamEndpoint>(
        'native_audio_open_spectrum_stream',
        undefined,
        {
          moduleId: 'audio',
          component: 'NativeAudioSpectrumStream',
          event: 'audio.spectrum.stream.open',
          successLevel: 'debug',
          failureLevel: 'debug',
        }
      );
    } catch (error) {
      this.reportFailure(error);
      this.scheduleRetry();
      return;
    }

    if (this.stopped || !this.isValidEndpoint(endpoint)) return;
    try {
      const socket = new WebSocket(endpoint.url);
      socket.binaryType = 'arraybuffer';
      this.socket = socket;
      socket.onopen = () => {
        if (this.socket !== socket || this.stopped) return;
        this.failureReported = false;
        telemetry.info('audio.spectrum.stream.connected', {
          fields: { protocolVersion: endpoint.protocolVersion },
        });
      };
      socket.onmessage = (event) => {
        if (this.socket !== socket || !(event.data instanceof ArrayBuffer)) return;
        const frame = decodeNativeAudioSpectrumBinaryFrame(event.data);
        if (frame) this.onFrame(frame);
      };
      socket.onclose = () => {
        if (this.socket !== socket) return;
        this.socket = null;
        if (!this.stopped) this.scheduleRetry();
      };
      socket.onerror = () => {
        // Close drives reconnection. Do not emit a log for each socket error callback.
      };
    } catch (error) {
      this.socket = null;
      this.reportFailure(error);
      this.scheduleRetry();
    }
  }

  private isValidEndpoint(endpoint: SpectrumStreamEndpoint): boolean {
    if (endpoint.protocolVersion !== 1 || !endpoint.url.startsWith('ws://127.0.0.1:')) {
      this.reportFailure(new Error('Invalid native spectrum stream endpoint'));
      this.scheduleRetry();
      return false;
    }
    return true;
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, RETRY_DELAY_MS);
  }

  private reportFailure(error: unknown): void {
    if (this.failureReported) return;
    this.failureReported = true;
    telemetry.warn('audio.spectrum.stream.unavailable', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
