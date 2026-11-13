#!/usr/bin/env python3
"""Build the self-contained Android APK using Android SDK build-tools 35.0.0."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'android' / 'build'
SDK = Path(os.environ.get('ANDROID_HOME', os.environ.get('ANDROID_SDK_ROOT', str(Path.home() / 'Android/Sdk'))))
TOOLS = Path(os.environ.get('HOJA_ANDROID_BUILD_TOOLS', str(SDK / 'build-tools/35.0.0')))
PLATFORM = Path(os.environ.get('HOJA_ANDROID_JAR', str(SDK / 'platforms/android-35/android.jar')))

def run(*args, **kwargs):
    subprocess.run([str(x) for x in args], check=True, **kwargs)

if not PLATFORM.is_file() or not (TOOLS / 'aapt2').is_file():
    raise SystemExit('Set ANDROID_HOME with platforms;android-35 and build-tools;35.0.0 installed.')
if OUT.exists(): shutil.rmtree(OUT)
for name in ['assets/web', 'resources', 'classes', 'dex']: (OUT / name).mkdir(parents=True, exist_ok=True)
shutil.copytree(ROOT / 'dist', OUT / 'assets/web', dirs_exist_ok=True)
# The Android package is entirely local, including fonts and sample documents.
style = OUT / 'assets/web/style.css'
shutil.copytree(ROOT / 'android/fonts', OUT / 'assets/web/fonts')
style.write_text((ROOT / 'android/fonts/fonts.css').read_text() + re.sub(r"@import\s+url\([^)]*\)\s*;\s*", '', style.read_text(), count=1))
index = OUT / 'assets/web/index.html'
html = index.read_text()
html = html.replace('Para tener Hoja a mano, usa «Añadir a pantalla de inicio» desde el menú de tu navegador. El acceso requiere conexión.',
    'Hoja está instalada en tu teléfono y funciona sin conexión. Los documentos se guardan dentro de esta aplicación. Si borras sus datos o la desinstalas, se vacía la biblioteca; los archivos originales se conservan.')
index.write_text(html)
# Android has its own launcher and packaging, so there is no PWA install UI.
(OUT / 'assets/web/manifest.webmanifest').unlink(missing_ok=True)
index.write_text(index.read_text().replace('<link rel="manifest" href="manifest.webmanifest">', ''))
run(TOOLS / 'aapt2', 'compile', '--dir', ROOT / 'android/res', '-o', OUT / 'resources.zip')
run(TOOLS / 'aapt2', 'link', '-o', OUT / 'base.apk', '-I', PLATFORM,
    '--manifest', ROOT / 'android/AndroidManifest.xml', '-A', OUT / 'assets',
    '--min-sdk-version', '26', '--target-sdk-version', '34', OUT / 'resources.zip')
sources = list((ROOT / 'android/src').rglob('*.java'))
compiler = shutil.which('javac')
if compiler:
    run(compiler, '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', PLATFORM, '-d', OUT / 'classes', *sources)
elif os.environ.get('HOJA_ECJ_JAR'):
    run('java', '-jar', os.environ['HOJA_ECJ_JAR'], '-encoding', 'UTF-8', '-source', '1.8', '-target', '1.8', '-bootclasspath', PLATFORM, '-d', OUT / 'classes', *sources)
else:
    raise SystemExit('Install JDK 17+ (javac), or set HOJA_ECJ_JAR to an Eclipse compiler JAR.')
run(TOOLS / 'd8', '--lib', PLATFORM, '--min-api', '26', '--output', OUT / 'dex', *list((OUT / 'classes').rglob('*.class')))
with zipfile.ZipFile(OUT / 'base.apk', 'a', zipfile.ZIP_STORED) as apk:
    for dex in (OUT / 'dex').glob('*.dex'): apk.write(dex, dex.name)
run(TOOLS / 'zipalign', '-f', '-p', '4', OUT / 'base.apk', OUT / 'aligned.apk')
keypath = os.environ.get('HOJA_KEYSTORE_PATH')
if not keypath or not os.environ.get('HOJA_KEYSTORE_PASSWORD'):
    raise SystemExit('Set HOJA_KEYSTORE_PATH and HOJA_KEYSTORE_PASSWORD to sign the APK. Keep the keystore out of Git.')
version = ET.parse(ROOT / 'android/AndroidManifest.xml').getroot().get('{http://schemas.android.com/apk/res/android}versionName')
apk = OUT / f'Hoja-{version}.apk'
run(TOOLS / 'apksigner', 'sign', '--ks', keypath, '--ks-key-alias', os.environ.get('HOJA_SIGNING_ALIAS', 'hoja'),
    '--ks-pass', 'env:HOJA_KEYSTORE_PASSWORD', '--key-pass', 'env:HOJA_KEYSTORE_PASSWORD',
    '--out', apk, OUT / 'aligned.apk')
run(TOOLS / 'apksigner', 'verify', '--verbose', apk)
print('APK:', apk)
