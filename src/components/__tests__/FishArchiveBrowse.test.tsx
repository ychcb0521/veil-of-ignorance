import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishFilterLibrary} from '../FishFilterLibrary';
import {DirectoryImportContext,FishWorkspaceRows} from '../FishWorkspaceSource';
import {newQualityStudy, type FishQualityStudy} from '@/lib/fish/quality';
import {importQualityWorkspaceRows} from '@/lib/fish/qualityWorkspace';
import {FishArchiveBrowse} from '../FishArchiveBrowse';
import type {BrowseRow,BrowseScope} from '@/lib/fish/libraryBrowse';

it('expands mining families without reading bodies, loads only a selected subtype and imports checked information',async()=>{
  calls.directory.mockResolvedValue({miningSeries:true,groups:[{id:'family',title:'BSS 系列',at:1,count:2,pages:[],children:[
    {id:'raw',title:'原值',at:0,count:0,pages:[]},{id:'avg',title:'avg',at:1,count:1,pages:['avg-page']},{id:'avg2',title:'avg-2',at:1,count:2,pages:['avg2-page']},
  ]}]});
  calls.body.mockResolvedValue([['BTCUSDT',1,'avg_BSS_2 0','chosen'],['UNPICKED',2,'avg_BSS_2 1','other']]);
  const pick=vi.fn(),onDelete=vi.fn();
  render(<FishArchiveBrowse owner="alice" scope="mining" query="" selectBeforeLoad legacySelection pickRecords onSelectRecords={pick} onDelete={onDelete}/>);
  fireEvent.click(await screen.findByRole('button',{name:/^BSS 系列 ·/}));
  expect(screen.getByRole('button',{name:'原值 0 条'})).toBeVisible();expect(calls.body).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'avg-2 2 条'}));expect(calls.body).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'载入所选目录'}));
  fireEvent.click(await screen.findByRole('checkbox',{name:/勾选 BTCUSDT/}));fireEvent.click(screen.getByRole('button',{name:'导入至组合表'}));
  expect(calls.body.mock.calls.map(call=>call[1])).toEqual(['avg2-page']);
  expect(pick).toHaveBeenCalledWith('avg2',new Set(['chosen']),[['BTCUSDT',1,'avg_BSS_2 0','chosen']]);
  fireEvent.click(screen.getByRole('button',{name:'原值 0 条'}));expect(screen.getByText('本目录没有记录')).toBeVisible();
  expect(calls.body).toHaveBeenCalledOnce();
});

