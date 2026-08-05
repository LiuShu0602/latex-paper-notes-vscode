import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFArray, PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';

const output = resolve('test', '.generated');
await mkdir(output, { recursive: true });
const id = 'method:offset-correction';

function addNamedDestination(document, name, page) {
  const destination = document.context.obj([page.ref, PDFName.of('XYZ'), 0, page.getHeight(), null]);
  const names = document.context.obj({ Names: [PDFString.of(name), destination] });
  document.catalog.set(PDFName.of('Names'), document.context.obj({ Dests: names }));
}

function addUriLink(document, page, uri, rectangle) {
  const annotation = document.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rectangle,
    Border: [0, 0, 0],
    A: { S: 'URI', URI: PDFString.of(uri) }
  });
  let annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annotations) {
    annotations = document.context.obj([]);
    page.node.set(PDFName.of('Annots'), annotations);
  }
  annotations.push(annotation);
}

async function annotatedPaper() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.TimesRoman);
  const blue = rgb(0.08, 0.32, 0.72);
  const page = document.addPage([612, 792]);
  document.addPage([612, 792]).drawText('Synthetic appendix page', { x: 72, y: 700, font, size: 14 });
  page.drawText('A Synthetic Paper', { x: 72, y: 720, font, size: 22 });
  page.drawText('Subtracting a fixed offset preserves the order of sensor readings.', { x: 72, y: 650, font, size: 13, color: blue });
  page.drawText('[N1.1]', { x: 462, y: 650, font, size: 10, color: blue });
  addNamedDestination(document, `pnote.main.${id}`, page);
  addUriLink(document, page, `paper_notes.pdf#nameddest=note.main.${id}`, [458, 644, 505, 666]);
  return document.save();
}

async function notesPdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.TimesRoman);
  const blue = rgb(0.08, 0.32, 0.72);
  const page = document.addPage([612, 792]);
  document.addPage([612, 792]).drawText('Note type index', { x: 72, y: 700, font, size: 14 });
  page.drawText('Paper Notes', { x: 72, y: 720, font, size: 22 });
  page.drawText('Why an offset preserves ordering', { x: 72, y: 660, font, size: 16 });
  page.drawText('Page 1 - open annotated source', { x: 72, y: 620, font, size: 12, color: blue });
  page.drawText('Open the structured editor', { x: 72, y: 590, font, size: 12, color: blue });
  addNamedDestination(document, `note.main.${id}`, page);
  addUriLink(document, page, `paper_annotated.pdf#nameddest=pnote.main.${id}`, [68, 614, 270, 634]);
  addUriLink(document, page, `paper-notes-editor:main:${id}`, [68, 584, 240, 604]);
  return document.save();
}

await writeFile(resolve(output, 'annotated.pdf'), await annotatedPaper());
await writeFile(resolve(output, 'notes.pdf'), await notesPdf());
