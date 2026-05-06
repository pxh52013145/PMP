import type {
  PmpHostCapabilityPreflightDecision,
  PmpHostCapabilityPreflightRequest,
} from './host';

const preflightRequest = {
  pluginId: 'example-plugin',
  hostLabel: 'Example Host',
  capabilityId: 'host.pmp.navigation',
  method: 'navigateTo',
  payload: {
    page: 'music-library',
  },
  permissions: ['api:host', 'api:host-capability', 'api:navigation'],
  requestKind: 'invoke',
} satisfies PmpHostCapabilityPreflightRequest;

const preflightDecision = {
  allow: true,
  normalizedPayload: {
    page: 'music-library',
  },
  diagnosticCode: 'allow',
} satisfies PmpHostCapabilityPreflightDecision;

void preflightRequest;
void preflightDecision;
