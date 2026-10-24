use super::*;
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIcon, CreateWindowExW, DestroyIcon, DestroyWindow, SendMessageW, HICON, HWND_MESSAGE,
    ICON_BIG, ICON_SMALL, WINDOW_EX_STYLE, WM_SETICON, WS_OVERLAPPED,
};

struct Window {
    handle: HWND,
    icons: Vec<HICON>,
}

impl Drop for Window {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyWindow(self.handle);
            for icon in &self.icons {
                let _ = DestroyIcon(*icon);
            }
        }
    }
}

#[test]
fn window_icon_keeps_large_details_and_borrowed_handles() {
    unsafe {
        let mut window = Window {
            handle: CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("STATIC"),
                w!("EchoBird icon fixture"),
                WS_OVERLAPPED,
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                None,
                None,
            )
            .unwrap(),
            icons: Vec::new(),
        };
        for (size, kind) in [(16, ICON_SMALL), (64, ICON_BIG)] {
            let pixels: Vec<u8> = (0..size * size)
                .flat_map(|index| {
                    if size == 16 {
                        [0, 255, 0, 255]
                    } else if index % size < 4 {
                        [50, 100, 200, 128]
                    } else if index % 2 == 0 {
                        [0, 0, 255, 255]
                    } else {
                        [255, 0, 0, 255]
                    }
                })
                .collect();
            let mask = vec![0_u8; size * size / 8];
            let icon = CreateIcon(
                None,
                size as i32,
                size as i32,
                1,
                32,
                mask.as_ptr(),
                pixels.as_ptr(),
            )
            .unwrap();
            window.icons.push(icon);
            SendMessageW(
                window.handle,
                WM_SETICON,
                Some(WPARAM(kind as usize)),
                Some(LPARAM(icon.0 as isize)),
            );
        }
        let encoded = read(window.handle.0 as u64).unwrap();
        let target = Target::Window(window.handle.0 as u64);
        let identity = cache_key(&target);
        assert!(identity.is_some());
        assert_eq!(identity, cache_key(&target));
        assert!(cache_key(&Target::Window(0)).is_none());
        let png = base64::engine::general_purpose::STANDARD
            .decode(encoded.strip_prefix("data:image/png;base64,").unwrap())
            .unwrap();
        let image = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(image.dimensions(), (64, 64));
        assert_eq!(image.get_pixel(2, 32).0, [199, 100, 50, 128]);
        assert_eq!(image.get_pixel(4, 32).0, [255, 0, 0, 255]);
        assert_eq!(image.get_pixel(5, 32).0, [0, 0, 255, 255]);
        // Reading again also proves that neither borrowed window icon was destroyed.
        assert_eq!(
            window_icon(window.handle.0 as u64, true),
            Some(window.icons[1])
        );
        assert_eq!(draw_icon(window.icons[1]).unwrap().width(), 64);
        assert_eq!(
            window_icon(window.handle.0 as u64, false),
            Some(window.icons[0])
        );
        assert_eq!(draw_icon(window.icons[0]).unwrap().width(), 16);
        assert!(read(0).is_none());
    }
}
