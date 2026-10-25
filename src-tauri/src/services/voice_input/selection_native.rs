use super::{native, selection::MAX_TEXT_CHARS};
use std::sync::Mutex;

static READING: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) enum Reading {
    Text(String),
    #[default]
    Empty,
    Manual,
    #[cfg(windows)]
    CopyFallback,
    TooLong,
}

impl Reading {
    pub(super) fn manual(&self) -> bool {
        match self {
            Self::Manual => true,
            #[cfg(windows)]
            Self::CopyFallback => true,
            _ => false,
        }
    }
    pub(super) fn available(&self) -> bool {
        matches!(self, Self::Text(_) | Self::TooLong)
    }
}

pub(super) fn read() -> Option<Reading> {
    let _reading = READING.try_lock().ok()?;
    if native::wayland() {
        return Some(Reading::Manual);
    }
    let Some(window) = native::foreground() else {
        return Some(Reading::Empty);
    };
    let reading = platform(window);
    if native::foreground() != Some(window) {
        return Some(Reading::Empty);
    }
    Some(match reading {
        Reading::Text(text) if text.chars().count() > MAX_TEXT_CHARS => Reading::TooLong,
        Reading::Text(text) if text.trim().is_empty() => Reading::Empty,
        other => other,
    })
}

#[cfg(windows)]
fn platform(window: u64) -> Reading {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Accessibility::{
        CUIAutomation8, IUIAutomation2, IUIAutomationElement, IUIAutomationTextPattern,
        TreeScope_Descendants, UIA_ControlTypePropertyId, UIA_DocumentControlTypeId,
        UIA_TextPatternId,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetClassNameW;
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }
    unsafe fn selected_text(element: &IUIAutomationElement) -> windows::core::Result<Reading> {
        unsafe {
            let pattern =
                element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)?;
            let ranges = pattern.GetSelection()?;
            let count = ranges.Length()?;
            if count > 8 {
                return Ok(Reading::Manual);
            }
            let mut text = String::new();
            for index in 0..count {
                let part = ranges
                    .GetElement(index)?
                    .GetText((MAX_TEXT_CHARS * 2 + 2) as i32)?
                    .to_string();
                if !text.is_empty() && !part.is_empty() {
                    text.push('\n');
                }
                text.push_str(&part);
                if text.chars().count() > MAX_TEXT_CHARS {
                    return Ok(Reading::TooLong);
                }
            }
            Ok(if text.trim().is_empty() {
                Reading::Empty
            } else {
                Reading::Text(text)
            })
        }
    }
    unsafe fn selected(window: u64) -> windows::core::Result<Reading> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
            let _apartment = Apartment;
            let automation: IUIAutomation2 =
                CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER)?;
            automation.SetAutoSetFocus(false)?;
            automation.SetConnectionTimeout(250)?;
            automation.SetTransactionTimeout(350)?;
            let mut element = automation.GetFocusedElement()?;
            if element.CurrentIsPassword()?.as_bool() {
                return Ok(Reading::Empty);
            }
            let walker = automation.ControlViewWalker()?;
            let mut empty = false;
            for _ in 0..5 {
                if let Ok(reading) = selected_text(&element) {
                    if reading.available() {
                        return Ok(reading);
                    }
                    empty |= reading == Reading::Empty;
                }
                let Ok(parent) = walker.GetParentElement(&element) else {
                    break;
                };
                element = parent;
            }
            // A browser can keep focus in an editor while its document has a selection.
            // Read only selected ranges belonging to this foreground window.
            let documents = (|| {
                let root = automation.ElementFromHandle(HWND(window as *mut _))?;
                let condition = automation.CreatePropertyCondition(
                    UIA_ControlTypePropertyId,
                    &VARIANT::from(UIA_DocumentControlTypeId.0),
                )?;
                root.FindAll(TreeScope_Descendants, &condition)
            })();
            if let Ok(documents) = documents {
                for index in 0..documents.Length()?.min(8) {
                    if let Ok(reading) = selected_text(&documents.GetElement(index)?) {
                        if reading.available() {
                            return Ok(reading);
                        }
                        empty |= reading == Reading::Empty;
                    }
                }
            }
            // Chromium may expose only the focused caret despite a DOM selection.
            // Keep its manual entry; copying is reserved for the explicit click.
            let mut class = [0_u16; 128];
            let length = GetClassNameW(HWND(window as *mut _), &mut class).max(0) as usize;
            if String::from_utf16_lossy(&class[..length]).starts_with("Chrome_WidgetWin_") {
                return Ok(Reading::CopyFallback);
            }
            Ok(if empty {
                Reading::Empty
            } else {
                Reading::Manual
            })
        }
    }
    unsafe { selected(window) }.unwrap_or(Reading::Manual)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn uncertain_browser_selection_keeps_the_entry_without_faking_text() {
        assert!(Reading::CopyFallback.manual());
        assert!(!Reading::CopyFallback.available());
        assert!(Reading::Manual.manual());
        assert!(!Reading::Empty.manual());
        assert!(!Reading::Empty.available());
    }
}

