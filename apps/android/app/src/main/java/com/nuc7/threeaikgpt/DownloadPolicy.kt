package com.nuc7.threeaikgpt

import java.util.Locale

object DownloadPolicy {
    const val MAX_DOWNLOAD_BYTES = 150L * 1024L * 1024L
    const val MAX_CHUNK_BYTES = 64 * 1024

    private val invalidFilenameCharacters = Regex("""[\x00-\x1F\x7F<>:"/\\|?*]""")
    private val repeatedWhitespace = Regex("\\s+")
    private val safeMime = Regex("^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+\\-]{0,126}/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+\\-]{0,126}(?:;.*)?$")

    fun safeFilename(candidate: String?, fallback: String = "3aik-download"): String {
        val cleaned = candidate.orEmpty()
            .replace(invalidFilenameCharacters, "-")
            .replace(repeatedWhitespace, " ")
            .trim(' ', '.')
            .take(120)
        val usable = cleaned.isNotBlank() && cleaned != "." && cleaned != ".."
        return if (usable) cleaned else fallback
    }

    fun safeMimeType(candidate: String?): String {
        val normalized = candidate.orEmpty().trim().lowercase(Locale.ROOT)
        return if (safeMime.matches(normalized)) normalized.substringBefore(';') else "application/octet-stream"
    }

    fun isSafeBlobId(candidate: String?): Boolean =
        candidate != null && candidate.length in 8..80 && candidate.all { it.isLetterOrDigit() || it == '-' || it == '_' }

    fun isSafeSize(size: Long): Boolean = size in 0..MAX_DOWNLOAD_BYTES
}
