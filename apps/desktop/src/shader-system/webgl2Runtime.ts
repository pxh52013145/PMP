import { buildWebgl2ShaderSources, type ResolvedPmpsEntryPoint } from './webgl2ShaderSource';

export type ShaderRuntimeErrorStage = 'context' | 'compile' | 'link' | 'runtime';

export type ShaderRuntimeError = {
  shaderId?: string;
  stage: ShaderRuntimeErrorStage;
  message: string;
  detail?: unknown;
};

export type DetectedUniform = {
  name: string;
  baseName: string;
  size: number;
  glType: number;
  glslType: string;
  isArray: boolean;
  isSampler: boolean;
  isReserved: boolean;
};

export type Webgl2RuntimeOptions = {
  canvas: HTMLCanvasElement;
  fragmentCode: string;
  entryPoint: ResolvedPmpsEntryPoint;
  shaderId?: string;
  fpsLimit?: number;
  resolutionScale?: number;
  getFrequencyData?: () => Uint8Array | null;
  onError?: (error: ShaderRuntimeError) => void;
};

type UniformLocations = {
  iResolution: WebGLUniformLocation | null;
  iTime: WebGLUniformLocation | null;
  iTimeDelta: WebGLUniformLocation | null;
  iFrameRate: WebGLUniformLocation | null;
  iFrame: WebGLUniformLocation | null;
  iMouse: WebGLUniformLocation | null;
  iDate: WebGLUniformLocation | null;
  iChannel0: WebGLUniformLocation | null;
  iChannel1: WebGLUniformLocation | null;
  iChannel2: WebGLUniformLocation | null;
  iChannel3: WebGLUniformLocation | null;
  iChannelResolution0: WebGLUniformLocation | null;
  iChannelTime0: WebGLUniformLocation | null;
};

type UserUniformBinding = {
  location: WebGLUniformLocation;
  glType: number;
  size: number;
};

function createShader(
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string,
  shaderId?: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (!compiled) {
    const log = gl.getShaderInfoLog(shader) ?? 'Unknown shader compilation error';
    gl.deleteShader(shader);
    throw new Error(`${shaderId ? `[${shaderId}] ` : ''}${log}`);
  }

  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
  shaderId?: string
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (!linked) {
    const log = gl.getProgramInfoLog(program) ?? 'Unknown program link error';
    gl.deleteProgram(program);
    throw new Error(`${shaderId ? `[${shaderId}] ` : ''}${log}`);
  }

  return program;
}

function create1x1Texture(gl: WebGL2RenderingContext, rgba: [number, number, number, number]): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array(rgba)
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function isReservedUniformName(name: string): boolean {
  if (name === 'iResolution') return true;
  if (name === 'iTime') return true;
  if (name === 'iTimeDelta') return true;
  if (name === 'iFrameRate') return true;
  if (name === 'iFrame') return true;
  if (name === 'iMouse') return true;
  if (name === 'iDate') return true;
  if (/^iChannel[0-3]$/.test(name)) return true;
  if (name.startsWith('iChannelResolution')) return true;
  if (name.startsWith('iChannelTime')) return true;
  return false;
}

function glslTypeName(gl: WebGL2RenderingContext, glType: number): string {
  switch (glType) {
    case gl.FLOAT:
      return 'float';
    case gl.FLOAT_VEC2:
      return 'vec2';
    case gl.FLOAT_VEC3:
      return 'vec3';
    case gl.FLOAT_VEC4:
      return 'vec4';
    case gl.INT:
      return 'int';
    case gl.INT_VEC2:
      return 'ivec2';
    case gl.INT_VEC3:
      return 'ivec3';
    case gl.INT_VEC4:
      return 'ivec4';
    case gl.BOOL:
      return 'bool';
    case gl.BOOL_VEC2:
      return 'bvec2';
    case gl.BOOL_VEC3:
      return 'bvec3';
    case gl.BOOL_VEC4:
      return 'bvec4';
    case gl.SAMPLER_2D:
      return 'sampler2D';
    case gl.SAMPLER_CUBE:
      return 'samplerCube';
    case gl.FLOAT_MAT2:
      return 'mat2';
    case gl.FLOAT_MAT3:
      return 'mat3';
    case gl.FLOAT_MAT4:
      return 'mat4';
    default:
      return `unknown(${glType})`;
  }
}

