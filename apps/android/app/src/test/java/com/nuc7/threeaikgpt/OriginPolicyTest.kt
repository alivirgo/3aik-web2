package com.nuc7.threeaikgpt

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OriginPolicyTest {
    @Test
    fun `allows only the exact production HTTPS origin internally`() {
        assertEquals(OriginPolicy.Navigation.INTERNAL, OriginPolicy.classifyNavigation("https://3aik.com/"))
        assertEquals(OriginPolicy.Navigation.INTERNAL, OriginPolicy.classifyNavigation(OriginPolicy.PRIVACY_URL))
        assertEquals(OriginPolicy.Navigation.INTERNAL, OriginPolicy.classifyNavigation("https://3AIK.com/chat?q=1#answer"))
        assertEquals(OriginPolicy.Navigation.INTERNAL, OriginPolicy.classifyNavigation("https://3aik.com.:443/"))
    }

    @Test
    fun `keeps other HTTPS destinations external`() {
        assertEquals(OriginPolicy.Navigation.EXTERNAL_HTTPS, OriginPolicy.classifyNavigation("https://github.com/alivirgo/3aik-web2"))
        assertEquals(OriginPolicy.Navigation.EXTERNAL_HTTPS, OriginPolicy.classifyNavigation("https://evil3aik.com/"))
        assertEquals(OriginPolicy.Navigation.EXTERNAL_HTTPS, OriginPolicy.classifyNavigation("https://3aik.com.evil.example/"))
        assertEquals(OriginPolicy.Navigation.EXTERNAL_HTTPS, OriginPolicy.classifyNavigation("https://3aik.com:8443/"))
    }

    @Test
    fun `blocks cleartext active and ambiguous schemes`() {
        listOf(
            "http://3aik.com/",
            "javascript:alert(1)",
            "intent://3aik.com/#Intent;scheme=https;end",
            "file:///etc/passwd",
            "content://example/private",
            "https://user@3aik.com/",
            "not a url",
        ).forEach { assertEquals(it, OriginPolicy.Navigation.BLOCKED, OriginPolicy.classifyNavigation(it)) }
    }

    @Test
    fun `allows constrained email handoff`() {
        assertEquals(OriginPolicy.Navigation.EXTERNAL_EMAIL, OriginPolicy.classifyNavigation("mailto:hello@example.com?subject=3aik"))
        assertEquals(OriginPolicy.Navigation.BLOCKED, OriginPolicy.classifyNavigation("mailto:"))
    }

    @Test
    fun `subresources are limited to the app origin and its origin-bound blobs`() {
        assertTrue(OriginPolicy.isAllowedSubresource("https://3aik.com/style.css"))
        assertTrue(OriginPolicy.isAllowedSubresource("blob:https://3aik.com/4dbb95a0"))
        assertTrue(OriginPolicy.isAllowedSubresource("data:image/png;base64,AA=="))
        assertFalse(OriginPolicy.isAllowedSubresource("https://analytics.example/script.js"))
        assertFalse(OriginPolicy.isAllowedSubresource("https://3aik.com.evil.example/redirected.js"))
        assertFalse(OriginPolicy.isAllowedSubresource("blob:https://evil.example/id"))
        assertFalse(OriginPolicy.isAllowedSubresource("data:text/html,<script>alert(1)</script>"))
        assertFalse(OriginPolicy.isAllowedSubresource("http://3aik.com/style.css"))
    }
}
