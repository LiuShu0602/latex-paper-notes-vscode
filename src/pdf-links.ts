export type PdfLinkTarget =
  | { kind: 'paper'; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'noteEditor'; id: string };

export function parsePdfLinkTarget(annotation: unknown): PdfLinkTarget | undefined {
  const serialized = safelyDecodeUri(JSON.stringify(annotation));
  const editorMatch = /paper-notes-editor:main:([a-z][a-z0-9:-]*)/i.exec(serialized);
  if (editorMatch?.[1]) {
    return { kind: 'noteEditor', id: editorMatch[1] };
  }
  const paperMatch = /(?:^|[^a-z])pnote(?:\.|:)main(?:\.|:)([a-z][a-z0-9:-]*)/i.exec(serialized);
  if (paperMatch?.[1]) {
    return { kind: 'paper', id: paperMatch[1] };
  }
  const noteMatch = /(?:^|[^a-z])note(?:\.|:)main(?:\.|:)([a-z][a-z0-9:-]*)/i.exec(serialized);
  if (noteMatch?.[1]) {
    return { kind: 'note', id: noteMatch[1] };
  }
  return undefined;
}

function safelyDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
