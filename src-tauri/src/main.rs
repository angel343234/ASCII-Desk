#![windows_subsystem = "windows"]

mod win32_desktop;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    http::{header::CONTENT_TYPE, Response, StatusCode},
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder,
};
use winreg::enums::*;
use winreg::RegKey;

const BRIDGE_JS: &str = include_str!("../../src/bridge.js");

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SelectOption {
    pub label: String,
    pub value: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ManifestControl {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub control_type: String,
    pub default: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<SelectOption>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WallpaperManifest {
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub controls: Vec<ManifestControl>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WallpaperEntry {
    pub folder: String,
    pub manifest: WallpaperManifest,
}

fn default_true() -> bool {
    true
}

fn default_source_type() -> String {
    "interactive".to_string()
}

fn default_shader() -> Value {
    serde_json::json!({
        "styleId": "none",
        "cellSize": 12,
        "charset": " .:-=+*xX80$#@",
        "opacity": 1.0,
        "blendMode": 0,
        "invert": false,
        "dotGrid": false,
        "contrast": 1.0,
        "brightness": 0.0,
        "saturation": 1.0,
        "relief": 0.25,
        "bevel": 0.25,
        "lightAngle": 135,
        "palette": 0,
        "fgColor": "#38bdf8",
        "bgColor": "#070b10",
        "useCustomColors": false,
        "animSpeed": 1.0,
        "intensity": 1.0,
        "param1": 0.5,
        "param2": 0.5,
        "fitMode": 0
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PersistentConfig {
    pub active_wallpaper: String,
    #[serde(default = "default_source_type")]
    pub source_type: String,
    #[serde(default)]
    pub media_path: String,
    #[serde(default = "default_shader")]
    pub shader: Value,
    pub paused: bool,
    pub autostart: bool,
    #[serde(default)]
    pub hide_desktop_icons: bool,
    #[serde(default = "default_true")]
    pub span_monitors: bool,
    pub settings: HashMap<String, HashMap<String, Value>>,
}

impl Default for PersistentConfig {
    fn default() -> Self {
        Self {
            active_wallpaper: "ascii-koi".to_string(),
            source_type: default_source_type(),
            media_path: String::new(),
            shader: default_shader(),
            paused: false,
            autostart: false,
            hide_desktop_icons: false,
            span_monitors: true,
            settings: HashMap::new(),
        }
    }
}

pub struct EngineState {
    pub wallpapers_dir: PathBuf,
    pub config_path: PathBuf,
    pub config: PersistentConfig,
    pub wallpapers: Vec<WallpaperEntry>,
    pub auto_paused: bool,
}

#[derive(Clone, Serialize)]
pub struct FullAppState {
    pub active_wallpaper: String,
    pub source_type: String,
    pub media_path: String,
    pub shader: Value,
    pub paused: bool,
    pub auto_paused: bool,
    pub autostart: bool,
    pub hide_desktop_icons: bool,
    pub span_monitors: bool,
    pub wallpapers: Vec<WallpaperEntry>,
    pub settings: HashMap<String, HashMap<String, Value>>,
}

fn sync_wallpapers_to_src(root_wp: &Path, src_wp: &Path) {
    if !root_wp.exists() {
        return;
    }
    let _ = fs::create_dir_all(src_wp);
    if let Ok(entries) = fs::read_dir(root_wp) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let folder_name = entry.file_name();
                let dest_dir = src_wp.join(&folder_name);
                if !dest_dir.exists() {
                    let _ = copy_dir_recursive(&path, &dest_dir);
                } else {
                    for file_name in ["manifest.json", "index.html", "app.js"] {
                        let s = path.join(file_name);
                        let d = dest_dir.join(file_name);
                        if s.exists() {
                            let _ = fs::copy(&s, &d);
                        }
                    }
                }
            }
        }
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}

fn find_project_paths() -> (PathBuf, PathBuf) {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    let candidates = [
        std::env::current_dir().unwrap_or_default(),
        exe_dir.clone(),
        exe_dir.join(".."),
        exe_dir.join("../.."),
        exe_dir.join("../../.."),
    ];

    for base in &candidates {
        let wp_dir = base.join("wallpapers");
        if wp_dir.exists() && wp_dir.is_dir() {
            let src_wp = base.join("src").join("wallpapers");
            sync_wallpapers_to_src(&wp_dir, &src_wp);
            return (wp_dir, base.join("config.json"));
        }
    }

    let fallback = std::env::current_dir().unwrap_or_else(|_| exe_dir);
    (fallback.join("wallpapers"), fallback.join("config.json"))
}

fn scan_wallpapers(wallpapers_dir: &Path) -> Vec<WallpaperEntry> {
    let mut entries = Vec::new();
    if let Ok(read_dir) = fs::read_dir(wallpapers_dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let folder = entry.file_name().to_string_lossy().to_string();
                let index_html = path.join("index.html");
                let manifest_path = path.join("manifest.json");
                if index_html.exists() && manifest_path.exists() {
                    if let Ok(raw) = fs::read_to_string(&manifest_path) {
                        if let Ok(manifest) = serde_json::from_str::<WallpaperManifest>(&raw) {
                            entries.push(WallpaperEntry { folder, manifest });
                        }
                    }
                }
            }
        }
    }
    entries.sort_by(|a, b| a.folder.cmp(&b.folder));
    entries
}

fn ensure_default_settings(config: &mut PersistentConfig, wallpapers: &[WallpaperEntry]) {
    for wp in wallpapers {
        let folder_settings = config.settings.entry(wp.folder.clone()).or_default();
        for ctrl in &wp.manifest.controls {
            folder_settings
                .entry(ctrl.id.clone())
                .or_insert_with(|| ctrl.default.clone());
        }
    }
    if !wallpapers.is_empty()
        && !wallpapers
            .iter()
            .any(|w| w.folder == config.active_wallpaper)
    {
        config.active_wallpaper = wallpapers[0].folder.clone();
    }
}

fn save_config(path: &Path, config: &PersistentConfig) {
    if let Ok(json) = serde_json::to_string_pretty(config) {
        let _ = fs::write(path, json);
    }
}

fn get_autostart_registry() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(run_key) = hkcu.open_subkey_with_flags(
        "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        KEY_READ,
    ) {
        let val: Result<String, _> = run_key.get_value("ASCIIDesk");
        return val.is_ok();
    }
    false
}

fn set_autostart_registry(enabled: bool) {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok((run_key, _)) =
        hkcu.create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
    {
        if enabled {
            if let Ok(exe) = std::env::current_exe() {
                let exe_str = format!("\"{}\"", exe.to_string_lossy());
                let _ = run_key.set_value("ASCIIDesk", &exe_str);
            }
        } else {
            let _ = run_key.delete_value("ASCIIDesk");
        }
    }
}

fn mime_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        _ => "application/octet-stream",
    }
}

