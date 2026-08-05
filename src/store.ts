import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  assertValidData,
  createEmptyData,
  migratePaperNotesData,
  normalizeRelativePosixPath,
  type PaperNote,
  type PaperNotesData,
  type PaperNotesProject
} from './model.js';
import { synchronizeAndGenerate, type ProjectSources } from './generator.js';
import { scanMarkers } from './markers.js';
import { discoverSourceGraph, resolveInsideProject } from './project.js';

export interface StorePaths {
  dataFile: string;
  legacyRootFile?: string;
  legacyGeneratedNotesFile?: string;
  legacyBackupFile: string;
  schemaBackupFile: string;
  legacyQuickScript?: string;
  legacyFullScript?: string;
}

export class PaperNotesStore {
  private currentData: PaperNotesData | undefined;
  private writeTail: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(readonly workspaceRoot: string, readonly paths: StorePaths) {}

  get data(): PaperNotesData {
    if (!this.currentData) {
      throw new Error('Paper Notes data has not been loaded.');
    }
    return this.currentData;
  }

  get project(): PaperNotesProject {
    return this.data.project;
  }

  absolute(relativePath: string): string {
    const normalized = normalizeRelativePosixPath(relativePath);
    return resolve(this.workspaceRoot, ...normalized.split('/'));
  }

  async initialize(): Promise<{ migrated: boolean; notes: PaperNotesData }> {
    const dataPath = this.absolute(this.paths.dataFile);
    if (!(await exists(dataPath))) {
      throw new Error('This folder is not initialized. Run “Initialize LaTeX Paper Notes Project”.');
    }
    const raw = await readFile(dataPath, 'utf8');
    const parsed = JSON.parse(stripBom(raw)) as Record<string, unknown>;
    const markerOwners = parsed.schemaVersion === 3 ? undefined : await this.findLegacyMarkerOwners(parsed);
    const migration = migratePaperNotesData(parsed, {
      legacyRootFile: this.paths.legacyRootFile,
      markerOwners,
      legacyQuickScript: this.paths.legacyQuickScript,
      legacyFullScript: this.paths.legacyFullScript
    });
    await this.assertProjectSafe(migration.data.project);
    this.currentData = migration.data;
    if (migration.migrated) {
      await this.backupPreviousSchema(raw);
      await this.save(migration.data);
    } else {
      // Regenerate only when the generated file is missing. Activation should
      // not rewrite a valid project merely because VS Code opened it.
      if (!(await exists(this.absolute(migration.data.project.generatedNotesFile)))) {
        await this.save(migration.data);
      }
    }
    return { migrated: migration.migrated, notes: this.currentData };
  }

  async create(project: PaperNotesProject): Promise<PaperNotesData> {
    const data = createEmptyData(project);
    await this.assertProjectSafe(data.project);
    this.currentData = data;
    return this.save(data);
  }

  async reload(): Promise<PaperNotesData> {
    await this.flush();
    const dataPath = this.absolute(this.paths.dataFile);
    const raw = await readFile(dataPath, 'utf8');
    const migration = migratePaperNotesData(JSON.parse(stripBom(raw)), {
      legacyRootFile: this.paths.legacyRootFile,
      legacyQuickScript: this.paths.legacyQuickScript,
      legacyFullScript: this.paths.legacyFullScript
    });
    await this.assertProjectSafe(migration.data.project);
    this.currentData = migration.data;
    if (migration.migrated) {
      await this.backupPreviousSchema(raw);
      return this.save(migration.data);
    }
    return migration.data;
  }

  async save(data: PaperNotesData = this.data, knownSources?: ProjectSources): Promise<PaperNotesData> {
    return this.enqueue(async () => {
      if (this.disposed) {
        throw new Error('Paper Notes store is closed.');
      }
      assertValidData(data);
      await this.assertProjectSafe(data.project);
      const sources = knownSources ?? await this.readSources(data.project.sourceFiles);
      const generated = synchronizeAndGenerate(data, sources);
      // Validate both products before replacing either live file.
      assertValidData(JSON.parse(generated.json));
      if (!generated.tex.includes(`data-sha256=${generated.hash}`)) {
        throw new Error('Generated TeX failed its data hash validation.');
      }
      const dataPath = this.absolute(this.paths.dataFile);
      const texPath = this.absolute(data.project.generatedNotesFile);
      await atomicWritePair(dataPath, generated.json, texPath, generated.tex);
      this.currentData = generated.data;
      return generated.data;
    });
  }

  async updateNote(updated: PaperNote): Promise<PaperNotesData> {
    const existing = this.data.notes.find((note) => note.id === updated.id);
    if (!existing) {
      throw new Error(`Note ${updated.id} no longer exists.`);
    }
    const incomingRevision = Math.max(0, Math.trunc(updated.revision ?? existing.revision ?? 0));
    const savedRevision = Math.max(0, existing.revision ?? 0);
    if (incomingRevision < savedRevision) {
      throw new Error(`A stale save for ${updated.id} was rejected (${incomingRevision} < ${savedRevision}).`);
    }
    const next = structuredClone(this.data);
    const index = next.notes.findIndex((note) => note.id === updated.id);
    next.notes[index] = {
      ...updated,
      id: existing.id,
      documentId: 'main',
      sourceFile: existing.sourceFile,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      revision: Math.max(savedRevision + 1, incomingRevision)
    };
    return this.save(next);
  }

  async addNote(note: PaperNote): Promise<PaperNotesData> {
    if (this.data.notes.some((candidate) => candidate.id === note.id)) {
      throw new Error(`Note ID ${note.id} already exists.`);
    }
    const next = structuredClone(this.data);
    next.notes.push({ ...note, revision: note.revision ?? 0 });
    return this.save(next);
  }

