"""Verify the installable APK and upgrade identity without an Android device."""
from pathlib import Path
import hashlib
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

root = Path(__file__).resolve().parent.parent
apk = Path(sys.argv[1])
previous = Path(sys.argv[2])
tools = Path(os.environ['HOJA_ANDROID_BUILD_TOOLS'])

def tool(name, *args):
    return subprocess.check_output([str(tools / name), *map(str, args)], text=True)

with zipfile.ZipFile(apk) as archive:
    assert archive.testzip() is None
    for file in ['app.js', 'pdf-reader.js', 'docx-reader.js', 'markdown-reader.js', 'pinch-zoom.js', 'reading-mode.js', 'theme.js', 'icons.js', 'vendor/pdf.mjs', 'vendor/pdf.worker.mjs', 'vendor/docx-preview.js', 'vendor/jszip.js', 'vendor/marked.mjs', 'vendor/legacy.js', 'samples/ejemplo.md']:
        assert archive.read('assets/web/' + file) == (root / 'dist' / file).read_bytes(), file
    html = archive.read('assets/web/index.html')
    assert b'id="pdfPages"' in html
    assert b'manifest.webmanifest' not in html
    assert 'Hoja está instalada en tu teléfono y funciona sin conexión'.encode() in html
    css = archive.read('assets/web/style.css')
    assert b'fonts.googleapis.com' not in css
    assert b'--control-text' in css
    dex = archive.read('classes.dex')
    assert dex.startswith(b'dex\n')
    assert b'HojaAndroid' in dex and b'setReadingFullscreen' in dex and b'WindowInsetsController' in dex
    assert b'isSystemDarkTheme' in dex and b'setDarkTheme' in dex
    assert b'setSupportZoom' in dex
    assert b'text/markdown' in html and b'text/markdown' in dex
    assert b'<symbol' not in html and b'<use ' not in html

version = ET.parse(root / 'android/AndroidManifest.xml').getroot().attrib
name = version['{http://schemas.android.com/apk/res/android}versionName']
code = version['{http://schemas.android.com/apk/res/android}versionCode']
manifest = tool('aapt2', 'dump', 'xmltree', apk, '--file', 'AndroidManifest.xml')
for value in ['site.hoja.reader', name, 'android.intent.action.VIEW', 'android.intent.action.SEND', 'android.intent.action.SEND_MULTIPLE', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/markdown', 'text/x-markdown']:
    assert value in manifest, value
assert f'versionCode(0x0101021b)={code}' in manifest
assert 'uses-permission' not in tool('aapt2', 'dump', 'permissions', apk)

def certificate(path):
    result = tool('apksigner', 'verify', '--verbose', '--print-certs', path)
    assert 'Verified using v2 scheme (APK Signature Scheme v2): true' in result
    assert 'Verified using v3 scheme (APK Signature Scheme v3): true' in result
    return re.search(r'Signer #1 certificate SHA-256 digest: (\S+)', result).group(1)

assert certificate(apk) == certificate(previous), 'Upgrade must retain the original signing identity'
checksum = hashlib.sha256(apk.read_bytes()).hexdigest()
apk.with_suffix('.apk.sha256').write_text(f'{checksum}  {apk.name}\n')
print('PASS: native APK content, Android document intents, current version and native fullscreen bridge, offline assets, no permissions, v2/v3 signature and same certificate as 1.0.0.')
print('SHA256:', checksum)
