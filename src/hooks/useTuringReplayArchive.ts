import { useEffect, useState } from 'react';
import { loadTuringReplayArchive, readLocalTuringReplayArchive, TURING_REPLAY_ARCHIVE_CHANGED, type TuringReplayArchive } from '@/lib/turingCupReplayArchive';

export function useTuringReplayArchive(owner?: string, enabled = true) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ owner: string; archive?: TuringReplayArchive; error?: string }>();

  useEffect(() => {
    if (!owner || !enabled) return;
    let active = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const load = () => {
      const request = ++attempt;
      clearTimeout(timer);
      const isCurrent = () => active && request === attempt;
      const fail = (error: string) => {
        if (isCurrent()) setResult(previous => previous?.owner === owner && previous.archive ? previous : { owner, error });
      };
      timer = setTimeout(() => fail('读取回放归档超时，请重试'), 50_000);
      let restored = false;
      void readLocalTuringReplayArchive(owner).then(archive => {
        if (archive && !restored && isCurrent()) setResult({ owner, archive });
      }, () => {});
      void loadTuringReplayArchive(owner).then(archive => {
        if (!isCurrent()) return;
        restored = true;
        clearTimeout(timer);
        setResult({ owner, archive });
      }, () => {
        if (!isCurrent()) return;
        clearTimeout(timer);
        fail('读取账号行情失败，请重试');
      });
    };
    const changed = (event: Event) => { if ((event as CustomEvent).detail === owner) load(); };
    window.addEventListener(TURING_REPLAY_ARCHIVE_CHANGED, changed);
    load();
    return () => { active = false; clearTimeout(timer); window.removeEventListener(TURING_REPLAY_ARCHIVE_CHANGED, changed); };
  }, [owner, enabled, revision]);

  const current = result?.owner === owner ? result : undefined;
  return { archive: current?.archive, loading: !!owner && enabled && !current, error: current?.error, retry: () => {
    setResult(undefined);
    setRevision(previous => previous + 1);
  } };
}