  async deleteNote(id: string): Promise<PaperNotesData> {
    const next = structuredClone(this.data);
    next.notes = next.notes.filter((note) => note.id !== id);
    return this.save(next);
  }

  async updateProject(project: PaperNotesProject): Promise<PaperNotesData> {
    const next = structuredClone(this.data);
    next.project = project;
    return this.save(next);
  }

  async readSources(sourceFiles = this.project.sourceFiles): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const sourceFile of sourceFiles) {
      const safe = await resolveInsideProject(this.workspaceRoot, sourceFile, false);
      result.set(sourceFile, await readFile(safe, 'utf8'));
    }
    return result;
  }

  async flush(): Promise<void> {
    await this.writeTail;
  }

  async dispose(): Promise<void> {
    await this.flush();
    this.disposed = true;
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const run = this.writeTail.then(action, action);
    this.writeTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async assertProjectSafe(project: PaperNotesProject): Promise<void> {
    for (const path of [
      project.rootFile,
      ...project.sourceFiles,
      project.notesDir,
      project.generatedNotesFile,
      project.annotatedWrapper,
      project.annotatedPdf,
      project.notesPdf,
      project.build.quickScript,
      project.build.fullScript
    ].filter((path): path is string => Boolean(path))) {
      await resolveInsideProject(this.workspaceRoot, path, true);
    }
  }

  private async findLegacyMarkerOwners(parsed: Record<string, unknown>): Promise<Map<string, string>> {
    const legacyProject = parsed.project as Record<string, unknown> | undefined;
    const rootFile = normalizeRelativePosixPath(
      typeof legacyProject?.mainFile === 'string'
        ? legacyProject.mainFile
        : this.paths.legacyRootFile ?? 'main.tex'
    );
    const owners = new Map<string, string>();
    let sourceFiles = [rootFile];
    try {
      sourceFiles = (await discoverSourceGraph(this.workspaceRoot, rootFile)).sourceFiles;
    } catch {
      // The legacy single-file migration still works if dependency discovery fails.
    }
    for (const sourceFile of sourceFiles) {
      try {
        const source = await readFile(this.absolute(sourceFile), 'utf8');
        for (const marker of scanMarkers(source).ranges) {
          if (!owners.has(marker.id)) {
            owners.set(marker.id, sourceFile);
          }
        }
      } catch {
        // Validation will report an unavailable source after migration.
      }
    }
    return owners;
  }

  private async backupPreviousSchema(raw: string): Promise<void> {
    const backupPath = this.absolute(this.paths.schemaBackupFile);
    if (!(await exists(backupPath))) {
      await atomicWrite(backupPath, raw);
    }
  }
}

export function defaultStorePaths(overrides: Partial<StorePaths> = {}): StorePaths {
  return {
    dataFile: 'notes/paper-notes.json',
    legacyRootFile: undefined,
    legacyGeneratedNotesFile: 'notes/main_notes.tex',
    legacyBackupFile: 'notes/legacy/main_notes.pre-app.tex',
    schemaBackupFile: 'notes/legacy/paper-notes.schema2.bak.json',
    legacyQuickScript: 'notes/build_main_notes_preview.ps1',
    legacyFullScript: 'notes/build_notes.ps1',
    ...overrides
  };
}

async function atomicWritePair(firstPath: string, firstContent: string, secondPath: string, secondContent: string): Promise<void> {
  const stamp = `${process.pid}-${Date.now()}`;
  const firstTemp = `${firstPath}.${stamp}.tmp`;
  const secondTemp = `${secondPath}.${stamp}.tmp`;
  const firstRollback = `${firstPath}.${stamp}.rollback`;
  const secondRollback = `${secondPath}.${stamp}.rollback`;
  const firstExisted = await exists(firstPath);
  const secondExisted = await exists(secondPath);
  await mkdir(dirname(firstPath), { recursive: true });
  await mkdir(dirname(secondPath), { recursive: true });
  await writeFile(firstTemp, firstContent, 'utf8');
  await writeFile(secondTemp, secondContent, 'utf8');

  if (firstExisted) {
    await copyFile(firstPath, `${firstPath}.last-good`);
    await copyFile(firstPath, firstRollback);
  }
  if (secondExisted) {
    await copyFile(secondPath, `${secondPath}.last-good`);
    await copyFile(secondPath, secondRollback);
  }
  try {
    await replacePreparedFile(firstTemp, firstPath);
    await replacePreparedFile(secondTemp, secondPath);
  } catch (error) {
    await restoreRollback(firstPath, firstRollback, firstExisted);
    await restoreRollback(secondPath, secondRollback, secondExisted);
    throw error;
  } finally {
    await Promise.all([
      rm(firstTemp, { force: true }), rm(secondTemp, { force: true }),
      rm(firstRollback, { force: true }), rm(secondRollback, { force: true })
    ]);
  }
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const temp = `${target}.${process.pid}-${Date.now()}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temp, content, 'utf8');
  if (await exists(target)) {
    await copyFile(target, `${target}.last-good`);
  }
  await replacePreparedFile(temp, target);
}

async function replacePreparedFile(temp: string, target: string): Promise<void> {
  try {
    await rename(temp, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM') {
      throw error;
    }
    await rm(target, { force: true });
    await rename(temp, target);
  }
}

async function restoreRollback(target: string, rollback: string, existed: boolean): Promise<void> {
  await rm(target, { force: true });
  if (existed && await exists(rollback)) {
    await copyFile(rollback, target);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
