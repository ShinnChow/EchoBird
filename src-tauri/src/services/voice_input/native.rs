use super::config::Binding;
use enigo::{Enigo, Keyboard, Settings};

pub fn wayland() -> bool {
    cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_some()
}

pub fn foreground() -> Option<u64> {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowThreadProcessId,
        };
        let window = GetForegroundWindow();
        let mut pid = 0;
        GetWindowThreadProcessId(window, Some(&mut pid));
        (!window.0.is_null() && pid != std::process::id()).then_some(window.0 as u64)
    }
    #[cfg(target_os = "macos")]
    {
        let pid = objc2_app_kit::NSWorkspace::sharedWorkspace()
            .frontmostApplication()?
            .processIdentifier() as u64;
        (pid != std::process::id() as u64).then_some(pid)
    }
    #[cfg(target_os = "linux")]
    {
        use x11rb::connection::Connection;
        use x11rb::protocol::xproto::{AtomEnum, ConnectionExt};
        if wayland() {
            return None;
        }
        let (connection, screen) = x11rb::connect(None).ok()?;
        let atom = connection
            .intern_atom(false, b"_NET_ACTIVE_WINDOW")
            .ok()?
            .reply()
            .ok()?
            .atom;
        let property = connection
            .get_property(
                false,
                connection.setup().roots[screen].root,
                atom,
                AtomEnum::WINDOW,
                0,
                1,
            )
            .ok()?
            .reply()
            .ok()?;
        property
            .value32()?
            .next()
            .map(u64::from)
            .filter(|id| *id != 0)
    }
}

pub fn insert(text: &str, target: Option<u64>) -> Result<(), String> {
    if target.is_some() && foreground() != target {
        return Err("voice.error.focus".into());
    }
    let mut keyboard = Enigo::new(&Settings::default()).map_err(|_| "voice.error.insert")?;
    keyboard.text(text).map_err(|_| "voice.error.insert".into())
}

pub fn modifier(binding: &Binding) -> bool {
    matches!(
        binding.code.as_str(),
        "AltLeft"
            | "AltRight"
            | "ControlLeft"
            | "ControlRight"
            | "ShiftLeft"
            | "ShiftRight"
            | "MetaLeft"
            | "MetaRight"
    )
}

pub struct ModifierMonitor {
    code: u32,
    #[cfg(target_os = "linux")]
    connection: x11rb::rust_connection::RustConnection,
}

impl ModifierMonitor {
    pub fn escape() -> Option<Self> {
        if wayland() {
            return None;
        }
        #[cfg(target_os = "macos")]
        if !unsafe { CGPreflightListenEventAccess() } {
            return None;
        }
        Self::new(&Binding {
            code: "Escape".into(),
            modifiers: Vec::new(),
        })
        .ok()
    }

    pub fn new(binding: &Binding) -> Result<Self, String> {
        if !binding.modifiers.is_empty() {
            return Err("voice.error.shortcut".into());
        }
        #[cfg(windows)]
        let code = match binding.code.as_str() {
            "Escape" => 0x1B,
            "AltLeft" => 0xA4,
            "AltRight" => 0xA5,
            "ControlLeft" => 0xA2,
            "ControlRight" => 0xA3,
            "ShiftLeft" => 0xA0,
            "ShiftRight" => 0xA1,
            "MetaLeft" => 0x5B,
            "MetaRight" => 0x5C,
            _ => return Err("voice.error.shortcut".into()),
        };
        #[cfg(target_os = "macos")]
        let code = {
            if !unsafe { CGPreflightListenEventAccess() } {
                unsafe {
                    CGRequestListenEventAccess();
                }
                return Err("voice.error.shortcutPermission".into());
            }
            match binding.code.as_str() {
                "Escape" => 53,
                "AltLeft" => 58,
                "AltRight" => 61,
                "ControlLeft" => 59,
                "ControlRight" => 62,
                "ShiftLeft" => 56,
                "ShiftRight" => 60,
                "MetaLeft" => 55,
                "MetaRight" => 54,
                _ => return Err("voice.error.shortcut".into()),
            }
        };
        #[cfg(target_os = "linux")]
        {
            use x11rb::connection::Connection;
            use x11rb::protocol::xproto::ConnectionExt;
            let keysym = match binding.code.as_str() {
                "Escape" => 0xff1b,
                "AltLeft" => 0xffe9,
                "AltRight" => 0xffea,
                "ControlLeft" => 0xffe3,
                "ControlRight" => 0xffe4,
                "ShiftLeft" => 0xffe1,
                "ShiftRight" => 0xffe2,
                "MetaLeft" => 0xffeb,
                "MetaRight" => 0xffec,
                _ => return Err("voice.error.shortcut".into()),
            };
            let (connection, _) = x11rb::connect(None).map_err(|_| "voice.error.shortcut")?;
            let setup = connection.setup();
            let mapping = connection
                .get_keyboard_mapping(setup.min_keycode, setup.max_keycode - setup.min_keycode + 1)
                .map_err(|_| "voice.error.shortcut")?
                .reply()
                .map_err(|_| "voice.error.shortcut")?;
            let index = mapping
                .keysyms
                .chunks(mapping.keysyms_per_keycode as usize)
                .position(|keys| keys.contains(&keysym))
                .ok_or("voice.error.shortcut")?;
            let code = setup.min_keycode as u32 + index as u32;
            Ok(Self { code, connection })
        }
        #[cfg(not(target_os = "linux"))]
        Ok(Self { code })
    }

    pub fn down(&self) -> bool {
        #[cfg(windows)]
        {
            unsafe {
                windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(self.code as i32) < 0
            }
        }
        #[cfg(target_os = "macos")]
        {
            unsafe { CGEventSourceKeyState(1, self.code as u16) }
        }
        #[cfg(target_os = "linux")]
        {
            use x11rb::protocol::xproto::ConnectionExt;
            self.connection
                .query_keymap()
                .ok()
                .and_then(|cookie| cookie.reply().ok())
                .is_some_and(|reply| {
                    reply.keys[self.code as usize / 8] & (1 << (self.code % 8)) != 0
                })
        }
    }
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceKeyState(state: i32, key: u16) -> bool;
    fn CGPreflightListenEventAccess() -> bool;
    fn CGRequestListenEventAccess() -> bool;
}
