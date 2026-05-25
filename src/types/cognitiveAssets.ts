export interface CognitiveAssetSection {
  id: string;
  title: string;
  content: string;
}

export interface CognitiveAssetCategory {
  id: string;
  title: string;
  subtitle: string;
  intro: string;
  sections: CognitiveAssetSection[];
}

export interface CognitiveAssetsDoc {
  meta: {
    title: string;
    subtitle: string;
  };
  categories: CognitiveAssetCategory[];
}
