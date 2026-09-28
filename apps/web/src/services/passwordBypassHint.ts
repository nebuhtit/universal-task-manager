const PASSWORD_BYPASS_HINT_KEY = 'utm:password-bypass-requested:v1';

export function hasPasswordBypassHint(): boolean {
  try { return globalThis.localStorage.getItem(PASSWORD_BYPASS_HINT_KEY) === '1'; }
  catch { return false; }
}

export function setPasswordBypassHint(enabled: boolean): void {
  try {
    if (enabled) globalThis.localStorage.setItem(PASSWORD_BYPASS_HINT_KEY, '1');
    else globalThis.localStorage.removeItem(PASSWORD_BYPASS_HINT_KEY);
  } catch { /* The verified IndexedDB record remains authoritative. */ }
}