fn url_decode(input: &str) -> String {
    let mut bytes = Vec::with_capacity(input.len());
    let mut chars = input.as_bytes().iter().copied();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next();
            let h2 = chars.next();
            if let (Some(c1), Some(c2)) = (h1, h2) {
                let hex = [c1, c2];
                if let Ok(s) = std::str::from_utf8(&hex) {
                    if let Ok(val) = u8::from_str_radix(s, 16) {
                        bytes.push(val);
                        continue;
                    }
                }
            }
            bytes.push(b'%');
        } else if b == b'+' {
            bytes.push(b' ');
        } else {
            bytes.push(b);
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn rebuild_tray_menu(app: &AppHandle, state: &Arc<Mutex<EngineState>>) {
    let Ok(guard) = state.lock() else { return };

    let Some(tray) = app.tray_by_id("main-tray") else {
        return;
    };

    let Ok(submenu) = Submenu::new(app, "Cambiar fondo", true) else {
        return;
    };

    for wp in &guard.wallpapers {
        let is_active =
            guard.config.source_type == "interactive" && wp.folder == guard.config.active_wallpaper;
        let id = format!("wp:{}", wp.folder);
        if let Ok(item) = CheckMenuItem::with_id(
            app,
            id,
            &wp.manifest.name,
            true,
            is_active,
            None::<&str>,
        ) {
            let _ = submenu.append(&item);
        }
    }

    let pause_label = if guard.config.paused {
        "Reanudar fondo"
    } else {
        "Pausar fondo"
    };

    let Ok(item_config) = MenuItem::with_id(
        app,
        "open_panel",
        "Abrir ASCII Desk",
        true,
        None::<&str>,
    ) else {
        return;
    };
    let Ok(item_pause) = MenuItem::with_id(app, "toggle_pause", pause_label, true, None::<&str>)
    else {
        return;
    };
    let Ok(item_span) = CheckMenuItem::with_id(
        app,
        "toggle_span",
        "Extender en todas las pantallas",
        true,
        guard.config.span_monitors,
        None::<&str>,
    ) else {
        return;
    };
    let Ok(item_hide_icons) = CheckMenuItem::with_id(
        app,
        "toggle_hide_icons",
        "Ocultar iconos del escritorio",
        true,
        guard.config.hide_desktop_icons,
        None::<&str>,
    ) else {
        return;
    };
    let Ok(item_autostart) = CheckMenuItem::with_id(
        app,
        "toggle_autostart",
        "Iniciar con Windows",
        true,
        guard.config.autostart,
        None::<&str>,
    ) else {
        return;
    };
    let Ok(sep1) = PredefinedMenuItem::separator(app) else {
        return;
    };
    let Ok(sep2) = PredefinedMenuItem::separator(app) else {
        return;
    };
    let Ok(item_quit) = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>) else {
        return;
    };

    if let Ok(menu) = Menu::with_items(
        app,
        &[
            &submenu,
            &item_config,
            &item_pause,
            &sep1,
            &item_span,
            &item_hide_icons,
            &item_autostart,
            &sep2,
            &item_quit,
        ],
    ) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn show_studio_window(app: &AppHandle) {
    if let Some(panel) = app.get_webview_window("panel") {
        unsafe {
            let screen_w = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(0);
            let screen_h = windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(1);
            let win_w = 1100;
            let win_h = 720;
            let x = ((screen_w - win_w) / 2).max(20);
            let y = ((screen_h - win_h) / 2).max(20);
            let _ = panel.set_position(PhysicalPosition::new(x, y));
        }
        let _ = panel.show();
        let _ = panel.set_focus();
        let _ = app.emit("panel-visibility", true);
    } else if let Ok(panel) = WebviewWindowBuilder::new(
        app,
        "panel",
        WebviewUrl::App("index.html?role=panel".into()),
    )
    .title("ASCII Desk")
    .inner_size(1100.0, 720.0)
    .min_inner_size(900.0, 600.0)
    .decorations(false)
    .resizable(true)
    .skip_taskbar(true)
    .visible(true)
    .center()
    .build()
    {
        let panel_clone = panel.clone();
        let app_clone = app.clone();
        panel.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = panel_clone.hide();
                let _ = app_clone.emit("panel-visibility", false);
            }
        });
        let _ = panel.set_focus();
        let _ = app.emit("panel-visibility", true);
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * TAURI COMMANDS
 * ═══════════════════════════════════════════════════════════════════════════ */

