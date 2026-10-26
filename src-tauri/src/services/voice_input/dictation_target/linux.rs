use super::{native, Edit, InputTarget, MAX_FIELD_BYTES, UNAVAILABLE};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;
use zbus::blocking::{connection::Builder, Connection, Proxy};
use zbus::zvariant::OwnedObjectPath;

type Object = (String, OwnedObjectPath);
const ROLE_PASSWORD_TEXT: u32 = 40;
type CacheItem = (
    Object,
    Object,
    Object,
    i32,
    i32,
    Vec<String>,
    String,
    u32,
    String,
    Vec<u32>,
);

fn state(states: &[u32], index: u32) -> bool {
    states
        .get((index / 32) as usize)
        .is_some_and(|bits| bits & (1 << (index % 32)) != 0)
}

fn connection(address: &str) -> Option<Connection> {
    if !address.starts_with("unix:") {
        return None;
    }
    Builder::address(address)
        .ok()?
        .method_timeout(Duration::from_millis(150))
        .build()
        .ok()
}

pub(super) struct Target {
    address: String,
    object: Object,
    edit: Edit,
    offset: i32,
    replace_selection: bool,
}

pub(super) fn capture(input: Option<InputTarget>) -> Option<Target> {
    if input.is_some_and(|original| !original.matches(native::input_target())) {
        return None;
    }
    let started = Instant::now();
    let session = Builder::session()
        .ok()?
        .method_timeout(Duration::from_millis(150))
        .build()
        .ok()?;
    let bus = Proxy::new(&session, "org.a11y.Bus", "/org/a11y/bus", "org.a11y.Bus").ok()?;
    let address: String = bus.call("GetAddress", &()).ok()?;
    let connection = connection(&address)?;
    let desktop = Proxy::new(
        &connection,
        "org.a11y.atspi.Registry",
        "/org/a11y/atspi/accessible/root",
        "org.a11y.atspi.Accessible",
    )
    .ok()?;
    let applications: Vec<Object> = desktop.call("GetChildren", &()).ok()?;
    for (destination, _) in applications.into_iter().take(64) {
        if started.elapsed() > Duration::from_millis(600) {
            break;
        }
        if !destination.starts_with(':') {
            continue;
        }
        let cache = Proxy::new(
            &connection,
            destination.as_str(),
            "/org/a11y/atspi/cache",
            "org.a11y.atspi.Cache",
        )
        .ok()?;
        let Ok(items): Result<Vec<CacheItem>, _> = cache.call("GetItems", &()) else {
            continue;
        };
        if items.len() > 16_384 {
            continue;
        }
        let ancestors: HashMap<_, _> = items
            .iter()
            .map(|item| (item.0.clone(), (item.2.clone(), &item.9)))
            .collect();
        for (object, _, _, _, _, interfaces, _, role, _, states) in &items {
            if started.elapsed() > Duration::from_millis(600) {
                return None;
            }
            if *role == ROLE_PASSWORD_TEXT
                || !state(states, 12)
                || state(states, 6)
                || !interfaces
                    .iter()
                    .any(|name| name == "org.a11y.atspi.EditableText")
            {
                continue;
            }
            // Inactive applications can retain FOCUSED on their last field.
            // Require a live ACTIVE ancestor, not just a cached focused bit.
            let mut ancestor = object.clone();
            let mut active = None;
            for _ in 0..32 {
                let Some((parent, states)) = ancestors.get(&ancestor) else {
                    break;
                };
                if state(states, 1) {
                    active = Some(ancestor);
                    break;
                }
                ancestor = parent.clone();
            }
            let Some(active) = active else {
                continue;
            };
            let active = Proxy::new(
                &connection,
                active.0.as_str(),
                active.1.as_str(),
                "org.a11y.atspi.Accessible",
            )
            .ok()?;
            let Ok(states): Result<Vec<u32>, _> = active.call("GetState", &()) else {
                continue;
            };
            if !state(&states, 1) {
                continue;
            }
            let Some(target) = capture_object(&connection, &address, object) else {
                continue;
            };
            let states: Vec<u32> = active.call("GetState", &()).ok()?;
            if !state(&states, 1)
                || input.is_some_and(|original| !original.matches(native::input_target()))
            {
                return None;
            }
            return Some(target);
        }
    }
    None
}

