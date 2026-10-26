import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { FishQualityProvider } from '@/contexts/FishQualityContext';

const run = async () => {};
function Wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter><FishQualityProvider owner="time-control-test" run={run}>{children}</FishQualityProvider></MemoryRouter>;
}
export const renderFishQuality = (ui: ReactElement, options?: RenderOptions) => render(ui, { wrapper: Wrapper, ...options });
