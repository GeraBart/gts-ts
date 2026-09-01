/**
 * Version reported by the CLI, the HTTP server binary, and the generated
 * OpenAPI document. Read from `package.json` so none of them can drift from
 * the published version; the file sits one level above `src` (ts-node) and
 * one level above `dist` (compiled output), so resolution from either
 * location needs to walk up two levels from the compiled/source file itself.
 */
export const PACKAGE_VERSION: string = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../package.json').version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
