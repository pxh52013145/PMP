import { useMemo, useState } from 'react';
import type { PmpsManifest, PmpsUniformDefinition } from '../../shader-system/pmps';
import {
  installPmpsShaderPackFromFile,
  uninstallPmpsShaderPack,
} from '../../shader-system/pmps';
import {
  removePmpsMagnetShaderBinding,
  upsertPmpsMagnetShaderBinding,
} from '../../shader-system/pmpsMagnetShaderBindings';
import {
  removePmpsMagnetUniformOverrides,
  resolvePmpsUniformValues,
  setPmpsMagnetUniformValue,
} from '../../shader-system/pmpsMagnetUniforms';
import { clearPmpsShaderFuse } from '../../shader-system/pmpsShaderFuse';
import { PmpsShaderLayer } from '../../shader-system/PmpsShaderLayer';
import type { DetectedUniform } from '../../shader-system/webgl2Runtime';
import { usePmpsMagnetShaderBinding } from '../../shader-system/usePmpsMagnetShaderBinding';
import { usePmpsMagnetUniformOverrides } from '../../shader-system/usePmpsMagnetUniformOverrides';
import { usePmpsShaderFuse } from '../../shader-system/usePmpsShaderFuse';
import { useInstalledPmpsShaderPack, useInstalledPmpsShaderPacks } from '../../shader-system/usePmpsShaderPacks';
import './ShaderDebugPanel.css';

export type ShaderDebugPanelProps = {
  magnetId: string;
};

type ShaderSelectValue = '__inherit__' | '__disabled__' | string;

function stableHslFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 85% 55%)`;
}

function splitHexColor(value: string): { rgb: string; alpha: number } | null {
  const match = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(value.trim());
  if (!match) return null;
  const hex = match[1].toLowerCase();
  const rgb = `#${hex.slice(0, 6)}`;
  const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return { rgb, alpha };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function toHexAlpha(alpha01: number): string {
  const clamped = Math.round(clamp01(alpha01) * 255);
  return clamped.toString(16).padStart(2, '0');
}

function combineHexColor(rgb: string, alpha01: number): string {
  const normalizedRgb = /^#[0-9a-fA-F]{6}$/.test(rgb) ? rgb.toLowerCase() : '#ffffff';
  const alphaHex = toHexAlpha(alpha01);
  return alphaHex === 'ff' ? normalizedRgb : `${normalizedRgb}${alphaHex}`;
}

function groupUniforms(defs: PmpsUniformDefinition[]): Array<{ name: string; items: PmpsUniformDefinition[] }> {
  const groups = new Map<string, PmpsUniformDefinition[]>();
  for (const def of defs) {
    const group = def.group?.trim() || 'Default';
    const existing = groups.get(group) ?? [];
    existing.push(def);
    groups.set(group, existing);
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, items]) => ({ name, items }));
}

function getUniformRange(def: PmpsUniformDefinition): { min: number; max: number; step: number } | null {
  const min = typeof def.min === 'number' && Number.isFinite(def.min) ? def.min : undefined;
  const max = typeof def.max === 'number' && Number.isFinite(def.max) ? def.max : undefined;
  if (typeof min !== 'number' || typeof max !== 'number' || min >= max) return null;
  const step =
    typeof def.step === 'number' && Number.isFinite(def.step) && def.step > 0
      ? def.step
      : def.type === 'int'
        ? 1
        : 0.01;
  return { min, max, step };
}

