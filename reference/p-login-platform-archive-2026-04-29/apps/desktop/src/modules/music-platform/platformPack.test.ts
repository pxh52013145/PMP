import { describe, expect, it } from 'vitest';

import { parsePlatformPackFromZipBytes } from './platformPack';

const WORKSPACE_PACK_BASE64 =
  'UEsDBBQAAAAIAMUCllwPm6LdzwAAALIBAAANAAAAbWFuaWZlc3QuanNvbl2PPQ7CMAyFd04RdYYIVm6AEIiJ3SQGGahTJQZUIe6Ok/6gMsV5n/38/J4ZU51DrEGOGBMFrtamWtllNc9E2gaz0NxBcteiAXfrUI0CHgQUZxNVyOfW04PuQrxgFISEpVkhQ12c9p1sDr2jOQyO2vScRNAQKn/KNheY0UmIv3WjtCl7x68dwtq/CJ6SonY/TTLQV4i3pOfhlrgY/k2PfBd8mffoyYGg/6VElthOEkoEJ328Uttr0gN7z/hgoS5NXyoeIOlIJvm16Xkpa2afL1BLAwQUAAAACADFApZcTtOi0yQCAAAiBgAADQAAAGNvbnRyYWN0Lmpzb26FVMFu2zAMvfcrAp8XY7vuthUYEAztIQV2GXZgJDohIkuKJCcLhvz7KEVSbLdNT4b5Hh+pJ1L/HhaLRhgdHIjwC50no5uvi+ZL+7n5FDGrIHTG9RyM3FFkJSNRY0DwmMgMSvKMn5+hx4g+T1EfIJBYcb0IEn9bf9xWdLDWuOCfBhVopZmsRVTpQHlkyiU1BEPY3ZpRZkv6ychU7eCKlMPDQA79ozF7qhoz8JsQZtAhnWOMlz7W2DErFgtuuDUgwMKGFAVCP3HlrMiHGIr0rNXB0TgKiTmuIYHUeY3C9D1qya4YPcv0CE6U4jl2GIDrnqdBDUfaJoX5OTAE0tt5aQvb1M7kUGDpO2mZ6flM2epmZ3xobW9bvjCNIhi3TFAWVLRx4GJXN2YZkiXle2wLq17C/Oz3kufsuUf3cjPplYX3cgprZtm9lCunGnoybu8tpAHOdpqT5gXbkY1KDO1n0yrXPI3U4yM4R+gi64SbI+Fp2bm4UIVuTKiq/B8Zk2Vsa/E2cRMxtRU926FSL8qkSf2dNYpWxBm6qt1UNkYWLz6smLiZeknfP7lyXZzzD+j5O1qfkQmjrjhaDR9NeUazbDTWxjiod1IDKuwx8OyVzIkh8fXDvxNHvTA2vSivrrm60HSESo49vEpd94PNGdlVkqdRAWKHL6nStK86Q9wV6vwi5xkaV+D+6m8dyHb2INeL+cnr/caDXfHyiEqUJCDwRcQ+Hi7/AVBLAwQUAAAACADFApZcKcWioUoAAABPAAAACgAAAHJ1bnRpbWUuanMNxkEKgCAQBdCrDK7qCrbqCt1A7AcuHGX8A0F499w9vL0Z5XHNLE0lGxJxubJUnL1su3xioJsuVDDdiSkuj+aWESUQg0GmzEPmD1BLAwQUAAAACADFApZc+elgaiwAAAAuAAAACAAAAGljb24uc3ZnsykuS1eoyM3JK7ZVyigpKbDS1y8vL9crN9bLL0rXNzIwMNAHqlCyswFRdgBQSwECFAAUAAAACADFApZcD5ui3c8AAACyAQAADQAAAAAAAAAAAAAAAAAAAAAAbWFuaWZlc3QuanNvblBLAQIUABQAAAAIAMUCllxO06LTJAIAACIGAAANAAAAAAAAAAAAAAAAAPoAAABjb250cmFjdC5qc29uUEsBAhQAFAAAAAgAxQKWXCnFoqFKAAAATwAAAAoAAAAAAAAAAAAAAAAASQMAAHJ1bnRpbWUuanNQSwECFAAUAAAACADFApZc+elgaiwAAAAuAAAACAAAAAAAAAAAAAAAAAC7AwAAaWNvbi5zdmdQSwUGAAAAAAQABADkAAAADQQAAAAA';

function decodePackArchive(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

function ensureBtoa(): void {
  if (typeof globalThis.btoa === 'function') {
    return;
  }

  Object.defineProperty(globalThis, 'btoa', {
    configurable: true,
    value: (input: string) => Buffer.from(input, 'binary').toString('base64'),
  });
}

describe('platformPack workspace descriptors', () => {
  it('preserves contract-level workspace UI descriptors during pack parsing', async () => {
    ensureBtoa();
    const pack = await parsePlatformPackFromZipBytes(
      decodePackArchive(WORKSPACE_PACK_BASE64)
    );

    expect(pack.workspace).toEqual({
      ownership: 'pack',
      requiredRuntimeCarrier: 'webview-frame',
      root: {
        viewId: 'netease.workspace.root',
        viewType: undefined,
      },
      shellSlots: [
        {
          slotId: 'workspace.body',
          viewId: 'netease.workspace.body',
          viewType: undefined,
        },
      ],
      capabilityFamilies: {
        required: ['host.pmp.navigation'],
        optional: ['host.pmp.telemetry'],
      },
      context: {
        scope: 'platform-instance',
        fields: ['connectorId', 'instanceId', 'cacheScope'],
      },
    });
    expect(pack.contract.workspace).toEqual(pack.workspace);
  });
});
