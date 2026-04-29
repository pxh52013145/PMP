import type { PlatformCompatContractFile } from '@pixel-matrix/plugin-platform-contracts';

export type PlatformConnectorId = `connector.platform.${string}`;
export type PlatformConnectorAuthState = 'authorized' | 'unauthorized' | 'pending' | 'error';
export type PlatformConnectorAvailability = 'available' | 'unavailable' | 'degraded';
export type PlatformConnectorWorkspaceKind = 'music' | 'video' | 'generic';
export type PlatformConnectorWorkspaceMode = 'legacy' | 'pack' | 'auto';

export interface PlatformConnectorTemplate {
  platformId: string;
  connectorId: PlatformConnectorId;
  displayName: string;
}

export interface PlatformConnectorDefinition {
  connectorId: PlatformConnectorId;
  platformId?: string;
  displayName: string;
  labelKey?: string;
  enabled?: boolean;
  authFlow?: 'qr' | 'cookie' | 'manual' | 'none';
  workspaceKind?: PlatformConnectorWorkspaceKind;
  workspaceMode?: PlatformConnectorWorkspaceMode;
  availability?: PlatformConnectorAvailability;
}

export interface BuiltinPlatformCompatRegistration {
  connectorId: PlatformConnectorId;
  enabled: boolean;
  contract: PlatformCompatContractFile;
}

export interface PlatformConnectorAuthSnapshot {
  connectorId: PlatformConnectorId;
  instanceId?: string;
  authState: PlatformConnectorAuthState;
  displayName?: string;
  accountUid?: string;
  updatedAtMs?: number;
}

export interface PlatformInstanceAuthSnapshot extends PlatformConnectorAuthSnapshot {
  instanceId: string;
}

export interface PlatformQrLoginSession {
  connectorId: PlatformConnectorId;
  instanceId?: string;
  sessionId: string;
  qrImageDataUrl: string;
  expiresAtMs: number;
}

export interface PlatformInstanceQrLoginSession extends PlatformQrLoginSession {
  instanceId: string;
}

export interface PlatformQrLoginPollResult {
  connectorId: PlatformConnectorId;
  instanceId?: string;
  sessionId: string;
  state:
    | 'pending'
    | 'confirmed'
    | 'authorized'
    | 'expired'
    | 'cancelled'
    | 'failed'
    | 'error';
  stateMessage?: string;
  accountUid?: string;
  snapshot?: PlatformConnectorAuthSnapshot | null;
}

export interface PlatformInstanceQrLoginPollResult extends PlatformQrLoginPollResult {
  instanceId: string;
  snapshot?: PlatformInstanceAuthSnapshot | null;
}

export type PlatformPackBootStage =
  | 'idle'
  | 'scheduled'
  | 'restore-store'
  | 'reconcile-inline'
  | 'inspect-store'
  | 'background-reconcile'
  | 'completed';

export type PlatformPackStartupState = 'idle' | 'scheduled' | 'running' | 'ready' | 'degraded';

export interface PlatformPackStartupStageRecord {
  ts: number;
  stage: PlatformPackBootStage;
  state: PlatformPackStartupState;
  level: 'info' | 'warn' | 'error';
  message?: string;
}

export interface PlatformPackStartupHealth {
  state: PlatformPackStartupState;
  currentStage: PlatformPackBootStage;
  bootScheduled: boolean;
  bootStartedAtMs: number | null;
  bootFinishedAtMs: number | null;
  lastUpdatedAtMs: number | null;
  durationMs: number | null;
  backgroundReconcileScheduled: boolean;
  backgroundReconcileRunning: boolean;
  storeBootstrapFailed: boolean;
  storeIndexAvailable: boolean | null;
  storeReadyWithoutIndex: boolean | null;
  storeAlreadyCurrent: boolean | null;
  registeredBuiltinCount: number;
  expectedBuiltinCount: number;
  staleConnectorIds: PlatformConnectorId[];
  relaxedDevConnectorIds: PlatformConnectorId[];
  lastError: string | null;
  recentStages: PlatformPackStartupStageRecord[];
}

export type PlatformPackDoctorStatus = 'ready' | 'degraded' | 'error';
export type PlatformPackDoctorSeverity = 'info' | 'warn' | 'error';
export type PlatformPackDoctorFlowStatus = 'ready' | 'degraded' | 'error' | 'unsupported';

