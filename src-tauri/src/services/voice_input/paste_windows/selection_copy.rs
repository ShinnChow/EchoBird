use super::*;
use crate::services::voice_input::selection::MAX_TEXT_CHARS;
use windows::Win32::System::Memory::GlobalSize;
use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

fn decode_text(units: &[u16]) -> std::result::Result<String, String> {
    let end = units
        .iter()
        .position(|&unit| unit == 0)
        .ok_or("voice.selectionTooLong")?;
    let text = String::from_utf16(&units[..end]).map_err(|_| "voice.selectionEmpty")?;
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err("voice.selectionTooLong".into());
    }
    if text.trim().is_empty() {
        return Err("voice.selectionEmpty".into());
    }
    Ok(text)
}

fn copied_text() -> std::result::Result<String, String> {
    unsafe {
        let handle = GetClipboardData(u32::from(CF_UNICODETEXT.0))
            .map_err(|_| "voice.selectionClipboard")?;
        let global = HGLOBAL(handle.0);
        let count = (GlobalSize(global) / 2).min(MAX_TEXT_CHARS * 2 + 2);
        let buffer = GlobalLock(global).cast::<u16>();
        if buffer.is_null() || count == 0 {
            if !buffer.is_null() {
                let _ = GlobalUnlock(global);
            }
            return Err("voice.selectionClipboard".into());
        }
        let result = decode_text(std::slice::from_raw_parts(buffer, count));
        let _ = GlobalUnlock(global);
        result
    }
}

fn process_id(window: HWND) -> u32 {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(window, Some(&mut pid)) };
    pid
}

pub(crate) fn copy_selection(
    target: InputTarget,
    cancel: &CancellationToken,
) -> std::result::Result<String, String> {
    let _copying = INSERTING.try_lock().map_err(|_| "voice.error.busy")?;
    let started = Instant::now();
    while modifiers_down() {
        if cancel.is_cancelled() || started.elapsed() >= Duration::from_secs(1) {
            return Err("voice.error.cancelled".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    if cancel.is_cancelled() || !target.matches(native::input_target()) {
        return Err("voice.error.focus".into());
    }
    let pid = process_id(HWND(target.window as *mut _));
    if pid == 0 {
        return Err("voice.error.focus".into());
    }
    // Back up every format before clearing anything. An unchanged clipboard can
    // never be mistaken for selected text, including when Ctrl+C does nothing.
    let mut clipboard = Clipboard::replace(&[0, 0]).map_err(|_| "voice.selectionClipboard")?;
    if cancel.is_cancelled() || modifiers_down() || !target.matches(native::input_target()) {
        return Err("voice.error.focus".into());
    }
    let inputs = key_inputs(VIRTUAL_KEY(0x43));
    if unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) } != inputs.len() as u32 {
        let _ = unsafe { SendInput(&inputs[2..], std::mem::size_of::<INPUT>() as i32) };
        return Err("voice.selectionClipboard".into());
    }
    let started = Instant::now();
    while started.elapsed() < Duration::from_millis(1500) {
        if unsafe { GetClipboardSequenceNumber() } != clipboard.sequence {
            let opened = Open::new(clipboard.owner.0).map_err(|_| "voice.selectionClipboard")?;
            if unsafe { GetClipboardSequenceNumber() } == clipboard.sequence {
                continue;
            }
            let owner = unsafe { GetClipboardOwner() }.map_err(|_| "voice.selectionClipboard")?;
            if process_id(owner) != pid {
                // Another application's copy wins; do not read or restore over it.
                return Err("voice.selectionClipboard".into());
            }
            let text = copied_text();
            clipboard.sequence = 0;
            clipboard
                .restore_contents()
                .map_err(|_| "voice.selectionClipboard")?;
            drop(opened);
            if cancel.is_cancelled() || !target.matches(native::input_target()) {
                return Err("voice.error.focus".into());
            }
            return text;
        }
        std::thread::sleep(Duration::from_millis(15));
    }
    Err("voice.selectionEmpty".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_copy_sends_one_copy_chord_without_paste_enter_or_tab() {
        let keys: Vec<_> = key_inputs(VIRTUAL_KEY(0x43))
            .iter()
            .map(|input| unsafe {
                let key = input.Anonymous.ki;
                (key.wVk.0, key.dwFlags.contains(KEYEVENTF_KEYUP))
            })
            .collect();
        assert_eq!(
            keys,
            [(0x11, false), (0x43, false), (0x43, true), (0x11, true)]
        );
    }

    #[test]
    fn copied_text_is_bounded_and_keeps_unicode_and_paragraphs() {
        let source = "正文🙂\r\nsecond line";
        let units: Vec<_> = source.encode_utf16().chain(Some(0)).collect();
        assert_eq!(decode_text(&units).unwrap(), source);
        assert!(decode_text(&[0]).is_err());
        let limit: Vec<_> = "🙂"
            .repeat(MAX_TEXT_CHARS)
            .encode_utf16()
            .chain(Some(0))
            .collect();
        assert!(decode_text(&limit).is_ok());
        assert!(decode_text(&[0x61; MAX_TEXT_CHARS * 2 + 2]).is_err());
    }
}
