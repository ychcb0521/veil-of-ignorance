type ReadIssue = 'revision' | 'network' | 'quota';
const issues = new Map<string, ReadIssue>();

export class ArchiveReadFailure extends Error {
  constructor(readonly issue: ReadIssue) { super(issue === 'revision' ? '云端分片版本不一致或缺失' : issue); }
}
export function setArchiveReadIssue(owner: string, name: string, issue?: ReadIssue) {
  const key = owner + '/' + name;
  if (issue) issues.set(key, issue); else issues.delete(key);
}
export function archiveReadIssue(owner: string | undefined, name: string) {
  return owner ? issues.get(owner + '/' + name) : undefined;
}
export function describeArchiveReadIssue(owner: string | undefined, name: string) {
  switch (archiveReadIssue(owner, name)) {
    case 'revision': return '云端分片缺失或版本与清单不一致，需要同一版本的完整备份。';
    case 'quota': return '浏览器存储空间不足，账号存档未覆盖。';
    case 'network': return '云端分片读取失败，可重试读取。';
  }
}

/** A transient request failure gets one retry in smaller responses.
 * Revision and completeness checks happen after transport, never retried as network errors. */
export async function readArchiveBatch<T>(
  keys: string[], signal: AbortSignal | undefined,
  fetchRows: (keys: string[]) => Promise<T[]>,
): Promise<T[]> {
  try { return await fetchRows(keys); } catch {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted','AbortError');
    const size = Math.ceil(keys.length / 2);
    const rows: T[] = [];
    try {
      for (let i = 0; i < keys.length; i += size) {
        if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted','AbortError');
        rows.push(...await fetchRows(keys.slice(i, i + size)));
      }
      return rows;
    } catch {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted','AbortError');
      throw new ArchiveReadFailure('network');
    }
  }
}