it.each([{picker:true,readyBeforeClick:false},{picker:false,readyBeforeClick:false},{picker:false,readyBeforeClick:true}])('imports checked information directly without loading the original archive or workspace (%j)',async({picker,readyBeforeClick})=>{
  calls.directory.mockResolvedValue({detectorPreview:true,groups:[
    {id:'one',title:'BSS 95',at:1,count:536,pages:['a']},
    {id:'two',title:'BSS 90',at:2,count:1251,pages:['b']},
  ]});
  calls.body.mockResolvedValue([
    ['PIEVERSEUSDT',2,'不过滤','saved',[{metric:'BSS · avg_BSS_2',reading:0.13146699636353357,percentile:90.453877893559,sampleCount:14299}]],
    ['UNPICKEDUSDT',3,'不过滤','unpicked'],
  ]);
  const configure=vi.fn();
  let destination=newQualityStudy(100);
  const onImport=vi.fn((snapshot:FishQualityStudy,ids:readonly string[])=>{
    const next=importQualityWorkspaceRows(destination,snapshot,ids);
    const changed=next!==destination;destination=next;return changed;
  });
  const snapshot=newQualityStudy(2);
  const source={id:'signal',symbol:'PIEVERSEUSDT',timeMs:2,timeLabel:'',fallbackZone:''};
  const existing={id:'existing',source:{...source,id:'existing-signal',symbol:'EXISTINGUSDT'},enteredAt:1,basis:'capture' as const,importedAt:1,groups:[]};
  destination.samples=[existing];
  const complete:FishQualityStudy={...snapshot,filterLibrary:{
    version:1,settings:[{id:'f',signature:'f',filters:[],plans:[]}],
    records:[
      {id:'saved',sourceSelection:{family:'BSS',readings:[{metric:'avg_BSS_2',reading:0.13146699636353357,percentile:90.453877893559,sampleCount:14299}]},settingId:'f',source,enteredAt:9,basis:'capture',readings:[],status:{state:'none',detail:'不过滤'},firstSavedAt:2,updatedAt:2},
      {id:'other',settingId:'f',source:{...source,id:'other-signal',symbol:'OTHERUSDT'},enteredAt:8,basis:'capture',readings:[],status:{state:'none',detail:'不过滤'},firstSavedAt:1,updatedAt:1},
      {id:'unpicked',settingId:'f',source:{...source,id:'unpicked-signal',symbol:'UNPICKEDUSDT',timeMs:3},enteredAt:8,basis:'capture',readings:[],status:{state:'none',detail:'不过滤'},firstSavedAt:1,updatedAt:1},
    ],rounds:[
      {id:'one',startedAt:1,updatedAt:1,state:'complete',recordIds:['other']},
      {id:'two',startedAt:2,updatedAt:2,state:'complete',recordIds:['saved','unpicked']},
    ],
  }};
  const original=structuredClone(complete);
  const panel=(ready:boolean)=><DirectoryImportContext.Provider value={{onImport,onImportInformation:async(snapshot,ids)=>onImport(snapshot,ids),prepareImport:ready?undefined:{label:'载入组合表',onClick:configure}}}><FishFilterLibrary account="alice" study={ready?complete:snapshot} ready={ready}
    openRequest={picker?{key:1,importSelection:true}:undefined} requestWorkspace={configure}
    renderStudy={(selected,close)=><FishWorkspaceRows snapshot={selected} onImport={onImport} onDone={close}/>}/></DirectoryImportContext.Provider>;
  const view=render(panel(false));
  if(!picker)fireEvent.click(screen.getByRole('button',{name:'打开过滤库'}));
  fireEvent.click(await screen.findByRole('button',{name:/BSS 90/}));
  expect(calls.body).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'载入所选目录'}));
  await screen.findByText('PIEVERSEUSDT');
  expect(configure).not.toHaveBeenCalled();
  expect(screen.queryByText('旧归档导入')).toBeNull();
  expect(screen.queryByRole('button',{name:/载入旧版完整档案并/})).toBeNull();
  expect(screen.getByText('BSS · avg_BSS_2')).toBeInTheDocument();
  expect(screen.getByText('0.13146699636353357')).toBeInTheDocument();
  expect(screen.getByText('90.453877893559%（12934/14299）')).toBeInTheDocument();
  const importButton=screen.getByRole('button',{name:'导入至组合表'});
  expect(importButton).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox',{name:'全选目录预览记录'}));
  fireEvent.click(screen.getByRole('checkbox',{name:/勾选 UNPICKEDUSDT/}));
  if(readyBeforeClick)view.rerender(panel(true));
  fireEvent.click(screen.getByRole('button',{name:'导入至组合表'}));
  expect(configure).not.toHaveBeenCalled();
  view.rerender(panel(true));
  await waitFor(()=>expect(onImport).toHaveBeenCalledOnce());
  expect(onImport).toHaveBeenCalledWith(expect.objectContaining({
    samples:[expect.objectContaining({enteredAt:null,source:expect.objectContaining({symbol:'PIEVERSEUSDT'}),directoryInformation:expect.objectContaining({recordId:'saved',detectors:[expect.objectContaining({reading:0.13146699636353357,percentile:90.453877893559})]})})],
  }),expect.any(Array));
  expect(onImport.mock.calls[0][0].samples).toHaveLength(1);
  expect(destination.samples.map(row=>row.source.symbol)).toEqual(['EXISTINGUSDT','PIEVERSEUSDT']);
  expect(destination.samples[0]).toBe(existing);expect(complete).toEqual(original);
  expect(screen.queryByRole('dialog')).toBeNull();
  view.rerender(panel(true));expect(onImport).toHaveBeenCalledOnce();
  expect(calls.body.mock.calls.map(([,key])=>key)).toEqual(['b']);
});

