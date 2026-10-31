import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { uiExportRoot } from '../src/apppaths.js';

describe('uiExportRoot', () => {
  it('resolves ui/out as a sibling of the app shell directory', () => {
    expect(uiExportRoot(path.join('repo', 'app'))).toBe(path.join('repo', 'ui', 'out'));
    expect(uiExportRoot(path.join('C:', 'src', 'app'))).toBe(path.join('C:', 'src', 'ui', 'out'));
  });

  it('works from inside app.asar', () => {
    expect(uiExportRoot(path.join('resources', 'app.asar', 'app'))).toBe(
      path.join('resources', 'app.asar', 'ui', 'out'),
    );
  });
});
