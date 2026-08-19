import { PACKAGE_VERSION } from '../src/version';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageJson = require('../package.json');

describe('PACKAGE_VERSION', () => {
  test('reflects package.json, so the CLI/server binaries cannot drift from a stale hard-coded string', () => {
    expect(PACKAGE_VERSION).toBe(packageJson.version);
  });
});