it.each(['close','account'])('cancels a pending preview import after %s before the archive is ready',async action=>{
  calls.directory.mockResolvedValue({groups:[{id:'round',title:'待导入',at:1,count:1,pages:['page']}]});
  calls.body.mockResolvedValue([['BTCUSDT',1,'冻结记录','saved']]);
  const source={id:'signal',symbol:'BTCUSDT',timeMs:1,timeLabel:'',fallbackZone:''};
  const cold=newQualityStudy(1),warm:FishQualityStudy={...cold,filterLibrary:{version:1,settings:[{id:'f',signature:'f',filters:[],plans:[]}],
    records:[{id:'saved',settingId:'f',source,enteredAt:1,basis:'capture',readings:[],status:{state:'none',detail:''},firstSavedAt:1,updatedAt:1}],
    rounds:[{id:'round',startedAt:1,updatedAt:1,state:'complete',recordIds:['saved']}]}};
  const load=vi.fn(),onImport=vi.fn(()=>true);
  const panel=(owner:string,ready:boolean)=><DirectoryImportContext.Provider value={{onImport,prepareImport:ready?undefined:{label:'载入组合表',onClick:load}}}>
    <FishFilterLibrary account={owner} study={ready?warm:cold} ready={ready} requestWorkspace={load}/></DirectoryImportContext.Provider>;
  const view=render(panel('alice',false));
  fireEvent.click(screen.getByRole('button',{name:'打开过滤库'}));
  fireEvent.click(await screen.findByRole('button',{name:/待导入/}));fireEvent.click(screen.getByRole('button',{name:'载入所选目录'}));
  fireEvent.click(await screen.findByRole('checkbox',{name:/勾选 BTCUSDT/}));fireEvent.click(screen.getByRole('button',{name:'导入至组合表'}));
  expect(load).toHaveBeenCalledOnce();expect(onImport).not.toHaveBeenCalled();
  if(action==='close')fireEvent.click(screen.getByRole('button',{name:'关闭'}));
  else view.rerender(panel('bob',false));
  view.rerender(panel('alice',true));
  await act(async()=>{});expect(onImport).not.toHaveBeenCalled();
});

it('selects all 1,251 preview records across four pages before allowing import',async()=>{
  calls.directory.mockResolvedValue({groups:[
    {id:'chosen',title:'BSS 1251',at:1,count:1251,pages:['p0','p1','p2','p3']},
    {id:'other',title:'其他目录',at:2,count:1,pages:['unrelated']},
  ]});
  const rows:BrowseRow[]=Array.from({length:1251},(_,i)=>['SYM'+i,i,'冻结记录','id-'+i]);
  let release!:(rows:BrowseRow[])=>void;
  calls.body.mockImplementation((_,key)=>key==='p1'?new Promise(resolve=>{release=resolve;}):Promise.resolve(rows.slice(Number(key[1])*350,Number(key[1])*350+350)));
  const pick=vi.fn();
  render(<FishArchiveBrowse owner="alice" scope="filter" query="" pickRecords onSelectRecords={pick} legacySelection/>);
  fireEvent.click(await screen.findByRole('button',{name:/BSS 1251/}));
  await screen.findByText('SYM0');
  fireEvent.click(screen.getByRole('checkbox',{name:'全选目录预览记录'}));
  await waitFor(()=>expect(calls.body).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('button',{name:'导入至组合表'})).toBeDisabled();
  await act(async()=>release(rows.slice(350,700)));
  await waitFor(()=>expect(screen.getByRole('button',{name:'导入至组合表'})).toBeEnabled());
  expect(screen.getByText('已选 1251 条')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'导入至组合表'}));
  expect(pick).toHaveBeenCalledWith('chosen',new Set(rows.map(r=>r[3])),rows);
  expect(calls.body.mock.calls.map(([,key])=>key)).toEqual(['p0','p1','p2','p3']);
});

