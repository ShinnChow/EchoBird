use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct DesktopApp {
    pub app_id: String,
    pub window_id: String,
}

impl DesktopApp {
    pub fn new(app_id: &str, window_id: &str) -> Option<Self> {
        let app_id = app_id.strip_suffix(".desktop").unwrap_or(app_id);
        if app_id.is_empty()
            || app_id.len() > 255
            || app_id.contains(['/', '\\'])
            || app_id.chars().any(char::is_control)
            || matches!(app_id, "." | "..")
            || app_id.eq_ignore_ascii_case("com.echobird.ai")
            || app_id.eq_ignore_ascii_case("echobird")
            || window_id.is_empty()
            || window_id.len() > 256
        {
            return None;
        }
        Some(Self {
            app_id: app_id.into(),
            window_id: window_id.into(),
        })
    }

    pub fn hyprland(value: &serde_json::Value) -> Option<Self> {
        Self::new(
            value.get("class")?.as_str()?,
            value.get("address")?.as_str()?,
        )
    }

    pub fn niri(value: &serde_json::Value) -> Option<Self> {
        let window = value.get("Ok")?.get("FocusedWindow")?;
        Self::new(
            window.get("app_id")?.as_str()?,
            &window.get("id")?.as_u64()?.to_string(),
        )
    }
}

#[derive(Default)]
struct Toplevel {
    app_id: String,
    activated: bool,
}

#[derive(Default)]
pub(super) struct Toplevels {
    windows: HashMap<u32, Toplevel>,
    pub active: Option<DesktopApp>,
}

impl Toplevels {
    pub fn app_id(&mut self, id: u32, app_id: String) {
        self.windows.entry(id).or_default().app_id = app_id;
    }

    pub fn state(&mut self, id: u32, bytes: &[u8]) {
        self.windows.entry(id).or_default().activated = bytes
            .chunks_exact(4)
            .any(|value| u32::from_ne_bytes(value.try_into().unwrap()) == 2);
    }

    pub fn done(&mut self, id: u32) {
        let window = self.windows.entry(id).or_default();
        let window_id = format!("wlr:{id}");
        if window.activated {
            self.active = DesktopApp::new(&window.app_id, &window_id);
        } else if self
            .active
            .as_ref()
            .is_some_and(|app| app.window_id == window_id)
        {
            self.active = None;
        }
    }

    pub fn closed(&mut self, id: u32) {
        self.windows.remove(&id);
        if self
            .active
            .as_ref()
            .is_some_and(|app| app.window_id == format!("wlr:{id}"))
        {
            self.active = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn desktop_ids_are_safe_and_never_resolve_echobird_or_an_empty_focus() {
        assert_eq!(
            DesktopApp::new("org.mozilla.firefox.desktop", "42")
                .unwrap()
                .app_id,
            "org.mozilla.firefox"
        );
        assert_eq!(
            DesktopApp::new("中文应用.desktop", "43").unwrap().app_id,
            "中文应用"
        );
        for id in [
            "",
            "..",
            "/tmp/application",
            "../secret",
            "file:///icon",
            "com.echobird.ai.desktop",
            "EchoBird",
            "app\0id",
        ] {
            assert!(DesktopApp::new(id, "42").is_none(), "{id}");
        }
        assert!(DesktopApp::new("firefox", "").is_none());
    }

    #[test]
    fn compositor_ipc_uses_the_focused_application_and_not_window_titles() {
        assert_eq!(
            DesktopApp::hyprland(&json!({"class":"firefox","address":"0xa","title":"private"})),
            DesktopApp::new("firefox", "0xa")
        );
        assert_eq!(
            DesktopApp::niri(
                &json!({"Ok":{"FocusedWindow":{"app_id":"foot","id":12,"title":"private"}}})
            ),
            DesktopApp::new("foot", "12")
        );
        for value in [
            json!({}),
            json!({"Ok":{"FocusedWindow":null}}),
            json!({"Err":"unavailable"}),
        ] {
            assert!(DesktopApp::hyprland(&value).is_none());
            assert!(DesktopApp::niri(&value).is_none());
        }
    }

    #[test]
    fn toplevel_batches_ignore_inactive_and_closed_windows_without_clearing_new_focus() {
        let mut windows = Toplevels::default();
        windows.app_id(1, "firefox".into());
        windows.state(1, &2_u32.to_ne_bytes());
        assert!(windows.active.is_none());
        windows.done(1);
        assert_eq!(windows.active, DesktopApp::new("firefox", "wlr:1"));
        windows.app_id(2, "foot".into());
        windows.state(2, &2_u32.to_ne_bytes());
        windows.done(2);
        windows.state(1, &[]);
        windows.done(1);
        windows.closed(1);
        assert_eq!(windows.active, DesktopApp::new("foot", "wlr:2"));
        windows.app_id(2, "com.echobird.ai".into());
        windows.done(2);
        assert!(windows.active.is_none());
        windows.app_id(2, "foot".into());
        windows.done(2);
        windows.closed(2);
        assert!(windows.active.is_none());
    }
}
