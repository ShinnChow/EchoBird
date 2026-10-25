use super::super::{
    native,
    selection_gesture::{Event, Tracker},
    selection_pointer,
};
use super::*;

pub(crate) fn start(app: &AppHandle) {
    let app = app.clone();
    let (requests, receiver) = std::sync::mpsc::channel::<(u64, Anchor)>();
    let worker_app = app.clone();
    std::thread::spawn(move || {
        while let Ok(mut request) = receiver.recv() {
            while let Ok(latest) = receiver.try_recv() {
                request = latest;
            }
            std::thread::sleep(Duration::from_millis(60));
            let (generation, anchor) = request;
            if !anchor.owns(native::foreground()) {
                continue;
            }
            let reading = selection_native::read().unwrap_or(Reading::Manual);
            let voice = shared(&worker_app);
            let config = voice.saved.lock().unwrap().config.clone();
            if !config.selection_active()
                || voice.runtime.lock().unwrap().active()
                || !anchor.owns(native::foreground())
            {
                continue;
            }
            let shown = {
                let mut state = voice.selection.lock().unwrap();
                if state.result.revision != generation || state.open {
                    continue;
                }
                if !reading.available() && !reading.manual() {
                    state.dismiss();
                    false
                } else {
                    state.result.mode = Mode::Toolbar;
                    state.result.language = config.selection_translation_language;
                    true
                }
            };
            if shown {
                if window::show(&worker_app).is_err() {
                    close(&worker_app);
                } else {
                    emit(&worker_app);
                }
            } else {
                emit(&worker_app);
            }
        }
    });
    std::thread::spawn(move || {
        let voice = shared(&app);
        let pointer = selection_pointer::Pointer::new();
        let mut tracker = Tracker::default();
        let started = Instant::now();
        while !voice.stopped.load(std::sync::atomic::Ordering::Acquire) {
            if !voice.saved.lock().unwrap().config.selection_active()
                || voice.runtime.lock().unwrap().active()
            {
                close(&app);
                tracker = Tracker::default();
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            let (open, anchor, capturing) = {
                let state = voice.selection.lock().unwrap();
                (state.open, state.anchor, state.capturing)
            };
            if let Some(mut sample) = pointer.read(&app, anchor.is_some() && !open, capturing) {
                let popup = app.get_webview_window("voice-translation");
                let inside = popup
                    .as_ref()
                    .is_some_and(|popup| window::contains(popup, sample.point));
                let focused = open
                    && popup
                        .as_ref()
                        .is_some_and(|popup| popup.is_focused().unwrap_or(false));
                if focused || (open && sample.window.is_none()) {
                    sample.window = anchor.map(|anchor| anchor.target.window).or(tracker.window);
                    sample.keys = false;
                }
                match tracker.update(sample, started.elapsed().as_millis() as u64, inside) {
                    Event::Cancel => close(&app),
                    Event::Select { window, point } => {
                        if let Some(target) =
                            native::input_target().filter(|target| target.window == window)
                        {
                            let anchor = Anchor { target, point };
                            let generation = {
                                let mut state = voice.selection.lock().unwrap();
                                state.dismiss();
                                state.anchor = Some(anchor);
                                state.point = point;
                                state.result.revision
                            };
                            let _ = requests.send((generation, anchor));
                        }
                    }
                    Event::None => {}
                }
            }
            std::thread::sleep(Duration::from_millis(16));
        }
    });
}
