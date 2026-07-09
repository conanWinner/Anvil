/**
 * Console theme system.
 *
 * Themes are CSS class names applied to `.console-root`. The default
 * (dark magenta) needs no extra class. Additional themes append a modifier.
 *
 * Persisted to localStorage under STORAGE_KEY so the choice survives reload.
 */

export type ThemeId = 'dark-magenta' | 'light-mint';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  description: string;
  /** CSS class to append to .console-root. Empty = default (no extra class). */
  className: string;
  /** Preview swatches [bg, accent, text] */
  swatches: [string, string, string];
}

export const THEMES: ThemeOption[] = [
  {
    id: 'dark-magenta',
    label: 'Dark Magenta',
    description: 'Default dark theme with brand magenta–violet–teal gradient',
    className: '',
    swatches: ['#2a2535', '#ED10EC', '#f8f6ff'],
  },
  {
    id: 'light-mint',
    label: 'Light Mint',
    description: 'Clean light theme with mint-teal accent',
    className: 'theme-light-mint',
    swatches: ['#f7f8fa', '#00C896', '#1a1d23'],
  },
];

const STORAGE_KEY = 'anvil.console.theme';

export function loadTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light-mint') return 'light-mint';
  } catch {
    /* ignore */
  }
  return 'dark-magenta';
}

export function saveTheme(id: ThemeId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function themeClass(id: ThemeId): string {
  return THEMES.find(t => t.id === id)?.className ?? '';
}
