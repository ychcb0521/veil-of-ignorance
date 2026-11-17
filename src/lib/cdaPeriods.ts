export const CDA_FIVE_MINUTE_LABEL = 'CDA-5mins';
export const CDA_HOURLY_LABEL = 'CDA-1h';
export const CDA_HOURLY_ID = 'cda-1h-v1';
export const CDA_HOURLY_CHART_ID = 'CDA_1H';

export const CDA_HOURLY_TIME_SCALE = 12;
export const CDA_HOURLY_AVERAGE_HOURS = 24 * CDA_HOURLY_TIME_SCALE;
export const CDA_HOURLY_RETENTION_HOURS = 48 * CDA_HOURLY_TIME_SCALE;

export const usesHourlyCda = (def: { id?: string; chartTemplate?: string }) =>
  (def.chartTemplate ?? def.id) === CDA_HOURLY_ID;
