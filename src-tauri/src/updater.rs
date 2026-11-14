use futures_util::StreamExt;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadProgressPayload {
    status: String,
    progress: u8,
    loaded: u64,
    total: u64,
    file_name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadResult {
    pub file_path: String,
    pub launched: bool,
}

fn is_allowed_github_release_url(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    lower.starts_with("https://github.com/")
        || lower.starts_with("https://objects.githubusercontent.com/")
        || lower.starts_with("https://release-assets.githubusercontent.com/")
}

fn sanitize_installer_filename(raw: &str) -> String {
    let base = raw
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("Escriba-Setup.exe")
        .trim();
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() || !cleaned.to_ascii_lowercase().ends_with(".exe") {
        "Escriba-Setup.exe".to_string()
    } else {
        cleaned
    }
}

fn resolve_download_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = app.path().download_dir() {
        if std::fs::create_dir_all(&dir).is_ok() {
            return Ok(dir);
        }
    }
    let fallback = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("No se pudo ubicar la carpeta de descargas: {e}"))?
        .join("updates");
    std::fs::create_dir_all(&fallback)
        .map_err(|e| format!("No se pudo crear la carpeta de actualización: {e}"))?;
    Ok(fallback)
}

#[tauri::command]
pub async fn download_and_open_update(
    app: AppHandle,
    url: String,
    file_name: Option<String>,
) -> Result<UpdateDownloadResult, String> {
    if !is_allowed_github_release_url(&url) {
        return Err("Solo se permiten descargas oficiales desde GitHub Releases.".to_string());
    }

    let safe_name = sanitize_installer_filename(file_name.as_deref().unwrap_or("Escriba-Setup.exe"));
    let target_dir = resolve_download_dir(&app)?;
    let final_path = target_dir.join(&safe_name);
    let part_path = target_dir.join(format!("{safe_name}.part"));

    let client = reqwest::Client::builder()
        .user_agent("EscribaDesktopUpdater/1.0")
        .build()
        .map_err(|e| format!("Error iniciando descarga: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con GitHub Releases: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "No se pudo descargar la actualización (HTTP {})",
            response.status()
        ));
    }

    let total_bytes = response.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&part_path)
        .await
        .map_err(|e| format!("No se pudo crear el archivo del instalador: {e}"))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_pct: i16 = -1;

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("Error descargando actualización: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Error escribiendo instalador en disco: {e}"))?;

        downloaded += chunk.len() as u64;
        let pct = if total_bytes > 0 {
            ((downloaded as f64 / total_bytes as f64) * 100.0).min(100.0) as u8
        } else {
            0
        };

        if pct as i16 != last_pct {
            last_pct = pct as i16;
            let _ = app.emit(
                "update:download-progress",
                UpdateDownloadProgressPayload {
                    status: "progress".to_string(),
                    progress: pct,
                    loaded: downloaded,
                    total: total_bytes,
                    file_name: safe_name.clone(),
                },
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Error finalizando descarga: {e}"))?;
    drop(file);

    if tokio::fs::try_exists(&final_path).await.unwrap_or(false) {
        let _ = tokio::fs::remove_file(&final_path).await;
    }
    tokio::fs::rename(&part_path, &final_path)
        .await
        .map_err(|e| format!("No se pudo guardar el instalador en Descargas: {e}"))?;

    let _ = app.emit(
        "update:download-progress",
        UpdateDownloadProgressPayload {
            status: "done".to_string(),
            progress: 100,
            loaded: downloaded,
            total: total_bytes.max(downloaded),
            file_name: safe_name,
        },
    );

    #[allow(unused_mut)]
    let mut launched = false;
    #[cfg(target_os = "windows")]
    {
        if std::process::Command::new(&final_path).spawn().is_ok() {
            launched = true;
        }
    }

    Ok(UpdateDownloadResult {
        file_path: final_path.to_string_lossy().to_string(),
        launched,
    })
}