function parseHexColorToRgbaFloat(value: string): [number, number, number, number] | null {
  const match = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, a];
}

export class Webgl2ShaderRuntime {
  private readonly gl: WebGL2RenderingContext;
  private readonly shaderId?: string;
  private readonly onError?: (error: ShaderRuntimeError) => void;
  private getFrequencyData?: () => Uint8Array | null;
  private readonly fragmentCode: string;
  private readonly entryPoint: ResolvedPmpsEntryPoint;

  private program: WebGLProgram | null = null;
  private vertexShader: WebGLShader | null = null;
  private fragmentShader: WebGLShader | null = null;

  private vao: WebGLVertexArrayObject | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private fallbackTexture: WebGLTexture | null = null;
  private audioTexture: WebGLTexture | null = null;
  private audioTextureWidth = 0;
  private audioTextureHeight = 0;
  private uniforms: UniformLocations | null = null;
  private detectedUniforms: DetectedUniform[] = [];
  private userUniformBindings = new Map<string, UserUniformBinding>();
  private userUniformValues: Record<string, unknown> = {};
  private userUniformsDirty = false;

  private running = false;
  private desiredRunning = false;
  private rafId: number | null = null;

  private startAtMs = 0;
  private accumulatedTimeMs = 0;
  private lastFrameAtMs = 0;
  private frame = 0;
  private lastAudioUploadAtMs = 0;
  private readonly audioUploadMinDeltaMs = 33;

  private contextLost = false;
  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    if (this.contextLost) return;

    this.contextLost = true;
    this.report('context', new Error('WebGL context lost'));
    this.stop();

