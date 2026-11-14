# Firma gratuita de Windows (.exe) con SignPath Foundation

SignPath Foundation firma gratuitamente instaladores de código abierto con un certificado **Authenticode** válido para eliminar el cartel azul de **Windows SmartScreen**.

El repositorio ya incluye:
- Licencia **Apache 2.0** (`LICENSE` en la raíz del proyecto).
- Flujo automático en `.github/workflows/build-windows.yml` con la acción oficial `signpath/github-action-submit-signing-request@v3`.

> **Importante:** Mientras no cargues los secretos de SignPath, el workflow **no falla**: sigue generando y publicando `Escriba-Setup.exe` normalmente sin firma. Apenas cargues el secreto y las variables, el siguiente build saldrá firmado automáticamente.

---

## Pasos para activarlo (una sola vez)

1. **Solicitá la cuenta gratuita Open Source:**
   - Entrá a [about.signpath.io](https://about.signpath.io) y completá el formulario de **SignPath Foundation** indicando tu repositorio público `https://github.com/emiir14/LocalTrans`.
   - Cuando te aprueben, instalá la **SignPath GitHub App** en `emiir14/LocalTrans`.

2. **Creá el Project y Signing Policy en SignPath:**
   - Project slug sugerido: `escriba`
   - Signing Policy slug sugerido: `release-signing`
   - Origen confiable (Trusted Build System): **GitHub Actions** sobre el workflow `.github/workflows/build-windows.yml`
   - Artifact Configuration: archivo ZIP (`escriba-windows-unsigned`) que contiene `Escriba-Setup.exe` (`pe-file`).

3. **Cargá los datos en tu repositorio de GitHub (`Settings → Secrets and variables → Actions`):**

   - En **Secrets** (`Repository secrets`):
     - `SIGNPATH_API_TOKEN` → tu token de API generado en SignPath.

   - En **Variables** (`Repository variables`):
     - `SIGNPATH_ORGANIZATION_ID` → ID de tu organización en SignPath.
     - `SIGNPATH_PROJECT_SLUG` → `escriba` *(opcional si usás ese mismo slug)*.
     - `SIGNPATH_SIGNING_POLICY_SLUG` → `release-signing` *(opcional si usás ese mismo slug)*.

4. **Volvé a ejecutar el workflow:**
   - Entrá a **Actions → Build Escriba Windows (.exe) → Run workflow** con un nuevo tag (ej. `v1.0.2`).
   - El instalador publicado en Releases ya va a salir firmado con Authenticode.
