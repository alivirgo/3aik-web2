package com.nuc7.threeaikgpt

import android.content.ContentResolver
import android.net.Uri
import android.util.Base64
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.OutputStream

/**
 * A narrow, origin-scoped bridge for user-initiated blob downloads.
 *
 * It deliberately uses WebMessageListener rather than addJavascriptInterface. The JavaScript
 * object exists only on the exact HTTPS production origin and can only stream bytes into a file
 * location the user explicitly chooses through Android's document picker.
 */
class BlobDownloadBridge(
    private val contentResolver: ContentResolver,
    private val requestDestination: (SuggestedDownload) -> Unit,
    private val notify: (Notice) -> Unit,
) : WebViewCompat.WebMessageListener {

    data class SuggestedDownload(val filename: String, val mimeType: String)

    enum class Notice {
        SAVED,
        FAILED,
        TOO_LARGE,
        UNSUPPORTED,
    }

    private data class Offer(
        val id: String,
        val filename: String,
        val mimeType: String,
        val size: Long,
        val reply: JavaScriptReplyProxy,
    )

    private data class Active(
        val offer: Offer,
        val destination: Uri,
        val stream: OutputStream,
        var written: Long = 0,
    )

    private var pending: Offer? = null
    private var active: Active? = null

    val isSupported: Boolean
        get() = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)

    fun install(webView: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(
            webView,
            BRIDGE_NAME,
            setOf(OriginPolicy.APP_ORIGIN),
            this,
        )
    }

    fun injectDownloadHandler(webView: WebView) {
        if (!isSupported || OriginPolicy.classifyNavigation(webView.url.orEmpty()) != OriginPolicy.Navigation.INTERNAL) return
        webView.evaluateJavascript(INSTALL_SCRIPT, null)
    }

    fun onDestinationResult(destination: Uri?) {
        val offer = pending ?: return
        pending = null
        if (destination == null) {
            reply(offer.reply, "cancel", offer.id)
            return
        }

        val stream = runCatching { contentResolver.openOutputStream(destination, "w") }.getOrNull()
        if (stream == null) {
            reply(offer.reply, "cancel", offer.id)
            notify(Notice.FAILED)
            return
        }

        active = Active(offer, destination, stream)
        val binary = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)
        post(
            offer.reply,
            JSONObject()
                .put("type", "begin")
                .put("id", offer.id)
                .put("binary", binary)
                .toString(),
        )
    }

    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy,
    ) {
        if (!isMainFrame || sourceOrigin.toString() != OriginPolicy.APP_ORIGIN) return

        when (message.type) {
            WebMessageCompat.TYPE_ARRAY_BUFFER -> handleBinary(message.arrayBuffer, replyProxy)
            WebMessageCompat.TYPE_STRING -> handleControl(message.data.orEmpty(), replyProxy)
        }
    }

    fun close() {
        pending?.let { reply(it.reply, "cancel", it.id) }
        pending = null
        failActive(notifyUser = false)
    }

    private fun handleControl(raw: String, replyProxy: JavaScriptReplyProxy) {
        if (raw.length > MAX_CONTROL_MESSAGE_CHARS) return
        val message = runCatching { JSONObject(raw) }.getOrNull() ?: return
        if (message.optInt("v", PROTOCOL_VERSION) != PROTOCOL_VERSION) return

        when (message.optString("type")) {
            "offer" -> handleOffer(message, replyProxy)
            "chunk" -> handleBase64Chunk(message, replyProxy)
            "done" -> finish(message.optString("id"), replyProxy)
            "error" -> failActive(notifyUser = true)
        }
    }

    private fun handleOffer(message: JSONObject, replyProxy: JavaScriptReplyProxy) {
        val id = message.optString("id")
        val size = message.optLong("size", -1)
        if (!DownloadPolicy.isSafeBlobId(id)) return
        if (!DownloadPolicy.isSafeSize(size)) {
            reply(replyProxy, "cancel", id)
            notify(Notice.TOO_LARGE)
            return
        }
        if (pending != null || active != null) {
            reply(replyProxy, "cancel", id)
            return
        }

        val offer = Offer(
            id = id,
            filename = DownloadPolicy.safeFilename(message.optString("name")),
            mimeType = DownloadPolicy.safeMimeType(message.optString("mime")),
            size = size,
            reply = replyProxy,
        )
        pending = offer
        requestDestination(SuggestedDownload(offer.filename, offer.mimeType))
    }

    private fun handleBinary(bytes: ByteArray?, replyProxy: JavaScriptReplyProxy) {
        val activeDownload = active ?: return
        if (bytes == null || bytes.size > DownloadPolicy.MAX_CHUNK_BYTES) {
            failActive(notifyUser = true)
            return
        }
        writeChunk(activeDownload, bytes, replyProxy)
    }

    private fun handleBase64Chunk(message: JSONObject, replyProxy: JavaScriptReplyProxy) {
        val activeDownload = active ?: return
        if (message.optString("id") != activeDownload.offer.id) return
        val encoded = message.optString("data")
        if (encoded.length > MAX_BASE64_CHARS) {
            failActive(notifyUser = true)
            return
        }
        val bytes = runCatching { Base64.decode(encoded, Base64.NO_WRAP) }.getOrNull()
        if (bytes == null || bytes.size > DownloadPolicy.MAX_CHUNK_BYTES) {
            failActive(notifyUser = true)
            return
        }
        writeChunk(activeDownload, bytes, replyProxy)
    }

    private fun writeChunk(download: Active, bytes: ByteArray, replyProxy: JavaScriptReplyProxy) {
        val nextSize = download.written + bytes.size
        if (nextSize > download.offer.size || nextSize > DownloadPolicy.MAX_DOWNLOAD_BYTES) {
            failActive(notifyUser = true)
            return
        }
        try {
            download.stream.write(bytes)
            download.written = nextSize
            reply(replyProxy, "ack", download.offer.id)
        } catch (_: Exception) {
            failActive(notifyUser = true)
        }
    }

    private fun finish(id: String, replyProxy: JavaScriptReplyProxy) {
        val download = active ?: return
        if (id != download.offer.id || download.written != download.offer.size) {
            failActive(notifyUser = true)
            return
        }
        try {
            download.stream.flush()
            download.stream.close()
            active = null
            reply(replyProxy, "complete", id)
            notify(Notice.SAVED)
        } catch (_: Exception) {
            failActive(notifyUser = true)
        }
    }

    private fun failActive(notifyUser: Boolean) {
        val download = active
        active = null
        runCatching { download?.stream?.close() }
        if (download != null) {
            runCatching { contentResolver.delete(download.destination, null, null) }
            reply(download.offer.reply, "cancel", download.offer.id)
        }
        if (notifyUser) notify(Notice.FAILED)
    }

    private fun reply(proxy: JavaScriptReplyProxy, type: String, id: String) {
        post(proxy, JSONObject().put("type", type).put("id", id).toString())
    }

    private fun post(proxy: JavaScriptReplyProxy, message: String) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        runCatching { proxy.postMessage(message) }
    }

    companion object {
        private const val BRIDGE_NAME = "threeAikNativeDownloads"
        private const val PROTOCOL_VERSION = 1
        private const val MAX_CONTROL_MESSAGE_CHARS = 100_000
        private const val MAX_BASE64_CHARS = 90_000

        private val INSTALL_SCRIPT =
            """
            (() => {
              if (window.__threeAikNativeDownloadV1) return;
              const bridge = window.threeAikNativeDownloads;
              if (!bridge || typeof bridge.postMessage !== 'function') return;
              const pending = new Map();
              const maxBytes = 157286400;
              const chunkBytes = 49152;

              function post(value) { bridge.postMessage(JSON.stringify(Object.assign({v: 1}, value))); }
              function id() {
                if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
                return 'download_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
              }
              function filename(value) {
                const clean = String(value || '3aik-download').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-').trim();
                return clean.slice(0, 120) || '3aik-download';
              }
              function base64(bytes) {
                let binary = '';
                for (let index = 0; index < bytes.length; index += 8192) {
                  binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 8192));
                }
                return btoa(binary);
              }
              async function sendNext(entry) {
                if (!pending.has(entry.id)) return;
                if (entry.offset >= entry.blob.size) {
                  post({type: 'done', id: entry.id});
                  return;
                }
                const end = Math.min(entry.offset + chunkBytes, entry.blob.size);
                try {
                  const buffer = await entry.blob.slice(entry.offset, end).arrayBuffer();
                  entry.offset = end;
                  if (entry.binary) bridge.postMessage(buffer);
                  else post({type: 'chunk', id: entry.id, data: base64(new Uint8Array(buffer))});
                } catch (_) {
                  post({type: 'error', id: entry.id});
                  pending.delete(entry.id);
                }
              }

              bridge.onmessage = event => {
                let message;
                try { message = JSON.parse(String(event.data)); } catch (_) { return; }
                const entry = pending.get(message.id);
                if (!entry) return;
                if (message.type === 'begin') {
                  entry.binary = message.binary === true;
                  sendNext(entry);
                } else if (message.type === 'ack') {
                  sendNext(entry);
                } else if (message.type === 'cancel' || message.type === 'complete') {
                  pending.delete(message.id);
                }
              };

              document.addEventListener('click', async event => {
                const target = event.target;
                const anchor = target && target.closest ? target.closest('a[download]') : null;
                if (!anchor || !String(anchor.href).startsWith('blob:')) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                const downloadId = id();
                try {
                  const response = await fetch(anchor.href);
                  const blob = await response.blob();
                  if (blob.size > maxBytes) {
                    post({type: 'offer', id: downloadId, name: filename(anchor.download), mime: blob.type, size: blob.size});
                    return;
                  }
                  pending.set(downloadId, {id: downloadId, blob: blob, offset: 0, binary: false});
                  post({type: 'offer', id: downloadId, name: filename(anchor.download), mime: blob.type, size: blob.size});
                } catch (_) {
                  post({type: 'error', id: downloadId});
                }
              }, true);

              window.__threeAikNativeDownloadV1 = true;
            })();
            """.trimIndent()
    }
}