#[tauri::command]
fn get_app_state(state: tauri::State<'_, Arc<Mutex<EngineState>>>) -> Result<FullAppState, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.wallpapers = scan_wallpapers(&guard.wallpapers_dir);
    let wall_clone = guard.wallpapers.clone();
    ensure_default_settings(&mut guard.config, &wall_clone);

    Ok(FullAppState {
        active_wallpaper: guard.config.active_wallpaper.clone(),
        source_type: guard.config.source_type.clone(),
        media_path: guard.config.media_path.clone(),
        shader: guard.config.shader.clone(),
        paused: guard.config.paused,
        auto_paused: guard.auto_paused,
        autostart: guard.config.autostart,
        hide_desktop_icons: guard.config.hide_desktop_icons,
        span_monitors: guard.config.span_monitors,
        wallpapers: guard.wallpapers.clone(),
        settings: guard.config.settings.clone(),
    })
}

#[tauri::command]
fn get_current_wallpaper_settings(
    state: tauri::State<'_, Arc<Mutex<EngineState>>>,
) -> Result<Value, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let active = &guard.config.active_wallpaper;
    let values = guard
        .config
        .settings
        .get(active)
        .cloned()
        .unwrap_or_default();
    let effective_paused = guard.config.paused || guard.auto_paused;

    Ok(serde_json::json!({
        "folder": active,
        "source_type": guard.config.source_type,
        "media_path": guard.config.media_path,
        "values": values,
        "shader": guard.config.shader,
        "paused": effective_paused
    }))
}

