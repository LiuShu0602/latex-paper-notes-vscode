import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [annotatedPath, notesPath, noteId] = process.argv.slice(2);
if (!annotatedPath || !notesPath || !noteId) {
  console.error('Usage: node scripts/audit-pdfs.mjs <annotated.pdf> <notes.pdf> <semantic-id>');
  process.exit(2);
}

async function load(path) {
  return getDocument({ data: new Uint8Array(await readFile(path)), isEvalSupported: false }).promise;
}

async function annotations(document) {
  const result = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    result.push(...await page.getAnnotations());
  }
  return result;
}

const annotated = await load(annotatedPath);
const notes = await load(notesPath);
const paperDestination = await annotated.getDestination(`pnote.main.${noteId}`);
const noteDestination = await notes.getDestination(`note.main.${noteId}`);
const annotatedLinks = await annotations(annotated);
const notesLinks = await annotations(notes);
const linkText = (item) => JSON.stringify({ url: item.url, unsafeUrl: item.unsafeUrl, dest: item.dest, action: item.action });

const checks = {
  paperDestination: Boolean(paperDestination),
  noteDestination: Boolean(noteDestination),
  annotatedToNotes: annotatedLinks.some((item) => linkText(item).includes(noteId) || linkText(item).includes('paper_notes.pdf')),
  notesToPaper: notesLinks.some((item) => linkText(item).includes(noteId) || linkText(item).includes('paper_annotated.pdf')),
  notesToEditor: notesLinks.some((item) => linkText(item).includes(`paper-notes-editor:main:${noteId}`))
};
console.log(JSON.stringify({ pages: { annotated: annotated.numPages, notes: notes.numPages }, checks }, null, 2));
await annotated.destroy();
await notes.destroy();
if (Object.values(checks).some((value) => !value)) {
  process.exitCode = 1;
}
