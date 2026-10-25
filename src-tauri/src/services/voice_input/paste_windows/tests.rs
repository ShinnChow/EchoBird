use super::*;

#[test]
fn clipboard_payload_preserves_multiline_tabs_unicode_and_long_transcripts() {
    let paragraph = "语音回填🙂 café\tcolumn\r\n第二行\n\n第三段\r结束";
    let source = paragraph.repeat(4_000);
    let encoded = text_data(&source).unwrap();
    let units: Vec<_> = encoded
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    assert_eq!(units.last(), Some(&0));
    let restored = String::from_utf16(&units[..units.len() - 1]).unwrap();
    assert_eq!(
        restored,
        paragraph
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .replace('\n', "\r\n")
            .repeat(4_000)
    );
    assert!(text_data("before\0after").is_err());
}

#[test]
fn one_paste_has_no_enter_tab_or_per_character_key_events() {
    let mut calls = Vec::new();
    dispatch(|inputs| {
        calls.push(
            inputs
                .iter()
                .map(|input| unsafe {
                    let key = input.Anonymous.ki;
                    assert_eq!(input.r#type, INPUT_KEYBOARD);
                    (key.wVk.0, key.dwFlags.contains(KEYEVENTF_KEYUP))
                })
                .collect::<Vec<_>>(),
        );
        inputs.len() as u32
    })
    .unwrap();
    assert_eq!(
        calls,
        vec![vec![
            (0x11, false),
            (0x56, false),
            (0x56, true),
            (0x11, true)
        ]]
    );
}

#[test]
fn partial_dispatch_releases_keys_without_retrying_or_typing_a_second_copy() {
    for accepted in 0..4 {
        let mut calls = Vec::new();
        let result = dispatch(|inputs| {
            calls.push(
                inputs
                    .iter()
                    .map(|input| unsafe {
                        let key = input.Anonymous.ki;
                        (key.wVk.0, key.dwFlags.contains(KEYEVENTF_KEYUP))
                    })
                    .collect::<Vec<_>>(),
            );
            if calls.len() == 1 {
                accepted
            } else {
                inputs.len() as u32
            }
        });
        assert_eq!(result, Err("voice.error.insert".into()));
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1], [(0x56, true), (0x11, true)]);
        assert_eq!(
            calls
                .iter()
                .flatten()
                .filter(|&&(key, released)| key == 0x56 && !released)
                .count(),
            1
        );
    }
}

#[test]
fn concurrent_insert_is_rejected_before_any_clipboard_or_keyboard_work() {
    let _guard = INSERTING.lock().unwrap();
    assert_eq!(
        insert("do not type", None, &CancellationToken::new()),
        Err("voice.error.busy".into())
    );
}

#[test]
#[ignore = "uses the real Windows clipboard; run explicitly with one test thread"]
fn real_clipboard_preserves_formats_long_text_and_newer_copies() {
    use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
    use windows::Win32::System::Memory::GlobalSize;

    fn read(format: u32) -> Vec<u8> {
        unsafe {
            let global = HGLOBAL(GetClipboardData(format).unwrap().0);
            let size = GlobalSize(global);
            let pointer = GlobalLock(global).cast::<u8>();
            assert!(!pointer.is_null());
            let data = std::slice::from_raw_parts(pointer, size).to_vec();
            let _ = GlobalUnlock(global);
            data
        }
    }

    let _guard = INSERTING.lock().unwrap();
    let seed = text_data("clipboard sentinel🙂").unwrap();
    let mut original = Clipboard::replace(&seed).unwrap();
    let html = unsafe { RegisterClipboardFormatW(w!("HTML Format")) };
    assert_ne!(html, 0);
    let markup = b"Version:0.9\r\nStartHTML:0000000000\r\n<b>clipboard sentinel</b>\0";
    let mut dib = vec![0_u8; 44];
    for (offset, value) in [(0, 40_i32), (4, 1), (8, 1), (20, 4)] {
        dib[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
    dib[12..14].copy_from_slice(&1_u16.to_le_bytes());
    dib[14..16].copy_from_slice(&32_u16.to_le_bytes());
    dib[40..44].copy_from_slice(&[0x30, 0x60, 0x90, 0xff]);
    {
        let _opened = Open::new(original.owner.0).unwrap();
        assert_eq!(unsafe { GetClipboardSequenceNumber() }, original.sequence);
        Data::bytes(html, markup).unwrap().put().unwrap();
        Data::bytes(8, &dib).unwrap().put().unwrap();
        original.sequence = unsafe { GetClipboardSequenceNumber() };
    }
    original.sequence = Clipboard::owned_sequence(original.owner.0).unwrap();
    let long = text_data(&"第一段\n第二段🙂\tlong transcript\n".repeat(4_000)).unwrap();
    let mut transaction = Clipboard::replace(&long).unwrap();
    original.sequence = std::mem::take(&mut transaction.sequence);
    {
        let _opened = Open::new(transaction.owner.0).unwrap();
        // Global allocations may include padding after the required NUL.
        assert!(read(13).starts_with(&long));
    }
    transaction.sequence = original.sequence;
    original.sequence = transaction.restore().unwrap().unwrap();
    {
        let _opened = Open::new(original.owner.0).unwrap();
        assert!(read(13).starts_with(&seed));
        assert!(read(html).starts_with(markup));
        assert!(read(8).starts_with(&dib));
    }
    let mut transaction = Clipboard::replace(&text_data("temporary voice text").unwrap()).unwrap();
    original.sequence = std::mem::take(&mut transaction.sequence);
    let voice_sequence = original.sequence;
    let newer = text_data("user copied something newer").unwrap();
    {
        let _opened = Open::new(original.owner.0).unwrap();
        assert_eq!(unsafe { GetClipboardSequenceNumber() }, voice_sequence);
        unsafe {
            EmptyClipboard().unwrap();
        }
        Data::bytes(13, &newer).unwrap().put().unwrap();
        original.sequence = unsafe { GetClipboardSequenceNumber() };
    }
    original.sequence = Clipboard::owned_sequence(original.owner.0).unwrap();
    transaction.sequence = voice_sequence;
    drop(transaction);
    {
        let _opened = Open::new(original.owner.0).unwrap();
        assert!(read(13).starts_with(&newer));
    }
    // Restore the user's original clipboard only if our test still owns it.
    assert!(original.restore().is_ok());
}