fn capture_object(connection: &Connection, address: &str, object: &Object) -> Option<Target> {
    if !object.0.starts_with(':') {
        return None;
    }
    let accessible = Proxy::new(
        connection,
        object.0.as_str(),
        object.1.as_str(),
        "org.a11y.atspi.Accessible",
    )
    .ok()?;
    let role: u32 = accessible.call("GetRole", &()).ok()?;
    if role == ROLE_PASSWORD_TEXT {
        return None;
    }
    let states: Vec<u32> = accessible.call("GetState", &()).ok()?;
    if !state(&states, 12) || !state(&states, 7) || state(&states, 6) {
        return None;
    }
    let text = Proxy::new(
        connection,
        object.0.as_str(),
        object.1.as_str(),
        "org.a11y.atspi.Text",
    )
    .ok()?;
    let count: i32 = text.get_property("CharacterCount").ok()?;
    if !(0..=MAX_FIELD_BYTES as i32 / 4).contains(&count) {
        return None;
    }
    let original: String = text.call("GetText", &(0_i32, count)).ok()?;
    let offset: i32 = text.get_property("CaretOffset").ok()?;
    let selections: i32 = text.call("GetNSelections", &()).ok()?;
    let (start, end) = match selections {
        0 => (offset, offset),
        1 => text.call("GetSelection", &(0_i32,)).ok()?,
        _ => return None,
    };
    let edit = Edit::characters(
        original,
        usize::try_from(start).ok()?,
        usize::try_from(end).ok()?,
    )?;
    let states: Vec<u32> = accessible.call("GetState", &()).ok()?;
    if !state(&states, 12) {
        return None;
    }
    Some(Target {
        address: address.into(),
        object: object.clone(),
        edit,
        offset: start,
        replace_selection: start != end,
    })
}

impl Target {
    pub(super) fn insert(self, inserted: &str, cancel: &CancellationToken) -> Result<(), String> {
        if cancel.is_cancelled() {
            return Err("voice.error.cancelled".into());
        }
        let connection = connection(&self.address).ok_or(UNAVAILABLE)?;
        let accessible = Proxy::new(
            &connection,
            self.object.0.as_str(),
            self.object.1.as_str(),
            "org.a11y.atspi.Accessible",
        )
        .map_err(|_| UNAVAILABLE)?;
        let role: u32 = accessible.call("GetRole", &()).map_err(|_| UNAVAILABLE)?;
        if role == ROLE_PASSWORD_TEXT {
            return Err(UNAVAILABLE.into());
        }
        let states: Vec<u32> = accessible.call("GetState", &()).map_err(|_| UNAVAILABLE)?;
        if state(&states, 6) || !state(&states, 7) {
            return Err(UNAVAILABLE.into());
        }
        let text = Proxy::new(
            &connection,
            self.object.0.as_str(),
            self.object.1.as_str(),
            "org.a11y.atspi.Text",
        )
        .map_err(|_| UNAVAILABLE)?;
        let current: String = text
            .call("GetText", &(0_i32, -1_i32))
            .map_err(|_| UNAVAILABLE)?;
        let replacement = self.edit.replace(&current, inserted)?;
        let editable = Proxy::new(
            &connection,
            self.object.0.as_str(),
            self.object.1.as_str(),
            "org.a11y.atspi.EditableText",
        )
        .map_err(|_| UNAVAILABLE)?;
        if cancel.is_cancelled() {
            return Err("voice.error.cancelled".into());
        }
        let success: bool = if self.replace_selection {
            editable
                .call("SetTextContents", &(replacement,))
                .map_err(|_| UNAVAILABLE)?
        } else {
            let bytes = i32::try_from(inserted.len()).map_err(|_| UNAVAILABLE)?;
            editable
                .call("InsertText", &(self.offset, inserted, bytes))
                .map_err(|_| UNAVAILABLE)?
        };
        if success {
            Ok(())
        } else {
            Err(UNAVAILABLE.into())
        }
    }
}
