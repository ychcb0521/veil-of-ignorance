import {expect,it,vi} from 'vitest';
import {saveQualityStudy} from '../qualityStore';
import {newQualityStudy} from '../quality';
it('refuses to write an isolated execution into the historical study even through a legacy caller',async()=>{
 const open=vi.fn(()=>{throw Error('historical storage must stay unopened');});vi.stubGlobal('indexedDB',{open});
 try{expect(await saveQualityStudy('owner',{...newQualityStudy(),workspaceExecution:1})).toBe(false);expect(open).not.toHaveBeenCalled();}
 finally{vi.unstubAllGlobals();}
});
