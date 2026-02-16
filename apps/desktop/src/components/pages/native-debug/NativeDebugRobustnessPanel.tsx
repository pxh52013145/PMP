import { AudioRobustnessSnapshot } from '../../../services/audio';

export type NativeDebugRobustnessMetricsView = {
  backend: string;
  scheduler: string;
  transport: string;
  srcBackend: string;
  quantization: string;
  outputMonitorStatus: string;
  transferMonitorStatus: string;
  callbackP99: string;
  callbackJitterP99: string;
  waitTimeout: string;
  callbackOverrun: string;
  outputUnderrunEvents: string;
  outputUnderrunFrames: string;
  bufferPercent: number;
  bufferStatus: string;
  bufferNow: string;
  decodeBufferNow: string;
  outputBufferNow: string;
  bufferMin: string;
  bufferAvg: string;
  rebuffer: string;
  engineUnderrunEvents: string;
  engineUnderrunWindow: string;
  outputSampleRate: string;
  transferLowWatermark: string;
  transferRenderLowHits: string;
  transferDecodeLowHits: string;
};

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

type NativeDebugRobustnessPanelProps = {
  t: TranslateFn;
  robustness: AudioRobustnessSnapshot;
  robustnessMetricsView: NativeDebugRobustnessMetricsView;
  outputMetricsUnavailableLabel: string;
  formatSeconds: (value: number | null) => string;
  lastAutoSwitchLabel: string;
  diagnosticTimelineRows: string[];
  displayedRobustness: string;
};