export interface PlatformPackWorkspaceReadinessDiagnostic {
  code: string;
  severity: PlatformPackDoctorSeverity;
  message: string;
  fields?: Record<string, unknown>;
}

export interface PlatformPackDoctorIssue {
  code: string;
  severity: PlatformPackDoctorSeverity;
  message: string;
  fields?: Record<string, unknown>;
}

export interface PlatformPackDoctorWorkspaceRoutingReport {
  ownershipMode: 'legacy' | 'pack' | 'auto';
  path: 'legacy' | 'pack' | 'none';
  status: 'active' | 'fallback' | 'blocked';
  packWorkspaceReady: boolean;
  fallbackReasonCode: string | null;
  fallbackReasonMessage: string | null;
  diagnostics: PlatformPackWorkspaceReadinessDiagnostic[];
}

export interface PlatformPackDoctorPathProbe {
  path: string | null;
  resolved: boolean;
}

export interface PlatformPackDoctorWorkspaceSurfaceProbe extends PlatformPackDoctorPathProbe {
  source: string | null;
  rootViewId: string | null;
  viewType: string | null;
  requiredRuntimeCarrier: string | null;
  runtimeImportUrl: string | null;
}

export interface PlatformPackDoctorWorkspaceReadiness {
  ready: boolean;
  registrationPresent: boolean;
  contractPresent: boolean;
  runtimePresent: boolean;
  workspaceOwnershipDeclared: boolean;
  mountSurfaceDeclared: boolean;
  diagnostics: PlatformPackWorkspaceReadinessDiagnostic[];
}

export interface PlatformPackDoctorInstallationReport {
  installationId: string;
  connectorId: PlatformConnectorId;
  platformId: string | null;
  packId: string | null;
  packVersion: string | null;
  status: PlatformPackDoctorStatus;
  sourceType: string | null;
  source: string | null;
  installedAtMs: number | null;
  activeConnectorRegistration: boolean;
  registrationPresent: boolean;
  packageDigest: string | null;
  artifactRoot: PlatformPackDoctorPathProbe;
  artifactsPresent: boolean;
  runtime: PlatformPackDoctorPathProbe;
  icon: PlatformPackDoctorPathProbe;
  workspaceSurface: PlatformPackDoctorWorkspaceSurfaceProbe;
  workspaceReadiness: PlatformPackDoctorWorkspaceReadiness;
  issues: PlatformPackDoctorIssue[];
}

export interface PlatformPackDoctorWorkspaceMountReport {
  resolutionSource: string | null;
  installationId: string | null;
  sourceType: string | null;
  source: string | null;
  packId: string | null;
  packVersion: string | null;
  packageDigest: string | null;
  artifactRootPath: string | null;
  runtimePath: string | null;
  runtimeImportUrl: string | null;
  iconPath: string | null;
  surfaceResolved: boolean;
  surfaceSource: string | null;
  rootViewId: string | null;
  viewType: string | null;
}

export interface PlatformPackDoctorRenderSelectionStatus {
  registryInitialized: boolean;
  currentPresent: boolean;
  currentMounted: boolean;
  currentMountedAtMs: number | null;
  currentOrder: number | null;
  persistedPresent: boolean;
  persistedMounted: boolean;
  persistedMountedAtMs: number | null;
  persistedOrder: number | null;
  inSync: boolean;
}

export interface PlatformPackDoctorInstanceReport {
  instanceId: string;
  installationId: string | null;
  connectorId: PlatformConnectorId;
  platformId: string | null;
  status: PlatformPackDoctorStatus;
  displayName: string | null;
  instanceLabel: string | null;
  imported: boolean;
  importedRegistryPresent: boolean;
  instanceRecordPresent: boolean;
  descriptorPresent: boolean;
  installationPresent: boolean;
  sourceType: string | null;
  source: string | null;
  authState: string | null;
  availability: string | null;
  workspaceRouting: PlatformPackDoctorWorkspaceRoutingReport;
  workspaceMount: PlatformPackDoctorWorkspaceMountReport;
  renderSelection: PlatformPackDoctorRenderSelectionStatus;
  issues: PlatformPackDoctorIssue[];
}

