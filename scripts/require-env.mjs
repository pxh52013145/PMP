import fs from 'node:fs';
import path from 'node:path';

function printHelp() {
  // eslint-disable-next-line no-console
  console.error('Usage: node scripts/require-env.mjs <ENV_NAME> [ENV_NAME...]');
}

const envNames = process.argv.slice(2).filter(Boolean);
if (envNames.length === 0) {
  printHelp();
  process.exit(2);
}

function checkExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
for (const name of envNames) {
  const value = process.env[name];
  if (!value) {
    // eslint-disable-next-line no-console
    console.error(`[env] Missing required env var: ${name}`);
    process.exit(1);
  }

  if (name.endsWith('_DIR')) {
    const resolved = path.resolve(value);
    if (!checkExists(resolved)) {
      // eslint-disable-next-line no-console
      console.error(`[env] ${name} does not exist: ${resolved}`);
      process.exit(1);
    }

    if (name === 'CPAL_ASIO_DIR') {
      const asioHeader = path.join(resolved, 'common', 'asio.h');
      if (!checkExists(asioHeader)) {
        // eslint-disable-next-line no-console
        console.error(`[env] ${name} does not look like ASIO SDK root (missing common/asio.h): ${resolved}`);
        process.exit(1);
      }
    }
  }
}
