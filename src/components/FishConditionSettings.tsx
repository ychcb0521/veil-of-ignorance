import type {ReactNode} from 'react';
import {DialogDescription,DialogTitle} from '@/components/ui/dialog';
import './FishConditionSettings.css';
import {SettingsImageScope} from './SettingsImageExport';

/** Shared visual frame only; executable drafts and save handlers stay owned by each editor. */
export function FishConditionSettings({title,description,children,imageExport=false,dialog=false}:{title:string;description:string;children:ReactNode;imageExport?:boolean;dialog?:boolean}){
  const heading = <h3>{title}</h3>, detail = <p>{description}</p>;
  const content = <div className="fish-settings-form"><header className="fish-settings-header"><div>{dialog?<><DialogTitle asChild>{heading}</DialogTitle><DialogDescription asChild>{detail}</DialogDescription></>:<>{heading}{detail}</>}</div></header><div className="fish-settings-body">{children}</div></div>;
  return imageExport ? <SettingsImageScope title={title}>{content}</SettingsImageScope> : content;
}