export interface PlatformPackDoctorConnectorReport {
  connectorId: PlatformConnectorId;
  displayName: string;
  status: PlatformPackDoctorStatus;
  expectedBuiltin: boolean;
  installedRecord: { installedAtMs: number | null };
  registrationPresent: boolean;
  descriptorPresent: boolean;
  connectorDefinitionPresent: boolean;
  requiredFlows: {
    recommendations: PlatformPackDoctorFlowStatus;
    quality: PlatformPackDoctorFlowStatus;
    pages: PlatformPackDoctorFlowStatus;
  };
  workspaceRouting: PlatformPackDoctorWorkspaceRoutingReport;
  installations: PlatformPackDoctorInstallationReport[];
  instances: PlatformPackDoctorInstanceReport[];
  issues: PlatformPackDoctorIssue[];
}

export interface PlatformPackDoctorReport {
  status: PlatformPackDoctorStatus;
  generatedAtMs: number;
  durationMs: number;
  connectorCount: number;
  installationCount: number;
  instanceCount: number;
  readyConnectorCount: number;
  degradedConnectorCount: number;
  errorConnectorCount: number;
  issues: PlatformPackDoctorIssue[];
  connectors: PlatformPackDoctorConnectorReport[];
}

export interface PlatformConnectorFacadeItem {
  connectorId: PlatformConnectorId;
  displayName: string;
  status: 'active' | 'offline' | 'error';
}

export interface PlatformTrackSearchOptions {
  query: string;
  limit?: number;
  connectorIds?: string[];
}

export interface PlatformTrackSearchResult {
  connectorViews: PlatformConnectorFacadeItem[];
  tracks: Array<Record<string, unknown>>;
}

export interface PreparePlatformPlaybackOptions {
  sourceLocator: string;
  connectorId?: string;
  qualityHint?: string;
  instanceId?: string;
}

export interface PlatformPreparedPlayback {
  sourceLocator: string;
  streamUrl?: string;
  cachePath?: string;
  durationSeconds?: number;
  mimeType?: string;
  headers?: Record<string, string>;
  expiresAtMs?: number;
  seekable?: boolean;
  rangeRequests?: boolean;
}

export interface PreparePlatformPlaybackResult {
  connectorId: string;
  prepared: PlatformPreparedPlayback | null;
}

export interface PlatformWorkspacePageItem {
  pageId: string;
  label: string;
}

export interface PlatformWorkspacePageModel {
  pages: PlatformWorkspacePageItem[];
  activePageId: string | null;
}

export interface PlatformWorkspaceCollectionItem {
  collectionId: string;
  title: string;
}

export interface PlatformWorkspaceResourceItem {
  resourceId: string;
  title: string;
  coverUrl?: string;
}

export interface PlatformWorkspaceResourcePage {
  items: PlatformWorkspaceResourceItem[];
  pageNum: number;
  pageSize: number;
  hasMore: boolean;
}

export interface PlatformWorkspaceQualityState {
  options: PlatformWorkspaceQualityOption[];
  selectedQualityKey: string | null;
}

export interface PlatformWorkspaceQualityOption {
  qualityKey: string;
  label: string;
}

export interface PlatformRuntimeWorkspaceRouting {
  path: 'legacy' | 'pack' | 'none';
  status: 'active' | 'fallback' | 'blocked';
  packWorkspaceReady: boolean;
  ownershipMode: 'legacy' | 'pack' | 'auto';
}

export interface PlatformRuntimeWorkspaceMount {
  installationId: string | null;
  source: string;
  runtimeImportUrl: string | null;
}

export type PlatformRuntimeWorkspaceMountResolutionSource =
  | 'none'
  | 'installed-pack'
  | 'platform-pack-dev';

export interface PlatformRuntimeDescriptor {
  connectorId: PlatformConnectorId;
  instanceId: string;
  workspaceRouting: PlatformRuntimeWorkspaceRouting;
  workspaceMount: PlatformRuntimeWorkspaceMount | null;
}

export type PlatformRuntimeDescriptorInput = {
  connectorId?: string | null;
  instanceId?: string | null;
};

export type PlatformRenderSelectionPersistenceInspection = {
  records: PlatformRenderSelectionRecord[];
};

