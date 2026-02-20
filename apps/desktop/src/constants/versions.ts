import pkg from '../../package.json';

export const APP_VERSION: string = typeof pkg.version === 'string' ? pkg.version : '0.0.0';

// Plugin Host API contract version (docs/architecture/contracts/plugin-host-api.md).
export const HOST_API_VERSION = '1.3.0';
