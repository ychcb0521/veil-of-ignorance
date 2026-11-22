import {ensureCriticalStorageHeadroom} from './persistedStateStorage';

const tabKey = 'veil.auth.private-tab.v1';
let isolatedKey: string | undefined;

// A full origin can still have an older trading page that needs every legacy
// record. In that case use the separate tab quota and a separate SDK channel.
export function prepareLoginStorage() {
  try {
    isolatedKey = sessionStorage.getItem(tabKey) || undefined;
    if (isolatedKey || Object.keys(localStorage).some(key => /^sb-.+-auth-token$/.test(key))) return;
    if (ensureCriticalStorageHeadroom() !== 'full') return;
    const key = 'sb-tab-' + crypto.randomUUID() + '-auth-token';
    sessionStorage.setItem(tabKey, key);
    isolatedKey = key;
  } catch { /* The normal auth recovery screen handles unavailable storage. */ }
}

export function loginStorage(): Storage {
  return isolatedKey ? sessionStorage : localStorage;
}

export function isolatedLoginOptions() {
  return isolatedKey ? {storageKey: isolatedKey, storage: sessionStorage} : {};
}
