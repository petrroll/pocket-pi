package com.zosma.pocketpi.ui

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files

class FolderFilesTest {
    @get:Rule val temp = TemporaryFolder()

    private fun home(): File = temp.newFolder("home")

    @Test fun listsFoldersFirstIncludingHiddenAndUnicodeFiles() {
        val home = home()
        File(home, "z-folder").mkdir()
        File(home, ".hidden").writeText("hidden")
        File(home, "žluťoučký.txt").writeText("unicode")
        assertEquals(listOf("z-folder", ".hidden", "žluťoučký.txt"), FolderFiles(home).list("").map { it.name })
    }

    @Test fun binaryAndEmptyFilesRoundTripIntoSelectedFolder() {
        val home = home()
        File(home, "nested").mkdir()
        val files = FolderFiles(home)
        val bytes = ByteArray(256 * 1024) { it.toByte() }
        bytes.inputStream().use { files.upload("nested", "binary.dat", it) }
        assertArrayEquals(bytes, files.file("nested/binary.dat").readBytes())
        byteArrayOf().inputStream().use { files.upload("nested", "empty", it) }
        assertEquals(0L, files.file("nested/empty").length())
        assertFalse(File(home, "binary.dat").exists())
    }

    @Test fun refusesOverwrite() {
        val home = home()
        File(home, "existing").writeText("keep")
        assertThrows(IOException::class.java) {
            FolderFiles(home).upload("", "existing", "replace".byteInputStream())
        }
        assertEquals("keep", File(home, "existing").readText())
    }

    @Test fun rejectsUnsafeDisplayNames() {
        val files = FolderFiles(home())
        for (name in listOf("", " ", ".", "..", "../escape", "/absolute", "a/b", "a\\b", "a\u0000b")) {
            assertThrows("name: $name", IllegalArgumentException::class.java) {
                files.upload("", name, "data".byteInputStream())
            }
        }
        assertTrue(files.list("").isEmpty())
    }

    @Test fun rejectsTraversalAndSiblingPrefix() {
        val home = home()
        val files = FolderFiles(home)
        temp.newFolder("home-other")
        assertThrows(IllegalArgumentException::class.java) { files.resolve("..") }
        assertThrows(IllegalArgumentException::class.java) { files.resolve("/etc/passwd") }
        assertThrows(IllegalArgumentException::class.java) { files.resolve("../home-other") }
        assertEquals(home.canonicalFile, files.resolve(""))
    }

    @Test fun rejectsEscapingSymlinksAndHidesThemFromListing() {
        val home = home()
        val outside = temp.newFolder("outside")
        File(outside, "secret").writeText("keep")
        Files.createSymbolicLink(File(home, "link").toPath(), outside.toPath())
        val files = FolderFiles(home)
        assertThrows(IllegalArgumentException::class.java) { files.list("link") }
        assertThrows(IllegalArgumentException::class.java) { files.file("link/secret") }
        assertThrows(IllegalArgumentException::class.java) { files.upload("link", "new", "data".byteInputStream()) }
        assertTrue(files.list("").isEmpty())
        assertEquals("keep", File(outside, "secret").readText())
    }

    @Test fun refusesExistingAndDanglingSymlinkUploadTargets() {
        val home = home()
        File(home, "original").writeText("keep")
        val files = FolderFiles(home)
        for (target in listOf("original", "missing")) {
            Files.createSymbolicLink(File(home, "link-$target").toPath(), File(home, target).toPath())
            assertThrows(IOException::class.java) { files.upload("", "link-$target", "data".byteInputStream()) }
        }
        assertEquals("keep", File(home, "original").readText())
        assertFalse(File(home, "missing").exists())
    }

    @Test fun allowsSymlinksWithinHome() {
        val home = home()
        val folder = File(home, "folder").apply { mkdir() }
        Files.createSymbolicLink(File(home, "link").toPath(), folder.toPath())
        val files = FolderFiles(home)
        files.upload("link", "new.txt", "data".byteInputStream())
        assertEquals("data", files.file("link/new.txt").readText())
    }

    @Test fun failedUploadRemovesPartialFileAndAllowsRetry() {
        val home = home()
        val files = FolderFiles(home)
        val broken = object : InputStream() {
            var reads = 0
            override fun read(): Int {
                if (++reads > 100) throw IOException("Read failed")
                return 42
            }
        }
        assertThrows(IOException::class.java) { files.upload("", "broken", broken) }
        assertFalse(File(home, "broken").exists())
        files.upload("", "broken", "retry".byteInputStream())
        assertEquals("retry", files.file("broken").readText())
    }

    @Test fun rejectsDirectoriesAsDownloadsAndFilesAsUploadDestinations() {
        val home = home()
        File(home, "file").writeText("keep")
        val files = FolderFiles(home)
        assertThrows(IllegalArgumentException::class.java) { files.file("") }
        assertThrows(IllegalArgumentException::class.java) { files.upload("file", "new", "data".byteInputStream()) }
        assertThrows(IOException::class.java) { files.list("missing") }
    }
}
