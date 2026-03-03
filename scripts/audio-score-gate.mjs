import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const defaultConfigPath = path.join(repoRoot, 'design', 'audio-score-gate-baseline.json');

function parseArgs(argv) {
  const options = {
    configPath: defaultConfigPath,
    profile: 'baseline',
    withSmoke: false,
    requireSmoke: false,
    smokeTrack: null,
    cargoTargetDir: null,
    skipQuality: false,
    skipPerformance: false,
    dryRun: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--config': {
        options.configPath = resolveArgValue(arg, argv[++index]);
        break;
      }
      case '--profile': {
        options.profile = resolveArgValue(arg, argv[++index]);
        break;
      }
      case '--with-smoke': {
        options.withSmoke = true;
        break;
      }
      case '--require-smoke': {
        options.withSmoke = true;
        options.requireSmoke = true;
        break;
      }
      case '--smoke-track': {
        options.smokeTrack = resolveArgValue(arg, argv[++index]);
        break;
      }
      case '--cargo-target-dir': {
        options.cargoTargetDir = resolveArgValue(arg, argv[++index]);
        break;
      }
      case '--skip-quality': {
        options.skipQuality = true;
        break;
      }
      case '--skip-performance': {
        options.skipPerformance = true;
        break;
      }
      case '--dry-run': {
        options.dryRun = true;
        break;
      }
      case '--json': {
        options.json = true;
        break;
      }
      case '--help': {
        printHelp();
        process.exit(0);
      }
      default: {
        throw new Error(`Unknown argument: ${arg}`);
      }
    }
  }

  return options;
}

