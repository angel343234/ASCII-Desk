//! Win32 Desktop Integration for ASCII Desk
//! 1. Sends 0x052C to Progman and anchors the wallpaper window into WorkerW behind desktop icons.
//! 2. Removes all window borders/frames/rounded corners and spans across all monitors (SM_XVIRTUALSCREEN..SM_CYVIRTUALSCREEN) or primary monitor.
//! 3. Allows hiding/showing Windows Desktop Icons (`SysListView32` inside `SHELLDLL_DefView`).
//! 4. Polls cursor & left-click state on the desktop surface, translating physical screen coordinates into WebView CSS coordinates.
//! 5. Detects fullscreen/maximized apps to auto-pause rendering.

use serde::Serialize;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, POINT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
};
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, ScreenToClient, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows_sys::Win32::UI::Controls::Dialogs::{
    GetOpenFileNameW, OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_NOCHANGEDIR, OFN_PATHMUSTEXIST,
    OPENFILENAMEW,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetAncestor, GetClassNameW, GetClientRect,
    GetCursorPos, GetForegroundWindow, GetParent, GetSystemMetrics, GetWindowLongPtrW,
    GetWindowRect, IsIconic, IsWindowVisible, IsZoomed, SendMessageTimeoutW, SetParent,
    SetWindowLongPtrW, SetWindowPos, ShowWindow, WindowFromPoint, GA_ROOT, GWL_EXSTYLE, GWL_STYLE,
    HWND_BOTTOM, HWND_TOP, SMTO_NORMAL, SM_CXSCREEN, SM_CXVIRTUALSCREEN, SM_CYSCREEN,
    SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SWP_FRAMECHANGED, SWP_NOACTIVATE,
    SWP_SHOWWINDOW, SW_HIDE, SW_SHOW, WS_BORDER, WS_CAPTION, WS_CHILD, WS_CLIPCHILDREN,
    WS_CLIPSIBLINGS, WS_DLGFRAME, WS_EX_APPWINDOW, WS_EX_CLIENTEDGE, WS_EX_DLGMODALFRAME,
    WS_EX_NOACTIVATE, WS_EX_STATICEDGE, WS_EX_TOOLWINDOW, WS_EX_WINDOWEDGE, WS_OVERLAPPEDWINDOW,
    WS_POPUP, WS_SYSMENU, WS_THICKFRAME, WS_VISIBLE,
};

static WORKERW_HWND: AtomicIsize = AtomicIsize::new(0);
static SHELL_DEFVIEW_HWND: AtomicIsize = AtomicIsize::new(0);
static WALLPAPER_HWND: AtomicIsize = AtomicIsize::new(0);
static PANEL_HWND: AtomicIsize = AtomicIsize::new(0);
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static SYSTEM_PAUSED: AtomicBool = AtomicBool::new(false);

pub fn register_panel_hwnd(hwnd_isize: isize) {
    PANEL_HWND.store(hwnd_isize, Ordering::SeqCst);
}

// Stored bounds of the wallpaper in screen coordinates for accurate mouse mapping
static WP_SCREEN_X: AtomicI32 = AtomicI32::new(0);
static WP_SCREEN_Y: AtomicI32 = AtomicI32::new(0);
static WP_SCREEN_W: AtomicI32 = AtomicI32::new(1920);
static WP_SCREEN_H: AtomicI32 = AtomicI32::new(1080);

#[derive(Clone, Serialize)]
pub struct DesktopMouseEvent {
    pub action: &'static str,
    pub x: f64,
    pub y: f64,
    pub vw: i32,
    pub vh: i32,
    pub button: u8,
}

