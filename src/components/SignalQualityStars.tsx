import { memo, useCallback, useRef, type MouseEvent } from 'react';
import { Star } from 'lucide-react';
import { SIGNAL_QUALITY_MAX } from '@/lib/signalLibrary';

interface Props {
  value: number | undefined;
  onChange: (next: number) => void;
  /** 信号 id，仅用于 aria / testid 定位。 */
  signalId: string;
}

/**
 * 信号质量的五星评分。
 *
 * 刻意做成**行内五颗星**而不是下拉或弹窗：这一列的用途是扫一眼就能比较，
 * 而下拉要点两次才看得到值。点第 N 颗星 = 打 N 分；再点同一颗 = 取消评分
 * （否则误点之后没有退路，只能删掉整条信号）。
 *
 * 必须是跳转按钮的**兄弟节点**，不能嵌在里面：整行本身就是一个 <button>，
 * 按钮套按钮既是非法 HTML，点星星也会顺带把盘面跳走。
 *
 * 整组 memo 化，且五颗星共用同一个恒定的点击处理器（星数从 data-star 上读）。
 * 信号库里每行一组星，791 行就是 3955 个按钮——每颗星每次渲染各造一个闭包，
 * 等于让「隔壁行变了」也要把这一行的五个闭包全部重建一遍。
 */
function SignalQualityStarsImpl({ value, onChange, signalId }: Props) {
  const current = value ?? 0;
  // onChange 可能每次渲染都是新的闭包；用 ref 兜住，处理器本身就能恒定。
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    // 整行是跳转按钮，不拦住就会一边评分一边把盘面跳走
    event.stopPropagation();
    const star = Number(event.currentTarget.dataset.star);
    if (Number.isFinite(star) && star > 0) onChangeRef.current(star);
  }, []);

  return (
    <span
      data-testid={`signal-quality-${signalId}`}
      className="flex shrink-0 items-center gap-px"
      role="radiogroup"
      aria-label="信号质量"
    >
      {Array.from({ length: SIGNAL_QUALITY_MAX }, (_, i) => {
        const star = i + 1;
        const on = star <= current;
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={star === current}
            aria-label={`${star} 星`}
            data-testid={`signal-quality-${signalId}-${star}`}
            data-star={star}
            title={star === current ? '再点一次取消评分' : `评 ${star} 星`}
            onClick={handleClick}
            className="p-0 leading-none transition-transform hover:scale-110 active:scale-95"
          >
            <Star
              className={`h-3 w-3 ${
                on ? 'fill-[#F0B90B] text-[#F0B90B]' : 'text-muted-foreground/35'
              }`}
            />
          </button>
        );
      })}
    </span>
  );
}

export const SignalQualityStars = memo(SignalQualityStarsImpl);
