function reportEchoBirdApplication() {
  var window = workspace.showingDesktop ? null : workspace.activeWindow || workspace.activeClient;
  callDBus(
    '__ECHOBIRD_SERVICE__',
    '/com/echobird/IconBridge',
    'com.echobird.IconBridge',
    'Focus',
    window ? String(window.desktopFileName || window.resourceClass || '') : '',
    window ? String(window.internalId || window.windowId || '') : ''
  );
}

(workspace.windowActivated || workspace.clientActivated).connect(reportEchoBirdApplication);
if (workspace.showingDesktopChanged)
  workspace.showingDesktopChanged.connect(reportEchoBirdApplication);
reportEchoBirdApplication();
