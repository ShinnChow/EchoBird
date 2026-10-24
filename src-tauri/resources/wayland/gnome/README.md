# GNOME Wayland 应用图标

GNOME 不允许普通应用直接读取前台应用。此扩展为 EchoBird 提供当前应用的桌面 ID 和窗口标识，仅用于灵动岛图标；不读取窗口标题、文字、键盘或鼠标，也不控制窗口。

适用于 GNOME Shell 45–51。接口和生命周期已有代码测试，具体 Shell 版本仍需实机验证。

在本目录执行（Linux 安装包中位于资源目录的 `resources/wayland/gnome/`）：

```sh
gnome-extensions pack ./echobird-icons@echobird.ai --out-dir /tmp
gnome-extensions install /tmp/echobird-icons@echobird.ai.shell-extension.zip
```

Wayland 下安装新扩展后先注销并重新登录，再启用：

```sh
gnome-extensions enable echobird-icons@echobird.ai
```

EchoBird 会自动重新连接。停用该扩展或锁屏时，灵动岛恢复 EchoBird 图标。EchoBird 不会自动安装或启用扩展，也不需要打开 Shell unsafe mode。

卸载可使用系统扩展管理器，或执行：

```sh
gnome-extensions disable echobird-icons@echobird.ai
gnome-extensions uninstall echobird-icons@echobird.ai
```

其他 Wayland 桌面不需要此 GNOME 扩展：KDE Plasma 使用开启语音期间的临时 KWin 观察脚本，Hyprland/Niri 使用各自的只读 IPC，支持 `wlr-foreign-toplevel-management` 的桌面使用该协议。macOS、Windows、X11 保留各自的系统图标接口；所有环境使用同一个前端翻转效果。
