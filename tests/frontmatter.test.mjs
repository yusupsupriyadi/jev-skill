import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, isTruthy } from '../scripts/lib/frontmatter.mjs';

test('reads a plain scalar description', () => {
  const meta = parseFrontmatter('---\ndescription: Does a thing\n---\nbody');
  assert.equal(meta.description, 'Does a thing');
});

test('strips quotes around a description', () => {
  const meta = parseFrontmatter('---\ndescription: "Quoted, with a comma"\n---\n');
  assert.equal(meta.description, 'Quoted, with a comma');
});

test('reads a folded block', () => {
  const meta = parseFrontmatter('---\ndescription: >\n  first line\n  second line\nname: x\n---\n');
  assert.equal(meta.description, 'first line second line');
  assert.equal(meta.name, 'x');
});

test('coerces booleans so disable-model-invocation is detectable', () => {
  const meta = parseFrontmatter('---\ndisable-model-invocation: true\n---\n');
  assert.equal(meta['disable-model-invocation'], true);
  assert.equal(isTruthy(meta['disable-model-invocation']), true);
});

test('returns empty for a file without frontmatter', () => {
  assert.deepEqual(parseFrontmatter('# Just a heading\n'), {});
});