it('opens only the filter detector page and sorts by the original percentile',async()=>{
  calls.directory.mockResolvedValue({detectorPreview:true,groups:[{id:'both',title:'并集目录',at:1,count:2,pages:['rich']}]});
  const {filterBrowseRow}=await import('@/lib/fish/libraryBrowseProjection');
  const row=(id:string,percentile:number)=>filterBrowseRow({id,source:{id,symbol:id,timeMs:1,timeLabel:'',fallbackZone:''},
    status:{state:'none',detail:'冻结记录'},sourceSelection:{hits:[
      {family:'CBA',readings:[{metric:'avg_CBA_2',reading:0,percentile:79.5}]},
      {family:'BSS',readings:[{metric:'avg_BSS_2',reading:0.13146699636353357,percentile}]}]}});
  calls.body.mockResolvedValue([row('SECOND',98.1),row('FIRST',91.2)]);
  render(<FishArchiveBrowse owner="alice" scope="filter" query=""/>);
  fireEvent.click(await screen.findByRole('button',{name:/并集目录/}));
  await screen.findByText('98.1%');
  expect(screen.getAllByRole('columnheader')).toHaveLength(5);
  expect(screen.queryByRole('button',{name:'按归档记录排序'})).toBeNull();
  expect(screen.getAllByText('0.13146699636353357')).toHaveLength(2);
  expect(screen.getAllByText('0')).toHaveLength(2);
  expect(screen.getAllByText('BSS · avg_BSS_2')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button',{name:'按百分位位置排序'}));
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('FIRST');
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('79.5%');
  expect(calls.body.mock.calls.map(([,key])=>key)).toEqual(['rich']);
});

it.each<BrowseScope>(['mining','screen','filter'])('sorts across pages, keeps the selected record IDs and skips other directories (%s)',async scope=>{
  calls.directory.mockResolvedValue({groups:[
    {id:'chosen',title:'待排序',at:1,count:2,pages:['first','second']},
    {id:'other',title:'其他目录',at:2,count:1,pages:['unrelated']},
  ]});
  calls.body.mockImplementation((_,key)=>Promise.resolve(key==='first'?[['ZZZ',2,'甲','z']]:[['AAA',1,'乙','a']]));
  const pick=vi.fn();
  render(<FishArchiveBrowse owner="alice" scope={scope} query="" pickRecords onSelectRecords={pick}/>);
  fireEvent.click(await screen.findByRole('button',{name:/待排序/}));
  fireEvent.click(await screen.findByRole('checkbox',{name:/勾选 ZZZ/}));
  fireEvent.click(screen.getByRole('button',{name:'按标的排序'}));
  await screen.findByText('AAA');
  expect(screen.getAllByRole('row').filter(r=>r.querySelector('td input')).map(r=>r.children[1].textContent)).toEqual(['AAA','ZZZ']);
  expect(screen.getByRole('checkbox',{name:/勾选 ZZZ/})).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox',{name:'全选目录预览记录'}));
  fireEvent.click(screen.getByRole('checkbox',{name:/勾选 ZZZ/}));
  fireEvent.click(screen.getByRole('button',{name:'导入至组合表'}));
  expect(pick).toHaveBeenCalledWith('chosen',new Set(['a']),[['AAA',1,'乙','a']]);
  expect(calls.body.mock.calls.map(([,key])=>key)).toEqual(['first','second']);
});

it.each<BrowseScope>(['mining','filter','screen'])('reads only an explicitly requested directory for %s',async scope=>{
  calls.directory.mockResolvedValue({groups:[
    {id:'a',title:'目录甲',at:1,count:43280,pages:['a0','a1']},
    {id:'b',title:'目录乙',at:2,count:43,pages:['b0']},
  ]});
  let complete!: (value:BrowseRow[])=>void;
  calls.body.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
  render(<FishArchiveBrowse owner="alice" scope={scope} query="" selectBeforeLoad/>);
  fireEvent.click(await screen.findByRole('button',{name:/目录甲/}));
  expect(calls.body).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:/目录乙/}));
  expect(calls.body).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'载入所选目录'}));
  expect(calls.body.mock.calls.map(([,key])=>key)).toEqual(['b0']);
  fireEvent.click(screen.getByRole('button',{name:/目录甲/}));
  expect(calls.body.mock.calls[0][2].aborted).toBe(true);
  await act(async()=>complete([['LATE',2,'不应显示','id']]));
  expect(screen.queryByText('LATE')).toBeNull();
  expect(calls.body).toHaveBeenCalledOnce();
});

