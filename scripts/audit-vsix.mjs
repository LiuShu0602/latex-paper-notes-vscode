import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AdmZip from 'adm-zip';

let target = process.argv[2];
if (!target) {
  const candidates = (await readdir('.')).filter((name) => /^latex-paper-notes-.*\.vsix$/i.test(name)).sort();
  target = candidates.at(-1);
}
if (!target) {
  throw new Error('No latex-paper-notes VSIX was found.');
}
const absolute = resolve(target);
const archive = new AdmZip(absolute);
const entries = archive.getEntries().filter((entry) => !entry.isDirectory);
const forbiddenEntry = /(?:^|\/)(?:notes|build)(?:\/|$)|\.(?:tex|pdf|synctex(?:\.gz)?|aux|fls|fdb_latexmk|log|sha256)$/i;
const forbiddenContent = [
  /[A-Za-z]:\\(?:Users|Documents|Research|研究|论文)[^\s"']*/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}/i
];
const problems = [];
for (const entry of entries) {
  const name = entry.entryName.replace(/\\/g, '/');
  if (forbiddenEntry.test(name)) {
    problems.push(`forbidden artifact path: ${name}`);
  }
  if (/\.(?:js|json|md|txt|css|html)$/i.test(name)) {
    const content = entry.getData().toString('utf8');
    for (const pattern of forbiddenContent) {
      if (pattern.test(content)) {
        problems.push(`sensitive content pattern ${pattern} in ${name}`);
      }
    }
  }
}
if (problems.length > 0) {
  throw new Error(`VSIX privacy audit failed:\n${problems.join('\n')}`);
}
console.log(`VSIX privacy audit passed: ${target} (${entries.length} files, no paper or build artifact).`);
