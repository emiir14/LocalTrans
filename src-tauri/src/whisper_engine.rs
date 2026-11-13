use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::StreamExt;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCapabilities {
    pub runtime: String,
    pub engine: String,
    pub gpu_active: bool,
    pub backend_label: String,
    pub cpu_threads: usize,
    pub models_dir: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeModelStatus {
    pub tier: String,
    pub file_name: String,
    pub is_cached: bool,
    pub file_bytes: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressPayload {
    tier: String,
    status: String,
    progress: u8,
    loaded: u64,
    total: u64,
    file: String,
}

pub struct WhisperManager {
    ctx: Arc<Mutex<Option<(String, WhisperContext)>>>,
    gpu_active: Arc<Mutex<bool>>,
    is_busy: Arc<Mutex<bool>>,
}

impl WhisperManager {
    pub fn new() -> Self {
        Self {
            ctx: Arc::new(Mutex::new(None)),
            gpu_active: Arc::new(Mutex::new(true)),
            is_busy: Arc::new(Mutex::new(false)),
        }
    }

    pub fn is_busy(&self) -> bool {
        *self.is_busy.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn set_busy(&self, busy: bool) {
        if let Ok(mut guard) = self.is_busy.lock() {
            *guard = busy;
        }
    }
}

fn model_spec_for_tier(tier: &str) -> (&'static str, &'static str, &'static str) {
    match tier {
        "max" => (
            "max",
            "ggml-large-v3-turbo-q5_0.bin",
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
        ),
        _ => (
            "balanced",
            "ggml-small-q8_0.bin",
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin",
        ),
    }
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("No se pudo resolver app_local_data_dir: {e}"))?;
    let dir = base.join("models");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("No se pudo crear la carpeta de modelos: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub fn get_native_capabilities(
    app: AppHandle,
    state: tauri::State<'_, WhisperManager>,
) -> Result<NativeCapabilities, String> {
    let dir = models_dir(&app)?;
    let gpu_active = *state.gpu_active.lock().unwrap_or_else(|e| e.into_inner());
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);

    Ok(NativeCapabilities {
        runtime: "windows-exe".to_string(),
        engine: "whisper.cpp".to_string(),
        gpu_active,
        backend_label: if gpu_active {
            "Vulkan GPU Nativo (whisper.cpp)".to_string()
        } else {
            "CPU Nativo AVX2 Multihilo (whisper.cpp)".to_string()
        },
        cpu_threads: threads,
        models_dir: dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn check_native_model_status(app: AppHandle, tier: String) -> Result<NativeModelStatus, String> {
    let (resolved_tier, file_name, _) = model_spec_for_tier(&tier);
    let path = models_dir(&app)?.join(file_name);
    let meta = std::fs::metadata(&path).ok();
    let file_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    // Any valid quantized whisper.cpp model is > 50 MB
    let is_cached = file_bytes > 50 * 1024 * 1024;

    Ok(NativeModelStatus {
        tier: resolved_tier.to_string(),
        file_name: file_name.to_string(),
        is_cached,
        file_bytes,
    })
}

async fn ensure_model_downloaded(
    app: &AppHandle,
    tier: &str,
) -> Result<(String, PathBuf), String> {
    let (resolved_tier, file_name, url) = model_spec_for_tier(tier);
    let dir = models_dir(app)?;
    let final_path = dir.join(file_name);

    if let Ok(meta) = std::fs::metadata(&final_path) {
        if meta.len() > 50 * 1024 * 1024 {
            return Ok((resolved_tier.to_string(), final_path));
        }
    }

    let part_path = dir.join(format!("{file_name}.part"));
    let client = reqwest::Client::builder()
        .user_agent("EscribaDesktop/1.0")
        .build()
        .map_err(|e| format!("Error inicializando cliente HTTP: {e}"))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Error descargando modelo {file_name}: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "No se pudo descargar el modelo ({}): HTTP {}",
            file_name,
            response.status()
        ));
    }

    let total_bytes = response.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&part_path)
        .await
        .map_err(|e| format!("No se pudo escribir el archivo temporal del modelo: {e}"))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emitted_pct: i16 = -1;

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("Interrupción durante descarga: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Error escribiendo modelo en disco: {e}"))?;

        downloaded += chunk.len() as u64;
        let pct = if total_bytes > 0 {
            ((downloaded as f64 / total_bytes as f64) * 100.0).min(100.0) as u8
        } else {
            0
        };

        if pct as i16 != last_emitted_pct {
            last_emitted_pct = pct as i16;
            let _ = app.emit(
                "whisper:download-progress",
                DownloadProgressPayload {
                    tier: resolved_tier.to_string(),
                    status: "progress".to_string(),
                    progress: pct,
                    loaded: downloaded,
                    total: total_bytes,
                    file: file_name.to_string(),
                },
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Error cerrando descarga del modelo: {e}"))?;
    drop(file);

    tokio::fs::rename(&part_path, &final_path)
        .await
        .map_err(|e| format!("Error finalizando archivo de modelo: {e}"))?;

    let _ = app.emit(
        "whisper:download-progress",
        DownloadProgressPayload {
            tier: resolved_tier.to_string(),
            status: "done".to_string(),
            progress: 100,
            loaded: downloaded,
            total: total_bytes.max(downloaded),
            file: file_name.to_string(),
        },
    );

    Ok((resolved_tier.to_string(), final_path))
}

#[tauri::command]
pub async fn load_whisper_model(
    app: AppHandle,
    state: tauri::State<'_, WhisperManager>,
    tier: String,
) -> Result<NativeCapabilities, String> {
    let (resolved_tier, model_path) = ensure_model_downloaded(&app, &tier).await?;

    // Check if the requested tier is already loaded in memory
    let already_loaded = {
        let guard = state.ctx.lock().map_err(|_| "Error de bloqueo de memoria".to_string())?;
        matches!(guard.as_ref(), Some((loaded_tier, _)) if loaded_tier == &resolved_tier)
    };
    if already_loaded {
        return get_native_capabilities(app, state);
    }

    let path_str = model_path.to_string_lossy().to_string();
    let (loaded_ctx, used_gpu) = tokio::task::spawn_blocking(move || {
        let mut gpu_params = WhisperContextParameters::default();
        gpu_params.use_gpu(true);

        if let Ok(ctx) = WhisperContext::new_with_params(&path_str, gpu_params) {
            return Ok((ctx, true));
        }

        // Automatic fallback to CPU if system lacks Vulkan drivers
        let mut cpu_params = WhisperContextParameters::default();
        cpu_params.use_gpu(false);
        WhisperContext::new_with_params(&path_str, cpu_params)
            .map(|ctx| (ctx, false))
            .map_err(|e| format!("No se pudo inicializar whisper.cpp con el modelo: {e}"))
    })
    .await
    .map_err(|e| format!("Error interno al cargar modelo nativo: {e}"))??;

    {
        let mut guard = state.ctx.lock().map_err(|_| "Error de bloqueo de memoria".to_string())?;
        *guard = Some((resolved_tier, loaded_ctx));
    }
    if let Ok(mut gpu_flag) = state.gpu_active.lock() {
        *gpu_flag = used_gpu;
    }

    get_native_capabilities(app, state)
}

#[tauri::command]
pub async fn transcribe_whisper_segment(
    state: tauri::State<'_, WhisperManager>,
    samples_b64: String,
    language: Option<String>,
    initial_prompt: Option<String>,
) -> Result<String, String> {
    let raw_bytes = BASE64
        .decode(samples_b64.as_bytes())
        .map_err(|e| format!("Error decodificando buffer de audio PCM: {e}"))?;

    if raw_bytes.len() % 4 != 0 {
        return Err("Longitud inválida de muestras Float32".to_string());
    }

    let float_samples: Vec<f32> = raw_bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect();

    if float_samples.is_empty() {
        return Ok(String::new());
    }

    state.set_busy(true);
    let ctx_arc = Arc::clone(&state.ctx);
    let lang = language.unwrap_or_else(|| "es".to_string());
    let prompt = initial_prompt.unwrap_or_default();

    let result = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let guard = ctx_arc
            .lock()
            .map_err(|_| "Error de bloqueo de contexto Whisper".to_string())?;
        let (_, ctx) = guard
            .as_ref()
            .ok_or_else(|| "El modelo nativo de Whisper no fue cargado".to_string())?;

        let mut w_state = ctx
            .create_state()
            .map_err(|e| format!("Error creando estado de inferencia: {e}"))?;

        let strategy = SamplingStrategy::BeamSearch {
            beam_size: 5,
            patience: -1.0,
        };
        let mut params = FullParams::new(strategy);

        let threads = std::thread::available_parallelism()
            .map(|n| n.get().clamp(2, 8) as i32)
            .unwrap_or(4);
        params.set_n_threads(threads);
        params.set_language(Some(lang.as_str()));
        if !prompt.trim().is_empty() {
            params.set_initial_prompt(prompt.trim());
        }
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_no_context(false);

        w_state
            .full(params, &float_samples)
            .map_err(|e| format!("Error durante inferencia whisper.cpp: {e}"))?;

        let mut combined = Vec::new();
        for segment in w_state.as_iter() {
            if let Ok(seg_text) = segment.to_str_lossy() {
                let trimmed = seg_text.trim();
                if !trimmed.is_empty() {
                    combined.push(trimmed.to_string());
                }
            }
        }

        Ok(combined.join(" ").trim().to_string())
    })
    .await
    .map_err(|e| format!("Error en hilo de inferencia nativo: {e}"));

    state.set_busy(false);
    result?
}

#[tauri::command]
pub fn unload_whisper_model(state: tauri::State<'_, WhisperManager>) -> Result<(), String> {
    let mut guard = state
        .ctx
        .lock()
        .map_err(|_| "Error liberando memoria del modelo".to_string())?;
    *guard = None;
    Ok(())
}
