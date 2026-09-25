import { describe, expect, it } from 'vitest';
import { renderFailureDetails, safeRenderFailureDetails } from './renderFailure';

describe('privacy-safe render failures', () => {
  it('retains bundled stack locations without private messages or URLs', () => {
    const error = new TypeError('Private task and password');
    error.stack = 'Private task\nf@http://127.0.0.1:49381/assets/SettingsPage-Ab_9.js:12:34\nf@https://private.test/user.js?secret:1:2';
    expect(renderFailureDetails(error)).toBe('{"category":"type-error","frames":["assets/SettingsPage-Ab_9.js:12:34"]}');
    expect(safeRenderFailureDetails(renderFailureDetails(error))).toBe(renderFailureDetails(error));
  });
  it('categorizes module, hook and date failures', () => {
    expect(JSON.parse(renderFailureDetails(new Error('Importing a module script failed.'))).category).toBe('chunk-load');
    expect(JSON.parse(renderFailureDetails(new Error('Minified React error #310'))).category).toBe('react-hooks');
    expect(JSON.parse(renderFailureDetails(new RangeError('Invalid time value'))).category).toBe('invalid-date');
  });
  it('revalidates exported records and removes arbitrary fields', () => {
    expect(safeRenderFailureDetails(JSON.stringify({ category: 'unexpected', password: 'secret', frames: ['private title', '/Users/private', 'assets/index-Ab.js:1:2'] }))).toBe('{"category":"unexpected","frames":["assets/index-Ab.js:1:2"]}');
    expect(safeRenderFailureDetails('{"category":"secret"}')).toBeUndefined();
  });
});