#[tauri::command]
fn set_active_wallpaper(
    folder: String,
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<EngineState>>>,
) -> Result<(), String> {
    let (values, shader, effective_paused) = {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.config.active_wallpaper = folder.clone();
        guard.config.source_type = "interactive".to_string();
        save_config(&guard.config_path, &guard.config);
        let vals = guard
            .config
            .settings
            .get(&folder)
            .cloned()
            .unwrap_or_default();
        (
            vals,
            guard.config.shader.clone(),
            guard.config.paused || guard.auto_paused,
        )
    };

    rebuild_tray_menu(&app, state.inner());

    let _ = app.emit(
        "wallpaper-changed",
        serde_json::json!({
            "source_type": "interactive",
            "folder": folder,
            "values": values,
            "shader": shader,
            "paused": effective_paused
        }),
    );
    let _ = app.emit("state-updated", ());
    Ok(())
}

#[tauri::command]
fn update_wallpaper_control(
    folder: String,
    key: String,
    value: Value,
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<EngineState>>>,
) -> Result<(), String> {
    let values = {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        let entry = guard.config.settings.entry(folder.clone()).or_default();
        entry.insert(key, value);
        let cloned = entry.clone();
        save_config(&guard.config_path, &guard.config);
        cloned
    };

    let _ = app.emit(
        "wallpaper-config",
        serde_json::json!({
            "folder": folder,
            "values": values
        }),
    );
    Ok(())
}

#[tauri::command]
fn update_shader_settings(
    shader: Value,
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<EngineState>>>,
) -> Result<(), String> {
    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.config.shader = shader.clone();
        save_config(&guard.config_path, &guard.config);
    }
    let _ = app.emit("wallpaper-shader", shader);
    Ok(())
}

#[tauri::command]
fn apply_studio_wallpaper(
    source_type: String,
    active_wallpaper: String,
    media_path: String,
    shader: Value,
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<EngineState>>>,
) -> Result<(), String> {
    let payload = {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.config.source_type = source_type.clone();
        guard.config.active_wallpaper = active_wallpaper.clone();
        guard.config.media_path = media_path.clone();
        guard.config.shader = shader.clone();
        save_config(&guard.config_path, &guard.config);

        let vals = guard
            .config
            .settings
            .get(&active_wallpaper)
            .cloned()
            .unwrap_or_default();
        let eff_paused = guard.config.paused || guard.auto_paused;

        serde_json::json!({
            "source_type": source_type,
            "active_wallpaper": active_wallpaper,
            "media_path": media_path,
            "values": vals,
            "shader": shader,
            "paused": eff_paused
        })
    };

    rebuild_tray_menu(&app, state.inner());
    let _ = app.emit("studio-applied", payload);
    Ok(())
}