export interface PlatformRenderSelectionRecord {
  instanceId: string;
  mounted: boolean;
  mountedAtMs?: number;
  order?: number;
}

export interface MusicPlatformActiveInstanceState {
  activeByConnectorId: Record<string, string>;
}

export type PlatformPackDevSourceStatus = 'ready' | 'degraded' | 'error';

export interface PlatformPackDevSourceDiagnostic {
  severity: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  fields?: Record<string, unknown>;
}

export interface PlatformPackDevSource {
  rootDir: string;
  manifestPath: string;
  contractPath: string | null;
  runtimePath: string | null;
  iconPath: string | null;
  sidecarPath: string | null;
  status: PlatformPackDevSourceStatus;
  diagnostics: PlatformPackDevSourceDiagnostic[];
  manifest: {
    metadata: {
      id: string;
      name?: string;
      version?: string;
    };
    connector: {
      connectorId: PlatformConnectorId;
    };
  } | null;
}

export type PlatformPackDevInstanceBindingStatus = 'bound' | 'error';
export type PlatformPackDevInstanceReloadStatus = 'success' | 'error';

export interface PlatformPackDevInstanceReloadHistoryEntry {
  at: number;
  revision: number;
  status: PlatformPackDevInstanceReloadStatus;
  message?: string;
}

export interface PlatformPackDevInstanceBindingRecord {
  instanceId: string;
  connectorId: PlatformConnectorId;
  installationId: string;
  rootDir: string;
  displayName: string;
  packId: string;
  status: PlatformPackDevInstanceBindingStatus;
  revision: number;
  reloadHistory: PlatformPackDevInstanceReloadHistoryEntry[];
  lastError: string | null;
}

export interface PlatformPackDevInstanceBindResult {
  record: PlatformPackDevInstanceBindingRecord;
  source: PlatformPackDevSource;
}

export interface FocusMusicPlatformWorkspaceResult {
  focused: boolean;
}

const archivedStartupHealth: PlatformPackStartupHealth = {
  state: 'idle',
  currentStage: 'idle',
  bootScheduled: false,
  bootStartedAtMs: null,
  bootFinishedAtMs: null,
  lastUpdatedAtMs: null,
  durationMs: null,
  backgroundReconcileScheduled: false,
  backgroundReconcileRunning: false,
  storeBootstrapFailed: false,
  storeIndexAvailable: null,
  storeReadyWithoutIndex: null,
  storeAlreadyCurrent: null,
  registeredBuiltinCount: 0,
  expectedBuiltinCount: 0,
  staleConnectorIds: [],
  relaxedDevConnectorIds: [],
  lastError: null,
  recentStages: [],
};

const archivedDoctorRouting: PlatformPackDoctorWorkspaceRoutingReport = {
  ownershipMode: 'auto',
  path: 'none',
  status: 'blocked',
  packWorkspaceReady: false,
  fallbackReasonCode: 'platform_archived',
  fallbackReasonMessage: 'Music platform modules are archived under reference/.',
  diagnostics: [],
};

export const BILIBILI_CONNECTOR_ID: PlatformConnectorId = 'connector.platform.bilibili';
export const NETEASE_CONNECTOR_ID: PlatformConnectorId = 'connector.platform.netease';

export function listPlatformConnectorDefinitions(): PlatformConnectorDefinition[] {
  return [];
}

export function subscribePlatformConnectorDefinitions(
  _listener: (definitions: PlatformConnectorDefinition[]) => void
): () => void {
  return () => undefined;
}

export function listPlatformConnectorAdapters(): [] {
  return [];
}

export function listPlatformConnectorAuthSnapshots(): PlatformConnectorAuthSnapshot[] {
  return [];
}

export function getPlatformConnectorDefinition(
  _connectorId: string
): PlatformConnectorDefinition | null {
  return null;
}

export function getPlatformConnectorAuthSnapshot(
  _connectorId: string
): PlatformConnectorAuthSnapshot | null {
  return null;
}

export function resolvePlatformConnectorTemplate(
  connectorId: string
): PlatformConnectorTemplate | null {
  const normalized = connectorId.trim();
  if (!normalized.startsWith('connector.platform.')) return null;
  return {
    platformId: normalized.replace(/^connector\.platform\./, ''),
    connectorId: normalized as PlatformConnectorId,
    displayName: normalized,
  };
}

