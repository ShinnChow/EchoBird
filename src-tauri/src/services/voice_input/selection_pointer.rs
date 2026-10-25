use super::selection_gesture::Sample;
use tauri::AppHandle;
#[cfg(any(windows, target_os = "macos"))]
use tauri::Manager;

pub(super) struct Pointer {
    #[cfg(target_os = "linux")]
    x11: Option<(x11rb::rust_connection::RustConnection, u32, Vec<u8>)>,
}

impl Pointer {
    pub fn new() -> Self {
        Self {
            #[cfg(target_os = "linux")]
            x11: Self::connect(),
        }
    }

    #[cfg(target_os = "linux")]
    fn connect() -> Option<(x11rb::rust_connection::RustConnection, u32, Vec<u8>)> {
        use x11rb::{connection::Connection, protocol::xproto::ConnectionExt};
        if super::native::wayland() {
            return None;
        }
        let (connection, screen) = x11rb::connect(None).ok()?;
        let setup = connection.setup();
        let root = setup.roots[screen].root;
        let min = setup.min_keycode;
        let mapping = connection
            .get_keyboard_mapping(min, setup.max_keycode - min + 1)
            .ok()?
            .reply()
            .ok()?;
        let shifts = mapping
            .keysyms
            .chunks(mapping.keysyms_per_keycode as usize)
            .enumerate()
            .filter(|(_, codes)| codes.iter().any(|&key| key == 0xffe1 || key == 0xffe2))
            .map(|(offset, _)| min + offset as u8)
            .collect();
        Some((connection, root, shifts))
    }

    pub fn read(&self, app: &AppHandle, keyboard: bool, copying: bool) -> Option<Sample> {
        #[cfg(any(windows, target_os = "macos"))]
        let (point, down, keys) = {
            let point = app.get_webview_window("main")?.cursor_position().ok()?;
            (
                (point.x, point.y),
                super::native::left_mouse_down(),
                keyboard && super::native::selection_keys_down(copying),
            )
        };
        #[cfg(target_os = "linux")]
        let (point, down, keys) = {
            use x11rb::protocol::xproto::{ConnectionExt, KeyButMask};
            let (connection, root, shifts) = self.x11.as_ref()?;
            let pointer = connection.query_pointer(*root).ok()?.reply().ok()?;
            let keys = keyboard
                && connection
                    .query_keymap()
                    .ok()?
                    .reply()
                    .ok()?
                    .keys
                    .iter()
                    .enumerate()
                    .any(|(byte, &bits)| {
                        (0..8).any(|bit| {
                            bits & (1 << bit) != 0 && !shifts.contains(&((byte * 8 + bit) as u8))
                        })
                    });
            let _ = (app, copying);
            (
                (f64::from(pointer.root_x), f64::from(pointer.root_y)),
                pointer.mask.contains(KeyButMask::BUTTON1),
                keys,
            )
        };
        Some(Sample {
            point,
            down,
            keys,
            window: super::native::foreground(),
        })
    }
}