#[tauri::command]
async fn pick_media_file(media_type: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(win32_desktop::open_media_file_dialog(&media_type)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn reset_wallpaper_controls(
    folder: String,
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<EngineState>>>,
) -> Result<(), String> {
    let values = {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        let mut defaults = HashMap::new();
        if let Some(wp) = guard.wallpapers.iter().find(|w| w.folder == folder) {
            for ctrl in &wp.manifest.controls {
                defaults.insert(ctrl.id.clone(), ctrl.default.clone());
            }
        }
        guard.config.settings.insert(folder.clone(), defaults.clone());
        save_config(&guard.config_path, &guard.config);
        defaults
    };

    let _ = app.emit(
        "wallpaper-config",
        serde_json::json!({
            "folder": folder,
            "values": values
        }),
    );
    Ok(())
}

#[tauri::command]
fn toggle_pause(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<EngineState>>>,
) -> Result<bool, String> {
    let (manual_paused, auto_paused) = {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.config.paused = !guard.config.paused;
        save_config(&guard.config_path, &guard.config);
        (guard.config.paused, guard.auto_paused)
    };

    let effective = manual_paused || auto_paused;
    win32_desktop::set_hook_paused(effective);
    rebuild_tray_menu(&app, state.inner());

    let _ = app.emit(
        "wallpaper-pause",
        serde_json::json!({
            "paused": effective,
            "manual_paused": manual_paused,
            "auto_paused": auto_paused
        }),
    );
    Ok(manual_paused)
}

#[tauri::command]
fn set_hide_desktop_icons(
    hidden: bool,
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<EngineState>>>,
) -> Result<(), String> {
    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.config.hide_desktop_icons = hidden;
        save_config(&guard.config_path, &guard.config);
    }
    win32_desktop::set_desktop_icons_hidden(hidden);
    rebuild_tray_menu(&app, state.inner());
    let _ = app.emit("state-updated", ());
    Ok(())
}

#[tauri::command]
fn set_span_monitors(
    enabled: bool,
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<EngineState>>>,
) -> Result<(), String> {
    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.config.span_monitors = enabled;
        save_config(&guard.config_path, &guard.config);
    }
    win32_desktop::update_wallpaper_bounds(enabled);
    rebuild_tray_menu(&app, state.inner());
    let _ = app.emit("state-updated", ());
    Ok(())
}

#[tauri::command]
fn set_autostart(
    enabled: bool,
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<EngineState>>>,
) -> Result<(), String> {
    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.config.autostart = enabled;
        save_config(&guard.config_path, &guard.config);
    }
    set_autostart_registry(enabled);
    rebuild_tray_menu(&app, state.inner());
    Ok(())
}

#[tauri::command]
fn hide_panel(app: AppHandle) {
    if let Some(panel) = app.get_webview_window("panel") {
        let _ = panel.hide();
        let _ = app.emit("panel-visibility", false);
    }
}

