package site.hoja.reader;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.AssetManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.os.Build;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.FilterInputStream;
import java.util.ArrayList;
import java.util.ArrayDeque;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONException;
import java.util.Collections;
import java.util.Locale;

/** Local-only reader. The system picker grants access to selected documents. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String DARK_APPEARANCE = "dark_appearance";
    private static final int DARK_SURFACE = Color.rgb(41, 38, 34);
    private static final int LIGHT_SURFACE = Color.rgb(252, 250, 246);
    private static final int PICK_DOCUMENT = 200;
    private static final long MAX_DOCUMENT_BYTES = 50L * 1024 * 1024;
    private final ConcurrentHashMap<String, IncomingDocument> incoming = new ConcurrentHashMap<>();
    private final ArrayDeque<IncomingDocument> pending = new ArrayDeque<>();
    private final ExecutorService documentExecutor = Executors.newSingleThreadExecutor();
    private boolean pageLoaded, delivering, destroyed;
    private int deliveryAttempts;
    private WebView webView;
    private FrameLayout root;
    private ValueCallback<Uri[]> fileCallback;
    private boolean readingFullscreen;
    private boolean darkAppearance;
    private volatile boolean systemDark;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        systemDark = isNightMode(getResources().getConfiguration());
        darkAppearance = getPreferences(MODE_PRIVATE).getBoolean(DARK_APPEARANCE, systemDark);
        root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        applyAppearance();
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        if (Build.VERSION.SDK_INT >= 29 && Build.VERSION.SDK_INT < 33) settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        if (Build.VERSION.SDK_INT >= 33) settings.setAlgorithmicDarkeningAllowed(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        webView.addJavascriptInterface(new ReaderBridge(), "HojaAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!HOST.equals(uri.getHost()) || !"https".equals(uri.getScheme())) {
                    return response(403, "Blocked");
                }
                String path = uri.getPath();
                if (path != null && path.startsWith("/incoming/")) {
                    IncomingDocument document = incoming.remove(path.substring("/incoming/".length()));
                    if (document == null) return response(404, "Not found");
                    try {
                        InputStream stream = getContentResolver().openInputStream(document.uri);
                        if (stream == null) return response(404, "Not found");
                        return new WebResourceResponse(document.type, null, 200, "OK",
                            Collections.singletonMap("Cache-Control", "no-store"), new LimitedInputStream(stream));
                    } catch (IOException | SecurityException error) { return response(403, "Unavailable"); }
                }
                if (path == null || path.equals("/")) path = "/index.html";
                if (path.contains("..") || path.contains("\\")) return response(403, "Blocked");
                try {
                    return new WebResourceResponse(mime(path), "UTF-8", 200, "OK",
                        Collections.singletonMap("Cache-Control", "no-cache"),
                        getAssets().open("web" + path, AssetManager.ACCESS_STREAMING));
                } catch (IOException error) {
                    return response(404, "Not found");
                }
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (url.equals("https://" + HOST + "/index.html")) {
                    pageLoaded = true;
                    notifySystemTheme();
                    deliverPending();
                }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost()) && "https".equals(uri.getScheme())) return false;
                if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (ActivityNotFoundException error) { message("No hay un navegador disponible."); }
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivityForResult(intent, PICK_DOCUMENT); }
                catch (ActivityNotFoundException error) {
                    fileCallback.onReceiveValue(null); fileCallback = null;
                    message("No se encontró un selector de documentos.");
                }
                return true;
            }
        });
        webView.loadUrl("https://" + HOST + "/index.html");
        receiveIntent(getIntent());
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (readingFullscreen) setReadingFullscreen(false);
        receiveIntent(intent);
    }

    private void receiveIntent(final Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        ArrayList<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) uris.add(intent.getData());
        if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) uris.add(uri);
        }
        if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> shared = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (shared != null) uris.addAll(shared);
        }
        if (uris.isEmpty() && (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) && intent.getClipData() != null) {
            for (int i = 0; i < intent.getClipData().getItemCount(); i++) {
                Uri uri = intent.getClipData().getItemAt(i).getUri();
                if (uri != null) uris.add(uri);
            }
        }
        for (int n = 0; n < Math.min(uris.size(), 20); n++) {
            final Uri uri = uris.get(n);
            if (!"content".equals(uri.getScheme()) && !"file".equals(uri.getScheme())) continue;
            documentExecutor.execute(new Runnable() {
                @Override public void run() {
                    try {
                        final IncomingDocument document = describeDocument(uri, intent.getType());
                        runOnUiThread(new Runnable() {
                            @Override public void run() {
                                if (destroyed) return;
                                incoming.put(document.token, document);
                                pending.add(document);
                                deliverPending();
                            }
                        });
                    } catch (Exception error) {
                        runOnUiThread(new Runnable() {
                            @Override public void run() { if (!destroyed) message("No se pudo abrir el archivo. Elige un PDF o Word de hasta 50 MB."); }
                        });
                    }
                }
            });
        }
    }

    private IncomingDocument describeDocument(Uri uri, String intentType) throws IOException {
        String name = uri.getLastPathSegment();
        long size = -1;
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0 && !cursor.isNull(column)) name = cursor.getString(column);
                column = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (column >= 0 && !cursor.isNull(column)) size = cursor.getLong(column);
            }
        } catch (IllegalArgumentException ignored) { /* Some file providers have no metadata query. */ }
        if (size > MAX_DOCUMENT_BYTES || size == 0) throw new IOException("File size");
        String type = getContentResolver().getType(uri);
        if (type == null) type = intentType;
        if (name == null || name.trim().isEmpty()) name = "Documento";
        name = name.replace('/', '_').replace('\\', '_').trim();
        String lower = name.toLowerCase(Locale.ROOT);
        if (!lower.endsWith(".pdf") && !lower.endsWith(".doc") && !lower.endsWith(".docx")) {
            if ("application/pdf".equals(type) || "application/x-pdf".equals(type)) name += ".pdf";
            else if ("application/msword".equals(type) || "application/vnd.ms-word".equals(type)) name += ".doc";
            else if ("application/vnd.openxmlformats-officedocument.wordprocessingml.document".equals(type)) name += ".docx";
            else throw new IOException("Unsupported document");
        }
        lower = name.toLowerCase(Locale.ROOT);
        type = lower.endsWith(".pdf") ? "application/pdf" : lower.endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/msword";
        return new IncomingDocument(uri, name, type);
    }

    private void deliverPending() {
        if (destroyed || !pageLoaded || pending.isEmpty() || delivering) return;
        final ArrayList<IncomingDocument> batch = new ArrayList<>(pending);
        JSONArray data = new JSONArray();
        try {
            for (IncomingDocument document : batch) {
                JSONObject item = new JSONObject();
                item.put("name", document.name);
                item.put("type", document.type);
                item.put("modified", System.currentTimeMillis());
                item.put("url", "https://" + HOST + "/incoming/" + document.token);
                data.put(item);
            }
        } catch (JSONException error) { return; }
        delivering = true;
        String script = "(function(){if(!window.hojaReady||typeof window.hojaOpenAndroidDocuments!=='function')return false;window.hojaOpenAndroidDocuments(" + data.toString() + ");return true;})()";
        webView.evaluateJavascript(script, new ValueCallback<String>() {
            @Override public void onReceiveValue(String handled) {
                delivering = false;
                if (destroyed) return;
                if ("true".equals(handled)) {
                    pending.removeAll(batch); deliveryAttempts = 0; deliverPending();
                } else if (++deliveryAttempts < 150) {
                    webView.postDelayed(new Runnable() { @Override public void run() { deliverPending(); } }, 100);
                } else {
                    for (IncomingDocument document : pending) incoming.remove(document.token);
                    pending.clear(); deliveryAttempts = 0;
                    message("No se terminó de cargar Hoja. Abre el documento de nuevo.");
                }
            }
        });
    }

    private static final class IncomingDocument {
        final Uri uri;
        final String name, type, token = UUID.randomUUID().toString();
        IncomingDocument(Uri uri, String name, String type) { this.uri = uri; this.name = name; this.type = type; }
    }

    private static final class LimitedInputStream extends FilterInputStream {
        private long total;
        LimitedInputStream(InputStream stream) { super(stream); }
        private void count(int bytes) throws IOException {
            if (bytes > 0 && (total += bytes) > MAX_DOCUMENT_BYTES) throw new IOException("Document exceeds 50 MB");
        }
        @Override public int read() throws IOException { int value = in.read(); count(value < 0 ? 0 : 1); return value; }
        @Override public int read(byte[] bytes, int offset, int length) throws IOException {
            int count = in.read(bytes, offset, length); count(count); return count;
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_DOCUMENT || fileCallback == null) return;
        ArrayList<Uri> selected = new ArrayList<>();
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                for (int n = 0; n < data.getClipData().getItemCount(); n++) selected.add(data.getClipData().getItemAt(n).getUri());
            } else if (data.getData() != null) selected.add(data.getData());
        }
        fileCallback.onReceiveValue(selected.isEmpty() ? null : selected.toArray(new Uri[0]));
        fileCallback = null;
    }

    @Override public void onBackPressed() {
        if (readingFullscreen) { setReadingFullscreen(false); return; }
        webView.evaluateJavascript("(function(){var dialogs=document.querySelectorAll('dialog[open]');if(dialogs.length){dialogs[dialogs.length-1].close();return true;}var r=document.getElementById('reader');if(r&&!r.hidden){document.getElementById('closeReader').click();return true;}return false;})()", new ValueCallback<String>() {
            @Override public void onReceiveValue(String handled) {
                if (!"true".equals(handled)) finish();
            }
        });
    }
    /** Only UI state is exposed; documents stay behind the local asset origin. */
    public final class ReaderBridge {
        @JavascriptInterface public void setReadingFullscreen(final boolean enabled) {
            onLocalPage(new Runnable() {
                @Override public void run() {
                    MainActivity.this.setReadingFullscreen(enabled);
                }
            });
        }

        @JavascriptInterface public boolean isSystemDarkTheme() {
            return systemDark;
        }

        @JavascriptInterface public void setDarkTheme(final boolean enabled) {
            onLocalPage(new Runnable() {
                @Override public void run() {
                    if (darkAppearance == enabled) return;
                    darkAppearance = enabled;
                    getPreferences(MODE_PRIVATE).edit().putBoolean(DARK_APPEARANCE, enabled).apply();
                    applyAppearance();
                }
            });
        }
    }

    private void onLocalPage(final Runnable action) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                if (destroyed || webView.getUrl() == null) return;
                Uri origin = Uri.parse(webView.getUrl());
                if ("https".equals(origin.getScheme()) && HOST.equals(origin.getHost())) action.run();
            }
        });
    }

    private static boolean isNightMode(Configuration configuration) {
        return (configuration.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        boolean night = isNightMode(configuration);
        if (systemDark == night) return;
        systemDark = night;
        notifySystemTheme();
    }

    private void notifySystemTheme() {
        if (!destroyed) webView.evaluateJavascript("window.hojaSystemThemeChanged&&window.hojaSystemThemeChanged()", null);
    }

    private void applyAppearance() {
        int surface = darkAppearance ? DARK_SURFACE : LIGHT_SURFACE;
        root.setBackgroundColor(surface);
        webView.setBackgroundColor(surface);
        getWindow().setStatusBarColor(surface);
        getWindow().setNavigationBarColor(surface);
        applySystemBars();
    }

    private void setReadingFullscreen(boolean enabled) {
        readingFullscreen = enabled;
        applySystemBars();
        if (!destroyed) webView.evaluateJavascript("window.hojaNativeFullscreenChanged&&window.hojaNativeFullscreenChanged(" + enabled + ")", null);
    }

    private void applySystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller == null) return;
            int lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            controller.setSystemBarsAppearance(darkAppearance ? 0 : lightBars, lightBars);
            if (readingFullscreen) {
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.systemBars());
            } else controller.show(WindowInsets.Type.systemBars());
        } else {
            int flags = darkAppearance ? 0 : (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            if (readingFullscreen) flags |= View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && readingFullscreen) applySystemBars();
    }
    private void message(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
    private static WebResourceResponse response(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason,
            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    private static String mime(String path) {
        path = path.toLowerCase(Locale.ROOT);
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "application/javascript";
        if (path.endsWith(".json") || path.endsWith(".webmanifest")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".pdf")) return "application/pdf";
        if (path.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        return "application/octet-stream";
    }
    @Override protected void onDestroy() {
        destroyed = true; documentExecutor.shutdownNow(); incoming.clear(); pending.clear();
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        webView.removeJavascriptInterface("HojaAndroid");
        webView.stopLoading(); root.removeAllViews(); webView.destroy();
        super.onDestroy();
    }
}
