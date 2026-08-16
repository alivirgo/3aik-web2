package com.nuc7.threeaikgpt

import java.net.IDN
import java.net.URI
import java.util.Locale

/** Central URL policy shared by navigation, subresources, downloads, and tests. */
object OriginPolicy {
    const val APP_ORIGIN = "https://3aik.com"
    const val START_URL = "$APP_ORIGIN/"
    const val PRIVACY_URL = "$APP_ORIGIN/privacy"

    enum class Navigation {
        INTERNAL,
        EXTERNAL_HTTPS,
        EXTERNAL_EMAIL,
        BLOCKED,
    }

    fun classifyNavigation(rawUrl: String): Navigation {
        val uri = parse(rawUrl) ?: return Navigation.BLOCKED
        if (uri.rawUserInfo != null) return Navigation.BLOCKED
        return when (uri.scheme?.lowercase(Locale.ROOT)) {
            "https" -> if (isExactAppOrigin(uri)) Navigation.INTERNAL else Navigation.EXTERNAL_HTTPS
            "mailto" -> if (isSafeMailto(uri)) Navigation.EXTERNAL_EMAIL else Navigation.BLOCKED
            else -> Navigation.BLOCKED
        }
    }

    fun isAllowedSubresource(rawUrl: String): Boolean {
        val uri = parse(rawUrl) ?: return false
        return when (uri.scheme?.lowercase(Locale.ROOT)) {
            "https" -> isExactAppOrigin(uri)
            // These schemes do not create cleartext network requests. Blob URLs retain the
            // creator origin, and data URLs are used only as in-document resources.
            "blob" -> rawUrl.startsWith("blob:$APP_ORIGIN/", ignoreCase = true)
            "data" -> rawUrl.startsWith("data:image/", ignoreCase = true)
            else -> false
        }
    }

    fun displayHost(rawUrl: String): String? {
        val uri = parse(rawUrl) ?: return null
        return normalizedHost(uri)
    }

    private fun isExactAppOrigin(uri: URI): Boolean {
        if (uri.rawUserInfo != null || uri.rawFragment?.contains('\u0000') == true) return false
        val port = uri.port
        if (port != -1 && port != 443) return false
        return normalizedHost(uri) == "3aik.com"
    }

    private fun normalizedHost(uri: URI): String? {
        val rawHost = uri.host?.trimEnd('.') ?: return null
        return runCatching { IDN.toASCII(rawHost, IDN.USE_STD3_ASCII_RULES) }
            .getOrNull()
            ?.lowercase(Locale.ROOT)
    }

    private fun isSafeMailto(uri: URI): Boolean {
        if (uri.rawSchemeSpecificPart.isNullOrBlank()) return false
        val address = uri.rawSchemeSpecificPart.substringBefore('?')
        return address.length <= 320 && '@' in address && !address.any { it.isISOControl() }
    }

    private fun parse(rawUrl: String): URI? {
        if (rawUrl.isBlank() || rawUrl.length > 8_192 || rawUrl.any { it == '\u0000' }) return null
        return runCatching { URI(rawUrl) }.getOrNull()
    }
}
