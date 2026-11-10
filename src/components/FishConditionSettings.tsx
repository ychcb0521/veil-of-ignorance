import type {ReactNode} from 'react';
import './FishConditionSettings.css';
import {SettingsImageScope} from './SettingsImageExport';

/** Shared visual frame only; executable drafts and save handlers stay owned by each editor. */
export function FishConditionSettings({title,description,children,imageExport=false}:{title:string;description:string;children:ReactNode;imageExport?:boolean}){
  const content = <div className="fish-settings-form"><header className="fish-settings-header"><div><h3>{title}</h3><p>{description}</p></div></header><div className="fish-settings-body">{children}</div></div>;
  return imageExport ? <SettingsImageScope title={title}>{content}</SettingsImageScope> : content;
}