    this.program = null;
    this.vertexShader = null;
    this.fragmentShader = null;
    this.positionBuffer = null;
    this.vao = null;
    this.fallbackTexture = null;
    this.audioTexture = null;
    this.audioTextureWidth = 0;
    this.audioTextureHeight = 0;
    this.uniforms = null;
    this.detectedUniforms = [];
    this.userUniformBindings.clear();
  };

  private readonly onContextRestored = () => {
    if (!this.contextLost) return;
    this.contextLost = false;

    try {
      this.initializeProgram(this.fragmentCode, this.entryPoint);
      this.resize(this.width, this.height, { resolutionScale: this.resolutionScale });
      this.userUniformsDirty = true;
      this.applyUserUniformValues();
      if (this.desiredRunning) {
        this.start();
      }
    } catch {
      // initializeProgram already reported compile/link errors.
    }
  };

  private width = 0;
  private height = 0;
  private fpsLimit: number | undefined;
  private resolutionScale: number;
  private readonly channelResolutions = new Float32Array([
    1, 1, 1, // channel0
    1, 1, 1, // channel1
    1, 1, 1, // channel2
    1, 1, 1, // channel3
  ]);
  private readonly channelTimes = new Float32Array([0, 0, 0, 0]);

  constructor(options: Webgl2RuntimeOptions) {
    this.shaderId = options.shaderId;
    this.onError = options.onError;
    this.getFrequencyData = options.getFrequencyData;
    this.fragmentCode = options.fragmentCode;
    this.entryPoint = options.entryPoint;

    const gl = options.canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      throw new Error('WebGL2 is not available in this environment');
    }
    this.gl = gl;

    this.setFpsLimit(options.fpsLimit);
    this.resolutionScale = clampNumber(options.resolutionScale, 0.1, 2.0, 1.0);

    options.canvas.addEventListener('webglcontextlost', this.onContextLost);
    options.canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.initializeProgram(options.fragmentCode, options.entryPoint);
  }

  private report(stage: ShaderRuntimeErrorStage, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.onError?.({ shaderId: this.shaderId, stage, message, detail: error });
  }

  getDetectedUniforms(): DetectedUniform[] {
    return this.detectedUniforms;
  }

  setUserUniformValues(values: Record<string, unknown> | undefined): void {
    this.userUniformValues = values ?? {};
    this.userUniformsDirty = true;
    try {
      this.applyUserUniformValues();
    } catch (error) {
      this.report('runtime', error);
    }
  }

  private applyUserUniformValues(): void {
    if (!this.userUniformsDirty) return;

    const gl = this.gl;
    const program = this.program;
    if (!program) return;

    gl.useProgram(program);

    for (const [name, rawValue] of Object.entries(this.userUniformValues)) {
      const binding = this.userUniformBindings.get(name);
      if (!binding) continue;

      const type = binding.glType;
      const size = binding.size;
      const location = binding.location;

      if (type === gl.FLOAT && size > 1) {
        if (!Array.isArray(rawValue)) continue;
        const numbers = rawValue.map((item) => (typeof item === 'number' ? item : NaN)).slice(0, size);
        if (numbers.some((n) => Number.isNaN(n))) continue;
        gl.uniform1fv(location, new Float32Array(numbers));
        continue;
      }

      if ((type === gl.INT || type === gl.BOOL) && size > 1) {
        if (!Array.isArray(rawValue)) continue;
        const numbers = rawValue
          .map((item) => {
            if (typeof item === 'boolean') return item ? 1 : 0;
            if (typeof item === 'number' && Number.isFinite(item)) return Math.trunc(item);
            return NaN;
          })
          .slice(0, size);
        if (numbers.some((n) => Number.isNaN(n))) continue;
        gl.uniform1iv(location, new Int32Array(numbers));
        continue;
      }

      switch (type) {
        case gl.FLOAT: {
          if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
            gl.uniform1f(location, rawValue);
          } else if (typeof rawValue === 'boolean') {
            gl.uniform1f(location, rawValue ? 1 : 0);
          }
          break;
        }
        case gl.INT: {
          if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
            gl.uniform1i(location, Math.trunc(rawValue));
          } else if (typeof rawValue === 'boolean') {
            gl.uniform1i(location, rawValue ? 1 : 0);
          }
          break;
        }
        case gl.BOOL: {
          if (typeof rawValue === 'boolean') {
            gl.uniform1i(location, rawValue ? 1 : 0);
          } else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
            gl.uniform1i(location, rawValue !== 0 ? 1 : 0);
          }
          break;
        }
        case gl.FLOAT_VEC2: {
          if (!Array.isArray(rawValue) || rawValue.length < 2) break;
          const [x, y] = rawValue;
          if (typeof x !== 'number' || typeof y !== 'number') break;
          gl.uniform2f(location, x, y);
          break;
        }
        case gl.FLOAT_VEC3: {
          if (typeof rawValue === 'string') {
            const rgba = parseHexColorToRgbaFloat(rawValue);
            if (rgba) gl.uniform3f(location, rgba[0], rgba[1], rgba[2]);
            break;
          }
          if (!Array.isArray(rawValue) || rawValue.length < 3) break;
          const [x, y, z] = rawValue;
          if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') break;
          gl.uniform3f(location, x, y, z);
          break;
        }
        case gl.FLOAT_VEC4: {
          if (typeof rawValue === 'string') {
            const rgba = parseHexColorToRgbaFloat(rawValue);
            if (rgba) gl.uniform4f(location, rgba[0], rgba[1], rgba[2], rgba[3]);
            break;
          }
          if (!Array.isArray(rawValue) || rawValue.length < 4) break;
          const [x, y, z, w] = rawValue;
          if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || typeof w !== 'number') {
            break;
          }
          gl.uniform4f(location, x, y, z, w);
          break;
        }
        case gl.INT_VEC2:
        case gl.BOOL_VEC2: {
          if (!Array.isArray(rawValue) || rawValue.length < 2) break;
          const [x, y] = rawValue;
          if (typeof x !== 'number' || typeof y !== 'number') break;
          gl.uniform2i(location, Math.trunc(x), Math.trunc(y));
          break;
        }
        case gl.INT_VEC3:
        case gl.BOOL_VEC3: {
          if (!Array.isArray(rawValue) || rawValue.length < 3) break;
          const [x, y, z] = rawValue;
          if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') break;
          gl.uniform3i(location, Math.trunc(x), Math.trunc(y), Math.trunc(z));
          break;
        }
        case gl.INT_VEC4:
        case gl.BOOL_VEC4: {
          if (!Array.isArray(rawValue) || rawValue.length < 4) break;
          const [x, y, z, w] = rawValue;
          if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || typeof w !== 'number') {
            break;
          }
          gl.uniform4i(location, Math.trunc(x), Math.trunc(y), Math.trunc(z), Math.trunc(w));
          break;
        }
        default:
          break;
      }
    }

    this.userUniformsDirty = false;
  }

  private initializeProgram(fragmentCode: string, entryPoint: ResolvedPmpsEntryPoint): void {
    const gl = this.gl;
    const sources = buildWebgl2ShaderSources({ fragmentCode, entryPoint });

    try {
      const vertexShader = createShader(gl, gl.VERTEX_SHADER, sources.vertexSource, this.shaderId);
      const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, sources.fragmentSource, this.shaderId);
      const program = createProgram(gl, vertexShader, fragmentShader, this.shaderId);

      this.vertexShader = vertexShader;
      this.fragmentShader = fragmentShader;
      this.program = program;

      gl.useProgram(program);

      const vao = gl.createVertexArray();
      if (!vao) throw new Error('Failed to create VAO');
      gl.bindVertexArray(vao);

      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Failed to create buffer');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );

      const positionLocation = gl.getAttribLocation(program, 'aPosition');
      if (positionLocation >= 0) {
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      }

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      this.vao = vao;
      this.positionBuffer = buffer;

      this.fallbackTexture = create1x1Texture(gl, [0, 0, 0, 255]);

      this.uniforms = {
        iResolution: gl.getUniformLocation(program, 'iResolution'),
        iTime: gl.getUniformLocation(program, 'iTime'),
        iTimeDelta: gl.getUniformLocation(program, 'iTimeDelta'),
        iFrameRate: gl.getUniformLocation(program, 'iFrameRate'),
        iFrame: gl.getUniformLocation(program, 'iFrame'),
        iMouse: gl.getUniformLocation(program, 'iMouse'),
        iDate: gl.getUniformLocation(program, 'iDate'),
        iChannel0: gl.getUniformLocation(program, 'iChannel0'),
        iChannel1: gl.getUniformLocation(program, 'iChannel1'),
        iChannel2: gl.getUniformLocation(program, 'iChannel2'),
        iChannel3: gl.getUniformLocation(program, 'iChannel3'),
        iChannelResolution0: gl.getUniformLocation(program, 'iChannelResolution[0]'),
        iChannelTime0: gl.getUniformLocation(program, 'iChannelTime[0]'),
      };

      this.bindFallbackChannels();
      this.setFallbackChannelMetadata();

      this.collectDetectedUniforms();
      this.userUniformsDirty = true;
      this.applyUserUniformValues();
    } catch (error) {
      this.report('compile', error);
      throw error;
    }
  }

  private collectDetectedUniforms(): void {
    const gl = this.gl;
    const program = this.program;
    if (!program) return;

    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    const detected: DetectedUniform[] = [];
    const bindings = new Map<string, UserUniformBinding>();

    for (let i = 0; i < count; i += 1) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;

      const name = info.name;
      const baseName = name.replace(/\[0\]$/, '');
      const glType = info.type;
      const glslType = glslTypeName(gl, glType);
      const isArray = info.size > 1 || name.endsWith('[0]');
      const isSampler = glType === gl.SAMPLER_2D || glType === gl.SAMPLER_CUBE;
      const isReserved = isReservedUniformName(baseName);

      detected.push({
        name,
        baseName,
        size: info.size,
        glType,
        glslType,
        isArray,
        isSampler,
        isReserved,
      });

      if (isReserved || isSampler) continue;

      const location = gl.getUniformLocation(program, name);
      if (!location) continue;

      const binding: UserUniformBinding = { location, glType, size: info.size };
      bindings.set(name, binding);
      if (name.endsWith('[0]')) {
        bindings.set(baseName, binding);
      }
    }

    this.detectedUniforms = detected;
    this.userUniformBindings = bindings;
  }

  private bindFallbackChannels(): void {
    const gl = this.gl;
    const program = this.program;
    const uniforms = this.uniforms;
    const texture = this.fallbackTexture;
    if (!program || !uniforms || !texture) return;

    gl.useProgram(program);

    const bindSampler = (unit: number, location: WebGLUniformLocation | null) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (location) gl.uniform1i(location, unit);
    };

    bindSampler(0, uniforms.iChannel0);
    bindSampler(1, uniforms.iChannel1);
    bindSampler(2, uniforms.iChannel2);
    bindSampler(3, uniforms.iChannel3);

    gl.activeTexture(gl.TEXTURE0);
  }

  private setFallbackChannelMetadata(): void {
    const gl = this.gl;
    const program = this.program;
    const uniforms = this.uniforms;
    if (!program || !uniforms) return;

    if (uniforms.iChannelResolution0) {
      gl.uniform3fv(uniforms.iChannelResolution0, this.channelResolutions);
    }
    if (uniforms.iChannelTime0) {
      gl.uniform1fv(uniforms.iChannelTime0, this.channelTimes);
    }
  }

  setFrequencyDataProvider(provider?: () => Uint8Array | null): void {
    this.getFrequencyData = provider;
  }

  setFpsLimit(limit?: number): void {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
      this.fpsLimit = undefined;
      return;
    }
    this.fpsLimit = Math.max(1, Math.min(240, limit));
  }

  setActive(active: boolean): void {
    this.desiredRunning = active;
    if (active) {
      this.start();
    } else {
      this.stop();
    }
  }

  private ensureAudioTexture(width: number, height: number): WebGLTexture {
    const gl = this.gl;
    const existing = this.audioTexture;

    if (existing && this.audioTextureWidth === width && this.audioTextureHeight === height) {
      return existing;
    }

    if (existing) {
      gl.deleteTexture(existing);
    }

    const texture = gl.createTexture();
    if (!texture) {
      throw new Error('Failed to create audio texture');
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      width,
      height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      new Uint8Array(width * height)
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.audioTexture = texture;
    this.audioTextureWidth = width;
    this.audioTextureHeight = height;

    return texture;
  }

  private updateAudioChannel(nowMs: number, timeSeconds: number): void {
    const gl = this.gl;
    const program = this.program;
    const uniforms = this.uniforms;
    const getFrequencyData = this.getFrequencyData;
    if (!program || !uniforms || !getFrequencyData) return;

    if (nowMs - this.lastAudioUploadAtMs < this.audioUploadMinDeltaMs) return;
    this.lastAudioUploadAtMs = nowMs;

    const data = getFrequencyData();
    if (!data || data.length === 0) return;

    const width = data.length;
    const height = 1;
    const texture = this.ensureAudioTexture(width, height);

    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, data);

    if (uniforms.iChannel0) {
      gl.uniform1i(uniforms.iChannel0, 0);
    }

    this.channelResolutions[0] = width;
    this.channelResolutions[1] = height;
    this.channelResolutions[2] = 1;
    this.channelTimes[0] = timeSeconds;

    if (uniforms.iChannelResolution0) {
      gl.uniform3fv(uniforms.iChannelResolution0, this.channelResolutions);
    }
    if (uniforms.iChannelTime0) {
      gl.uniform1fv(uniforms.iChannelTime0, this.channelTimes);
    }

  }

  resize(width: number, height: number, options: { resolutionScale?: number } = {}): void {
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
    if (typeof options.resolutionScale === 'number') {
      this.resolutionScale = clampNumber(options.resolutionScale, 0.1, 2.0, this.resolutionScale);
    }

    if (this.contextLost) return;

    const gl = this.gl;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const targetWidth = Math.max(1, Math.floor(this.width * dpr * this.resolutionScale));
    const targetHeight = Math.max(1, Math.floor(this.height * dpr * this.resolutionScale));

    const canvas = gl.canvas as HTMLCanvasElement;
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    gl.viewport(0, 0, targetWidth, targetHeight);
  }

  start(): void {
    if (this.running) return;
    if (this.contextLost) return;
    if (!this.program || !this.uniforms || !this.vao) return;

    this.running = true;
    const now = performance.now();
    this.startAtMs = now - this.accumulatedTimeMs;
    this.lastFrameAtMs = now;

    const loop = (now: number) => {
      if (!this.running) return;

      const minDeltaMs = this.fpsLimit ? 1000 / this.fpsLimit : 0;
      const sinceLast = now - this.lastFrameAtMs;
      if (minDeltaMs > 0 && sinceLast < minDeltaMs) {
        this.rafId = requestAnimationFrame(loop);
        return;
      }

      const deltaMs = Math.max(0, Math.min(250, sinceLast));
      this.lastFrameAtMs = now;
      this.frame += 1;

      try {
        this.drawFrame(now, deltaMs);
      } catch (error) {
        this.report('runtime', error);
        this.stop();
        return;
      }

      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (!this.running) return;
    this.accumulatedTimeMs = Math.max(0, performance.now() - this.startAtMs);
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  dispose(): void {
    this.stop();

    const gl = this.gl;
    const canDelete = !this.contextLost && !gl.isContextLost?.();
    if (canDelete) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vertexShader) gl.deleteShader(this.vertexShader);
      if (this.fragmentShader) gl.deleteShader(this.fragmentShader);
      if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.fallbackTexture) gl.deleteTexture(this.fallbackTexture);
      if (this.audioTexture) gl.deleteTexture(this.audioTexture);
    }

    (gl.canvas as HTMLCanvasElement).removeEventListener('webglcontextlost', this.onContextLost);
    (gl.canvas as HTMLCanvasElement).removeEventListener('webglcontextrestored', this.onContextRestored);

    this.program = null;
    this.vertexShader = null;
    this.fragmentShader = null;
    this.positionBuffer = null;
    this.vao = null;
    this.fallbackTexture = null;
    this.audioTexture = null;
    this.uniforms = null;
    this.detectedUniforms = [];
    this.userUniformBindings.clear();
    this.userUniformValues = {};
    this.userUniformsDirty = false;
    this.accumulatedTimeMs = 0;
  }

  private drawFrame(nowMs: number, deltaMs: number): void {
    const gl = this.gl;
    const program = this.program;
    const vao = this.vao;
    const uniforms = this.uniforms;
    if (!program || !vao || !uniforms) return;

    if (this.contextLost) return;
    if (this.width <= 0 || this.height <= 0) return;

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    const timeSeconds = (nowMs - this.startAtMs) / 1000;
    const deltaSeconds = deltaMs / 1000;
    const frameRate = deltaSeconds > 0 ? 1 / deltaSeconds : 0;

    this.updateAudioChannel(nowMs, timeSeconds);
    this.applyUserUniformValues();

    if (uniforms.iResolution) {
      const canvas = gl.canvas as HTMLCanvasElement;
      gl.uniform3f(uniforms.iResolution, canvas.width, canvas.height, 1);
    }
    if (uniforms.iTime) gl.uniform1f(uniforms.iTime, timeSeconds);
    if (uniforms.iTimeDelta) gl.uniform1f(uniforms.iTimeDelta, deltaSeconds);
    if (uniforms.iFrameRate) gl.uniform1f(uniforms.iFrameRate, frameRate);
    if (uniforms.iFrame) gl.uniform1i(uniforms.iFrame, this.frame);
    if (uniforms.iMouse) gl.uniform4f(uniforms.iMouse, 0, 0, 0, 0);
    if (uniforms.iDate) {
      const date = new Date();
      const seconds =
        date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000;
      gl.uniform4f(uniforms.iDate, date.getFullYear(), date.getMonth() + 1, date.getDate(), seconds);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }
}
