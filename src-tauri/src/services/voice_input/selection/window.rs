use super::*;

pub(super) fn contains(window: &tauri::WebviewWindow, point: (f64, f64)) -> bool {
    if !window.is_visible().unwrap_or(false) {
        return false;
    }
    match (window.outer_position(), window.outer_size()) {
        (Ok(origin), Ok(size)) => {
            point.0 >= f64::from(origin.x)
                && point.1 >= f64::from(origin.y)
                && point.0 < f64::from(origin.x) + f64::from(size.width)
                && point.1 < f64::from(origin.y) + f64::from(size.height)
        }
        _ => false,
    }
}

// Physical pixels: stay near the released selection, flip above at the edge.
fn position(
    point: (f64, f64),
    area: (f64, f64, f64, f64),
    scale: f64,
    toolbar: bool,
) -> (i32, i32) {
    let (ax, ay, aw, ah) = area;
    let (width, height) = if toolbar {
        (TOOLBAR_WIDTH, TOOLBAR_HEIGHT)
    } else {
        (WIDTH, HEIGHT)
    };
    let (width, height, margin) = (width * scale, height * scale, 8.0 * scale);
    let below = point.1 + 20.0 * scale;
    let y = if below + height <= ay + ah - margin {
        below
    } else {
        point.1 - height - margin
    };
    (
        point
            .0
            .clamp(ax + margin, (ax + aw - width - margin).max(ax + margin))
            .round() as i32,
        y.clamp(ay + margin, (ay + ah - height - margin).max(ay + margin))
            .round() as i32,
    )
}

pub(super) fn show(app: &AppHandle) -> Result<(), String> {
    let (mode, point) = {
        let voice = shared(app);
        let state = voice.selection.lock().unwrap();
        (state.result.mode, state.point)
    };
    let toolbar = mode == Mode::Toolbar;
    let window = if let Some(window) = app.get_webview_window("voice-translation") {
        window
    } else {
        let window = tauri::WebviewWindowBuilder::new(
            app,
            "voice-translation",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("EchoBird")
        .inner_size(TOOLBAR_WIDTH, TOOLBAR_HEIGHT)
        .decorations(false)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .focusable(false)
        .focused(false)
        .build()
        .map_err(|_| "voice.error.island")?;
        let app = app.clone();
        window.on_window_event(move |event| match event {
            tauri::WindowEvent::Focused(true) => {
                shared(&app).selection.lock().unwrap().focused = true
            }
            tauri::WindowEvent::Focused(false) => {
                let close_it = {
                    let voice = shared(&app);
                    let state = voice.selection.lock().unwrap();
                    state.open && state.focused
                };
                if close_it {
                    close(&app);
                }
            }
            tauri::WindowEvent::Destroyed => close(&app),
            _ => {}
        });
        window
    };
    let _ = window.set_focusable(!toolbar);
    let (width, height) = if toolbar {
        (TOOLBAR_WIDTH, TOOLBAR_HEIGHT)
    } else {
        (WIDTH, HEIGHT)
    };
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    if let Ok(monitors) = window.available_monitors() {
        if let Some(monitor) = monitors
            .iter()
            .find(|monitor| {
                let origin = monitor.position();
                let size = monitor.size();
                point.0 >= f64::from(origin.x)
                    && point.1 >= f64::from(origin.y)
                    && point.0 < f64::from(origin.x) + f64::from(size.width)
                    && point.1 < f64::from(origin.y) + f64::from(size.height)
            })
            .or_else(|| monitors.first())
        {
            let area = monitor.work_area();
            let scale = monitor.scale_factor();
            let (x, y) = position(
                point,
                (
                    f64::from(area.position.x),
                    f64::from(area.position.y),
                    f64::from(area.size.width),
                    f64::from(area.size.height),
                ),
                scale,
                toolbar,
            );
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
            let _ = window.set_size(tauri::PhysicalSize::new(
                (width * scale).round() as u32,
                (height * scale).round() as u32,
            ));
        }
    }
    Ok(())
}

pub(super) fn ready(app: &AppHandle) -> Translation {
    let result = snapshot(app);
    if result.mode != Mode::Closed {
        if let Some(window) = app.get_webview_window("voice-translation") {
            let _ = window.show();
            if result.mode != Mode::Toolbar {
                let _ = window.set_focus();
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toolbar_and_card_stay_near_selection_with_dpi_and_negative_monitor_bounds() {
        for scale in [1.0, 1.25, 2.0] {
            for (ax, ay) in [(0.0, 0.0), (-1920.0, -400.0)] {
                let area = (ax, ay, 1920.0 * scale, 1040.0 * scale);
                for toolbar in [true, false] {
                    let (x, y) = position(
                        (ax + 500.0 * scale, ay + 200.0 * scale),
                        area,
                        scale,
                        toolbar,
                    );
                    assert!((f64::from(x) - (ax + 500.0 * scale)).abs() <= 1.0);
                    assert!((f64::from(y) - (ay + 220.0 * scale)).abs() <= 1.0);
                    let (x, y) = position(
                        (ax + 1900.0 * scale, ay + 1020.0 * scale),
                        area,
                        scale,
                        toolbar,
                    );
                    let (w, h) = if toolbar {
                        (TOOLBAR_WIDTH, TOOLBAR_HEIGHT)
                    } else {
                        (WIDTH, HEIGHT)
                    };
                    assert!(f64::from(x) >= ax && f64::from(x) + w * scale <= ax + area.2);
                    assert!(f64::from(y) >= ay && f64::from(y) + h * scale <= ay + area.3);
                }
            }
        }
    }
}
