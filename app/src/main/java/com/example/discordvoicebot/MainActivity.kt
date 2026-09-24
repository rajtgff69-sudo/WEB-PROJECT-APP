package com.example.discordvoicebot

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.example.discordvoicebot.ui.theme.DiscordVoiceBotTheme
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    internal var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val openSingleFileLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        filePathCallback?.onReceiveValue(uri?.let { arrayOf(it) } ?: emptyArray())
        filePathCallback = null
    }

    private val openMultipleFilesLauncher = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris: List<Uri> ->
        filePathCallback?.onReceiveValue(uris.toTypedArray())
        filePathCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            DiscordVoiceBotTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    WebViewScreen(
                        onFileChooser = { params ->
                            openFileChooser(params)
                        }
                    )
                }
            }
        }
    }

    private fun openFileChooser(fileChooserParams: WebChromeClient.FileChooserParams?) {
        val acceptTypes = (fileChooserParams?.acceptTypes ?: emptyArray())
            .flatMap { raw -> raw.split(',').map { it.trim() } }
            .map { normalizeMimeType(it) }
            .filter { it.isNotBlank() }
            .distinct()
            .toTypedArray()

        val allowMultiple = fileChooserParams?.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE

        if (allowMultiple) {
            if (acceptTypes.isNotEmpty()) {
                openMultipleFilesLauncher.launch(acceptTypes)
            } else {
                openMultipleFilesLauncher.launch(arrayOf("*/*"))
            }
        } else {
            val mimeType = acceptTypes.firstOrNull() ?: "*/*"
            openSingleFileLauncher.launch(mimeType)
        }
    }

    private fun normalizeMimeType(rawType: String): String {
        val value = rawType.trim()
        if (value.isEmpty()) return ""
        return when (value.lowercase()) {
            ".txt" -> "text/plain"
            ".mp3" -> "audio/mpeg"
            ".wav" -> "audio/wav"
            ".ogg" -> "audio/ogg"
            ".m4a" -> "audio/mp4"
            ".aac" -> "audio/aac"
            else -> value
        }
    }
}

@Composable
fun WebViewScreen(onFileChooser: (WebChromeClient.FileChooserParams?) -> Unit) {
    AndroidView(
        factory = { context ->
            createWebView(context, onFileChooser)
        },
        modifier = Modifier.fillMaxSize()
    )
}

@SuppressLint("SetJavaScriptEnabled")
private fun createWebView(
    context: Context,
    onFileChooser: (WebChromeClient.FileChooserParams?) -> Unit
): WebView {
    return WebView(context).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.allowUniversalAccessFromFileURLs = true
        settings.allowFileAccessFromFileURLs = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return false
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                (context as? MainActivity)?.let { activity ->
                    activity.filePathCallback = filePathCallback
                }
                onFileChooser(fileChooserParams)
                return true
            }
        }
        addJavascriptInterface(BotBridge(context), "AndroidBot")
        loadUrl("file:///android_asset/appui.html")
    }
}

class BotBridge(private val context: Context) {
    @JavascriptInterface
    fun postMessage(payload: String?) {
        val message = payload ?: return
        try {
            val json = JSONObject(message)
            val action = json.optString("action", "unknown")
            val vcId = json.optString("vcId", "")
            val mode = json.optString("mode", "")
            val amount = json.optInt("joinQuantity", 0)
            val bots = json.optInt("botQuantity", 0)

            val text = when (action) {
                "joinAll" -> "Joining VC $vcId • $amount bot(s)"
                "botOnline" -> "Bot online • VC $vcId • $amount active"
                "addTokens" -> "Loaded $bots token(s)"
                "playAll" -> "Playing audio on all bots"
                "muteAll" -> "Muted all bots"
                "unmuteAll" -> "Unmuted all bots"
                "deafenAll" -> "Deafened all bots"
                "undeafenAll" -> "Undeafened all bots"
                "leaveAll" -> "Left all voice channels"
                "stopAll" -> "Stopped sound playback"
                "setVolume" -> "Volume set to ${json.optInt("volume", 0)}%"
                else -> "Bot event: $action"
            }
            Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
        } catch (_: Exception) {
            Toast.makeText(context, "Bot event received", Toast.LENGTH_SHORT).show()
        }
    }
}
