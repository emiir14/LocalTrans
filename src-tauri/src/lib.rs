#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod updater;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod whisper_engine;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use whisper_engine::WhisperManager;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        tauri::Builder::default()
            // Register single-instance FIRST so clicking desktop shortcut twice focuses existing window
            .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                focus_main_window(app);
            }))
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_opener::init())
            .manage(WhisperManager::new())
            .setup(|app| {
                let show_item = MenuItem::with_id(app, "show", "Abrir Escriba", true, None::<&str>)?;
                let quit_item =
                    MenuItem::with_id(app, "quit", "Salir completamente", true, None::<&str>)?;
                let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

                let mut tray_builder = TrayIconBuilder::new()
                    .menu(&tray_menu)
                    .tooltip("Escriba — Transcripción Local")
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "show" => {
                            focus_main_window(app);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            focus_main_window(tray.app_handle());
                        }
                    });

                if let Some(icon) = app.default_window_icon() {
                    tray_builder = tray_builder.icon(icon.clone());
                }

                let _tray = tray_builder.build(app)?;

                if let Some(window) = app.get_webview_window("main") {
                    let app_handle = app.handle().clone();
                    let window_clone = window.clone();
                    window.on_window_event(move |event| {
                        if let WindowEvent::CloseRequested { api, .. } = event {
                            // If a native transcription is actively running, hide to system tray instead of killing progress
                            let manager = app_handle.state::<WhisperManager>();
                            if manager.is_busy() {
                                api.prevent_close();
                                let _ = window_clone.hide();
                            }
                        }
                    });
                }

                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                whisper_engine::get_native_capabilities,
                whisper_engine::check_native_model_status,
                whisper_engine::load_whisper_model,
                whisper_engine::transcribe_whisper_segment,
                whisper_engine::unload_whisper_model,
                updater::download_and_open_update,
            ])
            .run(tauri::generate_context!())
            .expect("Error ejecutando Escriba Desktop");
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        tauri::Builder::default()
            .plugin(tauri_plugin_opener::init())
            .run(tauri::generate_context!())
            .expect("Error ejecutando Escriba Mobile");
    }
}
