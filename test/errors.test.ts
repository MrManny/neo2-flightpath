import { expect, it } from 'vitest';

import { errorMessage } from '../src/errors.js';

it.for([
  { name: 'Error', value: new Error('boom'), want: 'boom' },
  { name: 'Error subclass', value: new TypeError('bad type'), want: 'bad type' },
  { name: 'string throw', value: 'string failure', want: 'string failure' },
  { name: 'number throw', value: 42, want: '42' },
  { name: 'null throw', value: null, want: 'null' },
])('errorMessage: $name', ({ value, want }) => {
  expect(errorMessage(value)).toBe(want);
});
