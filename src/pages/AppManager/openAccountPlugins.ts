import * as api from '../../api/tauri';
import { useNavigationStore } from '../../stores/navigationStore';

export async function openAccountPlugins(): Promise<void> {
  const navigation = useNavigationStore.getState();
  if (!navigation.developerMode) {
    const settings = await api.getSettings();
    if (!settings.developerMode) await api.saveSettings({ ...settings, developerMode: true });
  }
  useNavigationStore.getState().openAccountPlugins();
}