const calls=vi.hoisted(()=>({directory:vi.fn(),body:vi.fn(),local:vi.fn(),localBody:vi.fn(),rebuild:vi.fn()}));
vi.mock('@/lib/fish/libraryBrowse',async original=>({...(await original<typeof import('@/lib/fish/libraryBrowse')>()),readBrowseCatalog:calls.directory,readBrowsePage:calls.body}));
vi.mock('@/lib/fish/preEntryPersistence',async original=>({...(await original<typeof import('@/lib/fish/preEntryPersistence')>()),readScreenCatalog:calls.local,readScreenPage:calls.localBody}));
vi.mock('@/lib/fish/historicalScreenBrowse',()=>({rebuildHistoricalScreenCatalog:calls.rebuild}));
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();});

it('shows the safe directory failure reason and retries metadata without loading a full archive or records',async()=>{
  calls.directory.mockRejectedValueOnce(Error('目录读取失败（HTTP 503），请重试'))
    .mockResolvedValueOnce({groups:[{id:'retry',title:'已恢复目录',at:1,count:1,pages:['page']}]});
  render(<FishArchiveBrowse owner="alice" scope="filter" query="" selectBeforeLoad/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503');
  fireEvent.click(screen.getByRole('button',{name:'重新读取目录'}));
  expect(await screen.findByRole('button',{name:/已恢复目录/})).toBeVisible();
  expect(calls.directory).toHaveBeenCalledTimes(2);
  expect(calls.body).not.toHaveBeenCalled();expect(calls.rebuild).not.toHaveBeenCalled();
});

it('falls back from an empty local index and rebuilds missing v5 history only on demand',async()=>{
  vi.stubGlobal('indexedDB',{});
  calls.local.mockResolvedValue({id:'empty',groups:[]});
  calls.directory.mockResolvedValue(undefined);
  render(<FishArchiveBrowse owner="alice" scope="screen" query=""/>);
  fireEvent.click(await screen.findByRole('button',{name:'查看 v5 历史目录'}));
  const rebuild=await screen.findByRole('button',{name:'从账号 v5 归档重建目录'});
  expect(calls.rebuild).not.toHaveBeenCalled();
  calls.rebuild.mockResolvedValue(undefined);
  calls.directory.mockResolvedValue({groups:[{id:'archived',title:'云端轮次',at:1,count:1,pages:['p']}]});
  fireEvent.click(rebuild);
  expect(await screen.findByRole('button',{name:/云端轮次/})).toBeVisible();
  expect(calls.rebuild).toHaveBeenCalledTimes(1);
  expect(calls.body).not.toHaveBeenCalled();
});

it('uses verified history when the only local round is hidden in the research directory',async()=>{
  vi.stubGlobal('indexedDB',{});
  calls.local.mockResolvedValue({id:'local',groups:[{id:'hidden',title:'隐藏轮次',at:2,count:1,pages:['hidden-page']}]});
  calls.directory.mockResolvedValue({groups:[{id:'visible',title:'可见轮次',at:1,count:2,pages:['valid-page']}]});
  render(<FishArchiveBrowse owner="alice" scope="screen" query="" edits={{hidden:{hidden:true,at:100}}}/>);
  expect(await screen.findByRole('button',{name:/可见轮次/})).toBeVisible();
  expect(screen.queryByText('隐藏轮次')).toBeNull();
  expect(calls.body).not.toHaveBeenCalled();
});
function scrollNearEnd() {
  const viewport = screen.getByRole('region', {name:'归档记录连续滚动列表'});
  Object.defineProperties(viewport, {
    clientHeight:{configurable:true,value:240}, scrollHeight:{configurable:true,value:1000}
  });
  fireEvent.scroll(viewport,{target:{scrollTop:740}});
}

it.each<BrowseScope>(['filter','mining','screen'])('streams only the expanded round and drops late replies on switch and collapse (%s)',async scope=>{
  calls.directory.mockResolvedValue({groups:[
    {id:'older',title:'较早',at:1,count:1,pages:['a']},
    {id:'newer',title:'最近',at:2,count:2,pages:['b','c']},
  ]});
  let resolveOld!:(rows:BrowseRow[])=>void;
  calls.body.mockImplementation((_,page)=>page==='a'?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve([['NEW',2,page,'id']]));
  const view=render(<FishArchiveBrowse owner="alice" scope={scope} query=""/>);
  const latest=await screen.findByRole('button',{name:/最近/}),old=screen.getByRole('button',{name:/较早/});
  expect(calls.body).toHaveBeenCalledTimes(0);
  expect(screen.getAllByRole('button')[0]).toBe(latest);
  fireEvent.click(old);fireEvent.click(latest);
  expect(calls.body.mock.calls[0][2].aborted).toBe(true);
  await act(async()=>resolveOld([['OLD',1,'old','id']]));
  await screen.findByText('NEW');
  expect(screen.queryByText('OLD')).toBeNull();
  expect(screen.queryByRole('button',{name:'下一页'})).toBeNull();
  expect(calls.body.mock.calls.map(([,key])=>key)).toEqual(['a','b']);
  scrollNearEnd(); scrollNearEnd();
  await waitFor(()=>expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount','3'));
  if(scope!=='filter'){expect(screen.getByText('c')).toBeInTheDocument();expect(screen.getByText('b')).toBeInTheDocument();}
  fireEvent.click(latest);
  expect(screen.queryByText('NEW')).toBeNull();
  expect(calls.body.mock.calls.map(([,key])=>key)).toEqual(['a','b','c']);
  view.unmount();
  await waitFor(()=>expect(calls.body.mock.calls.every(([, ,signal])=>signal.aborted)).toBe(true));
});

it('retries a failed local batch in place without rereading earlier records or another round', async()=>{
  vi.stubGlobal('indexedDB',{});
  calls.local.mockResolvedValue({id:'revision',groups:[
    {id:'shown',title:'本机轮次',at:2,count:3,pages:['one','two']},
    {id:'other',title:'其他轮次',at:1,count:1,pages:['other']},
  ]});
  const row=(name:string):BrowseRow=>[name,1,'同一信号','shared-id'];
  calls.localBody.mockResolvedValueOnce([row('AAA'),row('BBB')]).mockRejectedValueOnce(Error('网络中断'))
    .mockResolvedValueOnce([row('CCC')]);
  render(<FishArchiveBrowse owner="alice" scope="screen" query=""/>);
  fireEvent.click(await screen.findByRole('button',{name:/本机轮次/}));
  await screen.findByText('AAA');
  scrollNearEnd();
  await screen.findByRole('alert');
  expect(screen.getByText('BBB')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'重试读取'}));
  await screen.findByText('CCC');
  expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount','4');
  expect(calls.localBody.mock.calls.map(call=>call[2])).toEqual(['one','two','two']);
  expect(calls.body).not.toHaveBeenCalled();
});
