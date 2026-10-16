import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@vscode/test-cli';

const extensionRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  files: 'src-ext/test/**/*.test.js',
  extensionDevelopmentPath: extensionRoot,
  workspaceFolder: extensionRoot,
  mocha: {
    timeout: 30000,
  },
});
