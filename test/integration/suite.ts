import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as vscode from 'vscode';

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('latex-paper-notes.latex-paper-notes');
  assert.ok(extension, 'The development extension is not installed in the test host.');
  await extension.activate();

  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'The synthetic example workspace was not opened.');
  const methodUri = vscode.Uri.file(resolve(folder.uri.fsPath, 'sections', 'method.tex'));
  const document = await vscode.workspace.openTextDocument(methodUri);
  await vscode.window.showTextDocument(document);

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    'paperNotes.openPanel', 'paperNotes.addFromSelection', 'paperNotes.validate',
    'paperNotes.rescanSources', 'paperNotes.repairIntegration'
  ]) {
    assert.ok(commands.includes(command), `Missing command: ${command}`);
  }

  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', methodUri);
  assert.ok(lenses?.some((lens) => lens.command?.arguments?.[0] === 'method:offset-correction'));
  await vscode.commands.executeCommand('paperNotes.validate');

  const data = JSON.parse(await readFile(resolve(folder.uri.fsPath, 'notes', 'paper-notes.json'), 'utf8')) as {
    schemaVersion?: number;
    project?: { sourceFiles?: string[] };
    notes?: Array<{ id?: string; sourceFile?: string }>;
  };
  assert.equal(data.schemaVersion, 3);
  assert.deepEqual(data.project?.sourceFiles, ['main.tex', 'sections/introduction.tex', 'sections/method.tex']);
  assert.ok(data.notes?.some((note) => note.id === 'method:offset-correction' && note.sourceFile === 'sections/method.tex'));
}
