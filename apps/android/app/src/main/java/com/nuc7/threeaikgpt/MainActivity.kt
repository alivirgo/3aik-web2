package com.nuc7.threeaikgpt

import android.annotation.SuppressLint
import android.app.Activity
import android.app.ActivityManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.DialogInterface
import android.content.Intent
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.provider.Browser
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewDatabase
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.edit
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.webkit.SafeBrowsingResponseCompat
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebStorageCompat
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebResourceErrorCompat
import android.webkit.RenderProcessGoneDetail
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import com.nuc7.threeaikgpt.databinding.ActivityMainBinding
import java.io.ByteArrayInputStream
import java.util.Locale
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private var webView: WebView? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var lastMainFrameFailed = false

    private val downloadExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "3aik-download").apply { isDaemon = true }
    }
    private lateinit var blobDownloads: BlobDownloadBridge
    private lateinit var httpDownloader: SafeHttpDownloader
    private var pendingSave: PendingSave? = null

    private sealed interface PendingSave {
        data object Blob : PendingSave
        data class Http(
            val url: String,
            val userAgent: String,
            val cookies: String?,
        ) : PendingSave
    }

    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = filePathCallback ?: return@registerForActivityResult
        filePathCallback = null
        val selected = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            ?.filter { it.scheme == "content" }
            ?.take(MAX_FILE_SELECTIONS)
            ?.toTypedArray()
        callback.onReceiveValue(selected?.takeIf { it.isNotEmpty() })
    }

    private val createDocument = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val save = pendingSave
        pendingSave = null
        val destination = result.data?.data?.takeIf { result.resultCode == Activity.RESULT_OK && it.scheme == "content" }
        when (save) {
            PendingSave.Blob -> blobDownloads.onDestinationResult(destination)
            is PendingSave.Http -> if (destination != null) {
                httpDownloader.start(
                    SafeHttpDownloader.Request(
                        url = save.url,
                        destination = destination,
                        userAgent = save.userAgent,
                        cookies = save.cookies,
                    ),
                )
            }
            null -> Unit
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        configureWindowInsets()
        configureToolbar()
        configureDownloads()
        configureServiceWorkers()
        binding.retryButton.setOnClickListener { retry() }

        createAndLoadWebView(savedInstanceState?.getBundle(KEY_WEBVIEW_STATE))
        configureBackNavigation()
        showOnboardingIfNeeded()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        val webState = Bundle()
        webView?.saveState(webState)
        outState.putBundle(KEY_WEBVIEW_STATE, webState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        blobDownloads.close()
        downloadExecutor.shutdownNow()
        webView?.let { view ->
            binding.webContainer.removeView(view)
            view.stopLoading()
            view.webChromeClient = null
            view.destroy()
        }
        webView = null
        super.onDestroy()
    }

    private fun configureWindowInsets() {
        WindowCompat.enableEdgeToEdge(window)
        WindowCompat.getInsetsController(window, binding.root).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
    }

    private fun configureToolbar() {
        binding.toolbar.inflateMenu(R.menu.main_menu)
        binding.toolbar.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                R.id.action_reload -> {
                    retry()
                    true
                }
                R.id.action_browser -> {
                    confirmExternal(OriginPolicy.START_URL, isEmail = false)
                    true
                }
                R.id.action_privacy -> {
                    showPrivacyDialog()
                    true
                }
                R.id.action_about -> {
                    showAboutDialog()
                    true
                }
                else -> false
            }
        }
    }

    private fun configureDownloads() {
        blobDownloads = BlobDownloadBridge(
            contentResolver = contentResolver,
            requestDestination = request@{ suggested ->
                if (pendingSave != null) return@request
                pendingSave = PendingSave.Blob
                launchCreateDocument(suggested.filename, suggested.mimeType)
            },
            notify = { notice ->
                runOnUiThread {
                    when (notice) {
                        BlobDownloadBridge.Notice.SAVED -> showMessage(getString(R.string.download_saved, "file"))
                        BlobDownloadBridge.Notice.FAILED -> showMessage(R.string.download_failed)
                        BlobDownloadBridge.Notice.TOO_LARGE -> showMessage(R.string.download_too_large)
                        BlobDownloadBridge.Notice.UNSUPPORTED -> showMessage(R.string.download_unavailable)
                    }
                }
            },
        )
        httpDownloader = SafeHttpDownloader(contentResolver, downloadExecutor) { result ->
            runOnUiThread {
                when (result) {
                    SafeHttpDownloader.Result.SAVED -> showMessage(getString(R.string.download_saved, "file"))
                    SafeHttpDownloader.Result.FAILED -> showMessage(R.string.download_failed)
                    SafeHttpDownloader.Result.TOO_LARGE -> showMessage(R.string.download_too_large)
                }
            }
        }
    }

    private fun configureServiceWorkers() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) return
        val controller = ServiceWorkerControllerCompat.getInstance()
        val settings = controller.serviceWorkerWebSettings
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_FILE_ACCESS)) {
            settings.allowFileAccess = false
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_CONTENT_ACCESS)) {
            settings.allowContentAccess = false
        }
        controller.setServiceWorkerClient(object : ServiceWorkerClientCompat() {
            override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                if (OriginPolicy.isAllowedSubresource(request.url.toString())) null else blockedResponse()
        })
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Suppress("DEPRECATION")
    private fun createAndLoadWebView(restoredState: Bundle?) {
        if (webView != null) return
        val view = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }
        webView = view
        binding.webContainer.addView(view)

        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            loadsImagesAutomatically = true
            blockNetworkImage = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            setGeolocationEnabled(false)
            mediaPlaybackRequiresUserGesture = true
            builtInZoomControls = true
            displayZoomControls = false
            textZoom = 100
            saveFormData = false
            safeBrowsingEnabled = true
            userAgentString = "$userAgentString 3aikGPTAndroid/${BuildConfig.VERSION_NAME}"
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(view, false)
        }

        blobDownloads.install(view)
        view.webViewClient = SecureWebViewClient()
        view.webChromeClient = SecureWebChromeClient()
        view.setDownloadListener { url, userAgent, contentDisposition, mimeType, contentLength ->
            handleDownload(url, userAgent, contentDisposition, mimeType, contentLength)
        }

        val restored = restoredState != null && view.restoreState(restoredState) != null
        if (!restored) view.loadUrl(OriginPolicy.START_URL)
    }

    private fun configureBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val view = webView
                if (view?.canGoBack() == true) {
                    view.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    private fun launchFilePicker(params: WebChromeClient.FileChooserParams, callback: ValueCallback<Array<Uri>>) {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = callback

        val accepted = params.acceptTypes
            .flatMap { it.split(',') }
            .mapNotNull(::normalizeMimeType)
            .distinct()
            .take(MAX_ACCEPT_TYPES)

        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = accepted.singleOrNull() ?: "*/*"
            if (accepted.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, accepted.toTypedArray())
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            filePicker.launch(intent)
        } catch (_: ActivityNotFoundException) {
            filePathCallback = null
            callback.onReceiveValue(null)
            showMessage(R.string.no_handler)
        }
    }

    private fun normalizeMimeType(candidate: String): String? {
        val value = candidate.trim().lowercase(Locale.ROOT)
        if (value == "*/*") return value
        if (MIME_PATTERN.matches(value)) return value
        if (value.startsWith('.') && value.length <= 12) {
            return android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(value.drop(1))
        }
        return null
    }

    private fun handleNavigation(url: String, isMainFrame: Boolean, hasGesture: Boolean): Boolean {
        return when (OriginPolicy.classifyNavigation(url)) {
            OriginPolicy.Navigation.INTERNAL -> false
            OriginPolicy.Navigation.EXTERNAL_HTTPS -> {
                if (isMainFrame && hasGesture) confirmExternal(url, isEmail = false) else showMessage(R.string.blocked_link)
                true
            }
            OriginPolicy.Navigation.EXTERNAL_EMAIL -> {
                if (isMainFrame && hasGesture) confirmExternal(url, isEmail = true) else showMessage(R.string.blocked_link)
                true
            }
            OriginPolicy.Navigation.BLOCKED -> {
                if (isMainFrame) showMessage(R.string.blocked_link)
                true
            }
        }
    }

    private fun confirmExternal(url: String, isEmail: Boolean) {
        val display = if (isEmail) url.removePrefix("mailto:").substringBefore('?') else OriginPolicy.displayHost(url) ?: return
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.external_title)
            .setMessage(getString(if (isEmail) R.string.external_mail_message else R.string.external_message, display))
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.open) { _, _ -> openExternal(url, isEmail) }
            .show()
    }

    private fun openExternal(url: String, isEmail: Boolean) {
        val intent = Intent(if (isEmail) Intent.ACTION_SENDTO else Intent.ACTION_VIEW, url.toUri()).apply {
            if (!isEmail) {
                addCategory(Intent.CATEGORY_BROWSABLE)
                putExtra(Browser.EXTRA_APPLICATION_ID, packageName)
            }
        }
        try {
            startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            showMessage(R.string.no_handler)
        }
    }

    private fun handleDownload(
        url: String,
        userAgent: String,
        contentDisposition: String?,
        mimeType: String?,
        contentLength: Long,
    ) {
        if (url.startsWith("blob:", ignoreCase = true)) {
            showMessage(R.string.download_unavailable)
            return
        }
        when (OriginPolicy.classifyNavigation(url)) {
            OriginPolicy.Navigation.INTERNAL -> {
                if (pendingSave != null) return
                if (contentLength > DownloadPolicy.MAX_DOWNLOAD_BYTES) {
                    showMessage(R.string.download_too_large)
                    return
                }
                val filename = DownloadPolicy.safeFilename(URLUtil.guessFileName(url, contentDisposition, mimeType))
                val safeMime = DownloadPolicy.safeMimeType(mimeType)
                pendingSave = PendingSave.Http(
                    url = url,
                    userAgent = userAgent.ifBlank { webView?.settings?.userAgentString.orEmpty() },
                    cookies = CookieManager.getInstance().getCookie(url),
                )
                launchCreateDocument(filename, safeMime)
            }
            OriginPolicy.Navigation.EXTERNAL_HTTPS -> confirmExternal(url, isEmail = false)
            else -> showMessage(R.string.blocked_link)
        }
    }

    private fun launchCreateDocument(filename: String, mimeType: String) {
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = DownloadPolicy.safeMimeType(mimeType)
            putExtra(Intent.EXTRA_TITLE, DownloadPolicy.safeFilename(filename))
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        try {
            createDocument.launch(intent)
        } catch (_: ActivityNotFoundException) {
            when (pendingSave) {
                PendingSave.Blob -> blobDownloads.onDestinationResult(null)
                else -> Unit
            }
            pendingSave = null
            showMessage(R.string.no_handler)
        }
    }

    private fun retry() {
        hideError()
        lastMainFrameFailed = false
        val current = webView
        if (current == null) {
            createAndLoadWebView(null)
        } else if (OriginPolicy.classifyNavigation(current.url.orEmpty()) == OriginPolicy.Navigation.INTERNAL) {
            current.reload()
        } else {
            current.loadUrl(OriginPolicy.START_URL)
        }
    }

    private fun showError(offline: Boolean) {
        lastMainFrameFailed = true
        binding.progress.isVisible = false
        binding.errorTitle.setText(if (offline) R.string.error_title_offline else R.string.error_title_unavailable)
        binding.errorMessage.setText(if (offline) R.string.error_message_offline else R.string.error_message_generic)
        binding.errorPanel.isVisible = true
        binding.toolbar.setSubtitle(if (offline) R.string.toolbar_subtitle_offline else R.string.toolbar_subtitle_secure)
    }

    private fun hideError() {
        binding.errorPanel.isVisible = false
        binding.toolbar.setSubtitle(R.string.toolbar_subtitle_secure)
    }

    private fun isOffline(): Boolean {
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return true
        return !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun showOnboardingIfNeeded() {
        val preferences = getSharedPreferences(NATIVE_PREFERENCES, MODE_PRIVATE)
        if (preferences.getBoolean(KEY_ONBOARDING_COMPLETE, false)) return
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.onboarding_title)
            .setMessage(R.string.onboarding_message)
            .setCancelable(false)
            .setPositiveButton(R.string.onboarding_accept) { _, _ ->
                preferences.edit { putBoolean(KEY_ONBOARDING_COMPLETE, true) }
            }
            .show()
    }

    private fun showPrivacyDialog() {
        val dialog = MaterialAlertDialogBuilder(this)
            .setTitle(R.string.privacy_title)
            .setMessage(R.string.privacy_message)
            .setNegativeButton(R.string.close, null)
            .setNeutralButton(R.string.view_privacy_policy) { _, _ ->
                confirmExternal(OriginPolicy.PRIVACY_URL, isEmail = false)
            }
            .setPositiveButton(R.string.clear_local_data, null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(DialogInterface.BUTTON_POSITIVE).setOnClickListener {
                dialog.dismiss()
                confirmClearLocalData()
            }
        }
        dialog.show()
    }

    private fun confirmClearLocalData() {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.clear_confirm_title)
            .setMessage(R.string.clear_confirm_message)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.clear_confirm_action) { _, _ -> clearLocalWebData() }
            .show()
    }

    private fun clearLocalWebData() {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)) {
            discardCurrentWebView()
            WebViewDatabase.getInstance(this).apply {
                clearHttpAuthUsernamePassword()
            }

            try {
                WebStorageCompat.deleteBrowsingData(WebStorage.getInstance()) {
                    if (isFinishing || isDestroyed) return@deleteBrowsingData
                    hideError()
                    createAndLoadWebView(null)
                    showMessage(R.string.data_cleared)
                }
            } catch (_: UnsupportedOperationException) {
                // The provider can change between feature detection and invocation.
                createAndLoadWebView(null)
                confirmFullAppDataFallback()
            }
        } else {
            confirmFullAppDataFallback()
        }
    }

    private fun discardCurrentWebView() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        pendingSave = null
        blobDownloads.close()

        val view = webView ?: return
        webView = null
        binding.webContainer.removeView(view)
        view.stopLoading()
        view.clearHistory()
        view.clearSslPreferences()
        view.webChromeClient = null
        view.destroy()
    }

    private fun confirmFullAppDataFallback() {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.clear_fallback_title)
            .setMessage(R.string.clear_fallback_message)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.clear_fallback_action) { _, _ ->
                val manager = getSystemService(ActivityManager::class.java)
                if (!manager.clearApplicationUserData()) showMessage(R.string.data_clear_failed)
            }
            .show()
    }

    private fun showAboutDialog() {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.about_title)
            .setMessage(getString(R.string.about_message, BuildConfig.VERSION_NAME.removeSuffix("-debug")))
            .setPositiveButton(R.string.close, null)
            .show()
    }

    private fun showMessage(message: Int) = showMessage(getString(message))

    private fun showMessage(message: String) {
        Snackbar.make(binding.root, message, Snackbar.LENGTH_LONG).show()
    }

    private fun blockedResponse(): WebResourceResponse = WebResourceResponse(
        "text/plain",
        Charsets.UTF_8.name(),
        403,
        "Blocked by 3aikGPT origin policy",
        mapOf("Cache-Control" to "no-store"),
        ByteArrayInputStream(ByteArray(0)),
    )

    private inner class SecureWebChromeClient : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            binding.progress.isIndeterminate = false
            binding.progress.progress = newProgress
            binding.progress.isVisible = newProgress in 0..99 && !binding.errorPanel.isVisible
        }

        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams,
        ): Boolean {
            launchFilePicker(fileChooserParams, filePathCallback)
            return true
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            request.deny()
            showMessage(R.string.permission_denied)
        }

        override fun onGeolocationPermissionsShowPrompt(
            origin: String?,
            callback: GeolocationPermissions.Callback,
        ) {
            callback.invoke(origin, false, false)
        }

        override fun onCreateWindow(
            view: WebView,
            isDialog: Boolean,
            isUserGesture: Boolean,
            resultMsg: android.os.Message,
        ): Boolean = false
    }

    // AndroidX lint 1.17 does not recognize the implemented framework callback below.
    @SuppressLint("MissingOnRenderProcessGone")
    private inner class SecureWebViewClient : WebViewClientCompat() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            handleNavigation(request.url.toString(), request.isForMainFrame, request.hasGesture())

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            if (OriginPolicy.isAllowedSubresource(request.url.toString())) null else blockedResponse()

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            if (OriginPolicy.classifyNavigation(url) != OriginPolicy.Navigation.INTERNAL) {
                view.stopLoading()
                showError(offline = false)
                return
            }
            lastMainFrameFailed = false
            binding.progress.isIndeterminate = true
            binding.progress.isVisible = true
        }

        override fun onLoadResource(view: WebView, url: String) {
            // shouldInterceptRequest does not expose every redirect hop on every WebView version.
            // Stop the document as a second line of defense if a final resource URL is surfaced.
            if (!OriginPolicy.isAllowedSubresource(url)) {
                view.stopLoading()
                showError(offline = false)
            }
        }

        override fun onPageFinished(view: WebView, url: String) {
            binding.progress.isVisible = false
            if (!lastMainFrameFailed && OriginPolicy.classifyNavigation(url) == OriginPolicy.Navigation.INTERNAL) {
                hideError()
                blobDownloads.injectDownloadHandler(view)
            }
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceErrorCompat) {
            if (request.isForMainFrame) showError(isOffline())
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
            if (request.isForMainFrame && errorResponse.statusCode >= 400) showError(offline = false)
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
            showError(offline = false)
            showMessage(R.string.certificate_error)
        }

        override fun onSafeBrowsingHit(
            view: WebView,
            request: WebResourceRequest,
            threatType: Int,
            callback: SafeBrowsingResponseCompat,
        ) {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_RESPONSE_BACK_TO_SAFETY)) {
                callback.backToSafety(true)
            } else {
                view.stopLoading()
                view.loadUrl("about:blank")
            }
            showMessage(R.string.unsafe_page_blocked)
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            filePathCallback?.onReceiveValue(null)
            filePathCallback = null
            if (pendingSave == PendingSave.Blob) pendingSave = null
            blobDownloads.close()
            if (webView === view) webView = null
            binding.webContainer.removeView(view)
            view.destroy()
            showError(offline = false)
            return true
        }
    }

    companion object {
        private const val KEY_WEBVIEW_STATE = "webview_state"
        private const val NATIVE_PREFERENCES = "native_ui"
        private const val KEY_ONBOARDING_COMPLETE = "onboarding_complete_v1"
        private const val MAX_FILE_SELECTIONS = 8
        private const val MAX_ACCEPT_TYPES = 16
        private val MIME_PATTERN = Regex("^[a-z0-9][a-z0-9!#$&^_.+\\-]{0,126}/(?:[a-z0-9][a-z0-9!#$&^_.+\\-]{0,126}|\\*)$")
    }
}
