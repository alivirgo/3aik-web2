package com.nuc7.threeaikgpt

import android.content.ContentResolver
import android.net.Uri
import java.net.URI
import java.net.URL
import java.util.concurrent.ExecutorService
import javax.net.ssl.HttpsURLConnection

/** Streams only same-origin HTTPS downloads into a user-selected document. */
class SafeHttpDownloader(
    private val contentResolver: ContentResolver,
    private val executor: ExecutorService,
    private val deliverResult: (Result) -> Unit,
) {
    enum class Result {
        SAVED,
        FAILED,
        TOO_LARGE,
    }

    data class Request(
        val url: String,
        val destination: Uri,
        val userAgent: String,
        val cookies: String?,
    )

    fun start(request: Request) {
        executor.execute {
            val result = runCatching { download(request) }.getOrElse { Result.FAILED }
            if (result != Result.SAVED) {
                runCatching { contentResolver.delete(request.destination, null, null) }
            }
            deliverResult(result)
        }
    }

    private fun download(request: Request): Result {
        var current = URI(request.url)
        repeat(MAX_REDIRECTS + 1) { redirectCount ->
            if (OriginPolicy.classifyNavigation(current.toString()) != OriginPolicy.Navigation.INTERNAL) return Result.FAILED
            val connection = URL(current.toASCIIString()).openConnection() as? HttpsURLConnection ?: return Result.FAILED
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = CONNECT_TIMEOUT_MS
                connection.readTimeout = READ_TIMEOUT_MS
                connection.requestMethod = "GET"
                connection.setRequestProperty("Accept", "*/*")
                connection.setRequestProperty("User-Agent", request.userAgent)
                request.cookies?.takeIf { it.isNotBlank() }?.let { connection.setRequestProperty("Cookie", it) }
                connection.connect()

                if (connection.responseCode in 300..399) {
                    if (redirectCount == MAX_REDIRECTS) return Result.FAILED
                    val location = connection.getHeaderField("Location") ?: return Result.FAILED
                    current = current.resolve(location)
                    return@repeat
                }
                if (connection.responseCode !in 200..299) return Result.FAILED

                val declaredLength = connection.contentLengthLong
                if (declaredLength > DownloadPolicy.MAX_DOWNLOAD_BYTES) return Result.TOO_LARGE

                val output = contentResolver.openOutputStream(request.destination, "w") ?: return Result.FAILED
                output.use { destination ->
                    connection.inputStream.use { source ->
                        val buffer = ByteArray(64 * 1024)
                        var total = 0L
                        while (true) {
                            val count = source.read(buffer)
                            if (count < 0) break
                            total += count
                            if (total > DownloadPolicy.MAX_DOWNLOAD_BYTES) return Result.TOO_LARGE
                            destination.write(buffer, 0, count)
                        }
                        destination.flush()
                    }
                }
                return Result.SAVED
            } finally {
                connection.disconnect()
            }
        }
        return Result.FAILED
    }

    companion object {
        private const val MAX_REDIRECTS = 5
        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val READ_TIMEOUT_MS = 60_000
    }
}
