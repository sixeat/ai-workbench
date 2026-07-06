import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptionalNumberInput, parseOptionalRatioInput } from './modelCapabilityForm';

test('parseOptionalNumberInput keeps ordinary numeric fields strict', () => {
  assert.equal(parseOptionalNumberInput(''), undefined);
  assert.equal(parseOptionalNumberInput(' 24 '), 24);
  assert.equal(parseOptionalNumberInput('1:8'), undefined);
  assert.equal(parseOptionalNumberInput('not-a-number'), undefined);
});

test('parseOptionalRatioInput accepts decimal and ratio notation', () => {
  assert.equal(parseOptionalRatioInput(''), undefined);
  assert.equal(parseOptionalRatioInput('0.125'), 0.125);
  assert.equal(parseOptionalRatioInput('1:8'), 0.125);
  assert.equal(parseOptionalRatioInput('8:1'), 8);
  assert.equal(parseOptionalRatioInput('16 : 9'), 16 / 9);
  assert.equal(parseOptionalRatioInput('0:9'), undefined);
  assert.equal(parseOptionalRatioInput('16:0'), undefined);
  assert.equal(parseOptionalRatioInput('wide'), undefined);
});
