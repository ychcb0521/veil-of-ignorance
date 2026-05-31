export interface HedgeBoundaryBasisDraft {
  whyRight: string;
  failureReason: string;
  invalidationSignal: string;
}

export interface ParsedHedgeBoundaryBasis extends HedgeBoundaryBasisDraft {
  isStructured: boolean;
}

const WHY_PREFIX = '正：';
const FAILURE_PREFIX = '反：';
const INVALIDATION_PREFIX = '止：';

export function buildHedgeBoundaryBasis(draft: HedgeBoundaryBasisDraft): string | null {
  const whyRight = draft.whyRight.trim();
  const failureReason = draft.failureReason.trim();
  const invalidationSignal = draft.invalidationSignal.trim();

  if (!whyRight && !failureReason && !invalidationSignal) return null;

  return [
    `${WHY_PREFIX}${whyRight}`,
    `${FAILURE_PREFIX}${failureReason}`,
    `${INVALIDATION_PREFIX}${invalidationSignal}`,
  ].join('\n');
}

export function parseHedgeBoundaryBasis(value: string | null | undefined): ParsedHedgeBoundaryBasis {
  const raw = value?.trim() ?? '';
  if (!raw) {
    return {
      whyRight: '',
      failureReason: '',
      invalidationSignal: '',
      isStructured: true,
    };
  }

  const lines = raw.split('\n');
  const whyRight = lines.find(line => line.startsWith(WHY_PREFIX))?.slice(WHY_PREFIX.length).trim() ?? '';
  const failureReason = lines.find(line => line.startsWith(FAILURE_PREFIX))?.slice(FAILURE_PREFIX.length).trim() ?? '';
  const invalidationSignal = lines.find(line => line.startsWith(INVALIDATION_PREFIX))?.slice(INVALIDATION_PREFIX.length).trim() ?? '';

  if (whyRight || failureReason || invalidationSignal) {
    return {
      whyRight,
      failureReason,
      invalidationSignal,
      isStructured: true,
    };
  }

  return {
    whyRight: raw,
    failureReason: '',
    invalidationSignal: '',
    isStructured: false,
  };
}
