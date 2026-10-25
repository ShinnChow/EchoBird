use super::{config::Binding, native, shared, Voice};
use std::cell::RefCell;
use std::sync::{atomic::Ordering, mpsc, Arc, Mutex};
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP,
    VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, PeekMessageW, PostThreadMessageW, SetWindowsHookExW,
    UnhookWindowsHookEx, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG, PM_NOREMOVE, WH_KEYBOARD_LL,
    WM_KEYUP, WM_QUIT, WM_SYSKEYUP,
};

struct Context {
    key: u16,
    voice: Arc<Voice>,
    stop: Arc<std::sync::atomic::AtomicBool>,
}

thread_local! {
    static CONTEXT: RefCell<Option<Context>> = const { RefCell::new(None) };
}

pub struct Guard {
    thread: u32,
    worker: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl Guard {
    pub fn create(
        app: &tauri::AppHandle,
        binding: &Binding,
        stop: Arc<std::sync::atomic::AtomicBool>,
    ) -> Result<Option<Self>, String> {
        let Some(key) = native::alt_menu_key(binding) else {
            return Ok(None);
        };
        let voice = shared(app);
        let (ready, receive) = mpsc::sync_channel(1);
        let worker = std::thread::Builder::new()
            .name("voice-alt-release".into())
            .spawn(move || unsafe {
                use windows::Win32::System::{
                    LibraryLoader::GetModuleHandleW, Threading::GetCurrentThreadId,
                };
                let mut message = MSG::default();
                let _ = PeekMessageW(&mut message, None, 0, 0, PM_NOREMOVE);
                let hook = GetModuleHandleW(None).and_then(|module| {
                    SetWindowsHookExW(WH_KEYBOARD_LL, Some(callback), Some(HINSTANCE(module.0)), 0)
                });
                let Ok(hook) = hook else {
                    let _ = ready.send(Err("voice.error.shortcut".to_string()));
                    return;
                };
                CONTEXT.with(|context| *context.borrow_mut() = Some(Context { key, voice, stop }));
                if ready.send(Ok(GetCurrentThreadId())).is_ok() {
                    while GetMessageW(&mut message, None, 0, 0).0 > 0 {}
                }
                let _ = UnhookWindowsHookEx(hook);
                CONTEXT.with(|context| context.borrow_mut().take());
            })
            .map_err(|_| "voice.error.shortcut".to_string())?;
        let thread = receive
            .recv()
            .map_err(|_| "voice.error.shortcut".to_string())??;
        log::info!("[VoiceInput] Alt release guard installed");
        Ok(Some(Self {
            thread,
            worker: Mutex::new(Some(worker)),
        }))
    }

    pub fn close(&self) {
        if let Some(worker) = self.worker.lock().unwrap().take() {
            unsafe {
                let _ = PostThreadMessageW(self.thread, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            let _ = worker.join();
        }
    }
}

impl Drop for Guard {
    fn drop(&mut self) {
        self.close();
    }
}

fn release_inputs(key: u16) -> [INPUT; 3] {
    let key_event = |key, flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(key),
                dwFlags: flags,
                ..Default::default()
            },
        },
    };
    [
        key_event(0xE8, Default::default()),
        key_event(0xE8, KEYEVENTF_KEYUP),
        key_event(
            key,
            KEYEVENTF_KEYUP
                | if key == 0xA5 {
                    KEYEVENTF_EXTENDEDKEY
                } else {
                    Default::default()
                },
        ),
    ]
}

unsafe extern "system" fn callback(code: i32, event: WPARAM, data: LPARAM) -> LRESULT {
    if code >= 0 && matches!(event.0 as u32, WM_KEYUP | WM_SYSKEYUP) && data.0 != 0 {
        let key = &*(data.0 as *const KBDLLHOOKSTRUCT);
        let guarded = CONTEXT.with(|context| {
            let context = context.borrow();
            let Some(context) = context.as_ref() else {
                return false;
            };
            if key.flags.contains(LLKHF_INJECTED)
                || key.vkCode != u32::from(context.key)
                || context.stop.load(Ordering::Acquire)
                || context.voice.suspended.load(Ordering::Acquire)
                || !context.voice.held.load(Ordering::Acquire)
            {
                return false;
            }
            // Keep Alt-down and normal combinations intact. On physical release,
            // queue the mask BEFORE Alt-up in one batch, replacing the real up.
            // Injecting the mask at Alt-down can race the target's menu handling.
            let inputs = release_inputs(context.key);
            if SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) == inputs.len() as u32 {
                log::info!("[VoiceInput] Alt release guarded");
                true
            } else {
                let _ = SendInput(&inputs[1..2], std::mem::size_of::<INPUT>() as i32);
                log::warn!("[VoiceInput] Alt release guard unavailable");
                false
            }
        });
        if guarded {
            return LRESULT(1);
        }
    }
    CallNextHookEx(None, code, event, data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_mask_precedes_alt_release_in_the_same_input_batch() {
        for key in [0xA4, 0xA5] {
            let inputs = release_inputs(key);
            let keys = inputs.map(|input| unsafe { input.Anonymous.ki });
            assert_eq!(keys[0].wVk, VIRTUAL_KEY(0xE8));
            assert_eq!(keys[0].dwFlags, Default::default());
            assert_eq!(keys[1].wVk, VIRTUAL_KEY(0xE8));
            assert_eq!(keys[1].dwFlags, KEYEVENTF_KEYUP);
            assert_eq!(keys[2].wVk, VIRTUAL_KEY(key));
            assert!(keys[2].dwFlags.contains(KEYEVENTF_KEYUP));
            assert_eq!(keys[2].dwFlags.contains(KEYEVENTF_EXTENDEDKEY), key == 0xA5);
        }
    }
}