function resolveArgValue(flag, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelp() {
  console.log([
    'Audio Score Gate',
    '',
    'Usage:',
    '  node scripts/audio-score-gate.mjs [options]',
    '',
    'Options:',
    '  --config <path>         Gate config file path',
    '  --profile <name>        Profile in config (default: baseline)',
    '  --with-smoke            Run hardware smoke and parse runtime metrics',
    '  --require-smoke         Fail when smoke cannot run',
    '  --smoke-track <path>    Track path for smoke mode',
    '  env PMP_AUDIO_SMOKE_TRACK Preferred smoke track when flag is omitted',
    '  --cargo-target-dir <p>  Cargo target dir override for gate commands',
    '  --skip-quality          Skip quality command suite',
    '  --skip-performance      Skip performance command suite',
    '  --dry-run               Print commands without executing them',
    '  --json                  Print report JSON after summary',
  ].join('\n'));
}

function resolveSpawnEnv(extraEnv) {
  if (!extraEnv || typeof extraEnv !== 'object') {
    return process.env;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(extraEnv)) {
    if (typeof value === 'undefined' || value === null) continue;
    normalized[key] = String(value);
  }

  return {
    ...process.env,
    ...normalized,
  };
}

function resolveCargoTargetDir(options, config) {
  const optionValue = options.cargoTargetDir;
  if (typeof optionValue === 'string' && optionValue.trim().length > 0) {
    return path.resolve(repoRoot, optionValue);
  }

  const configValue = config?.execution?.cargoTargetDir;
  if (typeof configValue === 'string' && configValue.trim().length > 0) {
    return path.resolve(repoRoot, configValue);
  }

  return null;
}

function attachCargoTargetEnvToShellCommand(command, cargoTargetDir) {
  if (!cargoTargetDir) return command;
  if (typeof command?.command !== 'string') return command;

  const raw = command.command.trim();
  if (!raw.startsWith('cargo ')) {
    return command;
  }

  return {
    ...command,
    env: {
      ...(command.env ?? {}),
      CARGO_TARGET_DIR: cargoTargetDir,
    },
  };
}

function readConfig(configPathInput) {
  const configPath = path.isAbsolute(configPathInput)
    ? configPathInput
    : path.resolve(repoRoot, configPathInput);
  const raw = fs.readFileSync(configPath, 'utf8');
  return {
    configPath,
    config: JSON.parse(raw),
  };
}

function runShellCommand(spec, options) {
  const cwd = path.resolve(repoRoot, spec.cwd ?? '.');
  const timeoutMs = Number.isFinite(spec.timeoutMs) ? spec.timeoutMs : 0;
  const startedAt = Date.now();

  if (options.dryRun) {
    console.log(`[dry-run] ${spec.id}: ${spec.command}`);
    return {
      id: spec.id,
      command: spec.command,
      cwd,
      ok: true,
      skipped: true,
      durationMs: 0,
      stdout: '',
      stderr: '',
      exitCode: 0,
    };
  }

  console.log(`\n==> ${spec.id}`);
  console.log(`$ ${spec.command}`);

  const result = spawnSync(spec.command, {
    cwd,
    shell: true,
    env: resolveSpawnEnv(spec.env),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });

  const durationMs = Date.now() - startedAt;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const output = [stdout, stderr].filter(Boolean).join('\n').trim();
  if (output) {
    console.log(output);
  }

  const hasError = Boolean(result.error);
  const exitCode = hasError ? 1 : (result.status ?? 0);
  const ok = !hasError && exitCode === 0;

  return {
    id: spec.id,
    command: spec.command,
    cwd,
    ok,
    skipped: false,
    durationMs,
    stdout,
    stderr,
    exitCode,
    error: hasError ? String(result.error?.message ?? result.error) : null,
  };
}

function runExecCommand(spec, options) {
  const cwd = path.resolve(repoRoot, spec.cwd ?? '.');
  const timeoutMs = Number.isFinite(spec.timeoutMs) ? spec.timeoutMs : 0;
  const startedAt = Date.now();
  const argsRendered = (spec.args ?? []).map((arg) => shellQuote(arg)).join(' ');
  const renderedCommand = `${spec.exec} ${argsRendered}`.trim();

  if (options.dryRun) {
    console.log(`[dry-run] ${spec.id}: ${renderedCommand}`);
    return {
      id: spec.id,
      command: renderedCommand,
      cwd,
      ok: true,
      skipped: true,
      durationMs: 0,
      stdout: '',
      stderr: '',
      exitCode: 0,
    };
  }

  console.log(`\n==> ${spec.id}`);
  console.log(`$ ${renderedCommand}`);

  const result = spawnSync(spec.exec, spec.args ?? [], {
    cwd,
    env: resolveSpawnEnv(spec.env),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });

  const durationMs = Date.now() - startedAt;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const output = [stdout, stderr].filter(Boolean).join('\n').trim();
  if (output) {
    console.log(output);
  }

  const hasError = Boolean(result.error);
  const exitCode = hasError ? 1 : (result.status ?? 0);
  const ok = !hasError && exitCode === 0;

  return {
    id: spec.id,
    command: renderedCommand,
    cwd,
    ok,
    skipped: false,
    durationMs,
    stdout,
    stderr,
    exitCode,
    error: hasError ? String(result.error?.message ?? result.error) : null,
  };
}

function shellQuote(value) {
  if (/^[\w./:-]+$/.test(value)) {
    return value;
  }
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function countFileLines(relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const text = fs.readFileSync(absolutePath, 'utf8');
  if (text.length === 0) {
    return 0;
  }
  return text.split(/\r?\n/).length;
}

function scoreLowerIsBetter(value, targetMax, hardMax, minimumScore = 5.0) {
  if (value <= targetMax) {
    return 10;
  }
  if (value >= hardMax) {
    return minimumScore;
  }
  const ratio = (value - targetMax) / (hardMax - targetMax);
  return 10 - ratio * (10 - minimumScore);
}

function scoreHigherIsBetter(value, targetMin, hardMin, minimumScore = 5.0) {
  if (value >= targetMin) {
    return 10;
  }
  if (value <= hardMin) {
    return minimumScore;
  }
  const ratio = (value - hardMin) / (targetMin - hardMin);
  return minimumScore + ratio * (10 - minimumScore);
}

function clampScore(score) {
  return Math.max(0, Math.min(10, score));
}

function roundScore(score) {
  return Math.round(score * 100) / 100;
}

function weightedAverage(items) {
  if (!items.length) {
    return 0;
  }
  const weightSum = items.reduce((sum, item) => sum + item.weight, 0);
  if (weightSum <= 0) {
    return items.reduce((sum, item) => sum + item.score, 0) / items.length;
  }
  return items.reduce((sum, item) => sum + item.score * item.weight, 0) / weightSum;
}

function evaluateDecoupling(decouplingConfig) {
  const metricScores = [];
  const metrics = [];

  for (const budget of decouplingConfig.sizeBudgets ?? []) {
    const lines = countFileLines(budget.path);
    const score = clampScore(
      scoreLowerIsBetter(lines, budget.targetLines, budget.maxLines, budget.minimumScore ?? 5.0),
    );
    metricScores.push({ score, weight: budget.weight ?? 1 });
    metrics.push({
      metric: `file_lines:${budget.path}`,
      value: lines,
      score: roundScore(score),
      target: budget.targetLines,
      max: budget.maxLines,
    });
  }

  if (decouplingConfig.moduleBudget) {
    const moduleBudget = decouplingConfig.moduleBudget;
    const targetDir = path.resolve(repoRoot, moduleBudget.dir);
    const includeRegex = new RegExp(moduleBudget.includePattern);
    const excludes = new Set(moduleBudget.exclude ?? []);
    const moduleCount = fs
      .readdirSync(targetDir)
      .filter((name) => includeRegex.test(name) && !excludes.has(name)).length;

    const score = clampScore(
      scoreHigherIsBetter(
        moduleCount,
        moduleBudget.targetCount,
        moduleBudget.minCount,
        moduleBudget.minimumScore ?? 5.0,
      ),
    );
    metricScores.push({ score, weight: moduleBudget.weight ?? 1 });
    metrics.push({
      metric: `module_count:${moduleBudget.dir}`,
      value: moduleCount,
      score: roundScore(score),
      target: moduleBudget.targetCount,
      min: moduleBudget.minCount,
    });
  }

  const score = roundScore(weightedAverage(metricScores));
  return {
    score,
    metrics,
  };
}

function runCommandSuite(commands, options, execution) {
  const results = [];
  for (const command of commands ?? []) {
    const prepared = attachCargoTargetEnvToShellCommand(command, execution.cargoTargetDir);
    results.push(runShellCommand(prepared, options));
  }
  return results;
}

function evaluateCommandDimension(config, options, execution) {
  const results = runCommandSuite(config.commands ?? [], options, execution);
  const failedCount = results.filter((item) => !item.ok).length;
  const score = clampScore(
    (config.baseScore ?? 10) - failedCount * (config.failedCommandPenalty ?? 1.5),
  );

  return {
    score: roundScore(score),
    commands: results,
    failedCount,
  };
}

function parseLastNativeAudioState(rawOutput) {
  const prefix = 'native_audio_state:';
  const lines = rawOutput.split(/\r?\n/);
  let latest = null;
  for (const line of lines) {
    const index = line.indexOf(prefix);
    if (index < 0) {
      continue;
    }
    const jsonText = line.slice(index + prefix.length).trim();
    if (!jsonText.startsWith('{')) {
      continue;
    }
    try {
      latest = JSON.parse(jsonText);
    } catch {
      // ignore malformed lines
    }
  }
  return latest;
}

function evaluateStateMetrics(state, metricsConfig) {
  if (!state || !Array.isArray(metricsConfig) || metricsConfig.length === 0) {
    return null;
  }

  const weighted = [];
  const details = [];

  for (const metric of metricsConfig) {
    const rawValue = state[metric.field];
    if (typeof rawValue !== 'number' || Number.isNaN(rawValue)) {
      continue;
    }

    const score = clampScore(
      scoreLowerIsBetter(
        rawValue,
        metric.targetMax,
        metric.hardMax,
        metric.minimumScore ?? 5.0,
      ),
    );
    weighted.push({ score, weight: metric.weight ?? 1 });
    details.push({
      metric: metric.field,
      value: rawValue,
      score: roundScore(score),
      target: metric.targetMax,
      max: metric.hardMax,
    });
  }

  if (weighted.length === 0) {
    return null;
  }

  return {
    score: roundScore(weightedAverage(weighted)),
    metrics: details,
  };
}

function resolveSmokeTrackCandidate(trackInput) {
  if (typeof trackInput !== 'string') return null;
  const trimmed = trackInput.trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(repoRoot, trimmed);
}

function writeDeterministicSmokeWav(filePath) {
  const sampleRate = 48_000;
  const channels = 2;
  const bitsPerSample = 16;
  const durationMs = 2_000;
  const frameCount = Math.max(1, Math.floor((sampleRate * durationMs) / 1_000));
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = frameCount * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  buffer.write('RIFF', offset);
  offset += 4;
  buffer.writeUInt32LE(totalSize - 8, offset);
  offset += 4;
  buffer.write('WAVE', offset);
  offset += 4;

  buffer.write('fmt ', offset);
  offset += 4;
  buffer.writeUInt32LE(16, offset);
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(channels, offset);
  offset += 2;
  buffer.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buffer.writeUInt32LE(byteRate, offset);
  offset += 4;
  buffer.writeUInt16LE(blockAlign, offset);
  offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset);
  offset += 2;

  buffer.write('data', offset);
  offset += 4;
  buffer.writeUInt32LE(dataSize, offset);
  offset += 4;

  const amplitude = 0.35;
  const invSampleRate = 1 / sampleRate;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const t = frame * invSampleRate;
    const env = Math.min(1, frame / (sampleRate * 0.04));
    const base =
      amplitude * env * (Math.sin(2 * Math.PI * 440 * t) * 0.75 + Math.sin(2 * Math.PI * 660 * t) * 0.25);
    const left = Math.max(-1, Math.min(1, base));
    const right = Math.max(-1, Math.min(1, base * 0.92));
    buffer.writeInt16LE(Math.round(left * 32767), offset);
    offset += 2;
    buffer.writeInt16LE(Math.round(right * 32767), offset);
    offset += 2;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

function ensureDeterministicSmokeTrack() {
  const generatedPath = path.resolve(repoRoot, 'tmp', 'audio-smoke-reference.wav');
  try {
    if (!fs.existsSync(generatedPath)) {
      writeDeterministicSmokeWav(generatedPath);
    }
    return generatedPath;
  } catch {
    return null;
  }
}

function resolveSmokeTrackPath(smokeTrack, smokeConfig = {}) {
  const cliCandidate = resolveSmokeTrackCandidate(smokeTrack);
  if (cliCandidate && fs.existsSync(cliCandidate)) return cliCandidate;

  const envCandidate = resolveSmokeTrackCandidate(process.env.PMP_AUDIO_SMOKE_TRACK ?? null);
  if (envCandidate && fs.existsSync(envCandidate)) return envCandidate;

  const configCandidate = resolveSmokeTrackCandidate(smokeConfig.track ?? null);
  if (configCandidate && fs.existsSync(configCandidate)) return configCandidate;

  const defaultTrack = path.resolve(repoRoot, 'Eagles_Hotel_California.flac');
  if (fs.existsSync(defaultTrack)) return defaultTrack;

  return ensureDeterministicSmokeTrack();
}

function runSmoke(config, options, execution) {
  const smokeConfig = config.smoke ?? {};
  const trackPath = resolveSmokeTrackPath(options.smokeTrack, smokeConfig);
  if (!trackPath || !fs.existsSync(trackPath)) {
    return {
      skipped: true,
      reason: 'track-not-found',
      trackPath,
      result: null,
      state: null,
      stateMetrics: null,
    };
  }

  const args = [
    'run',
    '--quiet',
    '--manifest-path',
    'apps/desktop/src-tauri/Cargo.toml',
    '--',
    '--audio-smoke',
    '--path',
    trackPath,
    '--play-ms',
    String(smokeConfig.playMs ?? 1200),
    '--seek-count',
    String(smokeConfig.seekCount ?? 2),
    '--seek-seconds',
    String(smokeConfig.seekSeconds ?? 6),
  ];

  if (Number.isFinite(smokeConfig.maxUnderrunEvents)) {
    args.push('--max-underrun-events', String(smokeConfig.maxUnderrunEvents));
  }
  if (Number.isFinite(smokeConfig.maxUnderrunFrames)) {
    args.push('--max-underrun-frames', String(smokeConfig.maxUnderrunFrames));
  }
  if (Number.isFinite(smokeConfig.maxOutputWaitTimeoutCount)) {
    args.push(
      '--max-output-wait-timeout-count',
      String(smokeConfig.maxOutputWaitTimeoutCount),
    );
  }
  if (Number.isFinite(smokeConfig.maxOutputCallbackJitterP99Us)) {
    args.push(
      '--max-output-callback-jitter-p99-us',
      String(smokeConfig.maxOutputCallbackJitterP99Us),
    );
  }
  if (Number.isFinite(smokeConfig.maxControlQueueCriticalOverflowEvents)) {
    args.push(
      '--max-control-queue-critical-overflow-events',
      String(smokeConfig.maxControlQueueCriticalOverflowEvents),
    );
  }

  const result = runExecCommand(
    {
      id: 'audio-smoke',
      exec: 'cargo',
      args,
      cwd: '.',
      timeoutMs: smokeConfig.timeoutMs ?? 12 * 60 * 1000,
      env: execution.cargoTargetDir
        ? { CARGO_TARGET_DIR: execution.cargoTargetDir }
        : undefined,
    },
    options,
  );

  const mergedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const state = parseLastNativeAudioState(mergedOutput);
  const stateMetrics = evaluateStateMetrics(state, config.stateMetrics ?? []);

  return {
    skipped: false,
    reason: null,
    trackPath,
    result,
    state,
    stateMetrics,
  };
}

function evaluatePerformance(perfConfig, options, execution) {
  const commandDimension = evaluateCommandDimension(perfConfig, options, execution);
  let smoke = {
    skipped: true,
    reason: 'smoke-disabled',
    trackPath: null,
    result: null,
    state: null,
    stateMetrics: null,
  };

  if (options.withSmoke) {
    smoke = runSmoke(perfConfig, options, execution);
  }

  if (options.withSmoke && options.requireSmoke && smoke.skipped) {
    commandDimension.failedCount += 1;
    commandDimension.score = clampScore(
      (perfConfig.baseScore ?? 10) - commandDimension.failedCount * (perfConfig.failedCommandPenalty ?? 1.5),
    );
  }

  const smokeFailed = options.withSmoke && !smoke.skipped && smoke.result && !smoke.result.ok;
  const commandScoreAfterSmokePenalty = clampScore(
    commandDimension.score - (smokeFailed ? (perfConfig.failedCommandPenalty ?? 1.5) : 0),
  );

  const stateScore = smoke.stateMetrics?.score;
  const shouldBlendState = typeof stateScore === 'number';
  const score = shouldBlendState
    ? commandScoreAfterSmokePenalty * (perfConfig.commandScoreWeight ?? 0.7) +
      stateScore * (perfConfig.stateScoreWeight ?? 0.3)
    : commandScoreAfterSmokePenalty;

  return {
    score: roundScore(clampScore(score)),
    commands: commandDimension.commands,
    failedCount: commandDimension.failedCount,
    smoke,
  };
}

function evaluateGate(scores, baselineScores, profile) {
  const checks = [];
  const dimensionKeys = ['decoupling', 'quality', 'performance', 'overall'];
  const tolerance = profile.regressionTolerance ?? 0;

  for (const key of dimensionKeys) {
    const currentScore = scores[key];
    const floor = profile.floors?.[key];
    if (typeof floor === 'number' && currentScore < floor) {
      checks.push({
        kind: 'floor',
        key,
        pass: false,
        message: `${key} score ${currentScore.toFixed(2)} is below floor ${floor.toFixed(2)}`,
      });
    } else {
      checks.push({
        kind: 'floor',
        key,
        pass: true,
        message:
          typeof floor === 'number'
            ? `${key} floor ${floor.toFixed(2)} passed`
            : `${key} floor check skipped`,
      });
    }

    const baseline = baselineScores?.[key];
    if (typeof baseline === 'number') {
      const pass = currentScore + tolerance >= baseline;
      checks.push({
        kind: 'regression',
        key,
        pass,
        message: pass
          ? `${key} regression check passed (current ${currentScore.toFixed(2)}, baseline ${baseline.toFixed(
              2,
            )}, tolerance ${tolerance.toFixed(2)})`
          : `${key} regressed (current ${currentScore.toFixed(2)}, baseline ${baseline.toFixed(
              2,
            )}, tolerance ${tolerance.toFixed(2)})`,
      });
    }
  }

  const failedChecks = checks.filter((check) => !check.pass);
  return {
    pass: failedChecks.length === 0,
    checks,
    failedChecks,
  };
}

function printCommandResults(label, commands) {
  if (!commands.length) {
    console.log(`- ${label}: no commands`);
    return;
  }
  for (const command of commands) {
    const status = command.ok ? 'PASS' : command.skipped ? 'SKIP' : 'FAIL';
    console.log(
      `- ${label}/${command.id}: ${status} (${(command.durationMs / 1000).toFixed(2)}s) [exit=${command.exitCode}]`,
    );
  }
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const { configPath, config } = readConfig(options.configPath);
  const profile = config.profiles?.[options.profile];
  if (!profile) {
    throw new Error(`Unknown profile '${options.profile}' in ${configPath}`);
  }

  const requireSmokeInCi = config?.execution?.requireSmokeInCi === true;
  if (process.env.CI && requireSmokeInCi) {
    options.withSmoke = true;
    options.requireSmoke = true;
  }

  console.log(`Audio Score Gate`);
  console.log(`- config: ${path.relative(repoRoot, configPath)}`);
  console.log(`- profile: ${options.profile}`);
  console.log(`- withSmoke: ${options.withSmoke}`);
  console.log(`- requireSmoke: ${options.requireSmoke}`);

  const execution = {
    cargoTargetDir: resolveCargoTargetDir(options, config),
  };
  if (execution.cargoTargetDir) {
    console.log(`- cargoTargetDir: ${path.relative(repoRoot, execution.cargoTargetDir)}`);
  }

  const decoupling = evaluateDecoupling(config.decoupling ?? {});
  const quality = options.skipQuality
    ? { score: 10, commands: [], failedCount: 0, skipped: true }
    : evaluateCommandDimension(config.quality ?? {}, options, execution);
  const performance = options.skipPerformance
    ? {
        score: 10,
        commands: [],
        failedCount: 0,
        skipped: true,
        smoke: {
          skipped: true,
          reason: 'performance-skipped',
          trackPath: null,
          result: null,
          state: null,
          stateMetrics: null,
        },
      }
    : evaluatePerformance(config.performance ?? {}, options, execution);

  const weights = config.weights ?? { decoupling: 0.35, quality: 0.35, performance: 0.3 };
  const overall = roundScore(
    decoupling.score * (weights.decoupling ?? 0.35) +
      quality.score * (weights.quality ?? 0.35) +
      performance.score * (weights.performance ?? 0.3),
  );

  const scores = {
    decoupling: decoupling.score,
    quality: quality.score,
    performance: performance.score,
    overall,
  };

  const gate = evaluateGate(scores, config.baselineScores ?? {}, profile);

  console.log('\nScores');
  console.log(`- decoupling: ${scores.decoupling.toFixed(2)}`);
  console.log(`- quality: ${scores.quality.toFixed(2)}`);
  console.log(`- performance: ${scores.performance.toFixed(2)}`);
  console.log(`- overall: ${scores.overall.toFixed(2)}`);

  console.log('\nDecoupling metrics');
  for (const metric of decoupling.metrics) {
    console.log(
      `- ${metric.metric}: value=${metric.value}, score=${metric.score.toFixed(2)} (target=${metric.target ?? '-'}, max=${metric.max ?? '-'}, min=${metric.min ?? '-'})`,
    );
  }

  console.log('\nCommand results');
  printCommandResults('quality', quality.commands ?? []);
  printCommandResults('performance', performance.commands ?? []);
  if (!options.skipPerformance && performance.smoke) {
    if (performance.smoke.skipped) {
      console.log(`- performance/smoke: SKIP (${performance.smoke.reason})`);
    } else if (performance.smoke.result) {
      const status = performance.smoke.result.ok ? 'PASS' : 'FAIL';
      console.log(
        `- performance/smoke: ${status} (${(performance.smoke.result.durationMs / 1000).toFixed(2)}s) track=${performance.smoke.trackPath}`,
      );
      if (performance.smoke.stateMetrics) {
        for (const metric of performance.smoke.stateMetrics.metrics ?? []) {
          console.log(
            `  - smoke/${metric.metric}: value=${metric.value}, score=${metric.score.toFixed(2)} (target=${metric.target}, max=${metric.max})`,
          );
        }
      }
    }
  }

  console.log('\nGate checks');
  for (const check of gate.checks) {
    console.log(`- ${check.pass ? 'PASS' : 'FAIL'} ${check.kind}/${check.key}: ${check.message}`);
  }

  const report = {
    timestamp: new Date().toISOString(),
    options: {
      profile: options.profile,
      withSmoke: options.withSmoke,
      requireSmoke: options.requireSmoke,
      cargoTargetDir: options.cargoTargetDir,
      skipQuality: options.skipQuality,
      skipPerformance: options.skipPerformance,
      dryRun: options.dryRun,
    },
    configPath,
    scores,
    decoupling,
    quality,
    performance,
    gate,
  };

  if (options.json) {
    console.log('\nReport JSON');
    console.log(JSON.stringify(report, null, 2));
  }

  if (!gate.pass) {
    console.error(`\nAudio Score Gate failed (${gate.failedChecks.length} checks).`);
    process.exit(1);
  }

  console.log('\nAudio Score Gate passed.');
}

try {
  run();
} catch (error) {
  console.error(`Audio Score Gate error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
