import {memo} from 'react';
import {FishQualityGuideContent} from './FishQualityGuideContent';
import {FishingManualMarkdown} from './FishingManualMarkdown';
import {fishing,notes} from './fishingGuideOutline';

export const FishingGuideContent=memo(function FishingGuideContent(){
  return <div className="guide-stack fishing-manual min-w-0" data-testid="fishing-guide-content">
    <FishingManualMarkdown text={fishing} guide skipTitle/>
    <FishQualityGuideContent guide/>
    <FishingManualMarkdown text={notes} guide/>
  </div>;
});
