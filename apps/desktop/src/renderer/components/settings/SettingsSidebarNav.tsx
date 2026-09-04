import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideProps } from 'lucide-react';
import {
  Activity,
  Boxes,
  Brain,
  FileUp,
  Gauge,
  MessageSquare,
  Package,
  Settings2,
  Sparkles,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { TAB_LABEL_KEY, type SettingsTab, type VisibleSettingsTab } from '@/lib/tabLabels';

const NAV_ITEM_CLASS = 'flex h-9 items-center gap-2.5 rounded-full px-3 text-sm transition-colors';
const NAV_ITEM_IDLE_CLASS =
  'border border-transparent text-[var(--settings-menu-text)] hover:bg-sidebar-item-hover';
const NAV_ITEM_ACTIVE_CLASS =
  'border border-[var(--sidebar-item-active-border)] bg-sidebar-item-active font-medium text-[var(--sidebar-item-active-foreground)]';

type SettingsNavIcon = ComponentType<LucideProps>;

const TAB_ICON: Record<VisibleSettingsTab, SettingsNavIcon> = {
  general: Settings2,
  personalization: Sparkles,
  providers: Boxes,
  import: FileUp,
  'pi-dashboard': Activity,
  'pi-sessions': MessageSquare,
  'pi-memory': Brain,
  'pi-subagents': Users,
  'pi-speedtest': Gauge,
  'pi-packages': Package,
};

interface SettingsSidebarNavProps {
  tabIds: readonly VisibleSettingsTab[];
  activeTab: SettingsTab;
  onSelectTab: (tab: SettingsTab) => void;
}

/** Settings left nav. Every item is an in-panel tab with a matching lucide mark. */
export function SettingsSidebarNav({ tabIds, activeTab, onSelectTab }: SettingsSidebarNavProps) {
  const { t } = useTranslation();

  return (
    <nav role="tablist" aria-label={t('settings.title')} className="flex flex-col gap-0.5">
      {tabIds.map((tabId) => {
        const selected = activeTab === tabId;
        const Icon = TAB_ICON[tabId];
        return (
          <button
            key={tabId}
            id={`settings-tab-${tabId}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`settings-panel-${tabId}`}
            onClick={() => onSelectTab(tabId)}
            className={cn(NAV_ITEM_CLASS, selected ? NAV_ITEM_ACTIVE_CLASS : NAV_ITEM_IDLE_CLASS)}
          >
            <Icon
              size={15}
              strokeWidth={1.8}
              aria-hidden="true"
              className={cn(
                'shrink-0',
                selected
                  ? 'text-sidebar-item-active-foreground'
                  : 'text-[var(--settings-menu-text)]',
              )}
            />
            <span className="leading-none">{t(TAB_LABEL_KEY[tabId])}</span>
          </button>
        );
      })}
    </nav>
  );
}
