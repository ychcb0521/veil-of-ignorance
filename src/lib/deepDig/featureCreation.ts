import type { DeepDigFeatureDef } from './features';

/** First registration in project version history, not a later edit/sync or a copy-ID seed. */
export const BUILTIN_FEATURE_CREATION:Readonly<Record<string,{at:string;commit:string}>>={
 'drift-speed':{at:'2026-10-16T08:25:44Z',commit:'ee61163f'},
 bss:{at:'2026-10-18T02:49:23Z',commit:'bcfee376'},
 'drift-speed-z':{at:'2026-10-18T04:53:35Z',commit:'b0fdda4e'},
 cba:{at:'2026-10-18T07:51:21Z',commit:'f2fca5aa'},
 cbi:{at:'2026-10-18T08:13:04Z',commit:'e4a8a572'},
 'cba-2':{at:'2026-10-18T18:04:14+08:00',commit:'40960f72'},
 cbi2:{at:'2026-10-18T10:23:02Z',commit:'db40e312'},
 cdi2:{at:'2026-10-22T10:55:35+08:00',commit:'5ce8e825'},
 state:{at:'2026-10-22T03:33:18Z',commit:'623b8a20'},
 dss:{at:'2026-10-22T12:11:25+08:00',commit:'a734e902'},
 cda:{at:'2026-10-22T12:19:26+08:00',commit:'72a6d718'},
 'seller-control':{at:'2026-10-23T10:45:25+08:00',commit:'001dcb1c'},
 state2:{at:'2026-10-23T21:20:41+08:00',commit:'e27f0815'},
 mbi:{at:'2026-10-29T06:26:19+08:00',commit:'07010b08'},
 ctba:{at:'2026-10-29T06:55:28+08:00',commit:'22f61c6e'},
 'mbi-bear':{at:'2026-10-29T14:34:08+08:00',commit:'0f4f64de'},
 'ctba-bear':{at:'2026-10-29T14:34:08+08:00',commit:'0f4f64de'},
 ctba_12h:{at:'2026-10-29T21:36:15+08:00',commit:'318b1494'},
 mbi2:{at:'2026-10-29T23:30:18+08:00',commit:'6e4953ea'},
 'mbi2-bear':{at:'2026-10-29T23:30:18+08:00',commit:'6e4953ea'},
 'ctba_12h-bear':{at:'2026-10-29T23:30:18+08:00',commit:'6e4953ea'},
 ...Object.fromEntries(['cdi2','seller-control','dss','mbi-bear','ctba-bear','mbi2-bear','ctba_12h-bear'].map(id=>[id+'-retain',{at:'2026-10-30T11:21:28+08:00',commit:'b4878b74'}])),
 ...Object.fromEntries(['darvas_5m_lower','darvas_5m_distance_bps','darvas_5m_width_bps','darvas_5m_age_minutes'].map(id=>[id,{at:'2026-10-31T21:17:20+08:00',commit:'7e36e2e6'}])),
 ...Object.fromEntries(['ati6h','prs_intraday_add_evidence_6h'].map(id=>[id,{at:'2026-10-31T11:54:55+08:00',commit:'a0e05624'}])),
 ...Object.fromEntries(['sbs_5m','sbs_5m_quality','sbs_5m_distance','sbs_5m_step'].map(id=>[id,{at:'2026-10-31T20:02:45+08:00',commit:'f8d23109'}])),
};
export interface FeatureCreation {at:number;source:'recorded'|'version-history';commit?:string}
export function featureCreation(def:Pick<DeepDigFeatureDef,'id'|'createdAt'>):FeatureCreation|null {
 // Builtin copy construction uses deterministic dates as ID seeds. Those are not creation records.
 const history=Object.prototype.hasOwnProperty.call(BUILTIN_FEATURE_CREATION,def.id)?BUILTIN_FEATURE_CREATION[def.id]:undefined;
 if(history)return {at:Date.parse(history.at),source:'version-history',commit:history.commit};
 const at=def.createdAt;
 return typeof at==='number'&&Number.isFinite(at)&&at>0&&at<=8.64e15-8*3600000?{at,source:'recorded'}:null;
}
