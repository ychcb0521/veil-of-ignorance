import { deserializeAccountBlobStream } from '../accountBlobStream';
import { qualityRestoreIntern } from './qualityRestoreIntern';
import { checkRecoverySignal, type RecoveryRead } from '../qualityRecoveryTransfer';

function decodeBase64(text: string) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Base64 boundaries need not coincide with gzip blocks, Unicode characters or JSON values. */
export async function decodeQualityStudy(enc: 'gzip' | 'json', pieces: readonly string[], read?: RecoveryRead) {
  let index = 0;
  const text = new ReadableStream<string>({
    pull(controller) {
      checkRecoverySignal(read?.signal);
      if (index === pieces.length) controller.close();
      else controller.enqueue(pieces[index++]);
    },
  });

  let carry = '';
  const fromBase64 = new TransformStream<string, Uint8Array<ArrayBuffer>>({
    transform(piece, controller) {
      const encoded = carry + piece;
      const end = encoded.length - encoded.length % 4;
      carry = encoded.slice(end);
      if (end) controller.enqueue(decodeBase64(encoded.slice(0, end)));
    },
    flush(controller) { if (carry) controller.enqueue(decodeBase64(carry)); },
  });
  const bytes = enc === 'json' ? text.pipeThrough(new TextEncoderStream())
    : text.pipeThrough(fromBase64).pipeThrough(new DecompressionStream('gzip'));

  let done = 0;
  const measured = bytes.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(part, controller) {
      checkRecoverySignal(read?.signal);
      done += part.length;
      read?.report({phase: 'decode', done, total: 0});
      controller.enqueue(part);
    },
  }));
  return deserializeAccountBlobStream(measured, undefined, undefined, qualityRestoreIntern());
}