#[cfg(target_os = "macos")]
fn platform(window: u64) -> Reading {
    use core_foundation::base::{CFGetTypeID, CFRelease, CFTypeRef, TCFType};
    use core_foundation::string::{CFString, CFStringGetTypeID, CFStringRef};
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
        fn AXUIElementCopyAttributeValue(
            element: CFTypeRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> i32;
        fn AXUIElementSetMessagingTimeout(element: CFTypeRef, timeout: f32) -> i32;
    }
    struct Owned(CFTypeRef);
    impl Drop for Owned {
        fn drop(&mut self) {
            unsafe {
                CFRelease(self.0);
            }
        }
    }
    unsafe fn attribute(element: CFTypeRef, name: &str) -> Option<Owned> {
        let name = CFString::new(name);
        let mut value = std::ptr::null();
        let status = unsafe {
            AXUIElementCopyAttributeValue(element, name.as_concrete_TypeRef(), &mut value)
        };
        if status == 0 && !value.is_null() {
            Some(Owned(value))
        } else {
            None
        }
    }
    unsafe {
        if !AXIsProcessTrusted() {
            return Reading::Manual;
        }
        let app = AXUIElementCreateApplication(window as i32);
        if app.is_null() {
            return Reading::Manual;
        }
        let app = Owned(app);
        let _ = AXUIElementSetMessagingTimeout(app.0, 0.35);
        let Some(element) = attribute(app.0, "AXFocusedUIElement") else {
            return Reading::Manual;
        };
        let _ = AXUIElementSetMessagingTimeout(element.0, 0.35);
        if let Some(role) = attribute(element.0, "AXSubrole") {
            if CFGetTypeID(role.0) == CFStringGetTypeID()
                && CFString::wrap_under_get_rule(role.0.cast()).to_string() == "AXSecureTextField"
            {
                return Reading::Empty;
            }
        }
        let Some(text) = attribute(element.0, "AXSelectedText") else {
            return Reading::Manual;
        };
        if CFGetTypeID(text.0) != CFStringGetTypeID() {
            return Reading::Empty;
        }
        let value = CFString::wrap_under_get_rule(text.0.cast());
        if value.char_len() as usize > MAX_TEXT_CHARS * 2 {
            return Reading::TooLong;
        }
        Reading::Text(value.to_string())
    }
}

#[cfg(target_os = "linux")]
fn platform(window: u64) -> Reading {
    use std::time::{Duration, Instant};
    use x11rb::{
        connection::Connection,
        protocol::{xproto::*, Event},
        rust_connection::RustConnection,
    };
    fn selected(window: u64) -> Option<String> {
        let (connection, screen) = RustConnection::connect(None).ok()?;
        let atom = |name: &[u8]| {
            connection
                .intern_atom(false, name)
                .ok()?
                .reply()
                .ok()
                .map(|reply| reply.atom)
        };
        let pid_atom = atom(b"_NET_WM_PID")?;
        let leader_atom = atom(b"WM_CLIENT_LEADER")?;
        let pid = |mut window: u32| {
            for _ in 0..6 {
                let reply = connection
                    .get_property(false, window, pid_atom, AtomEnum::CARDINAL, 0, 1)
                    .ok()?
                    .reply()
                    .ok()?;
                if let Some(pid) = reply.value32().and_then(|mut values| values.next()) {
                    return Some(pid);
                }
                let leader = connection
                    .get_property(false, window, leader_atom, AtomEnum::WINDOW, 0, 1)
                    .ok()?
                    .reply()
                    .ok()?;
                if let Some(value) = leader
                    .value32()
                    .and_then(|mut values| values.next())
                    .filter(|&value| value != window)
                {
                    window = value;
                } else {
                    let parent = connection.query_tree(window).ok()?.reply().ok()?.parent;
                    if parent == 0 || parent == window {
                        return None;
                    }
                    window = parent;
                }
            }
            None
        };
        let owner = connection
            .get_selection_owner(AtomEnum::PRIMARY)
            .ok()?
            .reply()
            .ok()?
            .owner;
        if owner == 0 {
            return Some(String::new());
        }
        let foreground_pid = pid(window as u32)?;
        if foreground_pid == std::process::id() || pid(owner)? != foreground_pid {
            return Some(String::new());
        }
        let utf8 = atom(b"UTF8_STRING")?;
        let property = atom(b"ECHOBIRD_SELECTION")?;
        let receiver = connection.generate_id().ok()?;
        connection
            .create_window(
                0,
                receiver,
                connection.setup().roots[screen].root,
                0,
                0,
                1,
                1,
                0,
                WindowClass::INPUT_ONLY,
                0,
                &CreateWindowAux::new(),
            )
            .ok()?
            .check()
            .ok()?;
        connection
            .convert_selection(receiver, AtomEnum::PRIMARY, utf8, property, 0_u32)
            .ok()?
            .check()
            .ok()?;
        connection.flush().ok()?;
        let started = Instant::now();
        while started.elapsed() < Duration::from_millis(300) {
            if let Some(Event::SelectionNotify(event)) = connection.poll_for_event().ok()? {
                if event.property == 0 {
                    return None;
                }
                let reply = connection
                    .get_property(
                        true,
                        receiver,
                        property,
                        utf8,
                        0,
                        (MAX_TEXT_CHARS + 1) as u32,
                    )
                    .ok()?
                    .reply()
                    .ok()?;
                if reply.bytes_after > 0 {
                    return Some("x".repeat(MAX_TEXT_CHARS + 1));
                }
                return String::from_utf8(reply.value).ok();
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        None
    }
    selected(window)
        .map(Reading::Text)
        .unwrap_or(Reading::Manual)
}
