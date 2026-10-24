use super::wayland_state::DesktopApp;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[path = "wayland_dbus.rs"]
mod dbus;
#[path = "wayland_wlr.rs"]
mod wlr;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Default)]
struct Shared {
    app: Mutex<Option<DesktopApp>>,
    stopped: AtomicBool,
}

impl Shared {
    fn stopped(&self) -> bool {
        self.stopped.load(Ordering::Acquire)
    }

    fn set(&self, app: Option<DesktopApp>) {
        *self.app.lock().unwrap() = app;
    }

    fn wait(&self, milliseconds: u64) {
        for _ in 0..milliseconds.div_ceil(50) {
            if self.stopped() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

pub(super) struct Tracker(Arc<Shared>);

impl Tracker {
    pub fn start() -> Self {
        let shared = Arc::new(Shared::default());
        let worker = shared.clone();
        std::thread::spawn(move || {
            let desktop = std::env::var("XDG_CURRENT_DESKTOP")
                .unwrap_or_default()
                .to_uppercase();
            let mut reported = false;
            while !worker.stopped() {
                let result = if desktop.contains("GNOME") {
                    dbus::gnome(&worker)
                } else if desktop.contains("KDE") || desktop.contains("PLASMA") {
                    dbus::kde(&worker)
                } else if std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some() {
                    ipc(&worker, false)
                } else if std::env::var_os("NIRI_SOCKET").is_some() {
                    ipc(&worker, true)
                } else {
                    wlr::run(&worker)
                };
                worker.set(None);
                if let Err(error) = result {
                    if !reported && !worker.stopped() {
                        log::warn!("Wayland application icon tracking unavailable: {error}");
                        reported = true;
                    }
                }
                worker.wait(1000);
            }
        });
        Self(shared)
    }

    pub fn current(&self) -> Option<DesktopApp> {
        self.0.app.lock().unwrap().clone()
    }
}

impl Drop for Tracker {
    fn drop(&mut self) {
        self.0.stopped.store(true, Ordering::Release);
        self.0.set(None);
    }
}

fn ipc(shared: &Shared, niri: bool) -> Result {
    let path = if niri {
        std::path::PathBuf::from(std::env::var_os("NIRI_SOCKET").ok_or("NIRI_SOCKET is missing")?)
    } else {
        let signature = std::env::var("HYPRLAND_INSTANCE_SIGNATURE")?;
        if signature.is_empty()
            || !signature
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        {
            return Err("invalid Hyprland session signature".into());
        }
        std::path::PathBuf::from(
            std::env::var_os("XDG_RUNTIME_DIR").ok_or("XDG_RUNTIME_DIR is missing")?,
        )
        .join("hypr")
        .join(signature)
        .join(".socket.sock")
    };
    while !shared.stopped() {
        let mut socket = UnixStream::connect(&path)?;
        socket.set_read_timeout(Some(Duration::from_millis(500)))?;
        socket.set_write_timeout(Some(Duration::from_millis(500)))?;
        socket.write_all(if niri {
            b"\"FocusedWindow\"\n"
        } else {
            b"j/activewindow"
        })?;
        let mut bytes = Vec::new();
        if niri {
            BufReader::new(socket.take(262145)).read_until(b'\n', &mut bytes)?;
        } else {
            socket.take(262145).read_to_end(&mut bytes)?;
        }
        if bytes.len() > 262144 {
            return Err("compositor response exceeds the icon lookup limit".into());
        }
        let value = serde_json::from_slice(&bytes)?;
        shared.set(if niri {
            DesktopApp::niri(&value)
        } else {
            DesktopApp::hyprland(&value)
        });
        shared.wait(250);
    }
    Ok(())
}
