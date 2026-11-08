/** Batch transport only; callers still evaluate exactly the requested, closed prefix. */
import type {FishReconstructionLoader} from './reconstruction';
import type {FishProgram} from './algorithm';
import type {ResearchBar} from '../deepRsa/window';
import {validateFishBars} from './shared';
export function preEntryWindowLoader(base:FishReconstructionLoader,end:number):FishReconstructionLoader {
  const windows=new WeakMap<FishProgram,{key:string;bars:readonly ResearchBar[]}>();
  const load:FishReconstructionLoader=async(row,from,cut,plan,signal)=>{
    if(signal.aborted)throw new DOMException('已暂停','AbortError');
    if(plan.step!==300000)return base(row,from,cut,plan,signal);
    const key=JSON.stringify([row.symbol,row.exchange,row.market,row.underlying,row.timeMs]);
    const cached=windows.get(plan);
    let bars=cached?.key===key?cached.bars:undefined;
    if(!bars?.some(b=>b.openTime===from)||bars.at(-1)!.openTime+plan.step<cut){
      const ahead=Math.max(cut,Math.min(Math.floor(end/plan.step)*plan.step,from+100*plan.step));
      try{bars=await base(row,from,ahead,plan,signal);validateFishBars(bars,ahead,(ahead-from)/plan.step,plan.step);}
      catch(error){if(signal.aborted||ahead===cut)throw error;bars=await base(row,from,cut,plan,signal);validateFishBars(bars,cut,(cut-from)/plan.step,plan.step);}
      windows.set(plan,{key,bars});
    }
    const prefix=bars.filter(b=>b.openTime>=from&&b.openTime<cut);
    validateFishBars(prefix,cut,(cut-from)/plan.step,plan.step);
    return prefix;
  };
  load.turingInitialization=base.turingInitialization;
  return load;
}
