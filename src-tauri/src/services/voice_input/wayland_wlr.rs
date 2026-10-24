use super::{Result, Shared};
use crate::services::voice_input::wayland_state::Toplevels;
use std::os::fd::AsRawFd;
use std::time::{Duration, Instant};
use wayland_client::{
    event_created_child, protocol::wl_registry, Connection, Dispatch, Proxy, QueueHandle,
};
use wayland_protocols_wlr::foreign_toplevel::v1::client::{
    zwlr_foreign_toplevel_handle_v1::{self, ZwlrForeignToplevelHandleV1 as Handle},
    zwlr_foreign_toplevel_manager_v1::{self, ZwlrForeignToplevelManagerV1 as Manager},
};

#[derive(Default)]
struct State {
    manager: Option<Manager>,
    windows: Toplevels,
    finished: bool,
}

impl Dispatch<wl_registry::WlRegistry, ()> for State {
    fn event(
        state: &mut Self,
        registry: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        _: &(),
        _: &Connection,
        queue: &QueueHandle<Self>,
    ) {
        if let wl_registry::Event::Global {
            name,
            interface,
            version,
        } = event
        {
            if interface == Manager::interface().name {
                state.manager = Some(registry.bind(name, version.min(3), queue, ()));
            }
        }
    }
}

impl Dispatch<Manager, ()> for State {
    fn event(
        state: &mut Self,
        _: &Manager,
        event: zwlr_foreign_toplevel_manager_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let zwlr_foreign_toplevel_manager_v1::Event::Finished = event {
            state.finished = true;
        }
    }
    event_created_child!(State, Manager, [0 => (Handle, ())]);
}

impl Dispatch<Handle, ()> for State {
    fn event(
        state: &mut Self,
        handle: &Handle,
        event: zwlr_foreign_toplevel_handle_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        let id = handle.id().protocol_id();
        match event {
            zwlr_foreign_toplevel_handle_v1::Event::AppId { app_id } => {
                state.windows.app_id(id, app_id)
            }
            zwlr_foreign_toplevel_handle_v1::Event::State { state: bytes } => {
                state.windows.state(id, &bytes)
            }
            zwlr_foreign_toplevel_handle_v1::Event::Done => state.windows.done(id),
            zwlr_foreign_toplevel_handle_v1::Event::Closed => {
                state.windows.closed(id);
                handle.destroy();
            }
            _ => {}
        }
    }
}

pub(super) fn run(shared: &Shared) -> Result {
    let connection = Connection::connect_to_env()?;
    let mut queue = connection.new_event_queue();
    let _registry = connection.display().get_registry(&queue.handle(), ());
    let mut state = State::default();
    let started = Instant::now();
    while !shared.stopped() {
        queue.dispatch_pending(&mut state)?;
        shared.set(state.windows.active.clone());
        if state.finished || (state.manager.is_none() && started.elapsed() > Duration::from_secs(1))
        {
            return Err("the compositor does not expose foreign-toplevel-management".into());
        }
        queue.flush()?;
        if let Some(read) = queue.prepare_read() {
            let mut descriptor = libc::pollfd {
                fd: read.connection_fd().as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            // A bounded wait also lets disabling voice input close this observer.
            let ready = unsafe { libc::poll(&mut descriptor, 1, 100) };
            if ready < 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() != std::io::ErrorKind::Interrupted {
                    return Err(error.into());
                }
            } else if ready > 0 {
                read.read()?;
            }
        }
    }
    Ok(())
}
