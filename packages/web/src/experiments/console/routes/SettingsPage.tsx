import { type ReactElement } from 'react';
import { ModelTiersPanel } from '../components/ModelTiersPanel';
import { AliasesPanel } from '../components/AliasesPanel';
import { AgentsPanel } from '../components/AgentsPanel';
import { AssistantConfigPanel } from '../components/AssistantConfigPanel';
import { SystemPanel } from '../components/SystemPanel';
import { GithubIdentityPanel } from '../components/GithubIdentityPanel';
import { ThemePanel } from '../components/ThemePanel';
import type { ThemeId } from '../lib/theme';

interface SettingsPageProps {
  themeId: ThemeId;
  onThemeChange: (id: ThemeId) => void;
}

/**
 * Global (installation-wide) console settings.
 * Appearance (theme picker) sits first — it's the most immediately
 * visible setting — followed by AI config, then system/identity panels.
 */
export function SettingsPage({ themeId, onThemeChange }: SettingsPageProps): ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="px-10 pt-[22px]">
        <h1 className="text-[22px] font-extrabold tracking-[-0.4px] text-text-primary">Settings</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-10 pb-14 pt-5">
        <div className="mx-auto flex max-w-[680px] flex-col gap-[22px]">
          <ThemePanel current={themeId} onChange={onThemeChange} />
          <ModelTiersPanel />
          <AliasesPanel />
          <AgentsPanel />
          <AssistantConfigPanel />
          <SystemPanel />
          <GithubIdentityPanel />
        </div>
      </div>
    </div>
  );
}
