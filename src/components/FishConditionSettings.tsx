import type {ReactNode} from 'react';
import './FishConditionSettings.css';

/** Shared visual frame only; executable drafts and save handlers stay owned by each editor. */
export function FishConditionSettings({title,description,children}:{title:string;description:string;children:ReactNode}){
  return <div className="fish-settings-form"><header className="fish-settings-header"><div><h3>{title}</h3><p>{description}</p></div></header><div className="fish-settings-body">{children}</div></div>;
}
