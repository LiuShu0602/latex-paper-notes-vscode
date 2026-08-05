import MarkdownIt from 'markdown-it';

interface MdToken {
  type: string;
  tag: string;
  content: string;
  children: MdToken[] | null;
  attrGet(name: string): string | null;
}

const parser = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false
});

export function markdownToLatex(markdown: string): string {
  const tokens = parser.parse(markdown.replace(/\r\n/g, '\n'), {}) as unknown as MdToken[];
  return renderBlocks(tokens).trim();
}

/**
 * Source excerpts are normally plain Markdown, but LaTeX papers frequently
 * spell names with text accent commands such as B\"acklund.  Markdown treats
 * those backslashes as escapes.  Preserve only this small, non-executable
 * family while continuing to escape arbitrary raw LaTeX in excerpts.
 */
export function markdownExcerptToLatex(markdown: string): string {
  const accents: string[] = [];
  const protectedMarkdown = markdown.replace(
    /\\(?:["'`^~=.uvHcdbtrk])\s*(?:\{[^{}\r\n]\}|[A-Za-z])/g,
    (accent) => {
      const token = `PNOTEACCENTTOKEN${accents.length}END`;
      accents.push(accent);
      return token;
    }
  );
  const rendered = markdownToLatex(protectedMarkdown);
  return rendered.replace(/PNOTEACCENTTOKEN(\d+)END/g, (_token, index: string) => accents[Number(index)] ?? '');
}

export function escapeLatexText(value: string): string {
  const replacements: Record<string, string> = {
    '\\': '\\textbackslash{}',
    '#': '\\#',
    '$': '\\$',
    '%': '\\%',
    '&': '\\&',
    '_': '\\_',
    '{': '\\{',
    '}': '\\}',
    '^': '\\textasciicircum{}',
    '~': '\\textasciitilde{}',
    '<': '\\textless{}',
    '>': '\\textgreater{}'
  };
  return Array.from(value, (char) => replacements[char] ?? char).join('');
}

export function containsRawHtml(value: string): boolean {
  return /<\/?[A-Za-z][^>]*>/.test(value);
}

function renderBlocks(tokens: MdToken[]): string {
  const output: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    switch (token.type) {
      case 'heading_open': {
        const inline = tokens[index + 1];
        output.push(`\\NoteHeading{${inline?.children ? renderInline(inline.children) : ''}}\n`);
        index += 2;
        break;
      }
      case 'paragraph_open':
      case 'heading_close':
      case 'thead_open':
      case 'thead_close':
      case 'tbody_open':
      case 'tbody_close':
      case 'tr_open':
      case 'tr_close':
      case 'th_open':
      case 'th_close':
      case 'td_open':
      case 'td_close':
        break;
      case 'paragraph_close':
        output.push('\\par\n');
        break;
      case 'inline':
        output.push(token.children ? renderInline(token.children) : renderTextWithMath(token.content));
        break;
      case 'bullet_list_open':
        output.push('\\begin{itemize}\n');
        break;
      case 'bullet_list_close':
        output.push('\\end{itemize}\n');
        break;
      case 'ordered_list_open':
        output.push('\\begin{enumerate}\n');
        break;
      case 'ordered_list_close':
        output.push('\\end{enumerate}\n');
        break;
      case 'list_item_open':
        output.push('\\item ');
        break;
      case 'list_item_close':
        output.push('\n');
        break;
      case 'blockquote_open':
        output.push('\\begin{quote}\n');
        break;
      case 'blockquote_close':
        output.push('\\end{quote}\n');
        break;
      case 'fence':
      case 'code_block':
        output.push(
          '\\begin{tcolorbox}[colback=black!3,colframe=black!20,boxrule=0.4pt]\\ttfamily\\small\n' +
          `${escapeLatexText(token.content.replace(/\n$/, '')).replace(/\n/g, '\\par\n')}\n` +
          '\\end{tcolorbox}\n'
        );
        break;
      case 'hr':
        output.push('\\par\\smallskip\\hrule\\smallskip\n');
        break;
      case 'table_open': {
        const close = findClosingToken(tokens, index, 'table_close');
        output.push(renderTable(tokens.slice(index + 1, close)));
        index = close;
        break;
      }
      case 'html_block':
        output.push(`${escapeLatexText(token.content)}\\par\n`);
        break;
      default:
        break;
    }
  }
  return output.join('');
}

function renderInline(tokens: MdToken[]): string {
  const output: string[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        output.push(renderTextWithMath(token.content));
        break;
      case 'softbreak':
        output.push('\n');
        break;
      case 'hardbreak':
        output.push('\\\\\n');
        break;
      case 'strong_open':
        output.push('\\textbf{');
        break;
      case 'strong_close':
        output.push('}');
        break;
      case 'em_open':
        output.push('\\emph{');
        break;
      case 'em_close':
        output.push('}');
        break;
      case 's_open':
        output.push('\\emph{');
        break;
      case 's_close':
        output.push('}');
        break;
      case 'code_inline':
        output.push(`\\texttt{${escapeLatexText(token.content)}}`);
        break;
      case 'link_open':
        output.push(`\\href{${escapeLatexUrl(token.attrGet('href') ?? '')}}{`);
        break;
      case 'link_close':
        output.push('}');
        break;
      case 'image': {
        const source = token.attrGet('src') ?? '';
        const caption = escapeLatexText(token.content || '图片');
        output.push(
          `\\begin{center}\\includegraphics[width=0.9\\linewidth]{${escapeLatexPath(source)}}` +
          `\\par\\small\\emph{${caption}}\\end{center}`
        );
        break;
      }
      case 'html_inline':
        output.push(escapeLatexText(token.content));
        break;
      default:
        if (token.content) {
          output.push(renderTextWithMath(token.content));
        }
        break;
    }
  }
  return output.join('');
}

