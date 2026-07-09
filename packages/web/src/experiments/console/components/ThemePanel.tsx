import { type ReactElement } from 'react';
import { THEMES, type ThemeId } from '../lib/theme';
import { SettingsSection } from './SettingsSection';

interface ThemePanelProps {
  current: ThemeId;
  onChange: (id: ThemeId) => void;
}

/**
 * Theme picker panel for Settings.
 * Shows a swatch card per available theme; clicking activates it immediately
 * (live preview) and persists via the parent's onChange → saveTheme call.
 */
export function ThemePanel({ current, onChange }: ThemePanelProps): ReactElement {
  return (
    <SettingsSection title="Appearance">
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-text-secondary">Choose a color theme for the console UI.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {THEMES.map(theme => {
            const isActive = theme.id === current;
            const [bgColor, accentColor, textColor] = theme.swatches;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={(): void => {
                  onChange(theme.id);
                }}
                aria-pressed={isActive}
                className={`group flex flex-col gap-2.5 rounded-xl border p-3 text-left transition-all ${
                  isActive
                    ? 'border-accent bg-accent-soft shadow-[0_0_0_2px_var(--accent-ring)]'
                    : 'border-border bg-surface-elevated hover:border-border-bright hover:bg-surface-hover'
                }`}
                style={!isActive ? { borderColor: 'var(--border)' } : undefined}
              >
                {/* Swatch preview */}
                <div
                  className="h-[56px] w-full overflow-hidden rounded-lg"
                  style={{ background: bgColor }}
                  aria-hidden
                >
                  {/* Mini mock UI inside swatch */}
                  <div className="flex h-full gap-1 p-1.5">
                    {/* Sidebar strip */}
                    <div
                      className="h-full w-5 rounded-md opacity-70"
                      style={{ background: accentColor + '22' }}
                    />
                    {/* Content area */}
                    <div className="flex flex-1 flex-col gap-1 pt-0.5">
                      <div
                        className="h-1.5 w-12 rounded-sm"
                        style={{ background: textColor + '55' }}
                      />
                      <div
                        className="h-1.5 w-8 rounded-sm"
                        style={{ background: textColor + '33' }}
                      />
                      <div className="mt-auto flex gap-1">
                        <div className="h-3 w-8 rounded" style={{ background: accentColor }} />
                        <div
                          className="h-3 w-5 rounded opacity-50"
                          style={{ background: textColor + '33' }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Label + active indicator */}
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[12px] font-semibold text-text-primary">{theme.label}</p>
                    <p className="text-[10px] text-text-tertiary">{theme.description}</p>
                  </div>
                  {isActive && (
                    <span
                      aria-label="Active"
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                      style={{ background: 'var(--accent)' }}
                    >
                      ✓
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </SettingsSection>
  );
}
