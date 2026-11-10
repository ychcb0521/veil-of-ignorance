import {createContext, useContext, useRef, useState, type ReactNode} from 'react';
import {flushSync} from 'react-dom';
import {ImageDown} from 'lucide-react';
import {readSettingsImage, downloadSettingsImage} from '@/lib/settingsImageExport';

const CaptureContext = createContext(false);
const ActionContext = createContext<{busy:boolean; generate:()=>void} | null>(null);
/** Only adds read-only export projections; never saves or parses executable plans. */
export const useSettingsImageCapture = () => useContext(CaptureContext);

export function SettingsImageScope({title, children}:{title:string; children:ReactNode}) {
  const root = useRef<HTMLDivElement>(null), running = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const generate = async () => {
    if (running.current || !root.current) return;
    running.current = true;
    setMessage(''); setError('');
    try {
      // Commit all additional rounds/branches synchronously, then freeze text before async encoding.
      flushSync(() => setBusy(true));
      const blocks = readSettingsImage(root.current);
      const count = await downloadSettingsImage(title, blocks);
      setMessage(count === 1 ? '图片已生成并下载' : `已生成 ${count} 张完整图片并打包下载`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片生成失败，请重试');
    } finally {
      setBusy(false); running.current = false;
    }
  };
  return <ActionContext.Provider value={{busy, generate:()=>void generate()}}><CaptureContext.Provider value={busy}>
    <div ref={root} className="contents" data-settings-image-root="">
      {children}
      <div data-settings-image-skip="" aria-live="polite">{message && <p role="status" className="px-3 py-1 text-xs text-primary">{message}</p>}{error && <p role="alert" className="px-3 py-1 text-xs text-destructive">{error}</p>}</div>
    </div>
  </CaptureContext.Provider></ActionContext.Provider>;
}

export function SettingsImageButton({className=''}:{className?:string}) {
  const action = useContext(ActionContext);
  return <button type="button" data-settings-image-skip="" disabled={!action || action.busy} onClick={action?.generate}
    title="生成并下载完整信息图片（包含折叠内容与全部参数）"
    className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-40 ${className}`}>
    <ImageDown aria-hidden className="h-3.5 w-3.5"/>{action?.busy ? '生成中…' : '生成图片'}
  </button>;
}
