import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveLoginFormSnapshot, resolveLoginSubmission } from './authFormState';

test('resolveLoginSubmission prefers real form values from browser autofill', () => {
  const submitted = resolveLoginSubmission(
    { email: '', password: '' },
    { email: 'autofilled@example.com', password: 'autofilled-password' }
  );

  assert.deepEqual(submitted, {
    email: 'autofilled@example.com',
    password: 'autofilled-password',
  });
});

test('resolveLoginSubmission falls back to React state when form values are empty', () => {
  const submitted = resolveLoginSubmission(
    { email: 'typed@example.com', password: 'typed-password' },
    { email: '', password: '' }
  );

  assert.deepEqual(submitted, {
    email: 'typed@example.com',
    password: 'typed-password',
  });
});

test('preserveLoginFormSnapshot keeps submitted login inputs after a failed sign in', () => {
  const snapshot = preserveLoginFormSnapshot({
    email: 'person@example.com',
    password: 'typed-password',
  });

  assert.deepEqual(snapshot, {
    email: 'person@example.com',
    password: 'typed-password',
  });
});
