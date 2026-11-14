import { definitionKey, featureParams, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { compileFishProgram, shortFishHash } from './algorithm';
import { stableEntryJson } from './preEntryThreeStage';

const VERSION = 'fish-capture-definition-v1';

export interface FishCaptureDefinition {
  version: typeof VERSION;
  definition: DeepDigFeatureDef;
  fingerprint: string;
}

function captureFingerprint(def: DeepDigFeatureDef) {
  // JSONB may reorder object keys, including keys in nested indicator configs.
  const ordered = JSON.parse(stableEntryJson(def)) as DeepDigFeatureDef;
  const plan = compileFishProgram(ordered, { direction: '>', threshold: 0, constraints: [] });
  return shortFishHash(stableEntryJson([ordered, definitionKey(ordered), featureParams(ordered),
    plan.compiled.usesBtc, plan.usesTaker, plan.step, plan.warm, plan.N, plan.stateHoldAlternatives]));
}

const verified = new WeakSet<FishCaptureDefinition>();

export function freezeCaptureDefinition(definition: DeepDigFeatureDef): FishCaptureDefinition {
  return { version: VERSION, definition: structuredClone(definition), fingerprint: captureFingerprint(definition) };
}

export function captureCardDefinition(card: { featureId: string; frozen?: FishCaptureDefinition },
    current?: DeepDigFeatureDef): DeepDigFeatureDef | undefined {
  const { frozen } = card;
  if (!frozen) return current;
  if (frozen.version !== VERSION || frozen.definition?.id !== card.featureId) {
    throw Error('捕捞模板的原公式或算法版本无法核验');
  }
  if (!verified.has(frozen)) {
    if (captureFingerprint(frozen.definition) !== frozen.fingerprint) throw Error('捕捞模板的原公式或算法版本无法核验');
    verified.add(frozen);
  }
  return frozen.definition;
}
