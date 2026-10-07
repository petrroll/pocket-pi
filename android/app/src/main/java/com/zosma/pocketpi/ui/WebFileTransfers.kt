package com.zosma.pocketpi.ui

import android.net.Uri
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

internal class WebFileTransfers(
    val chooseFiles: (ValueCallback<Array<Uri>>, WebChromeClient.FileChooserParams) -> Boolean,
    val download: DownloadListener,
)

/** Only platform plumbing: file listing and transfers belong to the shared web app. */
@Composable
internal fun rememberWebFileTransfers(port: Int): WebFileTransfers {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var callback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    var downloadUrl by rememberSaveable { mutableStateOf<String?>(null) }
    var copying by remember { mutableStateOf(false) }
    fun message(text: String) = Toast.makeText(ctx, text, Toast.LENGTH_LONG).show()

    val chooser = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        // An untrusted picker must not point the WebView at our private files.
        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            ?.filter { it.scheme == "content" && it.authority != "${ctx.packageName}.fileprovider" }
            ?.toTypedArray()?.takeIf { it.isNotEmpty() }
        callback?.onReceiveValue(uris)
        callback = null
    }
    DisposableEffect(Unit) {
        onDispose { callback?.onReceiveValue(null); callback = null }
    }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val url = downloadUrl
        downloadUrl = null
        if (uri != null && url != null) {
            val cookie = CookieManager.getInstance().getCookie(url)
            copying = true
            message("Downloading…")
            scope.launch {
                try {
                    withContext(Dispatchers.IO) {
                        copyDashboardDownload(url, port, cookie) {
                            ctx.contentResolver.openOutputStream(uri, "wt")
                                ?: throw IOException("Cannot open the save destination")
                        }
                    }
                    message("File downloaded")
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    message(e.message ?: "Download failed")
                } finally {
                    copying = false
                }
            }
        }
    }
    return WebFileTransfers(
        chooseFiles = { next, params ->
            if (callback != null) {
                next.onReceiveValue(null)
            } else {
                callback = next
                try {
                    chooser.launch(params.createIntent())
                } catch (e: Exception) {
                    callback?.onReceiveValue(null)
                    callback = null
                    message(e.message ?: "Cannot open file picker")
                }
            }
            true
        },
        download = DownloadListener { url, _, _, _, _ ->
            when {
                !isDashboardDownload(url, port) -> message("Unsupported download URL")
                downloadUrl != null || copying -> message("Finish the current download first")
                else -> {
                    downloadUrl = url
                    val name = Uri.parse(url).getQueryParameter("path")?.substringAfterLast('/') ?: "download"
                    try {
                        save.launch(name)
                    } catch (e: Exception) {
                        downloadUrl = null
                        message(e.message ?: "Cannot open save dialog")
                    }
                }
            }
        },
    )
}
