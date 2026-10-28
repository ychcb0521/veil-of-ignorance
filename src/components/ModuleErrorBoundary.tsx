import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CircleAlert, RotateCcw } from 'lucide-react';
import { BUILD_STAMP } from '@/lib/buildStamp';
import { describeRenderFailure, recordRenderFailure, type RenderFailure, type RenderFailureRecord } from '@/lib/renderFailure';

interface Props {
  children: ReactNode;
  label: string;
  page?: boolean;
  /** Only use when the task hooks live above this boundary. */
  backgroundTasks?: boolean;
}
interface State { failure: RenderFailure | null; record: RenderFailureRecord | null }

/** Recover the display without remounting task owners, reloading the page or clearing saved data. */
export class ModuleErrorBoundary extends Component<Props, State> {
  state: State = { failure: null, record: null };
  static getDerivedStateFromError(error: unknown): Partial<State> { return { failure: describeRenderFailure(error), record: null }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ record: recordRenderFailure(this.props.label, error, info.componentStack ?? '') });
  }
  render() {
    const { failure, record } = this.state;
    if (!failure) return this.props.children;
    const { label, page, backgroundTasks } = this.props, resource = failure.kind === 'resource';
    return <div role="alert" data-testid="module-render-error" className={page ? 'flex min-h-[40vh] items-center justify-center p-4' : 'm-3 rounded-lg border border-border/60 bg-muted/20 p-4'}>
      <div className="max-w-xl space-y-3 text-xs">
        <div className="flex items-start gap-2.5"><CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary"/><div className="space-y-1">
          <p className="font-medium text-foreground">{resource ? '页面所需资源未能加载' : `${label}显示暂时异常`}</p>
          <p className="leading-relaxed text-muted-foreground">{page ? '已有交易数据不会被清空。' : backgroundTasks ? '已启动的后台任务继续运行，已完成结果会继续保留。' : '已有数据保留，可单独恢复此模块。'}</p>
        </div></div>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-foreground hover:bg-accent" onClick={resource ? () => window.location.reload() : () => this.setState({ failure: null, record: null })}>
          <RotateCcw aria-hidden className="h-3 w-3"/>{resource ? '重新加载页面' : page ? '恢复页面显示' : `恢复${label}显示`}
        </button>
        {resource && backgroundTasks && <p className="text-[11px] text-muted-foreground">重新加载会中断本页当前计算，已保存结果会保留。</p>}
        <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer hover:text-foreground">查看异常详情</summary><div className="mt-2 space-y-1">
          <p>{BUILD_STAMP}{record ? ` · ${record.id}` : ''}</p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono">{failure.message}</pre>
        </div></details>
      </div>
    </div>;
  }
}
