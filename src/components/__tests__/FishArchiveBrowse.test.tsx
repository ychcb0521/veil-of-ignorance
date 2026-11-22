import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishFilterLibrary} from '../FishFilterLibrary';
import {DirectoryImportContext,FishWorkspaceRows} from '../FishWorkspaceSource';
import {newQualityStudy, type FishQualityStudy} from '@/lib/fish/quality';
import {FishArchiveBrowse} from '../FishArchiveBrowse';
import type {BrowseRow,BrowseScope} from '@/lib/fish/libraryBrowse';

it.each([true,false])('imports a cold filter round without opening the other round (source picker %s)',async picker=>{
  calls.directory.mockResolvedValue({groups:[
    {id:'one',title:'BSS 95',at:1,count:536,pages:['a']},
    {id:'two',title:'BSS 90',at:2,count:1251,pages:['b']},
  ]});
  calls.body.mockResolvedValue([['PIEVERSEUSDT',2,'不过滤','saved']]);
  const configure=vi.fn();
  const onImport=vi.fn(()=>true);
  const snapshot=newQualityStudy(2);
  const source={id:'signal',symbol:'PIEVERSEUSDT',timeMs:2,timeLabel:'',fallbackZone:''};
  const complete:FishQualityStudy={...snapshot,filterLibrary:{
    version:1,settings:[{id:'f',signature:'f',filters:[],plans:[]}],
    records:[
      {id:'saved',sourceSelection:{family:'BSS',readings:[{metric:'avg_BSS_2',reading:0.13146699636353357,percentile:90.453877893559,sampleCount:14299}]},settingId:'f',source,enteredAt:9,basis:'capture',readings:[],status:{state:'none',detail:'不过滤'},firstSavedAt:2,updatedAt:2},
      {id:'other',settingId:'f',source:{...source,id:'other-signal',symbol:'OTHERUSDT'},enteredAt:8,basis:'capture',readings:[],status:{state:'none',detail:'不过滤'},firstSavedAt:1,updatedAt:1},
    ],rounds:[
      {id:'one',startedAt:1,updatedAt:1,state:'complete',recordIds:['other']},
      {id:'two',startedAt:2,updatedAt:2,state:'complete',recordIds:['saved']},
    ],
  }};
  const panel=(ready:boolean)=><DirectoryImportContext.Provider value={picker?undefined:{onImport}}><FishFilterLibrary account="alice" study={ready?complete:snapshot} ready={ready}
    openRequest={picker?{key:1,importSelection:true}:undefined} requestWorkspace={configure}
    renderStudy={(selected,close)=><FishWorkspaceRows snapshot={selected} onImport={onImport} onDone={close}/>}/></DirectoryImportContext.Provider>;
  const view=render(panel(false));
  if(!picker)fireEvent.click(screen.getByRole('button',{name:'打开过滤库'}));
  fireEvent.click(await screen.findByRole('button',{name:/BSS 90/}));
  expect(calls.body).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'载入所选目录'}));
  await screen.findByText('PIEVERSEUSDT');
  expect(configure).not.toHaveBeenCalled();
  if(picker){fireEvent.click(screen.getByText('旧归档导入'));
  fireEvent.click(screen.getByRole('button',{name:'载入旧版完整档案并选取记录'}));
  }else{fireEvent.click(screen.getByRole('checkbox',{name:/勾选 PIEVERSE/}));fireEvent.click(screen.getByRole('button',{name:'载入旧版完整档案并导入所选'}));}
  expect(configure).toHaveBeenCalledOnce();
  view.rerender(panel(true));
  const checkbox=await screen.findByRole('checkbox',{name:/选取 PIEVERSEUSDT/});
  expect(screen.getByText('BSS · avg_BSS_2')).toBeInTheDocument();
  expect(screen.getByText('0.13146699636353357')).toBeInTheDocument();
  expect(screen.getByText('90.453877893559%（12934/14299）')).toBeInTheDocument();
  if(picker)fireEvent.click(checkbox);else expect(checkbox).toBeChecked();
  expect(screen.queryByRole('checkbox',{name:/选取 OTHERUSDT/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'导入组合表'}));
  expect(onImport).toHaveBeenCalledWith(expect.objectContaining({
    samples:[expect.objectContaining({id:'saved',enteredAt:9,source:expect.objectContaining({symbol:'PIEVERSEUSDT'})})],
  }),expect.any(Array));
  expect(calls.body.mock.calls.map(([,key])=>key)).toEqual(['b']);
});

it('opens only the filter detector page and sorts by the original percentile',async()=>{
  calls.directory.mockResolvedValue({detectorPreview:true,groups:[{id:'both',title:'并集目录',at:1,count:2,pages:['rich']}]});
  const {filterBrowseRow}=await import('@/lib/fish/libraryBrowseProjection');
  const row=(id:string,percentile:number)=>filterBrowseRow({id,source:{id,symbol:id,timeMs:1,timeLabel:'',fallbackZone:''},
    status:{state:'none',detail:'冻结记录'},sourceSelection:{hits:[
      {family:'CBA',readings:[{metric:'avg_CBA_2',reading:0,percentile:79.5}]},
      {family:'BSS',readings:[{metric:'avg_BSS_2',reading:0.14,percentile}]}]}});
  calls.body.mockResolvedValue([row('SECOND',98.1),row('FIRST',91.2)]);
  render(<FishArchiveBrowse owner="alice" scope="filter" query=""/>);
  fireEvent.click(await screen.findByRole('button',{name:/并集目录/}));
  await screen.findByText('98.1%');
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
  render(<FishArchiveBrowse owner="alice" scope={scope} query="" pickRecords onSelectRecords={pick} legacySelection/>);
  fireEvent.click(await screen.findByRole('button',{name:/待排序/}));
  fireEvent.click(await screen.findByRole('checkbox',{name:/勾选 ZZZ/}));
  fireEvent.click(screen.getByRole('button',{name:'按标的排序'}));
  await screen.findByText('AAA');
  expect(screen.getAllByRole('row').filter(r=>r.querySelector('td input')).map(r=>r.children[1].textContent)).toEqual(['AAA','ZZZ']);
  expect(screen.getByRole('checkbox',{name:/勾选 ZZZ/})).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox',{name:'全选目录预览记录'}));
  fireEvent.click(screen.getByRole('checkbox',{name:/勾选 ZZZ/}));
  fireEvent.click(screen.getByRole('button',{name:'载入旧版完整档案并导入所选'}));
  expect(pick).toHaveBeenCalledWith('chosen',new Set(['a']));
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
  await screen.findByText('c');
  expect(screen.getByText('b')).toBeInTheDocument();
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
