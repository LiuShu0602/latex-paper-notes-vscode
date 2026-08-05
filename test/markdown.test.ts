import assert from 'node:assert/strict';
import test from 'node:test';
import { containsRawHtml, markdownExcerptToLatex, markdownToLatex } from '../src/markdown.js';

test('converts structured markdown while escaping ordinary TeX characters', () => {
  const output = markdownToLatex(`## 小标题

这里有 **重点**、50% 与 $x_i^2$。

- 第一项
- 第二项`);
  assert.match(output, /\\NoteHeading\{小标题\}/);
  assert.match(output, /\\textbf\{重点\}/);
  assert.match(output, /50\\%/);
  assert.match(output, /\$x_i\^2\$/);
  assert.match(output, /\\begin\{itemize\}/);
});

test('converts links, quotes and GFM tables', () => {
  const output = markdownToLatex(`> 说明

[链接](https://example.com/a?x=1)

| 项目 | 说明 |
|---|---|
| A | 内容 |`);
  assert.match(output, /\\begin\{quote\}/);
  assert.match(output, /\\href\{https:\/\/example\.com\/a\?x=1\}\{链接\}/);
  assert.match(output, /\\begin\{tabularx\}/);
  assert.match(output, /\\toprule/);
});

test('raw HTML is detectable and rendered as text', () => {
  assert.equal(containsRawHtml('<script>alert(1)</script>'), true);
  const output = markdownToLatex('<b>not html</b>');
  assert.match(output, /textless/);
});

test('source excerpts preserve safe LaTeX text accents', () => {
  assert.equal(markdownExcerptToLatex('M\\"uller and Andr\\\'e'), 'M\\"uller and Andr\\\'e\\par');
  assert.match(markdownExcerptToLatex('raw \\input{secret}'), /textbackslash/);
});
