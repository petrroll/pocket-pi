package com.zosma.pocketpi.ui

import java.io.File
import java.io.IOException
import java.io.InputStream

/** File operations confined to Pi's home directory, including symlink targets. */
internal class FolderFiles(home: File) {
    data class Entry(val name: String, val isDirectory: Boolean)

    private val root by lazy { home.canonicalFile }

    fun resolve(path: String): File {
        require(!File(path).isAbsolute) { "Expected a path relative to Pi's home directory" }
        val file = File(root, path).canonicalFile
        require(file == root || file.path.startsWith(root.path + File.separator)) {
            "File is outside Pi's home directory"
        }
        return file
    }

    fun list(path: String): List<Entry> {
        val entries = resolve(path).listFiles() ?: throw IOException("Cannot read this folder")
        return entries.mapNotNull {
            val target = it.canonicalFile
            val isDirectory = it.isDirectory
            if (target.path.startsWith(root.path + File.separator) && (isDirectory || it.isFile)) {
                Entry(it.name, isDirectory)
            } else null
        }.sortedWith(compareBy<Entry> { !it.isDirectory }.thenBy { it.name.lowercase() })
    }

    fun upload(directory: String, name: String, input: InputStream) {
        require(name.isNotBlank() && name != "." && name != ".." &&
            name.none { it == '/' || it == '\\' || it == '\u0000' }) { "Invalid file name" }
        val folder = resolve(directory)
        require(folder.isDirectory) { "Upload destination is not a folder" }
        val target = File(folder, name)
        // Reserve the name exclusively: never overwrite a file or follow an existing symlink.
        if (!target.createNewFile()) throw IOException("A file named $name already exists")
        try {
            target.outputStream().use { input.copyTo(it) }
        } catch (e: Exception) {
            target.delete()
            throw e
        }
    }

    fun file(path: String): File = resolve(path).also {
        require(it.isFile) { "Not a regular file" }
    }
}
