import { useEffect, useState } from 'react';
import { loadTuringReplayArchive, TURING_REPLAY_ARCHIVE_CHANGED, type TuringReplayArchive } from '@/lib/turingCupReplayArchive';

export function useTuringReplayArchive(owner?: string, enabled = true) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ owner: string; archive?: TuringReplayArchive; error?: string }>();

  useEffect(() => {
    if (!owner || !enabled) return;
    let active = true;
    let attempt = 0;
    const load = () => {
      const request = ++attempt;
      void loadTuringReplayArchive(owner).then(archive => {
        if (active && request === attempt) setResult({ owner, archive });
      }, () => {
        if (active && request === attempt) setResult({ owner, error: '读取账号行情失败，请重试' });
      });
    };
    const changed = (event: Event) => { if ((event as CustomEvent).detail === owner) load(); };
    window.addEventListener(TURING_REPLAY_ARCHIVE_CHANGED, changed);
    load();
    return () => { active = false; window.removeEventListener(TURING_REPLAY_ARCHIVE_CHANGED, changed); };
  }, [owner, enabled, revision]);

  const current = result?.owner === owner ? result : undefined;
  return { archive: current?.archive, loading: !!owner && enabled && !current, error: current?.error, retry: () => {
    setResult(undefined);
    setRevision(previous => previous + 1);
  } };
}