fn wide_null(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn get_window_class(hwnd: HWND) -> String {
    if hwnd.is_null() {
        return String::new();
    }
    let mut buf = [0u16; 128];
    let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    if len > 0 {
        OsString::from_wide(&buf[..len as usize])
            .to_string_lossy()
            .into_owned()
    } else {
        String::new()
    }
}

unsafe extern "system" fn enum_windows_find_workerw(top_handle: HWND, _lparam: LPARAM) -> BOOL {
    let shell_dll_def_view = FindWindowExW(
        top_handle,
        std::ptr::null_mut(),
        wide_null("SHELLDLL_DefView").as_ptr(),
        std::ptr::null(),
    );

    if !shell_dll_def_view.is_null() {
        SHELL_DEFVIEW_HWND.store(shell_dll_def_view as isize, Ordering::SeqCst);
        let workerw = FindWindowExW(
            std::ptr::null_mut(),
            top_handle,
            wide_null("WorkerW").as_ptr(),
            std::ptr::null(),
        );
        if !workerw.is_null() {
            WORKERW_HWND.store(workerw as isize, Ordering::SeqCst);
            return 0;
        }
    }
    1
}

/// Anchors the wallpaper window behind desktop icons and sizes it across all monitors or primary monitor.
pub fn attach_to_desktop(hwnd_isize: isize, span_monitors: bool) -> Result<(), String> {
    unsafe {
        let hwnd = hwnd_isize as HWND;
        WALLPAPER_HWND.store(hwnd_isize, Ordering::SeqCst);

        // Disable Windows 11 DWM rounded corners and borders completely
        let corner_pref: u32 = DWMWCP_DONOTROUND as u32;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            &corner_pref as *const _ as *const _,
            std::mem::size_of::<u32>() as u32,
        );
        let border_none: u32 = 0xFFFFFFFE; // DWMWA_COLOR_NONE
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR as u32,
            &border_none as *const _ as *const _,
            std::mem::size_of::<u32>() as u32,
        );

        let progman = FindWindowW(wide_null("Progman").as_ptr(), std::ptr::null());
        WORKERW_HWND.store(0, Ordering::SeqCst);

        if !progman.is_null() {
            let mut result: usize = 0;
            SendMessageTimeoutW(
                progman,
                0x052C,
                0xD as WPARAM,
                0x1 as LPARAM,
                SMTO_NORMAL,
                1000,
                &mut result,
            );
        }

        EnumWindows(Some(enum_windows_find_workerw), 0);
        let mut target_parent = WORKERW_HWND.load(Ordering::SeqCst) as HWND;

        if target_parent.is_null() && !progman.is_null() {
            let defview_in_progman = FindWindowExW(
                progman,
                std::ptr::null_mut(),
                wide_null("SHELLDLL_DefView").as_ptr(),
                std::ptr::null(),
            );
            if !defview_in_progman.is_null() {
                SHELL_DEFVIEW_HWND.store(defview_in_progman as isize, Ordering::SeqCst);
            }

            let worker_in_progman = FindWindowExW(
                progman,
                std::ptr::null_mut(),
                wide_null("WorkerW").as_ptr(),
                std::ptr::null(),
            );
            target_parent = if !worker_in_progman.is_null() {
                worker_in_progman
            } else {
                progman
            };
            WORKERW_HWND.store(target_parent as isize, Ordering::SeqCst);
        }

        // Remove any stale "ASCII Desk Wallpaper" child windows left inside WorkerW by killed processes
        if !target_parent.is_null() {
            let wp_title = wide_null("ASCII Desk Wallpaper");
            let mut prev_child: HWND = std::ptr::null_mut();
            loop {
                let child = FindWindowExW(
                    target_parent,
                    prev_child,
                    std::ptr::null(),
                    wp_title.as_ptr(),
                );
                if child.is_null() {
                    break;
                }
                if child != hwnd {
                    ShowWindow(child, SW_HIDE);
                    SetParent(child, std::ptr::null_mut());
                }
                prev_child = child;
            }
        }

        // Only attach if we already have the proper parent
        let current_parent = GetParent(hwnd);
        if !target_parent.is_null() {
            if current_parent != target_parent {
                // Strip all frame/border/caption styles
                let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
                let strip_mask = (WS_CAPTION
                    | WS_THICKFRAME
                    | WS_BORDER
                    | WS_DLGFRAME
                    | WS_SYSMENU
                    | WS_OVERLAPPEDWINDOW) as isize;

                let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                let strip_ex = (WS_EX_DLGMODALFRAME
                    | WS_EX_WINDOWEDGE
                    | WS_EX_CLIENTEDGE
                    | WS_EX_STATICEDGE
                    | WS_EX_APPWINDOW) as isize;
                SetWindowLongPtrW(
                    hwnd,
                    GWL_EXSTYLE,
                    (ex_style & !strip_ex)
                        | (WS_EX_TOOLWINDOW as isize)
                        | (WS_EX_NOACTIVATE as isize),
                );

                let new_style = (style & !strip_mask)
                    | (WS_POPUP as isize)
                    | (WS_VISIBLE as isize)
                    | (WS_CLIPSIBLINGS as isize)
                    | (WS_CLIPCHILDREN as isize);
                SetWindowLongPtrW(hwnd, GWL_STYLE, new_style);

                SetParent(hwnd, target_parent);
                let child_style = (new_style & !(WS_POPUP as isize)) | (WS_CHILD as isize);
                SetWindowLongPtrW(hwnd, GWL_STYLE, child_style);
                ShowWindow(target_parent, SW_SHOW);
            }
            update_wallpaper_bounds(span_monitors);
            ShowWindow(hwnd, SW_SHOW);
        } else {
            // If WorkerW / Progman is not ready yet, keep hidden so we never show a floating window on top of apps
            ShowWindow(hwnd, SW_HIDE);
        }
    }

    Ok(())
}

