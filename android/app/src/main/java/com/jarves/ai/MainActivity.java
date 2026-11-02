package com.jarves.ai;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.ComponentName;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.Manifest;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.speech.RecognitionListener;
import android.speech.SpeechRecognizer;
import android.view.View;
import android.view.Window;
import android.webkit.WebChromeClient;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.util.Log;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.ArrayList;
import java.util.Set;

public class MainActivity extends Activity {
    private static final String PREFS = "jarves";
    private static final String KEY_URL = "server_url";
    private static final String KEY_LAUNCHER_ICON = "launcher_icon";
    private static final int PICK_FILE_REQUEST = 7412;
    private static final int REQUEST_AUDIO_PERMISSION = 7413;
    private static final String JARVES_SERVICE_TYPE = "_jarves._tcp.";
    private static final int DISCOVERY_TIMEOUT_MS = 15000;
    private WebView webView;
    private TextView loading;
    private String serverOrigin = "";
    private ValueCallback<Uri[]> fileChooserCallback;
    private NsdManager nsdManager;
    private ConnectivityManager connectivityManager;
    private WifiManager wifiManager;
    private WifiManager.MulticastLock multicastLock;
    private NsdManager.DiscoveryListener discoveryListener;
    private AlertDialog serverDialog;
    private Handler mainHandler;
    private Runnable discoveryTimeout;
    private final Set<String> resolvingServices = new HashSet<>();
    private int discoveryGeneration;
    private boolean serverConnected;
    private boolean serverUrlLoadPending;
    private boolean networkCallbackRegistered;
    private Network activeWifiNetwork;
    private String pendingServerUrl = "";
    private String serverErrorMessage = "";
    private volatile String serverConnectionStatus = "disconnected";
    private int manualServerCheckGeneration;
    private SpeechRecognizer speechRecognizer;
    private String pendingSpeechLanguage = "pt-BR";
    private boolean speechStartPending;
    private boolean userCancelledSpeech;
    private final ConnectivityManager.NetworkCallback wifiNetworkCallback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) {
            NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(network);
            if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                mainHandler.post(() -> connectToWifiNetwork(network));
            }
        }
        @Override public void onLost(Network network) {
            if (network.equals(activeWifiNetwork)) {
                mainHandler.post(() -> {
                    activeWifiNetwork = null;
                    connectivityManager.bindProcessToNetwork(null);
                    serverConnected = false;
                    serverConnectionStatus = "disconnected";
                    serverUrlLoadPending = false;
                    loading.setVisibility(View.VISIBLE);
                    loading.setText("Wi-Fi desconectado · aguardando a rede para procurar JARVES...");
                    stopDiscovery();
                    Network replacement = findWifiNetwork();
                    if (replacement != null) connectToWifiNetwork(replacement);
                });
            }
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        mainHandler = new Handler(Looper.getMainLooper());
        nsdManager = (NsdManager) getSystemService(Context.NSD_SERVICE);
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setStatusBarColor(0xFF080D1A);
        getWindow().setNavigationBarColor(0xFF080D1A);
        buildUi();
        pendingServerUrl = getPreferences(MODE_PRIVATE).getString(KEY_URL, "");
        loading.setText("Aguardando conexão Wi-Fi...");
    }

    @Override protected void onStart() {
        super.onStart();
        try {
            NetworkRequest wifiRequest = new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .build();
            connectivityManager.registerNetworkCallback(wifiRequest, wifiNetworkCallback);
            networkCallbackRegistered = true;
            Network network = findWifiNetwork();
            if (network != null) connectToWifiNetwork(network);
            else loading.setText("Conecte o Android à rede Wi-Fi do computador para localizar o JARVES.");
        } catch (RuntimeException error) {
            Log.e("JARVES", "Não foi possível acompanhar a conexão Wi-Fi.", error);
        }
    }

    @Override protected void onStop() {
        if (networkCallbackRegistered) {
            try {
                connectivityManager.unregisterNetworkCallback(wifiNetworkCallback);
            } catch (IllegalArgumentException error) {
                Log.w("JARVES", "O monitor de rede já estava desativado.", error);
            }
            networkCallbackRegistered = false;
        }
        stopDiscovery();
        connectivityManager.bindProcessToNetwork(null);
        activeWifiNetwork = null;
        serverConnected = false;
        serverUrlLoadPending = false;
        super.onStop();
    }

    @Override protected void onDestroy() {
        stopDiscovery();
        if (speechRecognizer != null) {
            speechRecognizer.destroy();
            speechRecognizer = null;
        }
        if (fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = null;
        }
        super.onDestroy();
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF080D1A);
        loading = new TextView(this);
        loading.setText("JARVES AI · Conectando...");
        loading.setTextColor(0xFFFFFFFF);
        loading.setPadding(18, 12, 18, 12);
        root.addView(loading, new LinearLayout.LayoutParams(-1, -2));
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        webView.addJavascriptInterface(new NativeSettingsBridge(), "JarvesAndroid");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                try {
                    startActivityForResult(Intent.createChooser(intent, "Escolha a imagem da IA"), PICK_FILE_REQUEST);
                    return true;
                } catch (android.content.ActivityNotFoundException error) {
                    fileChooserCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "Nenhum seletor de imagens disponível.", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                serverUrlLoadPending = true;
                loading.setVisibility(View.VISIBLE);
                loading.setText("JARVES AI · Carregando...");
            }
            @Override public void onPageFinished(WebView view, String url) {
                serverUrlLoadPending = false;
                serverConnected = true;
                serverConnectionStatus = "connected";
                loading.setVisibility(View.GONE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    serverUrlLoadPending = false;
                    serverConnected = false;
                    serverConnectionStatus = "error";
                    loading.setVisibility(View.VISIBLE);
                    int errorCode = error.getErrorCode();
                    String description = error.getDescription() == null ? "erro de rede" : error.getDescription().toString();
                    String failedUrl = pendingServerUrl.isEmpty() ? serverOrigin : pendingServerUrl;
                    serverErrorMessage = "Não foi possível abrir o servidor"
                        + (failedUrl.isEmpty() ? "" : " " + failedUrl)
                        + " (" + errorCode + ": " + description + "). Confira se o servidor está ligado, se os dois aparelhos estão na mesma Wi-Fi e se a porta está liberada no firewall.";
                    loading.setText("Servidor indisponível · procurando novamente na rede Wi-Fi...");
                    startDiscovery();
                }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String targetOrigin = uri.getScheme() + "://" + uri.getAuthority();
                if (targetOrigin.equals(serverOrigin)) return false;
                if ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                }
                return true;
            }
        });
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setPadding(12, 6, 12, 6);
        TextView brand = new TextView(this);
        brand.setText("JARVES AI");
        brand.setTextColor(0xFFFFFFFF);
        brand.setTextSize(16);
        toolbar.addView(brand, new LinearLayout.LayoutParams(0, -2, 1));
        android.widget.Button serverButton = new android.widget.Button(this);
        serverButton.setText("Servidor");
        serverButton.setOnClickListener(v -> showServerDialog());
        toolbar.addView(serverButton, new LinearLayout.LayoutParams(-2, -2));
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, -2));
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
    }

    private void showServerDialog() {
        if (serverDialog != null && serverDialog.isShowing()) return;
        final EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("http://192.168.1.10:3000");
        input.setText(pendingServerUrl.isEmpty()
            ? getPreferences(MODE_PRIVATE).getString(KEY_URL, "")
            : pendingServerUrl);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        LinearLayout box = new LinearLayout(this);
        box.setPadding(24, 8, 24, 0);
        box.addView(input);
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Conectar ao JARVES AI")
            .setMessage(serverErrorMessage.isEmpty()
                ? "Não encontrei um servidor JARVES na rede Wi-Fi. Inicie o JARVES no computador na mesma rede ou informe o endereço do servidor."
                : serverErrorMessage)
            .setView(box)
            .setCancelable(false)
            .setPositiveButton("Conectar", (d, w) -> {
                String value = input.getText().toString().trim();
                if (!value.matches("^https?://[^\\s]+$")) {
                    Toast.makeText(this, "Informe um endereço http:// ou https:// válido.", Toast.LENGTH_LONG).show();
                    mainHandler.post(() -> {
                        if (serverDialog == null) showServerDialog();
                    });
                    return;
                }
                pendingServerUrl = value.replaceAll("/+$", "");
                verifyManualServer(pendingServerUrl);
            })
            .setNeutralButton("Procurar novamente", (d, w) -> startDiscovery())
            .setNegativeButton("Sair", (d, w) -> finish())
            .create();
        serverDialog = dialog;
        dialog.setOnDismissListener(ignored -> {
            if (serverDialog == dialog) serverDialog = null;
        });
        dialog.show();
    }

    private Network findWifiNetwork() {
        for (Network network : connectivityManager.getAllNetworks()) {
            NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(network);
            if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return network;
        }
        return null;
    }

    private void connectToWifiNetwork(Network network) {
        if (isFinishing() || network.equals(activeWifiNetwork)) return;
        activeWifiNetwork = network;
        if (!connectivityManager.bindProcessToNetwork(network)) {
            Log.w("JARVES", "Não foi possível associar o app à rede Wi-Fi ativa.");
        }
        if (!pendingServerUrl.isEmpty()) verifyManualServer(pendingServerUrl);
        else if (!serverConnected && !serverUrlLoadPending) startDiscovery();
    }

    private void verifyManualServer(String serverUrl) {
        final int generation = ++manualServerCheckGeneration;
        serverConnectionStatus = "checking";
        loading.setVisibility(View.VISIBLE);
        loading.setText("Verificando o servidor " + serverUrl + "...");
        final Network network = activeWifiNetwork;
        new Thread(() -> {
            String error;
            try {
                error = checkServerHealth(serverUrl, network);
            } catch (Exception exception) {
                error = exception.getMessage() == null ? exception.getClass().getSimpleName() : exception.getMessage();
            }
            final String result = error;
            mainHandler.post(() -> {
                if (isFinishing() || generation != manualServerCheckGeneration) return;
                if (result == null) {
                    serverErrorMessage = "";
                    pendingServerUrl = "";
                    serverConnectionStatus = "connected";
                    loadServer(serverUrl);
                } else {
                    serverConnectionStatus = "error";
                    serverErrorMessage = "Não consegui validar " + serverUrl + ": " + result
                        + ". Confirme o endereço, a porta 3000, a rede Wi-Fi e o firewall do computador.";
                    loading.setText("Servidor não respondeu · confira o endereço e tente novamente.");
                    showServerDialog();
                }
            });
        }, "jarves-manual-server-check").start();
    }

    private void loadServer(String value) {
        stopDiscovery();
        String normalized = value.replaceAll("/+$", "");
        Uri uri = Uri.parse(normalized);
        if (uri.getHost() == null || (!"http".equals(uri.getScheme()) && !"https".equals(uri.getScheme()))) {
            showServerDialog();
            return;
        }
        serverOrigin = uri.getScheme() + "://" + uri.getAuthority();
        serverConnected = false;
        serverUrlLoadPending = true;
        getPreferences(MODE_PRIVATE).edit().putString(KEY_URL, normalized).apply();
        loading.setVisibility(View.VISIBLE);
        loading.setText("Conectando a " + serverOrigin);
        webView.loadUrl(normalized);
    }

    private void startDiscovery() {
        if (serverConnected || discoveryListener != null || isFinishing()) return;
        if (nsdManager == null) {
            loading.setText("Descoberta automática indisponível. Informe o endereço do servidor.");
            showServerDialog();
            return;
        }
        final int generation = ++discoveryGeneration;
        resolvingServices.clear();
        loading.setVisibility(View.VISIBLE);
        loading.setText("Procurando JARVES na rede Wi-Fi...");
        try {
            if (wifiManager != null && (multicastLock == null || !multicastLock.isHeld())) {
                multicastLock = wifiManager.createMulticastLock("jarves-mdns-discovery");
                multicastLock.setReferenceCounted(false);
                multicastLock.acquire();
            }
        } catch (RuntimeException error) {
            Log.e("JARVES", "Não foi possível habilitar a descoberta local da rede.", error);
        }
        NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            @Override public void onDiscoveryStarted(String serviceType) {}
            @Override public void onServiceFound(NsdServiceInfo service) {
                if (generation != discoveryGeneration || !JARVES_SERVICE_TYPE.equals(service.getServiceType())) return;
                if (!resolvingServices.add(service.getServiceName())) return;
                resolveJarvesService(service, generation);
            }
            @Override public void onServiceLost(NsdServiceInfo service) {
                resolvingServices.remove(service.getServiceName());
            }
            @Override public void onDiscoveryStopped(String serviceType) {}
            @Override public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                runOnUiThread(() -> {
                    if (generation != discoveryGeneration) return;
                    Log.e("JARVES", "Falha ao procurar JARVES na rede. Código NSD: " + errorCode);
                    stopDiscovery();
                    loading.setText("Não foi possível procurar automaticamente. Informe o endereço do servidor.");
                    showServerDialog();
                });
            }
            @Override public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                Log.e("JARVES", "Falha ao encerrar a busca NSD. Código: " + errorCode);
            }
        };
        discoveryListener = listener;
        try {
            nsdManager.discoverServices(JARVES_SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener);
            discoveryTimeout = () -> {
                if (generation != discoveryGeneration) return;
                if (serverConnected) {
                    stopDiscovery();
                    return;
                }
                stopDiscovery();
                loading.setText("Nenhum servidor JARVES encontrado nesta rede.");
                showServerDialog();
            };
            mainHandler.postDelayed(discoveryTimeout, DISCOVERY_TIMEOUT_MS);
        } catch (RuntimeException error) {
            Log.e("JARVES", "Não foi possível iniciar a descoberta do servidor.", error);
            stopDiscovery();
            loading.setText("Descoberta automática indisponível. Informe o endereço do servidor.");
            showServerDialog();
        }
    }

    @SuppressWarnings("deprecation")
    private void resolveJarvesService(NsdServiceInfo service, int generation) {
        try {
            nsdManager.resolveService(service, new NsdManager.ResolveListener() {
                @Override public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {
                    Log.w("JARVES", "Não foi possível resolver o servidor anunciado. Código NSD: " + errorCode);
                }
                @Override public void onServiceResolved(NsdServiceInfo serviceInfo) {
                    if (generation != discoveryGeneration || serverConnected) return;
                    InetAddress address = serviceInfo.getHost();
                    if (!(address instanceof Inet4Address)
                        || (!address.isSiteLocalAddress() && !address.isLinkLocalAddress())
                        || serviceInfo.getPort() < 1
                        || serviceInfo.getPort() > 65535) {
                        Log.w("JARVES", "Ignorando serviço anunciado fora da rede local permitida.");
                        return;
                    }
                    String serverUrl = "http://" + address.getHostAddress() + ":" + serviceInfo.getPort();
                    verifyJarvesServer(serverUrl, generation);
                }
            });
        } catch (RuntimeException error) {
            Log.w("JARVES", "Não foi possível resolver o serviço JARVES.", error);
        }
    }

    private void verifyJarvesServer(String serverUrl, int generation) {
        final Network network = activeWifiNetwork;
        new Thread(() -> {
            boolean isJarves;
            try {
                isJarves = checkServerHealth(serverUrl, network) == null;
            } catch (Exception error) {
                Log.w("JARVES", "Servidor anunciado não respondeu à verificação de saúde: " + serverUrl, error);
                isJarves = false;
            }
            if (isJarves) {
                mainHandler.post(() -> {
                    if (generation != discoveryGeneration || serverConnected) return;
                    stopDiscovery();
                    pendingServerUrl = "";
                    serverErrorMessage = "";
                    loading.setText("Servidor JARVES encontrado · conectando...");
                    loadServer(serverUrl);
                });
            }
        }, "jarves-server-check").start();
    }

    private String checkServerHealth(String serverUrl, Network network) throws Exception {
        URL healthUrl = new URL(serverUrl + "/api/health");
        java.net.URLConnection rawConnection = network == null
            ? healthUrl.openConnection()
            : network.openConnection(healthUrl);
        if (!(rawConnection instanceof HttpURLConnection)) return "o endereço não usa HTTP";
        HttpURLConnection connection = (HttpURLConnection) rawConnection;
        try {
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            connection.setInstanceFollowRedirects(false);
            int responseCode = connection.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) return "a API respondeu HTTP " + responseCode;
            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[1024];
                int total = 0;
                int count;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > 8192) return "a resposta de saúde é grande demais";
                    output.write(buffer, 0, count);
                }
                JSONObject health = new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
                if (!"ok".equals(health.optString("status")) || health.optString("version").isEmpty()) {
                    return "o endereço respondeu, mas não parece ser um servidor JARVES";
                }
                return null;
            }
        } finally {
            connection.disconnect();
        }
    }

    private void stopDiscovery() {
        discoveryGeneration++;
        if (discoveryTimeout != null) {
            mainHandler.removeCallbacks(discoveryTimeout);
            discoveryTimeout = null;
        }
        NsdManager.DiscoveryListener listener = discoveryListener;
        discoveryListener = null;
        if (listener != null && nsdManager != null) {
            try {
                nsdManager.stopServiceDiscovery(listener);
            } catch (IllegalArgumentException error) {
                Log.w("JARVES", "A busca de rede já estava encerrada.", error);
            }
        }
        resolvingServices.clear();
        if (multicastLock != null && multicastLock.isHeld()) multicastLock.release();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_AUDIO_PERMISSION || !speechStartPending) return;
        speechStartPending = false;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startAndroidSpeechRecognition();
        } else {
            notifyVoiceError("permission");
        }
    }

    private void beginAndroidSpeechRecognition(String language) {
        pendingSpeechLanguage = language;
        userCancelledSpeech = false;
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            notifyVoiceError("unavailable");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            speechStartPending = true;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_AUDIO_PERMISSION);
            return;
        }
        startAndroidSpeechRecognition();
    }

    private void startAndroidSpeechRecognition() {
        try {
            if (speechRecognizer == null) {
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
                speechRecognizer.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(Bundle params) { notifyVoiceStatus("listening"); }
                    @Override public void onBeginningOfSpeech() { notifyVoiceStatus("listening"); }
                    @Override public void onRmsChanged(float rmsdB) {}
                    @Override public void onBufferReceived(byte[] buffer) {}
                    @Override public void onEndOfSpeech() { notifyVoiceStatus("processing"); }
                    @Override public void onError(int error) {
                        if (userCancelledSpeech) {
                            userCancelledSpeech = false;
                            notifyVoiceError("cancelled");
                        } else if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                            notifyVoiceError("no-speech");
                        } else if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) {
                            notifyVoiceError("network");
                        } else if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                            notifyVoiceError("permission");
                        } else if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) {
                            notifyVoiceError("unavailable");
                        } else {
                            notifyVoiceError("unavailable");
                        }
                    }
                    @Override public void onResults(Bundle results) {
                        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (matches == null || matches.isEmpty() || matches.get(0).trim().isEmpty()) {
                            notifyVoiceError("no-speech");
                        } else {
                            String transcript = JSONObject.quote(matches.get(0));
                            webView.evaluateJavascript("window.jarvesNativeVoiceResult&&window.jarvesNativeVoiceResult(" + transcript + ")", null);
                        }
                    }
                    @Override public void onPartialResults(Bundle partialResults) { notifyVoiceStatus("listening"); }
                    @Override public void onEvent(int eventType, Bundle params) {}
                });
            }
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, pendingSpeechLanguage);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            speechRecognizer.startListening(intent);
        } catch (RuntimeException error) {
            Log.e("JARVES", "Não foi possível iniciar o reconhecimento de voz.", error);
            notifyVoiceError("unavailable");
        }
    }

    private void notifyVoiceStatus(String status) {
        if (webView != null) {
            webView.evaluateJavascript("window.jarvesNativeVoiceStatus&&window.jarvesNativeVoiceStatus("
                + JSONObject.quote(status) + ")", null);
        }
    }

    private void notifyVoiceError(String error) {
        if (webView != null) {
            webView.evaluateJavascript("window.jarvesNativeVoiceError&&window.jarvesNativeVoiceError("
                + JSONObject.quote(error) + ")", null);
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_FILE_REQUEST || fileChooserCallback == null) return;
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) results = new Uri[]{data.getData()};
        fileChooserCallback.onReceiveValue(results);
        fileChooserCallback = null;
    }

    public final class NativeSettingsBridge {
        @JavascriptInterface public boolean startVoiceRecognition(String language) {
            if (!"pt-BR".equals(language) && !"pt-PT".equals(language)
                && !"en-US".equals(language) && !"es-ES".equals(language)) return false;
            mainHandler.post(() -> beginAndroidSpeechRecognition(language));
            return true;
        }

        @JavascriptInterface public void stopVoiceRecognition() {
            mainHandler.post(() -> {
                userCancelledSpeech = true;
                if (speechRecognizer != null) speechRecognizer.cancel();
                speechStartPending = false;
            });
        }

        @JavascriptInterface public String getServerUrl() {
            return getPreferences(MODE_PRIVATE).getString(KEY_URL, "");
        }

        @JavascriptInterface public String getServerStatus() {
            return serverConnectionStatus;
        }

        @JavascriptInterface public boolean connectToServer(String address) {
            if (address == null || address.length() > 2048) return false;
            String normalized = address.trim().replaceAll("/+$", "");
            Uri uri = Uri.parse(normalized);
            if ((!"http".equals(uri.getScheme()) && !"https".equals(uri.getScheme()))
                || uri.getHost() == null
                || uri.getUserInfo() != null
                || (uri.getPath() != null && !uri.getPath().isEmpty())
                || uri.getQuery() != null
                || uri.getFragment() != null) {
                return false;
            }
            mainHandler.post(() -> {
                pendingServerUrl = normalized;
                getPreferences(MODE_PRIVATE).edit().putString(KEY_URL, normalized).apply();
                verifyManualServer(normalized);
            });
            return true;
        }

        @JavascriptInterface public String getLauncherIcon() {
            return getPreferences(MODE_PRIVATE).getString(KEY_LAUNCHER_ICON, "default");
        }

        @JavascriptInterface public boolean setLauncherIcon(String requestedIcon) {
            if (!"default".equals(requestedIcon) && !"robot".equals(requestedIcon)) return false;
            String selected = "robot".equals(requestedIcon) ? ".RobotLauncher" : ".DefaultLauncher";
            String disabled = "robot".equals(requestedIcon) ? ".DefaultLauncher" : ".RobotLauncher";
            PackageManager manager = getPackageManager();
            manager.setComponentEnabledSetting(
                new ComponentName(MainActivity.this, getPackageName() + selected),
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP
            );
            manager.setComponentEnabledSetting(
                new ComponentName(MainActivity.this, getPackageName() + disabled),
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP
            );
            getPreferences(MODE_PRIVATE).edit().putString(KEY_LAUNCHER_ICON, requestedIcon).apply();
            return true;
        }
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
