use super::{DesktopApp, Result, Shared};
use std::io::Write;
use std::sync::Arc;
use std::time::{Duration, Instant};
use zbus::blocking::{connection::Builder, Connection, Proxy};

const PATH: &str = "/com/echobird/IconBridge";
const INTERFACE: &str = "com.echobird.IconBridge";

pub(super) fn gnome(shared: &Shared) -> Result {
    let connection = Builder::session()?
        .method_timeout(Duration::from_millis(500))
        .build()?;
    let proxy = Proxy::new(
        &connection,
        "org.gnome.Shell",
        "/org/gnome/Shell/Extensions/EchoBird",
        INTERFACE,
    )?;
    while !shared.stopped() {
        let (app_id, window_id): (String, String) = proxy.call("GetActiveApp", &())?;
        shared.set(DesktopApp::new(&app_id, &window_id));
        shared.wait(250);
    }
    Ok(())
}

struct KWinSink {
    shared: Arc<Shared>,
    owner: String,
}

#[zbus::interface(name = "com.echobird.IconBridge")]
impl KWinSink {
    fn focus(
        &self,
        app_id: &str,
        window_id: &str,
        #[zbus(header)] header: zbus::message::Header<'_>,
    ) -> zbus::fdo::Result<()> {
        if header.sender().map(|sender| sender.as_str()) != Some(self.owner.as_str()) {
            return Err(zbus::fdo::Error::AccessDenied(
                "Only KWin can report its focused application".into(),
            ));
        }
        self.shared.set(DesktopApp::new(app_id, window_id));
        Ok(())
    }
}

fn kwin_owner(connection: &Connection) -> zbus::Result<String> {
    connection
        .call_method(
            Some("org.freedesktop.DBus"),
            "/org/freedesktop/DBus",
            Some("org.freedesktop.DBus"),
            "GetNameOwner",
            &("org.kde.KWin",),
        )?
        .body()
        .deserialize()
}

pub(super) fn kde(shared: &Arc<Shared>) -> Result {
    let connection = Builder::session()?
        .method_timeout(Duration::from_millis(500))
        .build()?;
    let owner = kwin_owner(&connection)?;
    connection.object_server().at(
        PATH,
        KWinSink {
            shared: shared.clone(),
            owner: owner.clone(),
        },
    )?;
    let service = format!("com.echobird.IconBridge.p{}", std::process::id());
    connection.request_name(service.as_str())?;
    let name = format!("echobird-icons-{}", uuid::Uuid::new_v4());
    let mut file = tempfile::Builder::new()
        .prefix("echobird-icons-")
        .suffix(".js")
        .tempfile()?;
    file.write_all(
        include_str!("wayland_kwin.js")
            .replace("__ECHOBIRD_SERVICE__", &service)
            .as_bytes(),
    )?;
    file.flush()?;
    let proxy = Proxy::new(
        &connection,
        "org.kde.KWin",
        "/Scripting",
        "org.kde.kwin.Scripting",
    )?;
    let id: i32 = proxy.call(
        "loadScript",
        &(file.path().to_string_lossy().as_ref(), name.as_str()),
    )?;
    if id < 0 {
        return Err("KWin refused the application icon observer".into());
    }
    let result = (|| -> Result {
        let path = format!("/Scripting/Script{id}");
        let script = Proxy::new(
            &connection,
            "org.kde.KWin",
            path.as_str(),
            "org.kde.kwin.Script",
        )?;
        match script.call::<_, _, ()>("run", &()) {
            Ok(()) => {}
            Err(zbus::Error::MethodError(error, _, _))
                if matches!(
                    error.as_str(),
                    "org.freedesktop.DBus.Error.UnknownObject"
                        | "org.freedesktop.DBus.Error.UnknownMethod"
                ) =>
            {
                // Plasma 5 exports script objects at /<id>; Plasma 6 moved them.
                let legacy_path = format!("/{id}");
                Proxy::new(
                    &connection,
                    "org.kde.KWin",
                    legacy_path.as_str(),
                    "org.kde.kwin.Script",
                )?
                .call::<_, _, ()>("run", &())?;
            }
            Err(error) => return Err(error.into()),
        }
        let mut checked = Instant::now();
        while !shared.stopped() {
            if checked.elapsed() >= Duration::from_secs(1) {
                if kwin_owner(&connection)? != owner {
                    return Err("KWin restarted".into());
                }
                checked = Instant::now();
            }
            shared.wait(100);
        }
        Ok(())
    })();
    let _ = proxy.call::<_, _, bool>("unloadScript", &(name.as_str(),));
    result
}