/// Updates the wallpaper window bounds to either span all monitors continuously or cover the primary monitor.
pub fn update_wallpaper_bounds(span_monitors: bool) {
    unsafe {
        let hwnd = WALLPAPER_HWND.load(Ordering::SeqCst) as HWND;
        let target_parent = WORKERW_HWND.load(Ordering::SeqCst) as HWND;
        if hwnd.is_null() {
            return;
        }

        let (scr_x, scr_y, scr_w, scr_h) = if span_monitors {
            let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
            let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
            let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
            (
                vx,
                vy,
                if vw > 0 { vw } else { GetSystemMetrics(SM_CXSCREEN) },
                if vh > 0 { vh } else { GetSystemMetrics(SM_CYSCREEN) },
            )
        } else {
            (0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN))
        };

        WP_SCREEN_X.store(scr_x, Ordering::SeqCst);
        WP_SCREEN_Y.store(scr_y, Ordering::SeqCst);
        WP_SCREEN_W.store(scr_w.max(1), Ordering::SeqCst);
        WP_SCREEN_H.store(scr_h.max(1), Ordering::SeqCst);

        let (pos_x, pos_y, z_order) = if !target_parent.is_null() {
            let mut pt = POINT { x: scr_x, y: scr_y };
            ScreenToClient(target_parent, &mut pt);
            (pt.x, pt.y, HWND_TOP)
        } else {
            (scr_x, scr_y, HWND_BOTTOM)
        };

        SetWindowPos(
            hwnd,
            z_order,
            pos_x,
            pos_y,
            scr_w,
            scr_h,
            SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
        );

        let mut client_rc = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetClientRect(hwnd, &mut client_rc) != 0 {
            let cw = client_rc.right - client_rc.left;
            let ch = client_rc.bottom - client_rc.top;
            let diff_w = scr_w - cw;
            let diff_h = scr_h - ch;
            if diff_w > 0 || diff_h > 0 {
                SetWindowPos(
                    hwnd,
                    z_order,
                    pos_x - (diff_w / 2),
                    pos_y - (diff_h / 2),
                    scr_w + diff_w,
                    scr_h + diff_h,
                    SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
                );
            }
        }
    }
}

/// Hides or shows the Windows Desktop Icons (`SysListView32` inside `SHELLDLL_DefView`).
pub fn set_desktop_icons_hidden(hide: bool) {
    unsafe {
        let mut defview = SHELL_DEFVIEW_HWND.load(Ordering::SeqCst) as HWND;
        if defview.is_null() {
            EnumWindows(Some(enum_windows_find_workerw), 0);
            defview = SHELL_DEFVIEW_HWND.load(Ordering::SeqCst) as HWND;
        }
        if defview.is_null() {
            let progman = FindWindowW(wide_null("Progman").as_ptr(), std::ptr::null());
            if !progman.is_null() {
                defview = FindWindowExW(
                    progman,
                    std::ptr::null_mut(),
                    wide_null("SHELLDLL_DefView").as_ptr(),
                    std::ptr::null(),
                );
            }
        }

        if !defview.is_null() {
            let folder_view = FindWindowExW(
                defview,
                std::ptr::null_mut(),
                wide_null("SysListView32").as_ptr(),
                std::ptr::null(),
            );
            let target = if !folder_view.is_null() {
                folder_view
            } else {
                defview
            };
            ShowWindow(target, if hide { SW_HIDE } else { SW_SHOW });
        }
    }
}

