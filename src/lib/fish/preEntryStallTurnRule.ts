import {createEntryStallTurnReader,validateEntryStallTurn,type EntryStallTurn} from './preEntryStallTurn';
import {createEntryStallTurn5mReader,validateEntryStallTurn5m,ENTRY_STALL_TURN_5M_VERSION,type EntryStallTurn5m} from './preEntryStallTurn5m';
export type EntryStallTurnRule=EntryStallTurn|EntryStallTurn5m;
export function validateEntryStallTurnRule(c:EntryStallTurnRule){
 if(c.version===ENTRY_STALL_TURN_5M_VERSION)validateEntryStallTurn5m(c);else validateEntryStallTurn(c);
}
/** Route by the saved tag. Never infer or migrate a template from its values. */
export function createVersionedEntryStallTurnReader(o:Omit<Parameters<typeof createEntryStallTurnReader>[0],'condition'>&{condition:EntryStallTurnRule}){
 return o.condition.version===ENTRY_STALL_TURN_5M_VERSION?createEntryStallTurn5mReader({...o,condition:o.condition}):createEntryStallTurnReader({...o,condition:o.condition});
}
