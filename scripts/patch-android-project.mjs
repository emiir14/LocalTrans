import fs from 'node:fs';
import path from 'node:path';

const androidRoot = path.resolve(process.cwd(), 'src-tauri', 'gen', 'android');
const manifestPath = path.join(androidRoot, 'app', 'src', 'main', 'AndroidManifest.xml');

if (!fs.existsSync(manifestPath)) {
  console.error(`AndroidManifest.xml not found at ${manifestPath}`);
  process.exit(1);
}

let manifest = fs.readFileSync(manifestPath, 'utf8');

const requiredPermissions = [
  'android.permission.INTERNET',
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.WAKE_LOCK',
];

for (const perm of requiredPermissions) {
  if (!manifest.includes(perm)) {
    manifest = manifest.replace(
      '<application',
      `    <uses-permission android:name="${perm}" />\n    <application`
    );
  }
}

if (!manifest.includes('android:allowBackup=')) {
  manifest = manifest.replace('<application', '<application android:allowBackup="false"');
} else {
  manifest = manifest.replace(/android:allowBackup="true"/g, 'android:allowBackup="false"');
}

fs.writeFileSync(manifestPath, manifest, 'utf8');
console.log('Patched AndroidManifest.xml with audio/wake-lock permissions and allowBackup=false.');

const mainActivityDir = path.join(
  androidRoot,
  'app',
  'src',
  'main',
  'java',
  'com',
  'escriba',
  'desktop'
);
const mainActivityPath = path.join(mainActivityDir, 'MainActivity.kt');

fs.mkdirSync(mainActivityDir, { recursive: true });

const mainActivityKotlin = `package com.escriba.desktop

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  private val audioPermissionRequestCode = 4102

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    ensureAudioPermission()
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    ensureAudioPermission()
  }

  private fun ensureAudioPermission() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val granted = ContextCompat.checkSelfPermission(
        this,
        Manifest.permission.RECORD_AUDIO
      ) == PackageManager.PERMISSION_GRANTED
      if (!granted) {
        ActivityCompat.requestPermissions(
          this,
          arrayOf(Manifest.permission.RECORD_AUDIO),
          audioPermissionRequestCode
        )
      }
    }
  }
}
`;

fs.writeFileSync(mainActivityPath, mainActivityKotlin, 'utf8');
console.log(`Patched MainActivity.kt at ${mainActivityPath}.`);