/// Checks if a point on screen is over the desktop surface (any monitor's desktop area) and not an open application window.
unsafe fn is_point_on_desktop(pt: POINT) -> bool {
    let hwnd = WindowFromPoint(pt);
    if hwnd.is_null() {
        return false;
    }

    let wp_hwnd = WALLPAPER_HWND.load(Ordering::SeqCst) as HWND;
    let panel_hwnd = PANEL_HWND.load(Ordering::SeqCst) as HWND;
    let workerw_hwnd = WORKERW_HWND.load(Ordering::SeqCst) as HWND;
    let defview_hwnd = SHELL_DEFVIEW_HWND.load(Ordering::SeqCst) as HWND;

    // Never treat the Studio Panel window (or any child of it) as desktop surface
    if !panel_hwnd.is_null() {
        if hwnd == panel_hwnd || GetAncestor(hwnd, GA_ROOT) == panel_hwnd {
            return false;
        }
    }

    if hwnd == wp_hwnd || hwnd == workerw_hwnd || hwnd == defview_hwnd {
        return true;
    }

    let class = get_window_class(hwnd);
    if matches!(
        class.as_str(),
        "SysListView32"
            | "SHELLDLL_DefView"
            | "WorkerW"
            | "Progman"
            | "Chrome_WidgetWin_0"
            | "Chrome_WidgetWin_1"
            | "Chrome_RenderWidgetHostHWND"
            | "Intermediate D3D Window"
    ) {
        let mut cur = hwnd;
        for _ in 0..8 {
            if cur.is_null() {
                break;
            }
            if cur == wp_hwnd || cur == workerw_hwnd || cur == defview_hwnd {
                return true;
            }
            let c_name = get_window_class(cur);
            if c_name == "Progman" || c_name == "WorkerW" || c_name == "SHELLDLL_DefView" {
                return true;
            }
            cur = GetParent(cur);
        }

        let root = GetAncestor(hwnd, GA_ROOT);
        if !root.is_null() {
            if root == wp_hwnd || root == workerw_hwnd {
                return true;
            }
            let root_class = get_window_class(root);
            if root_class == "Progman" || root_class == "WorkerW" {
                return true;
            }
        }
    }

    false
}

/// Checks if the foreground window is maximized/fullscreen when running on a single screen.
pub fn is_foreground_maximized_or_fullscreen(span_monitors: bool) -> bool {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.is_null() || IsWindowVisible(fg) == 0 || IsIconic(fg) != 0 {
            return false;
        }

        let wp_hwnd = WALLPAPER_HWND.load(Ordering::SeqCst) as HWND;
        if fg == wp_hwnd {
            return false;
        }

        let class = get_window_class(fg);
        if matches!(
            class.as_str(),
            "Progman"
                | "WorkerW"
                | "Shell_TrayWnd"
                | "Shell_SecondaryTrayWnd"
                | "Windows.UI.Core.CoreWindow"
                | "XamlExplorerHostIslandWindow"
        ) {
            return false;
        }

        if span_monitors {
            let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            let sw = GetSystemMetrics(SM_CXSCREEN);
            if vw > sw {
                return false;
            }
        }

        if IsZoomed(fg) != 0 {
            return true;
        }

        let mut win_rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetWindowRect(fg, &mut win_rect) != 0 {
            let monitor = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
            if !monitor.is_null() {
                let mut mi: MONITORINFO = std::mem::zeroed();
                mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
                if GetMonitorInfoW(monitor, &mut mi) != 0 {
                    let mr = mi.rcMonitor;
                    let covers_monitor = win_rect.left <= mr.left
                        && win_rect.top <= mr.top
                        && win_rect.right >= mr.right
                        && win_rect.bottom >= mr.bottom;
                    if covers_monitor {
                        return true;
                    }
                }
            }
        }

        false
    }
}

/// Checks if the wallpaper HWND is still valid and its parent is still our target WorkerW.
/// If Explorer restarted (e.g., crash or display change), re-attaches automatically.
pub fn ensure_attached(span_monitors: bool) {
    unsafe {
        let hwnd = WALLPAPER_HWND.load(Ordering::SeqCst) as HWND;
        if hwnd.is_null() {
            return;
        }
        let current_parent = GetParent(hwnd);
        let expected_parent = WORKERW_HWND.load(Ordering::SeqCst) as HWND;
        if current_parent.is_null()
            || expected_parent.is_null()
            || current_parent != expected_parent
        {
            let _ = attach_to_desktop(hwnd as isize, span_monitors);
        }
    }
}

