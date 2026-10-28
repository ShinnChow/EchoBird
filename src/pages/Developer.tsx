import { ViewModeTabs } from '../components/ViewModeTabs';
import { useI18n } from '../hooks/useI18n';
import { useNavigationStore } from '../stores/navigationStore';

export function DeveloperTitleActions() {
  const { t } = useI18n();
  const tab = useNavigationStore((state) => state.developerTab);
  const setTab = useNavigationStore((state) => state.setDeveloperTab);
  return (
    <ViewModeTabs
      value={tab}
      onChange={setTab}
      options={[
        { value: 'pets', label: t('developer.pets') },
        { value: 'plugins', label: t('developer.plugins') },
        { value: 'statistics', label: t('developer.statistics') },
      ]}
    />
  );
}
