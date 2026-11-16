import { fireEvent, screen, within } from '@testing-library/react';

export function openSignalLibraryMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: '信号库' }), { key: 'Enter' });
  return within(screen.getByRole('menu'));
}

export function openSignalLibrary(name = '信号库') {
  fireEvent.click(openSignalLibraryMenu().getByRole('menuitemcheckbox', { name }));
}
