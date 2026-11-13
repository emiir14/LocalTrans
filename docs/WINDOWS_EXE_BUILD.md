# Compilación de Escriba para Windows (.exe)

Escriba Desktop utiliza **Tauri v2** + **`whisper.cpp` (`whisper-rs`)** con aceleración gráfica **Vulkan** (compatible con placas NVIDIA, AMD e Intel) y respaldo automático a CPU AVX2.

## Opción 1: Compilación automática en la nube gratis (GitHub Actions, sin usar consola)

No necesitás instalar Rust, Visual Studio ni ejecutar comandos en tu PC.

1. Subí estos cambios a tu repositorio de GitHub (`emiir14/LocalTrans`).
2. En GitHub, abrí **Actions → Build Escriba Windows (.exe) → Run workflow** (arriba a la derecha).
   - Dejá marcada la opción **Publicar en GitHub Releases** y la versión `v1.0.0` (en futuras versiones cambiá a `v1.0.1`, `v1.0.2`, etc.).
   - Tocá el botón verde **Run workflow**.
3. Esperá unos 10–15 minutos mientras GitHub compila `Escriba-Setup.exe` y lo publica automáticamente en **Releases**. Apenas termina, el botón de la pestaña **Descargas** de tu web funciona solo.

*(Alternativa desde consola: `git tag v1.0.0 && git push origin v1.0.0`).*

### Variable en Vercel (opcional)
Ya viene `emiir14/LocalTrans` configurado por defecto, pero si usás otro repo podés definir:
```env
VITE_GITHUB_REPO="tu-usuario/tu-repositorio"
```

## Opción 2: Compilar localmente en una PC con Windows

Requisitos gratuitos en Windows 10/11:
- **Node.js 20+**
- **Rust (`rustup`)** con target `x86_64-pc-windows-msvc`
- **Visual Studio Build Tools** (carga de trabajo *Desarrollo para el escritorio con C++*)
- **LLVM / Clang** (requerido por `whisper-rs` / `bindgen`)
- **Vulkan SDK** (LunarG Vulkan SDK para aceleración GPU)

Comandos:
```bash
npm install
npm run tauri:build
```

El instalador final queda en `src-tauri/target/release/bundle/nsis/`.

## Qué hace el instalador `.exe` en Windows

- **Instalación por usuario (`currentUser`):** Se instala en `AppData\Local\Escriba` sin pedir permisos de administrador (UAC).
- **Modelos GGML locales:** Los modelos (`ggml-small-q8_0.bin` y `ggml-large-v3-turbo-q5_0.bin`) se descargan una sola vez dentro de `%LOCALAPPDATA%\com.escriba.app\models\`, nunca dentro de `Program Files`.
- **Single Instance & Bandeja del sistema:** Evita abrir dos ventanas duplicadas y protege sesiones de transcripción activas minimizando a la bandeja al cerrar.
- **SmartScreen de Windows:** Como es una app gratuita sin certificado comercial pago, la primera vez Windows puede mostrar *"Windows protegió su PC → Más información → Ejecutar de todas formas"*.