function renderTextWithMath(value: string): string {
  const output: string[] = [];
  let plainStart = 0;
  let cursor = 0;
  while (cursor < value.length) {
    if (value[cursor] !== '$' || isEscaped(value, cursor)) {
      cursor += 1;
      continue;
    }
    const delimiter = value[cursor + 1] === '$' ? '$$' : '$';
    const mathStart = cursor + delimiter.length;
    const mathEnd = findUnescaped(value, delimiter, mathStart);
    if (mathEnd < 0) {
      cursor += delimiter.length;
      continue;
    }
    output.push(escapeLatexText(value.slice(plainStart, cursor)));
    const math = value.slice(mathStart, mathEnd);
    output.push(delimiter === '$$' ? `\\[${math}\\]` : `$${math}$`);
    cursor = mathEnd + delimiter.length;
    plainStart = cursor;
  }
  output.push(escapeLatexText(value.slice(plainStart)));
  return output.join('');
}

function renderTable(tokens: MdToken[]): string {
  const rows: string[][] = [];
  let current: string[] | undefined;
  let headerRows = 0;
  let inHeader = false;
  for (const token of tokens) {
    if (token.type === 'thead_open') {
      inHeader = true;
    } else if (token.type === 'thead_close') {
      inHeader = false;
    } else if (token.type === 'tr_open') {
      current = [];
    } else if (token.type === 'tr_close' && current) {
      rows.push(current);
      if (inHeader) {
        headerRows += 1;
      }
      current = undefined;
    } else if (token.type === 'inline' && current) {
      current.push(token.children ? renderInline(token.children) : renderTextWithMath(token.content));
    }
  }
  if (rows.length === 0) {
    return '';
  }
  const columns = Math.max(...rows.map((row) => row.length), 1);
  const lines = rows.map((row, index) => {
    const padded = [...row, ...Array<string>(Math.max(0, columns - row.length)).fill('')];
    const rule = index + 1 === headerRows ? '\n\\midrule' : '';
    return `${padded.join(' & ')} \\\\${rule}`;
  });
  return [
    '\\begin{center}',
    '\\small',
    `\\begin{tabularx}{\\linewidth}{@{}*{${columns}}{>{\\raggedright\\arraybackslash}X}@{}}`,
    '\\toprule',
    ...lines,
    '\\bottomrule',
    '\\end{tabularx}',
    '\\end{center}\n'
  ].join('\n');
}

function findClosingToken(tokens: MdToken[], start: number, type: string): number {
  for (let index = start + 1; index < tokens.length; index += 1) {
    if (tokens[index]?.type === type) {
      return index;
    }
  }
  return tokens.length - 1;
}

function findUnescaped(value: string, delimiter: string, start: number): number {
  let cursor = start;
  while (cursor < value.length) {
    const found = value.indexOf(delimiter, cursor);
    if (found < 0) {
      return -1;
    }
    if (!isEscaped(value, found)) {
      return found;
    }
    cursor = found + delimiter.length;
  }
  return -1;
}

function isEscaped(value: string, position: number): boolean {
  let slashes = 0;
  for (let cursor = position - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function escapeLatexUrl(value: string): string {
  return value.replace(/([#%&_{}])/g, '\\$1');
}

function escapeLatexPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/([#%&_{} ])/g, '\\$1');
}
