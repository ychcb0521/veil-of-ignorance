import {expect,it} from 'vitest';
import {combineDirectoryStudies} from '../qualityDirectorySelection';
import {firstMatchFixture,MATCHED_AT,SIGNAL_AT} from './qualityFirstMatch.fixture';
import {entryDirectoryStudy} from '../qualityLibraryDirectory';
import {sourceDirectoryKeys,sourceDirectoryIds} from '../qualitySourceDirectories';
import {qualityComparisonRows,qualityDisplayRows,qualityEntryIdentity} from '../quality';

it('unions overlapping directory inputs without duplicate trades or lost detector memberships and preserves original snapshots',()=>{
 const {study}=firstMatchFixture(),a=structuredClone(study),b=structuredClone(study);
 a.samples[0].groups=['one'];b.samples[0].groups=['two'];
 b.samples.push({...structuredClone(b.samples[0]),id:'another',source:{...b.samples[0].source,id:'second',symbol:'OTHERUSDT'},groups:['two']});
 const before=structuredClone([a,b]),out=combineDirectoryStudies([a,b]);
 expect(out.samples).toHaveLength(2);expect(out.samples[0].groups).toEqual(['one','two']);expect(qualityComparisonRows(out)).toHaveLength(2);
 expect(out.selectedRowIds).toEqual(qualityDisplayRows(out).map(r=>r.id));expect([a,b]).toEqual(before);
 out.samples[0].source.symbol='MUTATED';expect(a.samples[0].source.symbol).toBe('UAIUSDT');
});

it('keeps separate entries even when old directory sample IDs collide',()=>{
 const {study:a}=firstMatchFixture(),b=structuredClone(a);b.samples[0].enteredAt+=60000;
 const out=combineDirectoryStudies([a,b]);expect(new Set(out.samples.map(s=>s.id)).size).toBe(2);
 expect(qualityComparisonRows(out).map(r=>r.enteredAt).sort()).toEqual([SIGNAL_AT,SIGNAL_AT+60000]);
});

it('retains independent first-match times and complete screening evidence across selected rounds',()=>{
 const {library}=firstMatchFixture(),second=structuredClone(library.rounds[0]);second.id='second';second.startedAt++;
 library.rounds.push(second);library.records.push({...structuredClone(library.records[0]),id:'second-record',roundId:'second',matchedAt:MATCHED_AT+60000});
 const out=combineDirectoryStudies(library.rounds.map(round=>entryDirectoryStudy(library,round))),choice={kind:'pre-entry' as const,id:'screen',ids:['screen','second']};
 expect(out.samples.map(r=>r.enteredAt)).toEqual([MATCHED_AT,MATCHED_AT+60000]);expect(out.screeningResults).toHaveLength(2);expect(out.screeningRounds).toHaveLength(2);
 const keys=sourceDirectoryKeys(choice,{},library)!;expect(keys.size).toBe(2);
 expect(out.samples.every(r=>keys.has(qualityEntryIdentity(r.source,r.enteredAt)))).toBe(true);
 expect(sourceDirectoryIds({kind:'mined',id:'one'})).toEqual(['one']);
});

it('keeps the single-directory snapshot and rejects an empty selection',()=>{
 const {study}=firstMatchFixture(),out=combineDirectoryStudies([study]);expect(out).toEqual(study);expect(out).not.toBe(study);
 expect(()=>combineDirectoryStudies([])).toThrow('至少选择一个目录');
});