export function registerPlatformConnectorAdapter(): () => void {
  return () => undefined;
}

export function unregisterPlatformConnectorAdapter(): void {
  return undefined;
}

export function createPassivePlatformConnectorAdapter(): null {
  return null;
}

export function createPlatformCompatRuntimeFromConnectorAdapter(): null {
  return null;
}

export function registerPlatformCompatRegistrationForConnector(): () => void {
  return () => undefined;
}

export function unregisterPlatformCompatRegistrationForConnector(): void {
  return undefined;
}

export function getBuiltinPlatformCompatContractRegistration(): BuiltinPlatformCompatRegistration | null {
  return null;
}

export function listBuiltinPlatformCompatContractRegistrations(): BuiltinPlatformCompatRegistration[] {
  return [];
}

export function listBuiltinPlatformCompatRegistrations(): BuiltinPlatformCompatRegistration[] {
  return [];
}

export function subscribePlatformConnectorCompatRegistrations(
  _listener: (registrations: BuiltinPlatformCompatRegistration[]) => void
): () => void {
  return () => undefined;
}

export async function beginPlatformQrLogin(
  connectorId: PlatformConnectorId
): Promise<PlatformQrLoginSession | null> {
  return {
    connectorId,
    sessionId: '',
    qrImageDataUrl: '',
    expiresAtMs: 0,
  };
}

export async function pollPlatformQrLogin(
  connectorId: PlatformConnectorId,
  sessionId: string
): Promise<PlatformQrLoginPollResult> {
  return {
    connectorId,
    sessionId,
    state: 'error',
    stateMessage: 'Music platform modules are archived.',
  };
}

export async function logoutPlatformConnector(
  connectorId: PlatformConnectorId
): Promise<PlatformConnectorAuthSnapshot> {
  return {
    connectorId,
    authState: 'unauthorized',
  };
}

export async function clearPlatformConnectorCookies(
  connectorId: PlatformConnectorId
): Promise<PlatformConnectorAuthSnapshot> {
  return logoutPlatformConnector(connectorId);
}

export function resolvePlatformInstanceId(options: {
  connectorId?: string | null;
  instanceId?: string | null;
}): string | null {
  return options.instanceId?.trim() || null;
}

export function getPlatformInstanceAuthSnapshot(
  _instanceId: string
): PlatformInstanceAuthSnapshot | null {
  return null;
}

export function listPlatformInstanceAuthSnapshots(_input?: unknown): PlatformInstanceAuthSnapshot[] {
  return [];
}

export async function refreshPlatformInstanceAuthSnapshot(
  _instanceId: string
): Promise<PlatformInstanceAuthSnapshot | null> {
  return null;
}

export async function beginPlatformInstanceQrLogin(
  instanceId: string
): Promise<PlatformInstanceQrLoginSession> {
  return {
    connectorId: BILIBILI_CONNECTOR_ID,
    instanceId,
    sessionId: '',
    qrImageDataUrl: '',
    expiresAtMs: 0,
  };
}

export async function pollPlatformInstanceQrLogin(
  instanceId: string,
  sessionId: string
): Promise<PlatformInstanceQrLoginPollResult> {
  return {
    connectorId: BILIBILI_CONNECTOR_ID,
    instanceId,
    sessionId,
    state: 'error',
    stateMessage: 'Music platform modules are archived.',
  };
}

export async function logoutPlatformInstance(
  instanceId: string
): Promise<PlatformInstanceAuthSnapshot> {
  return {
    connectorId: BILIBILI_CONNECTOR_ID,
    instanceId,
    authState: 'unauthorized',
  };
}

export async function clearPlatformInstanceAuthCookies(
  instanceId: string
): Promise<PlatformInstanceAuthSnapshot> {
  return logoutPlatformInstance(instanceId);
}

export function getPlatformPackStartupHealth(): PlatformPackStartupHealth {
  return { ...archivedStartupHealth, recentStages: [] };
}

export function subscribePlatformPackStartupHealth(
  listener: (health: PlatformPackStartupHealth) => void
): () => void {
  listener(getPlatformPackStartupHealth());
  return () => undefined;
}

