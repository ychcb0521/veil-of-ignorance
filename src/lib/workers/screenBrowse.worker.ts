import {readPreEntryReadModel,readPreEntryTableClears} from '../fish/preEntryPersistence';
import {screenBrowse} from '../fish/screenBrowse';
import type {LibraryDirectoryEdits} from '../fish/libraryDirectoryEdits';

// Read the already validated account view independently of the restore queue.
self.onmessage=async(event:MessageEvent<{owner:string;edits?:LibraryDirectoryEdits}>)=>{
  try{
    const {owner,edits}=event.data;
    const library=await readPreEntryReadModel(owner);
    self.postMessage(library?screenBrowse(library,await readPreEntryTableClears(owner),edits):null);
  }catch{self.postMessage(null);}
};
