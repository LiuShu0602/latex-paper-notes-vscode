import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accessibleAccent,
  contrastRatio,
  normalizeCustomTypeName,
  normalizeHexColor,
  pdfReadableColor
} from '../src/note-types.js';

test('validates Unicode custom names and canonicalizes colors', () => {
  assert.equal(normalizeCustomTypeName('  推导思路  '), '推导思路');
  assert.equal(normalizeHexColor('abc'), '#AABBCC');
  assert.equal(normalizeHexColor('#12aBef'), '#12ABEF');
  assert.throws(() => normalizeCustomTypeName('x\u0000y'), /control/i);
  assert.throws(() => normalizeCustomTypeName('界'.repeat(33)), /1–32/);
  assert.throws(() => normalizeHexColor('#abcd'), /hexadecimal/i);
});

test('derives readable semantic accents for light and dark surfaces', () => {
  const pdf = pdfReadableColor('#FFE66D');
  assert.ok(contrastRatio(pdf, '#FFFFFF') >= 4.5);
  const dark = accessibleAccent('#182030', '#111111', 3);
  assert.ok(contrastRatio(dark, '#111111') >= 3);
});
