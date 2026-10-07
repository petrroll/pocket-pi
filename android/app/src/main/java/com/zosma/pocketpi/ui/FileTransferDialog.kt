package com.zosma.pocketpi.ui

import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.zosma.pocketpi.pi.Bootstrapper
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

/** SAF grants access only to the documents the user selects; no storage permission needed. */
@Composable
internal fun FileTransferDialog(onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val files = remember { FolderFiles(Bootstrapper.homeDir(ctx)) }
    val scope = rememberCoroutineScope()
    var directory by rememberSaveable { mutableStateOf("") }
    var uploadDirectory by rememberSaveable { mutableStateOf<String?>(null) }
    var downloadPath by rememberSaveable { mutableStateOf<String?>(null) }
    var entries by remember { mutableStateOf<List<FolderFiles.Entry>?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var transferring by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    val busy = loading || transferring || uploadDirectory != null || downloadPath != null

    fun transfer(success: String, copy: () -> Unit) {
        transferring = true
        message = null
        scope.launch {
            try {
                withContext(Dispatchers.IO) { copy() }
                message = success
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                message = "Transfer failed: ${e.message ?: e.javaClass.simpleName}"
            } finally {
                transferring = false
                refresh++
            }
        }
    }

    val upload = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val destination = uploadDirectory
        uploadDirectory = null
        if (uri != null && destination != null) {
            transfer("File uploaded") {
                val resolver = ctx.contentResolver
                val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                    val column = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (column >= 0 && it.moveToFirst()) it.getString(column) else null
                } ?: throw IOException("Cannot read the selected file's name")
                resolver.openInputStream(uri)?.use { files.upload(destination, name, it) }
                    ?: throw IOException("Cannot open the selected file")
            }
        }
    }
    val download = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/octet-stream"),
    ) { uri ->
        val source = downloadPath
        downloadPath = null
        if (uri != null && source != null) {
            transfer("File downloaded") {
                files.file(source).inputStream().use { input ->
                    ctx.contentResolver.openOutputStream(uri, "wt")?.use { output -> input.copyTo(output) }
                        ?: throw IOException("Cannot open the save destination")
                }
            }
        }
    }

    LaunchedEffect(directory, refresh) {
        loading = true
        entries = null
        try {
            entries = withContext(Dispatchers.IO) { files.list(directory) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            message = "Cannot list folder: ${e.message ?: e.javaClass.simpleName}"
        } finally {
            loading = false
        }
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Files") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (directory.isEmpty()) "Pi home (~)" else "~/$directory")
                Row {
                    TextButton(
                        enabled = !busy && directory.isNotEmpty(),
                        onClick = { directory = File(directory).parent ?: ""; message = null },
                    ) { Text("Up") }
                    TextButton(enabled = !busy, onClick = {
                        uploadDirectory = directory
                        try {
                            upload.launch(arrayOf("*/*"))
                        } catch (e: Exception) {
                            uploadDirectory = null
                            message = "Cannot open file picker: ${e.message ?: e.javaClass.simpleName}"
                        }
                    }) { Text("Upload") }
                    TextButton(enabled = !busy, onClick = { message = null; refresh++ }) { Text("Refresh") }
                }
                if (loading || transferring) LinearProgressIndicator(Modifier.fillMaxWidth())
                message?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                Text("Open a folder, or tap a file to download it.", style = MaterialTheme.typography.bodySmall)
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 360.dp)) {
                    items(entries.orEmpty(), key = { it.name }) { entry ->
                        TextButton(
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth(),
                            onClick = {
                                val path = if (directory.isEmpty()) entry.name else "$directory/${entry.name}"
                                message = null
                                if (entry.isDirectory) {
                                    directory = path
                                } else {
                                    downloadPath = path
                                    try {
                                        download.launch(entry.name)
                                    } catch (e: Exception) {
                                        downloadPath = null
                                        message = "Cannot open save dialog: ${e.message ?: e.javaClass.simpleName}"
                                    }
                                }
                            },
                        ) { Text(entry.name + if (entry.isDirectory) "/" else "", Modifier.fillMaxWidth()) }
                    }
                    if (entries?.isEmpty() == true) item { Text("This folder is empty") }
                }
            }
        },
        confirmButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Close") } },
    )
}
