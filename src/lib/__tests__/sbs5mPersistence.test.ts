import {afterEach,expect,it,vi} from 'vitest';
import {computeSbs5m} from '../sbs5m';
import {saveSbsCheckpoint,loadSbsCheckpoint,resumeSbs5m,sbsCheckpointKey} from '../sbs5mPersistence';
import {sbsBaseline} from './fixtures/sbsBars';
afterEach(()=>vi.unstubAllGlobals());
it('keeps a recoverable memory copy without claiming disk durability, including repeated saves',async()=>{
 vi.stubGlobal('indexedDB',undefined);const checkpoint=computeSbs5m(sbsBaseline(),{symbol:'PERSIST_TEST',initializationId:'origin-a'}).checkpoint;
 expect(await saveSbsCheckpoint(checkpoint)).toBe(false);expect(await saveSbsCheckpoint(checkpoint)).toBe(false);expect(await loadSbsCheckpoint(checkpoint)).toEqual(checkpoint);expect(await loadSbsCheckpoint(checkpoint,checkpoint.last_time!-1)).toBeNull();
 const other={...checkpoint,data_version:'revised'};expect(sbsCheckpointKey(other)).not.toBe(sbsCheckpointKey(checkpoint));expect(await loadSbsCheckpoint(other)).toBeNull();
});
it('requires an explicit initialization identity for durable incremental use',async()=>{
 await expect(resumeSbs5m(sbsBaseline(),{symbol:'INIT_TEST'})).rejects.toThrow('初始化标识');
});
