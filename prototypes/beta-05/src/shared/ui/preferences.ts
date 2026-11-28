export function uiPreference(key: string) {
  try { return localStorage.getItem('laterna-beta05:ui:' + key) === '1'; }
  catch { return false; }
}

export function saveUiPreference(key: string, value = true) {
  try { localStorage.setItem('laterna-beta05:ui:' + key, value ? '1' : '0'); }
  catch { /* continue with in-memory preference */ }
}
