# Hoja para Android

Aplicación Android de solo lectura que incluye el visor completo en el APK. Funciona sin conexión, sin cuentas y sin cargar archivos a servidores. PDF, DOCX y DOC se procesan en Android System WebView. Los archivos DOC antiguos se muestran como texto y los DOCX se adaptan a la lectura.

- Android 8.0 o posterior y Android System WebView actualizado.
- Selección de documentos mediante el selector de Android, sin permisos generales de almacenamiento.
- Biblioteca local en IndexedDB dentro de la aplicación. Desinstalar o borrar sus datos elimina esta biblioteca; los documentos originales permanecen intactos.
- No solicita acceso a Internet, cámara, contactos ni micrófono.

## Compilar

Requisitos: Python 3, JDK 17 o posterior, Android SDK `platforms;android-35` y `build-tools;35.0.0`.

Define `ANDROID_HOME`, `HOJA_KEYSTORE_PATH`, `HOJA_KEYSTORE_PASSWORD` y, opcionalmente, `HOJA_SIGNING_ALIAS` (por defecto `hoja`). El keystore se crea con `keytool` y se conserva fuera del repositorio. Mantén la misma clave para firmar futuras actualizaciones.

Ejecuta desde la raíz:

```sh
python3 android/build.py
```

El archivo firmado queda en `android/build/Hoja-1.0.0.apk`. El script permite `HOJA_ANDROID_BUILD_TOOLS` y `HOJA_ANDROID_JAR` para SDK con otra distribución de carpetas. `HOJA_ECJ_JAR` permite usar el compilador Eclipse si solo está instalado Java Runtime.

La app usa el código de `dist/`, empaquetado bajo un origen HTTPS local interceptado por WebView. No depende del sitio publicado ni de una conexión a ChatGPT.

Validación de esta compilación: compilación Java, empaquetado Android, firma criptográfica y metadatos del APK. No se ha probado en un dispositivo o emulador Android en este entorno.
