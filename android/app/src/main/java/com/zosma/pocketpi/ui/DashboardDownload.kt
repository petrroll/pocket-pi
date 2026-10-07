package com.zosma.pocketpi.ui

import java.io.IOException
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URI

internal fun isDashboardDownload(url: String, port: Int): Boolean = runCatching {
    val uri = URI(url)
    uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port == port &&
        uri.userInfo == null && uri.rawPath == "/api/pocket-pi/files/download"
}.getOrDefault(false)

/** Called on Dispatchers.IO. Never follow redirects with the dashboard cookie. */
internal fun copyDashboardDownload(url: String, port: Int, cookie: String?, output: () -> OutputStream) {
    require(isDashboardDownload(url, port)) { "Not a dashboard file download" }
    val connection = URI(url).toURL().openConnection() as HttpURLConnection
    try {
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        cookie?.let { connection.setRequestProperty("Cookie", it) }
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IOException("Download failed (HTTP ${connection.responseCode})")
        }
        connection.inputStream.use { input -> output().use { input.copyTo(it) } }
    } finally {
        connection.disconnect()
    }
}
