import {createContext,type ReactNode} from 'react';

export interface FishLibraryRowExport {
  run:()=>void;
  count:number;
  busy:boolean;
}

export interface FishLibraryExportActions {
  exportLibrary:()=>void;
  canExportLibrary:boolean;
  selected?:FishLibraryRowExport;
  busy:boolean;
  directoryActions?:ReactNode;
}

/** Scope the current detail table's export to the dialog that owns it. */
export const FishLibraryRowExportContext=createContext<((action:FishLibraryRowExport)=>()=>void)|null>(null);
