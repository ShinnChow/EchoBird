import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const interfaceXml = `<node>
  <interface name="com.echobird.IconBridge">
    <method name="GetActiveApp">
      <arg name="app_id" type="s" direction="out"/>
      <arg name="window_id" type="s" direction="out"/>
    </method>
  </interface>
</node>`;

export default class EchoBirdIcons extends Extension {
  enable() {
    this._bridge = Gio.DBusExportedObject.wrapJSObject(interfaceXml, this);
    this._bridge.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/EchoBird');
  }

  GetActiveApp() {
    const window = global.display.get_focus_window();
    if (!window || Main.sessionMode.isLocked) return ['', ''];
    const app = Shell.WindowTracker.get_default().get_window_app(window);
    return [app?.get_id() ?? '', String(window.get_stable_sequence())];
  }

  disable() {
    this._bridge?.unexport();
    this._bridge = null;
  }
}