fn main() {
    let (wallpapers_dir, config_path) = find_project_paths();
    let wallpapers = scan_wallpapers(&wallpapers_dir);

    let mut config: PersistentConfig = if config_path.exists() {
        fs::read_to_string(&config_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        PersistentConfig::default()
    };

    config.autostart = get_autostart_registry() || config.autostart;
    ensure_default_settings(&mut config, &wallpapers);
    save_config(&config_path, &config);

    let initial_span = config.span_monitors;
    let initial_hide_icons = config.hide_desktop_icons;

    let shared_state = Arc::new(Mutex::new(EngineState {
        wallpapers_dir: wallpapers_dir.clone(),
        config_path,
        config,
        wallpapers,
        auto_paused: false,
    }));

    let protocol_wp_dir = wallpapers_dir.clone();

    tauri::Builder::default()
        .manage(shared_state.clone())
        .register_uri_scheme_protocol("wallpaper", move |_ctx, request| {
            let uri_path = request.uri().path().trim_start_matches('/');
            let query = request.uri().query().unwrap_or("");

            // Local media file serving with full CORS headers so WebGL2 texImage2D never taints the canvas
            if uri_path == "__local_media" {
                let mut file_path_str = String::new();
                for pair in query.split('&') {
                    if let Some(val) = pair.strip_prefix("path=") {
                        file_path_str = url_decode(val);
                    }
                }
                let path = PathBuf::from(&file_path_str);
                if path.exists() && path.is_file() {
                    let mime = mime_for_path(&path);
                    if let Ok(bytes) = fs::read(&path) {
                        return Response::builder()
                            .status(StatusCode::OK)
                            .header(CONTENT_TYPE, mime)
                            .header("Access-Control-Allow-Origin", "*")
                            .header("Access-Control-Allow-Methods", "GET, OPTIONS")
                            .body(bytes)
                            .unwrap();
                    }
                }
                return Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(b"Media file not found".to_vec())
                    .unwrap();
            }

            let decoded = url_decode(uri_path);
            if decoded == "__bridge.js" {
                return Response::builder()
                    .status(StatusCode::OK)
                    .header(CONTENT_TYPE, "application/javascript; charset=utf-8")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(BRIDGE_JS.as_bytes().to_vec())
                    .unwrap();
            }

            let mut clean_parts = Vec::new();
            for part in decoded.split('/') {
                if !part.is_empty() && part != "." && part != ".." {
                    clean_parts.push(part);
                }
            }
            let mut target_file = protocol_wp_dir.clone();
            for part in clean_parts {
                target_file.push(part);
            }
            if !target_file.exists() || !target_file.is_file() {
                return Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(b"Not found".to_vec())
                    .unwrap();
            }

            let mime = mime_for_path(&target_file);
            match fs::read(&target_file) {
                Ok(bytes) => Response::builder()
                    .status(StatusCode::OK)
                    .header(CONTENT_TYPE, mime)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(bytes)
                    .unwrap(),
                Err(_) => Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(b"Error reading file".to_vec())
                    .unwrap(),
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            get_current_wallpaper_settings,
            set_active_wallpaper,
            update_wallpaper_control,
            update_shader_settings,
            apply_studio_wallpaper,
            pick_media_file,
            reset_wallpaper_controls,
            toggle_pause,
            set_hide_desktop_icons,
            set_span_monitors,
            set_autostart,
            hide_panel
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            // 1. Create the Fullscreen Borderless Wallpaper Window (initially hidden until attached to WorkerW)
            let wp_window = WebviewWindowBuilder::new(
                app,
                "wallpaper",
                WebviewUrl::App("index.html?role=wallpaper".into()),
            )
            .title("ASCII Desk Wallpaper")
            .decorations(false)
            .shadow(false)
            .skip_taskbar(true)
            .resizable(false)
            .visible(false)
            .build()?;

            if let Ok(hwnd) = wp_window.hwnd() {
                let hwnd_val = hwnd.0 as isize;
                unsafe {
                    // Single-instance guard: if another instance already created our wallpaper window, exit cleanly
                    let win_title: Vec<u16> = "ASCII Desk Wallpaper\0".encode_utf16().collect();
                    let existing = windows_sys::Win32::UI::WindowsAndMessaging::FindWindowW(
                        std::ptr::null(),
                        win_title.as_ptr(),
                    );
                    if !existing.is_null() && (existing as isize) != hwnd_val {
                        std::process::exit(0);
                    }
                }

                // Perform WorkerW attachment and Progman readiness retries on a background thread
                // so the main Win32 message loop starts immediately and never shows as Not Responding
                std::thread::spawn(move || {
                    for _ in 0..30 {
                        let pm_name: Vec<u16> = "Progman\0".encode_utf16().collect();
                        let pm = unsafe {
                            windows_sys::Win32::UI::WindowsAndMessaging::FindWindowW(
                                pm_name.as_ptr(),
                                std::ptr::null(),
                            )
                        };
                        if !pm.is_null() {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(250));
                    }
                    let _ = win32_desktop::attach_to_desktop(hwnd_val, initial_span);
                    std::thread::sleep(Duration::from_millis(600));
                    let _ = win32_desktop::attach_to_desktop(hwnd_val, initial_span);
                    std::thread::sleep(Duration::from_millis(1200));
                    let _ = win32_desktop::attach_to_desktop(hwnd_val, initial_span);
                });
            }

            if initial_hide_icons {
                win32_desktop::set_desktop_icons_hidden(true);
            }

            // 2. Setup System Tray Icon & Menu (Studio window is created lazily on demand)
            let icon = app.default_window_icon().cloned().unwrap();
            let state_for_tray = shared_state.clone();

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("ASCII Desk")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(panel) = app.get_webview_window("panel") {
                            if panel.is_visible().unwrap_or(false) {
                                let _ = panel.hide();
                                let _ = app.emit("panel-visibility", false);
                            } else {
                                show_studio_window(app);
                            }
                        } else {
                            show_studio_window(app);
                        }
                    }
                })
                .on_menu_event(move |app, event| {
                    let id = event.id().as_ref();
                    if let Some(folder) = id.strip_prefix("wp:") {
                        let folder_str = folder.to_string();
                        let (vals, shader, eff_paused) = {
                            let mut guard = state_for_tray.lock().unwrap();
                            guard.config.active_wallpaper = folder_str.clone();
                            guard.config.source_type = "interactive".to_string();
                            save_config(&guard.config_path, &guard.config);
                            let v = guard
                                .config
                                .settings
                                .get(&folder_str)
                                .cloned()
                                .unwrap_or_default();
                            (
                                v,
                                guard.config.shader.clone(),
                                guard.config.paused || guard.auto_paused,
                            )
                        };
                        rebuild_tray_menu(app, &state_for_tray);
                        let _ = app.emit(
                            "wallpaper-changed",
                            serde_json::json!({
                                "source_type": "interactive",
                                "folder": folder_str,
                                "values": vals,
                                "shader": shader,
                                "paused": eff_paused
                            }),
                        );
                        let _ = app.emit("state-updated", ());
                    } else if id == "open_panel" {
                        show_studio_window(app);
                    } else if id == "toggle_pause" {
                        let (manual_paused, auto_paused) = {
                            let mut guard = state_for_tray.lock().unwrap();
                            guard.config.paused = !guard.config.paused;
                            save_config(&guard.config_path, &guard.config);
                            (guard.config.paused, guard.auto_paused)
                        };
                        let eff = manual_paused || auto_paused;
                        win32_desktop::set_hook_paused(eff);
                        rebuild_tray_menu(app, &state_for_tray);
                        let _ = app.emit(
                            "wallpaper-pause",
                            serde_json::json!({
                                "paused": eff,
                                "manual_paused": manual_paused,
                                "auto_paused": auto_paused
                            }),
                        );
                    } else if id == "toggle_span" {
                        let new_span = {
                            let mut guard = state_for_tray.lock().unwrap();
                            guard.config.span_monitors = !guard.config.span_monitors;
                            save_config(&guard.config_path, &guard.config);
                            guard.config.span_monitors
                        };
                        win32_desktop::update_wallpaper_bounds(new_span);
                        rebuild_tray_menu(app, &state_for_tray);
                        let _ = app.emit("state-updated", ());
                    } else if id == "toggle_hide_icons" {
                        let new_hide = {
                            let mut guard = state_for_tray.lock().unwrap();
                            guard.config.hide_desktop_icons = !guard.config.hide_desktop_icons;
                            save_config(&guard.config_path, &guard.config);
                            guard.config.hide_desktop_icons
                        };
                        win32_desktop::set_desktop_icons_hidden(new_hide);
                        rebuild_tray_menu(app, &state_for_tray);
                        let _ = app.emit("state-updated", ());
                    } else if id == "toggle_autostart" {
                        let new_auto = {
                            let mut guard = state_for_tray.lock().unwrap();
                            guard.config.autostart = !guard.config.autostart;
                            save_config(&guard.config_path, &guard.config);
                            guard.config.autostart
                        };
                        set_autostart_registry(new_auto);
                        rebuild_tray_menu(app, &state_for_tray);
                        let _ = app.emit("state-updated", ());
                    } else if id == "quit" {
                        win32_desktop::set_desktop_icons_hidden(false);
                        app.exit(0);
                    }
                })
                .build(app)?;

            rebuild_tray_menu(&handle, &shared_state);

            // 4. Start Global Desktop Mouse Polling
            win32_desktop::start_mouse_hook(handle.clone());

            // 5. Start Maximized / Fullscreen App Detector & Explorer Recovery Thread
            let detector_state = shared_state.clone();
            let detector_app = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_millis(750));
                let span = detector_state
                    .lock()
                    .map(|g| g.config.span_monitors)
                    .unwrap_or(true);
                win32_desktop::ensure_attached(span);
                let is_occluded = win32_desktop::is_foreground_maximized_or_fullscreen(span);

                let mut changed = None;
                if let Ok(mut guard) = detector_state.lock() {
                    if guard.auto_paused != is_occluded {
                        guard.auto_paused = is_occluded;
                        let eff = guard.config.paused || guard.auto_paused;
                        changed = Some((eff, guard.config.paused, guard.auto_paused));
                    }
                }

                if let Some((eff, manual, auto_p)) = changed {
                    win32_desktop::set_hook_paused(eff);
                    let _ = detector_app.emit(
                        "wallpaper-pause",
                        serde_json::json!({
                            "paused": eff,
                            "manual_paused": manual,
                            "auto_paused": auto_p
                        }),
                    );
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error al ejecutar ASCII & Shader Wallpaper Studio");
}