export function NativeDebugRobustnessPanel({
  t,
  robustness,
  robustnessMetricsView,
  outputMetricsUnavailableLabel,
  formatSeconds,
  lastAutoSwitchLabel,
  diagnosticTimelineRows,
  displayedRobustness,
}: NativeDebugRobustnessPanelProps) {
  return (
    <div className="native-debug-robustness-panel">
      <div className="queue-actions">
        <div>
          <p className="section-label">{t('pages.native-debug.robustness.title')}</p>
          <h3>{t('pages.native-debug.robustness.subtitle')}</h3>
        </div>
      </div>

      <div className="native-debug-metrics-panel">
        <section className="native-debug-metrics-section">
          <p className="native-debug-metrics-section-title">
            {t('settings.audioAdvanced.monitor.section.context')}
          </p>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.backend.current')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.backend}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('settings.audioAdvanced.monitor.scheduler')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.scheduler}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.transport.mode')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.transport}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.src.backend')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.srcBackend}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('settings.audioAdvanced.monitor.quantization')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.quantization}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.monitor.output.title')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.outputMonitorStatus}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.monitor.transfer.title')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.transferMonitorStatus}</span>
          </div>
        </section>

        <div className="native-debug-metrics-divider" />

        <section className="native-debug-metrics-section">
          <p className="native-debug-metrics-section-title">
            {t('settings.audioAdvanced.monitor.section.callback')}
          </p>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.output.callbackP99')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.callbackP99}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.output.callbackJitterP99')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.callbackJitterP99}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.output.waitTimeout')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.waitTimeout}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.output.callbackOverrun')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.callbackOverrun}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.output.renderUnderrunEvents')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.outputUnderrunEvents}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.output.renderUnderrunFrames')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.outputUnderrunFrames}</span>
          </div>
        </section>

        <div className="native-debug-metrics-divider" />

        <section className="native-debug-metrics-section">
          <p className="native-debug-metrics-section-title">
            {t('settings.audioAdvanced.monitor.section.buffer')}
          </p>
          <div className="native-debug-metrics-row native-debug-metrics-row--progress">
            <span className="native-debug-metrics-label">{t('settings.audioAdvanced.monitor.bufferAhead')}</span>
            <div className="native-debug-metrics-progress-track" role="presentation">
              <div
                className="native-debug-metrics-progress-fill"
                style={{ width: `${robustnessMetricsView.bufferPercent}%` }}
              />
            </div>
            <span className="native-debug-metrics-value">{`${robustnessMetricsView.bufferPercent}%`}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.buffer.now')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.bufferNow}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.buffer.decode')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.decodeBufferNow}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.buffer.output')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.outputBufferNow}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.buffer.min')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.bufferMin}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.buffer.avg')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.bufferAvg}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('settings.audioAdvanced.monitor.bufferStatus')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.bufferStatus}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.rebuffer')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.rebuffer}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.underrun.events')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.engineUnderrunEvents}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.underrun.window')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.engineUnderrunWindow}</span>
          </div>
        </section>

        <div className="native-debug-metrics-divider" />

        <section className="native-debug-metrics-section">
          <p className="native-debug-metrics-section-title">
            {t('settings.audioAdvanced.monitor.section.transfer')}
          </p>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('settings.audioAdvanced.monitor.outputSampleRate')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.outputSampleRate}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.transfer.lowWatermark')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.transferLowWatermark}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.transfer.renderLowHits')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.transferRenderLowHits}</span>
          </div>
          <div className="native-debug-metrics-row">
            <span className="native-debug-metrics-label">{t('pages.native-debug.robustness.transfer.decodeLowHits')}</span>
            <span className="native-debug-metrics-value">{robustnessMetricsView.transferDecodeLowHits}</span>
          </div>
        </section>
      </div>

      <div className="native-debug-robustness-grid">
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.backend.current')}</p>
          <p className="device-value">
            {robustness.outputBackendId ?? t('pages.native-debug.outputBackend.default')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.backend.available')}</p>
          <p className="device-value">
            {robustness.outputBackends.length > 0
              ? robustness.outputBackends.join(', ')
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.monitor.output.title')}</p>
          <p className="device-value">{robustnessMetricsView.outputMonitorStatus}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.monitor.transfer.title')}</p>
          <p className="device-value">{robustnessMetricsView.transferMonitorStatus}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.underrun.events')}</p>
          <p className="device-value">{robustness.underrunEvents}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.underrun.frames')}</p>
          <p className="device-value">{robustness.underrunFrames}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.underrun.window')}</p>
          <p className="device-value">{robustness.underrunEventsWindow}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.recovery')}</p>
          <p className="device-value">
            {robustness.underrunRecoveryActive ? t('common.state.on') : t('common.state.off')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.transport.mode')}</p>
          <p className="device-value">{robustness.transportMode ?? t('common.state.unknown')}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.hq.phase')}</p>
          <p className="device-value">{robustness.hqSrcPhaseMode ?? t('common.state.unknown')}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.src.mode')}</p>
          <p className="device-value">{robustness.srcMode ?? t('common.state.unknown')}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.src.backend')}</p>
          <p className="device-value">{robustness.srcBackend ?? t('common.state.unknown')}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.src.targetRate')}</p>
          <p className="device-value">
            {typeof robustness.srcTargetSampleRate === 'number'
              ? `${robustness.srcTargetSampleRate} Hz`
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.dynamic.enabled')}</p>
          <p className="device-value">
            {robustness.dynamicSrcAutoEnabled ? t('common.state.on') : t('common.state.off')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.dynamic.profile')}</p>
          <p className="device-value">
            {robustness.dynamicSrcProfile ?? t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.dynamic.adaptiveEnabled')}</p>
          <p className="device-value">
            {robustness.dynamicSrcAdaptiveEnabled ? t('common.state.on') : t('common.state.off')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.dynamic.adaptiveProfile')}</p>
          <p className="device-value">
            {robustness.dynamicSrcAdaptiveProfile ?? t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.dynamic.stressScore')}</p>
          <p className="device-value">
            {typeof robustness.dynamicSrcStressScore === 'number'
              ? String(robustness.dynamicSrcStressScore)
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.dynamic.learningEnabled')}</p>
          <p className="device-value">
            {robustness.dynamicSrcLearningEnabled ? t('common.state.on') : t('common.state.off')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.dynamic.learningScale')}</p>
          <p className="device-value">
            {typeof robustness.dynamicSrcLearningScale === 'number'
              ? robustness.dynamicSrcLearningScale.toFixed(3)
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.dynamic.lastReason')}</p>
          <p className="device-value">
            {robustness.dynamicSrcLastSwitchReason ?? t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.dynamic.holdMs')}</p>
          <p className="device-value">
            {typeof robustness.dynamicSrcHoldUntilMs === 'number'
              ? `${robustness.dynamicSrcHoldUntilMs} ms`
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.dynamic.restoreDebounceMs')}</p>
          <p className="device-value">
            {typeof robustness.dynamicSrcRestoreDebounceMs === 'number'
              ? `${robustness.dynamicSrcRestoreDebounceMs} ms`
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.dynamic.minSwitchIntervalMs')}</p>
          <p className="device-value">
            {typeof robustness.dynamicSrcMinSwitchIntervalMs === 'number'
              ? `${robustness.dynamicSrcMinSwitchIntervalMs} ms`
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.dynamic.effectiveRestoreDebounceMs')}</p>
          <p className="device-value">
            {typeof robustness.dynamicSrcEffectiveRestoreDebounceMs === 'number'
              ? `${robustness.dynamicSrcEffectiveRestoreDebounceMs} ms`
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.dynamic.effectiveMinSwitchIntervalMs')}</p>
          <p className="device-value">
            {typeof robustness.dynamicSrcEffectiveMinSwitchIntervalMs === 'number'
              ? `${robustness.dynamicSrcEffectiveMinSwitchIntervalMs} ms`
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.hq.stopband')}</p>
          <p className="device-value">
            {typeof robustness.hqSrcStopbandDb === 'number'
              ? `${robustness.hqSrcStopbandDb} dB`
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.hq.active')}</p>
          <p className="device-value">
            {typeof robustness.hqSrcActive === 'boolean'
              ? robustness.hqSrcActive
                ? t('common.state.on')
                : t('common.state.off')
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.hq.ratio')}</p>
          <p className="device-value">
            {typeof robustness.hqSrcRatio === 'number' && Number.isFinite(robustness.hqSrcRatio)
              ? robustness.hqSrcRatio.toFixed(6)
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.hq.sourceRate')}</p>
          <p className="device-value">
            {typeof robustness.sourceSampleRate === 'number' &&
            Number.isFinite(robustness.sourceSampleRate) &&
            robustness.sourceSampleRate > 0
              ? `${Math.floor(robustness.sourceSampleRate)} Hz`
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.hq.outputRate')}</p>
          <p className="device-value">
            {typeof robustness.outputSampleRate === 'number' &&
            Number.isFinite(robustness.outputSampleRate) &&
            robustness.outputSampleRate > 0
              ? `${Math.floor(robustness.outputSampleRate)} Hz`
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.transport.int32')}</p>
          <p className="device-value">
            {typeof robustness.transportExactInt32Container === 'boolean'
              ? robustness.transportExactInt32Container
                ? t('common.state.on')
                : t('common.state.off')
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.protection.active')}</p>
          <p className="device-value">
            {robustness.protectionWindowActive ? t('common.state.on') : t('common.state.off')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.protection.reason')}</p>
          <p className="device-value">
            {robustness.protectionReason ?? t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.protection.refCount')}</p>
          <p className="device-value">{robustness.protectionRefCount}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.buffer.now')}</p>
          <p className="device-value">{formatSeconds(robustness.bufferedAheadSeconds)}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.buffer.decode')}</p>
          <p className="device-value">{formatSeconds(robustness.decodeBufferedAheadSeconds)}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.buffer.output')}</p>
          <p className="device-value">{formatSeconds(robustness.outputBufferedAheadSeconds)}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.buffer.min')}</p>
          <p className="device-value">{formatSeconds(robustness.bufferedAheadMinSeconds)}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.buffer.avg')}</p>
          <p className="device-value">{formatSeconds(robustness.bufferedAheadAvgSeconds)}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.rebuffer')}</p>
          <p className="device-value">{robustness.rebufferCount}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.autoSwitch.count')}</p>
          <p className="device-value">{robustness.autoSwitchCount}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.autoSwitch.last')}</p>
          <p className="device-value">{lastAutoSwitchLabel}</p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.output.callbackP99')}</p>
          <p className="device-value">
            {robustness.outputCallbackMetricsValid === true &&
            typeof robustness.outputCallbackP99Us === 'number'
              ? `${robustness.outputCallbackP99Us} us`
              : robustness.outputCallbackMetricsValid === false
                ? outputMetricsUnavailableLabel
                : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.output.waitTimeout')}</p>
          <p className="device-value">
            {robustness.outputCallbackMetricsValid === true &&
            typeof robustness.outputWaitTimeoutCount === 'number'
              ? robustness.outputWaitTimeoutCount
              : robustness.outputCallbackMetricsValid === false
                ? outputMetricsUnavailableLabel
                : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.output.renderUnderrunEvents')}</p>
          <p className="device-value">
            {robustness.outputCallbackMetricsValid === true &&
            typeof robustness.outputRenderUnderrunEvents === 'number'
              ? robustness.outputRenderUnderrunEvents
              : robustness.outputCallbackMetricsValid === false
                ? outputMetricsUnavailableLabel
                : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.output.renderUnderrunFrames')}</p>
          <p className="device-value">
            {robustness.outputCallbackMetricsValid === true &&
            typeof robustness.outputRenderUnderrunFrames === 'number'
              ? robustness.outputRenderUnderrunFrames
              : robustness.outputCallbackMetricsValid === false
                ? outputMetricsUnavailableLabel
                : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.output.callbackJitterP99')}</p>
          <p className="device-value">
            {robustness.outputCallbackMetricsValid === true &&
            typeof robustness.outputCallbackIntervalJitterP99Us === 'number'
              ? `${robustness.outputCallbackIntervalJitterP99Us} us`
              : robustness.outputCallbackMetricsValid === false
                ? outputMetricsUnavailableLabel
                : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.output.callbackOverrun')}</p>
          <p className="device-value">
            {robustness.outputCallbackMetricsValid === true &&
            typeof robustness.outputCallbackIntervalOverrunCount === 'number'
              ? robustness.outputCallbackIntervalOverrunCount
              : robustness.outputCallbackMetricsValid === false
                ? outputMetricsUnavailableLabel
                : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.output.callbackExpectedInterval')}</p>
          <p className="device-value">
            {robustness.outputCallbackMetricsValid === true &&
            typeof robustness.outputCallbackExpectedIntervalUs === 'number'
              ? `${robustness.outputCallbackExpectedIntervalUs} us`
              : robustness.outputCallbackMetricsValid === false
                ? outputMetricsUnavailableLabel
                : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.transfer.lowWatermark')}</p>
          <p className="device-value">
            {typeof robustness.transferLowWatermarkSamples === 'number'
              ? robustness.transferLowWatermarkSamples
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.transfer.renderLowHits')}</p>
          <p className="device-value">
            {typeof robustness.transferRenderLowHitCount === 'number'
              ? robustness.transferRenderLowHitCount
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.transfer.decodeLowHits')}</p>
          <p className="device-value">
            {typeof robustness.transferDecodeLowHitCount === 'number'
              ? robustness.transferDecodeLowHitCount
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.shared.enabled')}</p>
          <p className="device-value">
            {typeof robustness.sharedRenderAheadEnabled === 'boolean'
              ? robustness.sharedRenderAheadEnabled
                ? t('common.state.on')
                : t('common.state.off')
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.shared.underrunEvents')}</p>
          <p className="device-value">
            {typeof robustness.sharedRenderUnderrunEvents === 'number'
              ? robustness.sharedRenderUnderrunEvents
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.shared.underrunFrames')}</p>
          <p className="device-value">
            {typeof robustness.sharedRenderUnderrunFrames === 'number'
              ? robustness.sharedRenderUnderrunFrames
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.shared.lowHits')}</p>
          <p className="device-value">
            {typeof robustness.sharedRenderLowHitCount === 'number'
              ? robustness.sharedRenderLowHitCount
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.shared.lowWatermark')}</p>
          <p className="device-value">
            {typeof robustness.sharedRenderLowWatermarkSamples === 'number'
              ? robustness.sharedRenderLowWatermarkSamples
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.transfer.pageLock')}</p>
          <p className="device-value">
            {typeof robustness.renderQueuePageLocked === 'boolean'
              ? robustness.renderQueuePageLocked
                ? t('common.state.on')
                : t('common.state.off')
              : t('common.state.unknown')}
          </p>
        </div>
        <div className="robustness-item">
          <p className="device-label">{t('pages.native-debug.robustness.timeline.dropped')}</p>
          <p className="device-value">
            {typeof robustness.diagnosticTimelineDroppedEvents === 'number'
              ? robustness.diagnosticTimelineDroppedEvents
              : t('common.state.unknown')}
          </p>
        </div>
      </div>
      <div className="native-debug-timeline">
        <p className="device-label">{t('pages.native-debug.robustness.timeline.title')}</p>
        {diagnosticTimelineRows.length > 0 ? (
          <ul>
            {diagnosticTimelineRows.map((row, index) => (
              <li key={`${index}-${row}`}>{row}</li>
            ))}
          </ul>
        ) : (
          <p className="device-hint">{t('pages.native-debug.robustness.timeline.empty')}</p>
        )}
      </div>
      <pre className="native-debug-state">{displayedRobustness}</pre>
    </div>


  );
}
