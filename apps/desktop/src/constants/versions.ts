import pkg from '../../package.json';

export const APP_VERSION: string = typeof pkg.version === 'string' ? pkg.version : '0.0.0';

// Plugin Host API contract version (see packages/plugin-platform-contracts and plugin overview docs).
export const HOST_API_VERSION = '1.8.0';
