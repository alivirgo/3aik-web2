package com.nuc7.threeaikgpt

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Static regression coverage for security-sensitive Android/WebView integration. */
class LocalDataClearContractTest {
    private val source: String by lazy {
        sequenceOf(
            File("src/main/java/com/nuc7/threeaikgpt/MainActivity.kt"),
            File("app/src/main/java/com/nuc7/threeaikgpt/MainActivity.kt"),
        ).first(File::isFile).readText()
    }

    @Test
    fun `complete browsing deletion remains feature gated and legacy API stays absent`() {
        assertTrue(source.contains("WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)"))
        assertTrue(source.contains("WebStorageCompat.deleteBrowsingData(WebStorage.getInstance())"))
        assertFalse(source.contains(".deleteAllData()"))
    }

    @Test
    fun `unsupported provider uses complete Android app-data erasure`() {
        assertTrue(source.contains("confirmFullAppDataFallback()"))
        assertTrue(source.contains("clearApplicationUserData()"))
    }

    @Test
    fun `success and reload are driven by the complete deletion callback`() {
        val deletionCall = source.indexOf("WebStorageCompat.deleteBrowsingData(WebStorage.getInstance()) {")
        val callbackEnd = source.indexOf("                }\n            } catch", startIndex = deletionCall)
        val reload = source.indexOf("createAndLoadWebView(null)", startIndex = deletionCall)
        val success = source.indexOf("showMessage(R.string.data_cleared)", startIndex = deletionCall)

        assertTrue(deletionCall >= 0)
        assertTrue(callbackEnd > deletionCall)
        assertTrue(reload in (deletionCall + 1)..<callbackEnd)
        assertTrue(success in (deletionCall + 1)..<callbackEnd)
    }
}
