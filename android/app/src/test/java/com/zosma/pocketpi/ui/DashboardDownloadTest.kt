package com.zosma.pocketpi.ui

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class DashboardDownloadTest {
    @Test fun acceptsOnlyTheLocalDashboardDownloadEndpoint() {
        val valid = "http://127.0.0.1:8000/api/pocket-pi/files/download?cwd=%2Fhome&path=file.bin"
        assertTrue(isDashboardDownload(valid, 8000))
        for (url in listOf(
            "http://evil.example:8000/api/pocket-pi/files/download",
            "http://127.0.0.1:9998/api/pocket-pi/files/download",
            "http://user@127.0.0.1:8000/api/pocket-pi/files/download",
            "http://127.0.0.1:8000/api/pocket-pi/files/download/../other",
            "http://127.0.0.1:8000/api/other",
            "file:///data/data/com.termux/files/home/secret",
            "blob:http://127.0.0.1:8000/blob", "not a URL",
        )) assertFalse(url, isDashboardDownload(url, 8000))
    }

    @Test fun streamsBinaryDataWithTheDashboardCookie() {
        val bytes = ByteArray(256 * 1024) { it.toByte() }
        val output = ByteArrayOutputStream()
        val headers = withResponse(200, bytes) { url, port ->
            copyDashboardDownload(url, port, "session=test") { output }
        }
        assertArrayEquals(bytes, output.toByteArray())
        assertTrue(headers.any { it.equals("Cookie: session=test", ignoreCase = true) })
    }

    @Test fun refusesHttpErrorsAndRedirectsBeforeOpeningTheDestination() {
        for (code in listOf(302, 403, 404, 500)) {
            var opened = false
            withResponse(code, byteArrayOf()) { url, port ->
                assertThrows(IOException::class.java) {
                    copyDashboardDownload(url, port, "secret") {
                        opened = true
                        ByteArrayOutputStream()
                    }
                }
            }
            assertFalse(opened)
        }
    }

    private fun withResponse(code: Int, bytes: ByteArray, action: (String, Int) -> Unit): List<String> {
        ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { server ->
            server.soTimeout = 5000
            val worker = Executors.newSingleThreadExecutor()
            try {
                val request = worker.submit<List<String>> {
                    server.accept().use { socket ->
                        socket.soTimeout = 5000
                        val reader = socket.getInputStream().bufferedReader()
                        val headers = generateSequence { reader.readLine() }.takeWhile { it.isNotEmpty() }.toList()
                        val output = socket.getOutputStream()
                        output.write(("HTTP/1.1 $code Response\r\nContent-Length: ${bytes.size}\r\n" +
                            "Location: https://example.com/private\r\nConnection: close\r\n\r\n").toByteArray())
                        output.write(bytes)
                        output.flush()
                        headers
                    }
                }
                action("http://127.0.0.1:${server.localPort}/api/pocket-pi/files/download", server.localPort)
                return request.get(5, TimeUnit.SECONDS)
            } finally {
                worker.shutdownNow()
            }
        }
    }
}
