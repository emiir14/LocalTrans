# Compilación de Escriba para Android (.apk)

Escriba para Android utiliza **Tauri v2 Mobile** (ARM64) empaquetando la aplicación completa con permisos nativos de micrófono (`RECORD_AUDIO`), bloqueo de suspensión (`WAKE_LOCK`) y motor Whisper local optimizado (`whisper-small q8`, ~240 MB) dentro del almacenamiento privado del teléfono.

---

## Cómo generar `Escriba.apk` gratis en GitHub Actions

1. Subí tus cambios al repositorio `emiir14/LocalTrans`.
2. En GitHub, abrí **Actions → Build Escriba Android (.apk) → Run workflow**.
3. Verificá que `release_tag` coincida con la versión que quieras publicar (por ejemplo `v1.0.1`) y tocá **Run workflow**.
4. En unos minutos GitHub va a compilar, alinear, firmar y publicar **`Escriba.apk`** directamente en **Releases**.
5. Apenas esté publicado, tanto el botón de **Descargas** de tu web como el ícono **Buscar actualizaciones** dentro de la app van a ofrecer `Escriba.apk` automáticamente en Android.

---

## Firma persistente para actualizaciones encima (opcional)

Por defecto, si no configurás una clave propia, el workflow firma el `.apk` automáticamente con un certificado temporal válido para que cualquier teléfono Android pueda instalarlo directo.

Si querés actualizar futuras versiones encima sin desinstalar la anterior en los teléfonos:

1. Generá una clave local una sola vez (en cualquier PC con Java):
   ```bash
   keytool -genkeypair -v -keystore escriba-release.jks -alias escriba -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Convertí el archivo a base64 (`base64 -w 0 escriba-release.jks`) y guardá en **GitHub → Settings → Secrets and variables → Actions**:
   - `ANDROID_KEYSTORE_BASE64`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS` (`escriba`)
   - `ANDROID_KEY_PASSWORD`
