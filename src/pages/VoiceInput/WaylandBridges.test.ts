import { describe, expect, it, vi } from 'vitest';
import kwinSource from '../../../src-tauri/src/services/voice_input/wayland_kwin.js?raw';
import gnomeSource from '../../../src-tauri/resources/wayland/gnome/echobird-icons@echobird.ai/extension.js?raw';
import metadata from '../../../src-tauri/resources/wayland/gnome/echobird-icons@echobird.ai/metadata.json';
import linuxConfig from '../../../src-tauri/tauri.linux.conf.json';

describe('Wayland icon bridges', () => {
  it.each(['plasma6', 'plasma5'] as const)(
    'observes %s focus and desktop changes without controlling windows',
    (version) => {
      const callbacks: (() => void)[] = [];
      const signal = { connect: (callback: () => void) => callbacks.push(callback) };
      const app =
        version === 'plasma6'
          ? { desktopFileName: 'org.kde.konsole', internalId: 'uuid-1' }
          : { resourceClass: 'konsole', windowId: 42 };
      const workspace = {
        showingDesktop: false,
        showingDesktopChanged: signal,
        ...(version === 'plasma6'
          ? { activeWindow: app, windowActivated: signal }
          : { activeClient: app, clientActivated: signal }),
      };
      const callDBus = vi.fn();
      const original = JSON.stringify(workspace);
      new Function('workspace', 'callDBus', kwinSource)(workspace, callDBus);
      expect(callDBus).toHaveBeenLastCalledWith(
        '__ECHOBIRD_SERVICE__',
        '/com/echobird/IconBridge',
        'com.echobird.IconBridge',
        'Focus',
        version === 'plasma6' ? 'org.kde.konsole' : 'konsole',
        version === 'plasma6' ? 'uuid-1' : '42'
      );
      expect(JSON.stringify(workspace)).toBe(original);
      workspace.showingDesktop = true;
      callbacks[1]();
      expect(callDBus.mock.lastCall?.slice(-2)).toEqual(['', '']);
      workspace.showingDesktop = false;
      callbacks[0]();
      expect(callDBus.mock.lastCall?.slice(-1)[0]).toBe(version === 'plasma6' ? 'uuid-1' : '42');
    }
  );

  it('exports GNOME app identity only, handles lock/no-focus, and removes its D-Bus object', () => {
    const exported = { export: vi.fn(), unexport: vi.fn() };
    const wrap = vi.fn(() => exported);
    const focused = { get_stable_sequence: () => 15, get_title: vi.fn() };
    const getFocus = vi.fn<() => typeof focused | null>(() => focused);
    const Main = { sessionMode: { isLocked: false } };
    const context = {
      Gio: { DBusExportedObject: { wrapJSObject: wrap }, DBus: { session: 'session' } },
      Shell: {
        WindowTracker: {
          get_default: () => ({
            get_window_app: () => ({ get_id: () => 'org.mozilla.firefox.desktop' }),
          }),
        },
      },
      Extension: class {},
      Main,
      global: { display: { get_focus_window: getFocus } },
      EchoBirdIcons: undefined as unknown as new () => {
        enable(): void;
        disable(): void;
        GetActiveApp(): string[];
      },
    };
    const source = gnomeSource
      .replace(/^import .*;\r?\n/gm, '')
      .replace('export default class EchoBirdIcons', 'return class EchoBirdIcons');
    const ExtensionClass = new Function('Gio', 'Shell', 'Extension', 'Main', 'global', source)(
      context.Gio,
      context.Shell,
      context.Extension,
      context.Main,
      context.global
    ) as typeof context.EchoBirdIcons;
    const extension = new ExtensionClass();
    extension.enable();
    expect(exported.export).toHaveBeenCalledWith('session', '/org/gnome/Shell/Extensions/EchoBird');
    expect(Array.from(extension.GetActiveApp())).toEqual(['org.mozilla.firefox.desktop', '15']);
    Main.sessionMode.isLocked = true;
    expect(Array.from(extension.GetActiveApp())).toEqual(['', '']);
    Main.sessionMode.isLocked = false;
    getFocus.mockReturnValue(null);
    expect(Array.from(extension.GetActiveApp())).toEqual(['', '']);
    expect(focused.get_title).not.toHaveBeenCalled();
    extension.disable();
    expect(exported.unexport).toHaveBeenCalledOnce();
  });

  it('bundles the GNOME bridge in Linux packages while retaining the existing tools resource', () => {
    expect(linuxConfig.bundle.resources).toContain('../tools/');
    expect(linuxConfig.bundle.resources).toContain('resources/wayland/gnome/');
    expect(metadata.uuid).toBe('echobird-icons@echobird.ai');
    expect(metadata['shell-version']).toContain('45');
    expect(gnomeSource).toContain('GetActiveApp()');
  });
});
