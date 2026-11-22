import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useQualityWorkspaceInformation } from '../useQualityWorkspaceInformation';
import { browseInformationStudy } from '@/lib/fish/browseInformationStudy';
import type { FishQualityStudy } from '@/lib/fish/quality';

const storage=vi.hoisted(()=>({read:vi.fn(),importRows:vi.fn(),update:vi.fn()}));
vi.mock('@/lib/fish/qualityWorkspaceStore',()=>({readQualityWorkspace:storage.read,importQualityWorkspaceInformation:storage.importRows,updateQualityWorkspace:storage.update}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const snapshot=(symbol:string)=>({...browseInformationStudy('filter','round',[[symbol,1,'',symbol]]),workspaceUpdatedAt:1});

it('keeps an explicit import when an earlier workspace read finishes late',async()=>{
  let resolve!:(study:FishQualityStudy)=>void;
  storage.read.mockImplementation(()=>new Promise<FishQualityStudy>(done=>{resolve=done;}));
  const picked=snapshot('PICKED');storage.importRows.mockResolvedValue(picked);
  const hook=renderHook(()=>useQualityWorkspaceInformation('alice',true));
  await act(async()=>{await hook.result.current.importRows(picked,[]);});
  await act(async()=>resolve(snapshot('STALE')));
  expect(hook.result.current.study?.samples[0].source.symbol).toBe('PICKED');
});

it('never displays an old account import in the new account',async()=>{
  let resolve!:(study:FishQualityStudy)=>void;
  storage.read.mockImplementation(async(owner:string)=>owner==='bob'?snapshot('BOB'):undefined);
  storage.importRows.mockImplementation(()=>new Promise<FishQualityStudy>(done=>{resolve=done;}));
  const hook=renderHook(({owner})=>useQualityWorkspaceInformation(owner,true),{initialProps:{owner:'alice'}});
  let pending:Promise<FishQualityStudy|undefined>;
  act(()=>{pending=hook.result.current.importRows(snapshot('ALICE'),[]);});
  hook.rerender({owner:'bob'});
  await waitFor(()=>expect(hook.result.current.study?.samples[0].source.symbol).toBe('BOB'));
  await act(async()=>{resolve(snapshot('ALICE'));expect(await pending).toBeUndefined();});
  expect(hook.result.current.study?.samples[0].source.symbol).toBe('BOB');
});
