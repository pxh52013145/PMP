import { describe, expect, it } from 'vitest';

import { createProfilePackZipBytes, parseProfilePackFromZipBytes } from '../profilePack';

describe('.pmpk profile-pack', () => {
  it('roundtrips manifest and profile without checksums', async () => {
    const bytes = await createProfilePackZipBytes({
      manifest: {
        formatVersion: '1.0',
        type: 'profile-pack',
        metadata: { id: 'my-profile', name: 'My Profile', version: '1.0.0' },
        entry: { profile: 'profile.json' },
      },
      profile: {
        formatVersion: '1.0',
        theme: { source: { kind: 'pmpt', path: 'theme.pmpt' } },
        magnets: {
          spaces: { value: {} },
          spaceLayout: { value: {} },
          spaceConfig: { value: {} },
        },
      },
      themeText: JSON.stringify({ id: 'theme-default', name: 'Default', version: '1.0.0' }),
      checksums: { enabled: false },
    });

    const parsed = await parseProfilePackFromZipBytes(bytes);
    expect(parsed.manifest.metadata.id).toBe('my-profile');
    expect(parsed.entryProfilePath).toBe('profile.json');
    expect(parsed.themeEntry?.path).toBe('theme.pmpt');
  });

  it('rejects non profile-pack manifests', async () => {
    await expect(
      createProfilePackZipBytes({
        // @ts-expect-error validating runtime error path
        manifest: { formatVersion: '1.0', type: 'theme-pack' },
        profile: { formatVersion: '1.0' },
        checksums: { enabled: false },
      })
    ).rejects.toThrow(/profile-pack/);
  });
});