export async function inspectPlatformPackDoctor(): Promise<PlatformPackDoctorReport> {
  return {
    status: 'ready',
    generatedAtMs: Date.now(),
    durationMs: 0,
    connectorCount: 0,
    installationCount: 0,
    instanceCount: 0,
    readyConnectorCount: 0,
    degradedConnectorCount: 0,
    errorConnectorCount: 0,
    issues: [],
    connectors: [],
  };
}

export function listPlatformConnectorFacadeItems(): PlatformConnectorFacadeItem[] {
  return [];
}

export async function searchPlatformTracks(
  options: PlatformTrackSearchOptions
): Promise<PlatformTrackSearchResult> {
  void options;
  return {
    connectorViews: [],
    tracks: [],
  };
}

export async function preparePlatformPlayback(
  options: PreparePlatformPlaybackOptions
): Promise<PreparePlatformPlaybackResult | null> {
  return {
    connectorId: options.connectorId ?? 'connector.platform.archived',
    prepared: null,
  };
}

export function getPlatformWorkspacePageModel(_input?: unknown): PlatformWorkspacePageModel {
  return { pages: [], activePageId: null };
}

export function listPlatformWorkspacePages(_input?: unknown): PlatformWorkspacePageItem[] {
  return [];
}

export function listPlatformWorkspaceCollections(
  _input?: unknown
): PlatformWorkspaceCollectionItem[] {
  return [];
}

export function listPlatformWorkspaceRecommendedCollections(
  _input?: unknown
): PlatformWorkspaceCollectionItem[] {
  return [];
}

export function listPlatformWorkspaceCollectionResources(
  _input?: unknown
): PlatformWorkspaceResourcePage {
  return { items: [], pageNum: 1, pageSize: 0, hasMore: false };
}

export function listPlatformWorkspaceRecommendedResources(
  _input?: unknown
): PlatformWorkspaceResourcePage {
  return { items: [], pageNum: 1, pageSize: 0, hasMore: false };
}

export function searchPlatformWorkspaceResources(_input?: unknown): PlatformWorkspaceResourcePage {
  return { items: [], pageNum: 1, pageSize: 0, hasMore: false };
}

export async function resolvePlatformWorkspaceResource(
  _input?: unknown
): Promise<PlatformWorkspaceResourceItem | null> {
  return null;
}

export function preparePlatformWorkspacePlayback(
  _input?: unknown
): PlatformPreparedPlayback | null {
  return null;
}

export function listPlatformWorkspaceQualityState(_input?: unknown): PlatformWorkspaceQualityState {
  return { options: [], selectedQualityKey: null };
}

export function listPlatformWorkspaceQualityOptions(
  _input?: unknown
): PlatformWorkspaceQualityOption[] {
  return [];
}

export function setPlatformWorkspaceQualityPreference(
  _input?: unknown
): PlatformWorkspaceQualityState {
  return listPlatformWorkspaceQualityState();
}

export async function resolvePlatformWorkspaceCoverAssetUrl(
  _input?: unknown
): Promise<string | null> {
  return null;
}

export function getMusicPlatformActiveInstanceState(): MusicPlatformActiveInstanceState {
  return { activeByConnectorId: {} };
}

export function getActiveMusicPlatformInstanceId(_input?: unknown): string | null {
  return null;
}

export function setActiveMusicPlatformInstance(): void {
  return undefined;
}

export function subscribeMusicPlatformActiveInstanceState(
  _listener: (state: MusicPlatformActiveInstanceState) => void
): () => void {
  return () => undefined;
}

export function listPlatformRenderSelections(): PlatformRenderSelectionRecord[] {
  return [];
}

export function getPlatformRenderSelection(
  _instanceId: string
): PlatformRenderSelectionRecord | null {
  return null;
}

export function subscribePlatformRenderSelections(
  _listener: () => void
): () => void {
  return () => undefined;
}

export function upsertPlatformRenderSelection(): void {
  return undefined;
}

export function removePlatformRenderSelection(): void {
  return undefined;
}

export function setPlatformRenderSelectionMounted(): void {
  return undefined;
}

export function inspectPlatformRenderSelectionPersistence(): PlatformRenderSelectionPersistenceInspection {
  return { records: [] };
}

