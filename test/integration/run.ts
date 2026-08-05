import { resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // Test commands can be launched from an existing VS Code extension host
  // (including Codex).  Its bootstrap variables must not leak into the fresh
  // desktop instance or Electron starts in Node/extension-host mode.
  for (const key of Object.keys(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('VSCODE_')) {
      delete process.env[key];
    }
  }
  const extensionDevelopmentPath = resolve(__dirname, '..', '..');
  const extensionTestsPath = resolve(extensionDevelopmentPath, 'dist', 'integration-suite.js');
  const workspacePath = resolve(extensionDevelopmentPath, 'example');
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspacePath, '--disable-extensions'],
    extensionTestsEnv: { PAPER_NOTES_INTEGRATION: '1' }
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
