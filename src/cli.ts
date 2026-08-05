import { resolve } from 'node:path';
import { scanMarkers } from './markers.js';
import { defaultStorePaths, PaperNotesStore } from './store.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'generate';
  const workspaceRoot = resolve(process.argv[3] ?? process.cwd());
  const store = new PaperNotesStore(workspaceRoot, defaultStorePaths());

  if (command === 'migrate') {
    const result = await store.initialize();
    console.log(result.migrated
      ? `Migrated ${result.notes.notes.length} main-paper note(s).`
      : `Data already exists; regenerated ${result.notes.notes.length} note(s).`);
    return;
  }

  await store.initialize();
  if (command === 'generate') {
    const data = await store.save();
    console.log(`Generated main_notes.tex from ${data.notes.length} structured note(s).`);
    return;
  }

  if (command === 'validate') {
    const sources = await store.readSources();
    const markerIds = new Set<string>();
    const scans = [...sources.entries()].map(([sourceFile, source]) => ({ sourceFile, scan: scanMarkers(source) }));
    for (const { scan } of scans) {
      for (const range of scan.ranges) markerIds.add(range.id);
    }
    const dataIds = new Set(store.data.notes.map((note) => note.id));
    const messages = scans.flatMap(({ sourceFile, scan }) => scan.problems.map((problem) => `${sourceFile}: ${problem.message}`));
    for (const id of markerIds) {
      if (!dataIds.has(id)) {
        messages.push(`源码标记没有结构化笔记：${id}`);
      }
    }
    for (const id of dataIds) {
      if (!markerIds.has(id)) {
        messages.push(`结构化笔记没有源码标记：${id}`);
      }
    }
    if (messages.length > 0) {
      for (const message of messages) {
        console.error(message);
      }
      process.exitCode = 1;
      return;
    }
    console.log(`Validated ${markerIds.size} marker pair(s).`);
    return;
  }

  throw new Error(`Unknown command: ${command}. Use migrate, generate, or validate.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
