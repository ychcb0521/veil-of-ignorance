export const c=(high:number,low:number,close:number)=>({open:close,high,low,close});
export const classificationExamples = [
  {name:'延续未回踩',value:1,mainClass:1,bars:[c(104,102,103),c(105,103,104)]},
  {name:'回踩守住并转强',value:2,mainClass:1,bars:[
    c(102,100.2,100.4),c(102,100.8,101.5),c(101.6,100.7,101.2),c(102.6,101.1,102.3),
  ]},
  {name:'反弹减弱',value:3,mainClass:2,bars:[
    c(101.5,100.3,100.4),c(104,100.8,103),c(103,100.8,102),
    c(102,100.3,100.4),c(103,100.8,102.5),c(102.6,100.7,102),
    c(101.5,100.2,100.4),c(102,100.8,101.8),c(101.7,100.7,101.4),
  ]},
  {name:'短暂刺穿，迅速收回',value:4,mainClass:2,bars:[c(100.4,99.5,99.8),c(101.2,100.1,100.8)]},
  {name:'反抽失败',value:5,mainClass:2,bars:[
    c(100,99,99.2),c(99.4,98.4,98.8),c(100,99,99.6),c(99.4,98.2,98.5),
  ]},
  {name:'修复确认',value:6,mainClass:2,bars:[
    c(100,99,99.2),c(99.4,98.4,98.8),c(101.2,99.6,100.8),c(102,100.8,101.5),c(101,100.2,100.8),
  ]},
] as const;