/// Opens a native Win32 file picker dialog (`GetOpenFileNameW` in `comdlg32.dll`).
/// Runs on a background thread with zero external processes (no PowerShell).
pub fn open_media_file_dialog(media_type: &str) -> Option<String> {
    unsafe {
        let filter_str = match media_type {
            "video" => "Video MP4/WebM\0*.mp4;*.webm\0GIF Animado\0*.gif\0Todos los archivos\0*.*\0\0",
            "gif" => "GIF Animado\0*.gif\0Multimedia\0*.gif;*.png;*.jpg;*.jpeg;*.webp;*.mp4;*.webm\0Todos los archivos\0*.*\0\0",
            _ => "Imágenes y GIF\0*.png;*.jpg;*.jpeg;*.webp;*.gif\0Todos los archivos\0*.*\0\0",
        };
        let filter_wide: Vec<u16> = filter_str.encode_utf16().collect();
        let title_wide = wide_null("Seleccionar archivo multimedia - ASCII & Shader Studio");
        let mut file_buf = vec![0u16; 1024];

        let mut ofn: OPENFILENAMEW = std::mem::zeroed();
        ofn.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
        ofn.lpstrFilter = filter_wide.as_ptr();
        ofn.lpstrFile = file_buf.as_mut_ptr();
        ofn.nMaxFile = file_buf.len() as u32;
        ofn.lpstrTitle = title_wide.as_ptr();
        ofn.Flags = OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;

        if GetOpenFileNameW(&mut ofn) != 0 {
            let len = file_buf.iter().position(|&c| c == 0).unwrap_or(0);
            if len > 0 {
                return Some(
                    OsString::from_wide(&file_buf[..len])
                        .to_string_lossy()
                        .into_owned(),
                );
            }
        }
        None
    }
}

pub fn set_hook_paused(paused: bool) {
    SYSTEM_PAUSED.store(paused, Ordering::Relaxed);
}

/// Starts a reliable, lightweight 60Hz cursor & left-button polling thread (`GetCursorPos` + `GetAsyncKeyState(VK_LBUTTON)`).
pub fn start_mouse_hook(app: AppHandle) {
    let _ = APP_HANDLE.set(app);

    std::thread::spawn(|| unsafe {
        let mut prev_x = i32::MIN;
        let mut prev_y = i32::MIN;
        let mut was_left_down = false;

        loop {
            std::thread::sleep(Duration::from_millis(16));

            if SYSTEM_PAUSED.load(Ordering::Relaxed) {
                was_left_down = (GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000) != 0;
                continue;
            }

            let mut pt = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut pt) == 0 {
                continue;
            }

            let is_left_down = (GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000) != 0;
            let moved = pt.x != prev_x || pt.y != prev_y;
            let left_just_pressed = is_left_down && !was_left_down;
            let left_just_released = !is_left_down && was_left_down;

            prev_x = pt.x;
            prev_y = pt.y;
            was_left_down = is_left_down;

            if !moved && !left_just_pressed && !left_just_released {
                continue;
            }

            if !is_point_on_desktop(pt) {
                continue;
            }

            let ox = WP_SCREEN_X.load(Ordering::Relaxed);
            let oy = WP_SCREEN_Y.load(Ordering::Relaxed);
            let vw = WP_SCREEN_W.load(Ordering::Relaxed).max(1);
            let vh = WP_SCREEN_H.load(Ordering::Relaxed).max(1);

            let rel_x = (pt.x - ox) as f64;
            let rel_y = (pt.y - oy) as f64;

            if let Some(app_handle) = APP_HANDLE.get() {
                if left_just_pressed {
                    let _ = app_handle.emit_to(
                        "wallpaper",
                        "desktop-mouse",
                        DesktopMouseEvent {
                            action: "left_down",
                            x: rel_x,
                            y: rel_y,
                            vw,
                            vh,
                            button: 0,
                        },
                    );
                } else if left_just_released {
                    let _ = app_handle.emit_to(
                        "wallpaper",
                        "desktop-mouse",
                        DesktopMouseEvent {
                            action: "left_up",
                            x: rel_x,
                            y: rel_y,
                            vw,
                            vh,
                            button: 0,
                        },
                    );
                } else if moved {
                    let _ = app_handle.emit_to(
                        "wallpaper",
                        "desktop-mouse",
                        DesktopMouseEvent {
                            action: "move",
                            x: rel_x,
                            y: rel_y,
                            vw,
                            vh,
                            button: 0,
                        },
                    );
                }
            }
        }
    });
}
