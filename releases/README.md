# Descargar Hoja para Android

[Descargar Hoja-1.1.1.apk](https://github.com/FacundoEchavarria/Lector-documentos/raw/refs/heads/main/releases/Hoja-1.1.1.apk)

Android 8.0 o posterior y Android System WebView actualizado. Abre el APK descargado para instalar; Android puede pedir autorización para instalar aplicaciones desde el navegador o el gestor de archivos.

El visor funciona sin conexión. Incluye PDF y Word de solo lectura; los DOC antiguos se muestran como texto. Los documentos se guardan dentro de la app y no se suben a ningún servidor.

Se verificaron la compilación, integridad y firma v2/v3 del paquete. No se ha probado en un teléfono o emulador Android en este entorno.

El archivo `Hoja-1.1.1.apk.sha256` contiene su suma de verificación. Las fuentes y las instrucciones para compilar están en `android/`.

## Cambios en 1.1.0

- PDF continuo, con todas las páginas en vertical y separadas.
- Cabecera reorganizada y controles visibles en temas claro y oscuro.
- Hoja aparece en «Abrir con» para PDF y Word y puede recibir documentos compartidos.
- Instala esta actualización sobre 1.0.0, sin desinstalar, para conservar tu biblioteca.

## Cambios en 1.1.1

- Corregido un error en el empaquetado de los estilos que dejaba inválidos los colores base de la cabecera.
- Pantalla completa nativa: oculta los controles del lector y las barras de Android; se sale con «Salir» o Atrás.
- Verificados los estilos extraídos del APK firmado; la prueba detecta el defecto del APK 1.1.0.
- Actualización sobre la versión anterior, con la misma firma y sin vaciar la biblioteca.