export function ShaderDebugPanel({ magnetId }: ShaderDebugPanelProps) {
  const packs = useInstalledPmpsShaderPacks();
  const binding = usePmpsMagnetShaderBinding(magnetId);

  const selectedValue: ShaderSelectValue = useMemo(() => {
    if (!binding) return '__inherit__';
    if (binding.enabled === false || binding.shaderId === null) return '__disabled__';
    return binding.shaderId;
  }, [binding]);

  const selectedShaderId = useMemo(() => {
    if (selectedValue === '__inherit__' || selectedValue === '__disabled__') return null;
    return selectedValue;
  }, [selectedValue]);

  const shaderPack = useInstalledPmpsShaderPack(selectedShaderId);
  const uniformOverrides = usePmpsMagnetUniformOverrides(magnetId, selectedShaderId);
  const fuse = usePmpsShaderFuse(magnetId, selectedShaderId);

  const uniformValues = useMemo(() => {
    if (!shaderPack) return {};
    return resolvePmpsUniformValues(shaderPack.manifest, uniformOverrides);
  }, [shaderPack, uniformOverrides]);

  const uniformGroups = useMemo(() => {
    const defs = shaderPack?.manifest.uniforms ?? [];
    return groupUniforms(defs);
  }, [shaderPack]);

  const [detectedUniforms, setDetectedUniforms] = useState<DetectedUniform[]>([]);
  const userDetectedUniforms = useMemo(
    () => detectedUniforms.filter((u) => !u.isReserved),
    [detectedUniforms]
  );

  const handleInstallFile = async (file: File) => {
    try {
      await installPmpsShaderPackFromFile(file, { overwrite: true });
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSelectShader = (value: ShaderSelectValue) => {
    if (value === '__inherit__') {
      removePmpsMagnetShaderBinding(magnetId);
      return;
    }
    if (value === '__disabled__') {
      upsertPmpsMagnetShaderBinding(magnetId, { shaderId: null, enabled: false });
      return;
    }

    upsertPmpsMagnetShaderBinding(magnetId, {
      shaderId: value,
      enabled: true,
      entryPoint: binding?.entryPoint,
      fpsLimit: binding?.fpsLimit,
      resolutionScale: binding?.resolutionScale,
    });
  };

  const updateBinding = (patch: Partial<NonNullable<typeof binding>>) => {
    if (!binding || selectedValue === '__inherit__') return;
    upsertPmpsMagnetShaderBinding(magnetId, { ...binding, ...patch });
  };

  const renderUniformEditor = (manifest: PmpsManifest) => {
    if (!selectedShaderId) return null;

    if (!manifest.uniforms || manifest.uniforms.length === 0) {
      return <div className="pmps-muted">This shader pack does not declare any `manifest.uniforms`.</div>;
    }

    return (
      <div className="pmps-uniforms">
        <div className="pmps-uniforms-actions">
          <button onClick={() => removePmpsMagnetUniformOverrides(magnetId, selectedShaderId)}>
            Reset (defaults)
          </button>
        </div>

        {uniformGroups.map((group) => (
          <div key={group.name} className="pmps-uniform-group">
            <div className="pmps-uniform-group-title">{group.name}</div>

            {group.items.map((def) => {
              const current = (uniformValues as any)[def.name];
              const label = `${def.name} (${def.type})`;
              const range = getUniformRange(def);

              if (def.type === 'bool') {
                const checked = Boolean(current);
                return (
                  <label key={def.name} className="pmps-uniform-row">
                    <span className="pmps-uniform-label">{label}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setPmpsMagnetUniformValue(magnetId, selectedShaderId, def.name, e.target.checked)
                      }
                    />
                  </label>
                );
              }

              if (def.type === 'color') {
                const parsed = typeof current === 'string' ? splitHexColor(current) : null;
                const rgb = parsed?.rgb ?? '#ffffff';
                const alpha = parsed?.alpha ?? 1;
                return (
                  <div key={def.name} className="pmps-uniform-row">
                    <span className="pmps-uniform-label">{label}</span>
                    <div className="pmps-color-controls">
                      <input
                        type="color"
                        value={rgb}
                        onChange={(e) =>
                          setPmpsMagnetUniformValue(
                            magnetId,
                            selectedShaderId,
                            def.name,
                            combineHexColor(e.target.value, alpha)
                          )
                        }
                      />
                      <input
                        className="pmps-alpha"
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={alpha}
                        onChange={(e) =>
                          setPmpsMagnetUniformValue(
                            magnetId,
                            selectedShaderId,
                            def.name,
                            combineHexColor(rgb, Number.parseFloat(e.target.value))
                          )
                        }
                      />
                      <span className="pmps-alpha-label">{alpha.toFixed(2)}</span>
                    </div>
                  </div>
                );
              }

              if (def.type === 'vec2' || def.type === 'vec3' || def.type === 'vec4') {
                const count = def.type === 'vec2' ? 2 : def.type === 'vec3' ? 3 : 4;
                const values: number[] = Array.isArray(current) ? current.slice(0, count) : Array(count).fill(0);
                while (values.length < count) values.push(0);

                const updateAt = (index: number, nextValue: number) => {
                  const next = [...values];
                  next[index] = nextValue;
                  setPmpsMagnetUniformValue(magnetId, selectedShaderId, def.name, next);
                };

                return (
                  <div key={def.name} className="pmps-uniform-row">
                    <span className="pmps-uniform-label">{label}</span>
                    <div className="pmps-vec-controls">
                      {values.map((value, index) => (
                        <input
                          key={index}
                          type="number"
                          value={Number.isFinite(value) ? value : 0}
                          step={def.type === 'vec4' ? 0.01 : 0.01}
                          onChange={(e) => updateAt(index, Number.parseFloat(e.target.value))}
                        />
                      ))}
                    </div>
                  </div>
                );
              }

              const numeric = typeof current === 'number' && Number.isFinite(current) ? current : 0;
              const step =
                typeof def.step === 'number' && Number.isFinite(def.step) && def.step > 0
                  ? def.step
                  : def.type === 'int'
                    ? 1
                    : 0.01;

              return (
                <div key={def.name} className="pmps-uniform-row">
                  <span className="pmps-uniform-label">{label}</span>
                  <div className="pmps-number-controls">
                    {range && (
                      <input
                        type="range"
                        min={range.min}
                        max={range.max}
                        step={range.step}
                        value={numeric}
                        onChange={(e) =>
                          setPmpsMagnetUniformValue(
                            magnetId,
                            selectedShaderId,
                            def.name,
                            def.type === 'int' ? Math.trunc(Number.parseFloat(e.target.value)) : Number.parseFloat(e.target.value)
                          )
                        }
                      />
                    )}
                    <input
                      className="pmps-number"
                      type="number"
                      value={numeric}
                      step={step}
                      onChange={(e) =>
                        setPmpsMagnetUniformValue(
                          magnetId,
                          selectedShaderId,
                          def.name,
                          def.type === 'int' ? Math.trunc(Number.parseFloat(e.target.value)) : Number.parseFloat(e.target.value)
                        )
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="shader-debug-panel">
      <div className="pmps-meta">
        <div className="pmps-meta-row">
          <span className="pmps-meta-label">Target magnet</span>
          <span className="pmps-meta-value">{magnetId}</span>
        </div>
      </div>

      <div className="pmps-install">
        <label className="pmps-file-upload">
          Install `.pmps` / `.glsl`
          <input
            type="file"
            accept=".pmps,.glsl,.frag"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleInstallFile(file);
              e.currentTarget.value = '';
            }}
          />
        </label>
      </div>

      <div className="pmps-section">
        <div className="pmps-section-title">Installed packs</div>
        {packs.length === 0 ? (
          <div className="pmps-muted">No shader packs installed.</div>
        ) : (
          <div className="shader-grid">
            {packs.map((pack) => {
              const id = pack.manifest.metadata.id;
              const selected = selectedShaderId === id;
              return (
                <button
                  type="button"
                  key={id}
                  className={`shader-card ${selected ? 'selected' : ''}`}
                  style={{ background: stableHslFromId(id) }}
                  onClick={() => handleSelectShader(id)}
                  title={id}
                >
                  {pack.manifest.metadata.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="pmps-section">
        <div className="pmps-section-title">Magnet binding</div>

        <select
          className="pmps-select"
          value={selectedValue}
          onChange={(e) => handleSelectShader(e.target.value as ShaderSelectValue)}
        >
          <option value="__inherit__">(inherit magnet config)</option>
          <option value="__disabled__">(disable shader)</option>
          {packs.map((pack) => (
            <option key={pack.manifest.metadata.id} value={pack.manifest.metadata.id}>
              {pack.manifest.metadata.name} ({pack.manifest.metadata.id})
            </option>
          ))}
        </select>

        <div className="pmps-binding-actions">
          <button onClick={() => removePmpsMagnetShaderBinding(magnetId)} disabled={!binding}>
            Clear override
          </button>
          {selectedShaderId && (
            <button onClick={() => uninstallPmpsShaderPack(selectedShaderId)}>Uninstall pack</button>
          )}
          {selectedShaderId && fuse.record && (
            <button onClick={() => clearPmpsShaderFuse(magnetId, selectedShaderId)}>
              Clear fuse
            </button>
          )}
        </div>

        {selectedShaderId && fuse.record && (
          <div className="pmps-muted">
            {fuse.isFused && fuse.record.disabledUntil
              ? `Fused until ${new Date(fuse.record.disabledUntil).toLocaleString()} (${fuse.record.lastStage ?? 'unknown'})`
              : `Last error: ${fuse.record.lastStage ?? 'unknown'} (${new Date(fuse.record.lastErrorAt).toLocaleString()})`}
          </div>
        )}

        <div className="pmps-binding-settings">
          <label className="pmps-setting">
            <span>entryPoint</span>
            <select
              value={binding?.entryPoint ?? 'auto'}
              disabled={!binding || selectedValue === '__inherit__'}
              onChange={(e) => updateBinding({ entryPoint: e.target.value as any })}
            >
              <option value="auto">auto</option>
              <option value="main">main</option>
              <option value="shadertoy">shadertoy</option>
            </select>
          </label>
          <label className="pmps-setting">
            <span>fpsLimit</span>
            <input
              type="number"
              placeholder="(inherit)"
              disabled={!binding || selectedValue === '__inherit__'}
              value={binding?.fpsLimit ?? ''}
              onChange={(e) => updateBinding({ fpsLimit: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </label>
          <label className="pmps-setting">
            <span>resolutionScale</span>
            <input
              type="number"
              step={0.05}
              placeholder="(inherit)"
              disabled={!binding || selectedValue === '__inherit__'}
              value={binding?.resolutionScale ?? ''}
              onChange={(e) =>
                updateBinding({ resolutionScale: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </label>
        </div>
      </div>

      {shaderPack && selectedShaderId && (
        <div className="pmps-section">
          <div className="pmps-section-title">Preview</div>
          <div className="pmps-preview">
            <PmpsShaderLayer
              shaderId={selectedShaderId}
              fragmentCode={shaderPack.fragmentCode}
              entryPoint={binding?.entryPoint ?? shaderPack.manifest.entry.entryPoint}
              width={320}
              height={160}
              fpsLimit={binding?.fpsLimit ?? shaderPack.manifest.render?.fpsLimit}
              resolutionScale={1}
              uniformValues={uniformValues}
              onDetectedUniforms={setDetectedUniforms}
              style={{ width: '100%', height: '160px', borderRadius: 6 }}
            />
          </div>
          {userDetectedUniforms.length > 0 && (
            <details className="pmps-detected">
              <summary>Detected uniforms ({userDetectedUniforms.length})</summary>
              <div className="pmps-detected-list">
                {userDetectedUniforms.map((u) => (
                  <div key={u.name} className="pmps-detected-item">
                    <code>{u.baseName}</code>
                    <span className="pmps-detected-type">
                      {u.glslType}
                      {u.isArray ? ` x${u.size}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {shaderPack && (
        <div className="pmps-section">
          <div className="pmps-section-title">Uniforms</div>
          {renderUniformEditor(shaderPack.manifest)}
        </div>
      )}
    </div>
  );
}