export function listPlatformRuntimeDescriptors(): PlatformRuntimeDescriptor[] {
  return [];
}

export function resolvePlatformRuntimeDescriptorByInstanceId(
  _instanceId?: string
): PlatformRuntimeDescriptor | null {
  return null;
}

export function resolvePlatformWorkspaceRoutingForConnector(
  _input?: unknown
): PlatformRuntimeWorkspaceRouting {
  return archivedDoctorRouting;
}

export function resolvePlatformWorkspaceRoutingForInstanceId(
  _input?: unknown
): PlatformRuntimeWorkspaceRouting {
  return archivedDoctorRouting;
}

export function resolveDefaultPlatformInstanceIdForConnector(_input?: unknown): string | null {
  return null;
}

export function resolvePreferredPlatformRuntimeDescriptorForConnector(
  _input?: unknown
): PlatformRuntimeDescriptor | null {
  return null;
}

export async function readPlatformPackDevSourceFromPath(
  rootDir: string
): Promise<PlatformPackDevSource> {
  return {
    rootDir,
    manifestPath: '',
    contractPath: null,
    runtimePath: null,
    iconPath: null,
    sidecarPath: null,
    status: 'error',
    diagnostics: [
      {
        severity: 'error',
        code: 'platform_archived',
        message: 'Platform pack development support is archived under reference/.',
      },
    ],
    manifest: null,
  };
}

export function listPlatformPackDevInstanceBindings(): PlatformPackDevInstanceBindingRecord[] {
  return [];
}

export function getPlatformPackDevInstanceBindingsRevision(): number {
  return 0;
}

export function subscribePlatformPackDevInstanceBindings(
  _listener: () => void
): () => void {
  return () => undefined;
}

export function getPlatformPackDevInstanceBinding(): PlatformPackDevInstanceBindingRecord | null {
  return null;
}

export function resolvePlatformPackDevInstanceBindingForSource(): PlatformPackDevInstanceBindingRecord | null {
  return null;
}

export async function bindPlatformPackDevInstance(
  source: PlatformPackDevSource
): Promise<PlatformPackDevInstanceBindResult> {
  throw new Error(
    `Platform pack development support is archived; cannot bind ${source.rootDir}.`
  );
}

export async function reloadPlatformPackDevInstanceBinding(
  record: PlatformPackDevInstanceBindingRecord
): Promise<PlatformPackDevInstanceBindResult> {
  throw new Error(
    `Platform pack development support is archived; cannot reload ${record.instanceId}.`
  );
}

export async function detachPlatformPackDevInstanceBinding(_instanceId?: string): Promise<void> {
  return undefined;
}

export async function focusMusicPlatformWorkspaceInstance(
  _input?: unknown
): Promise<FocusMusicPlatformWorkspaceResult> {
  return { focused: false };
}

export function awaitBuiltinPlatformPackRegistrationsReady(): Promise<void> {
  return Promise.resolve();
}

export function listBuiltinPlatformPackAssets(): [] {
  return [];
}

export function listPlatformPackRegistrations(): [] {
  return [];
}

export function subscribePlatformPackRegistrations(_listener: () => void): () => void {
  return () => undefined;
}

export function listPlatformPackWorkspaceSurfaces(): [] {
  return [];
}

export function listPlatformPackReadinessDiagnostics(): [] {
  return [];
}

export function inspectBuiltinPlatformPackStoreState(): null {
  return null;
}

export function inspectPlatformPackWorkspaceReadiness(): null {
  return null;
}

export function inspectPlatformPackWorkspaceReadinessForInstallation(): null {
  return null;
}

export async function installPlatformPackFromFile(): Promise<null> {
  return null;
}

export async function installPlatformPackFromZipBytes(): Promise<null> {
  return null;
}

export function registerPlatformPackDevSource(): Promise<null> {
  return Promise.resolve(null);
}

export function removePlatformPackDevRegistration(): void {
  return undefined;
}

export function removePlatformPackRegistration(): void {
  return undefined;
}

export function resolvePlatformPackWorkspaceSurface(): null {
  return null;
}

export function resolvePlatformPackWorkspaceSurfaceForInstallation(): null {
  return null;
}

export function resolvePlatformPackWorkspaceSurfaceForInstance(): null {
  return null;
}
