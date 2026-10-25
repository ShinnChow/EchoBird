use super::config::Binding;
use super::{native, trigger};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub struct Registration {
    pub binding: Binding,
    shortcut: Option<Shortcut>,
    stop: Arc<AtomicBool>,
    #[cfg(windows)]
    alt_release: Option<super::alt_release::Guard>,
    #[cfg(target_os = "linux")]
    portal: Option<tokio_util::sync::CancellationToken>,
    pub description: Option<String>,
}

impl Registration {
    pub async fn create(app: &AppHandle, binding: &Binding) -> Result<Self, String> {
        #[cfg(target_os = "linux")]
        if native::wayland() {
            return Self::portal(app, binding).await;
        }
        let stop = Arc::new(AtomicBool::new(false));
        #[cfg(windows)]
        let alt_release = super::alt_release::Guard::create(app, binding, stop.clone())?;
        let shortcut = if native::modifier(binding) {
            let monitor = native::ModifierMonitor::new(binding)?;
            let stop = stop.clone();
            let app = app.clone();
            let binding = binding.clone();
            std::thread::spawn(move || {
                let mut previous = monitor.down();
                while !stop.load(Ordering::Acquire) {
                    let down = monitor.down();
                    if down != previous {
                        trigger(&app, &binding, down);
                        previous = down;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(16));
                }
            });
            None
        } else {
            let shortcut = parse(binding)?;
            let binding = binding.clone();
            app.global_shortcut()
                .on_shortcut(shortcut, move |app, _, event| {
                    trigger(app, &binding, event.state == ShortcutState::Pressed);
                })
                .map_err(|_| "voice.error.shortcut")?;
            Some(shortcut)
        };
        Ok(Self {
            binding: binding.clone(),
            shortcut,
            stop,
            #[cfg(windows)]
            alt_release,
            description: None,
            #[cfg(target_os = "linux")]
            portal: None,
        })
    }

    pub fn close(&self, app: &AppHandle) {
        self.stop.store(true, Ordering::Release);
        #[cfg(windows)]
        if let Some(guard) = &self.alt_release {
            guard.close();
        }
        if let Some(shortcut) = self.shortcut {
            let _ = app.global_shortcut().unregister(shortcut);
        }
        #[cfg(target_os = "linux")]
        if let Some(cancel) = &self.portal {
            cancel.cancel();
        }
    }

    #[cfg(target_os = "linux")]
    async fn portal(app: &AppHandle, binding: &Binding) -> Result<Self, String> {
        use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};
        use futures_util::StreamExt;
        let portal = GlobalShortcuts::new()
            .await
            .map_err(|_| "voice.error.portal")?;
        let session = portal
            .create_session(Default::default())
            .await
            .map_err(|_| "voice.error.portal")?;
        let mut activated = portal
            .receive_activated()
            .await
            .map_err(|_| "voice.error.portal")?;
        let mut deactivated = portal
            .receive_deactivated()
            .await
            .map_err(|_| "voice.error.portal")?;
        let trigger = portal_trigger(binding);
        let response = portal
            .bind_shortcuts(
                &session,
                &[NewShortcut::new("voice-input", "EchoBird Voice Input")
                    .preferred_trigger(trigger.as_str())],
                None,
                Default::default(),
            )
            .await
            .map_err(|_| "voice.error.portal")?
            .response()
            .map_err(|_| "voice.error.portal")?;
        let description = response
            .shortcuts()
            .first()
            .map(|shortcut| shortcut.trigger_description().to_owned());
        if description.is_none() {
            return Err("voice.error.portal".into());
        }
        let session_path = serde_json::to_value(&session)
            .map_err(|_| "voice.error.portal")?
            .as_str()
            .ok_or("voice.error.portal")?
            .to_owned();
        let cancel = tokio_util::sync::CancellationToken::new();
        let cancelled = cancel.clone();
        let app = app.clone();
        let registered_binding = binding.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    _ = cancelled.cancelled() => break,
                    Some(event) = activated.next() => if event.session_handle().as_str() == session_path { super::trigger(&app, &registered_binding, true); },
                    Some(event) = deactivated.next() => if event.session_handle().as_str() == session_path { super::trigger(&app, &registered_binding, false); },
                    else => break,
                }
            }
            let _ = session.close().await;
        });
        Ok(Self {
            binding: binding.clone(),
            shortcut: None,
            stop: Arc::new(AtomicBool::new(false)),
            portal: Some(cancel),
            description,
        })
    }
}

pub fn parse(binding: &Binding) -> Result<Shortcut, String> {
    let code = binding
        .code
        .parse::<Code>()
        .map_err(|_| "voice.error.shortcut")?;
    let mut modifiers = Modifiers::empty();
    for key in &binding.modifiers {
        modifiers |= match key.as_str() {
            "Control" => Modifiers::CONTROL,
            "Alt" => Modifiers::ALT,
            "Shift" => Modifiers::SHIFT,
            "Meta" => Modifiers::SUPER,
            _ => return Err("voice.error.shortcut".into()),
        };
    }
    Ok(Shortcut::new(Some(modifiers), code))
}

#[cfg(target_os = "linux")]
fn portal_trigger(binding: &Binding) -> String {
    let mut trigger = binding
        .modifiers
        .iter()
        .map(|key| format!("<{}>", if key == "Meta" { "Super" } else { key }))
        .collect::<String>();
    let key = match binding.code.as_str() {
        "Space" => "space",
        "Enter" => "Return",
        "Backspace" => "BackSpace",
        "ArrowUp" => "Up",
        "ArrowDown" => "Down",
        "ArrowLeft" => "Left",
        "ArrowRight" => "Right",
        "PageUp" => "Page_Up",
        "PageDown" => "Page_Down",
        "Backquote" => "grave",
        "Backslash" => "backslash",
        "BracketLeft" => "bracketleft",
        "BracketRight" => "bracketright",
        "Comma" => "comma",
        "Equal" => "equal",
        "Minus" => "minus",
        "Period" => "period",
        "Quote" => "apostrophe",
        "Semicolon" => "semicolon",
        "Slash" => "slash",
        "AltLeft" => "Alt_L",
        "AltRight" => "Alt_R",
        "ControlLeft" => "Control_L",
        "ControlRight" => "Control_R",
        "ShiftLeft" => "Shift_L",
        "ShiftRight" => "Shift_R",
        "MetaLeft" => "Super_L",
        "MetaRight" => "Super_R",
        other => other
            .strip_prefix("Key")
            .or_else(|| other.strip_prefix("Digit"))
            .unwrap_or(other),
    };
    trigger.push_str(key);
    trigger
}
