/** Large archive writes/encoders share the renderer's memory, even in Workers.
 * Calculations remain independent; only their storage copies take turns. */
let tail:Promise<unknown>=Promise.resolve();
export function serializeArchiveWork<T>(task:()=>Promise<T>):Promise<T>{
  const result=tail.then(task,task);
  tail=result.then(()=>undefined,()=>undefined);
  return result;
}
