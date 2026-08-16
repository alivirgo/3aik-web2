package com.nuc7.threeaikgpt

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadPolicyTest {
    @Test
    fun `filename strips traversal controls and reserved characters`() {
        assertEquals("-..-secret-name-.json", DownloadPolicy.safeFilename("../../secret\\name?.json"))
        assertEquals("3aik-download", DownloadPolicy.safeFilename(" . "))
        assertFalse(DownloadPolicy.safeFilename("x".repeat(200)).length > 120)
    }

    @Test
    fun `mime types are constrained`() {
        assertEquals("image/png", DownloadPolicy.safeMimeType("Image/PNG"))
        assertEquals("text/markdown", DownloadPolicy.safeMimeType("text/markdown;charset=utf-8"))
        assertEquals("application/octet-stream", DownloadPolicy.safeMimeType("text/plain\r\nX-Evil: yes"))
    }

    @Test
    fun `blob identifiers and sizes are bounded`() {
        assertTrue(DownloadPolicy.isSafeBlobId("download_123-abc"))
        assertFalse(DownloadPolicy.isSafeBlobId("short"))
        assertFalse(DownloadPolicy.isSafeBlobId("download/escape"))
        assertTrue(DownloadPolicy.isSafeSize(DownloadPolicy.MAX_DOWNLOAD_BYTES))
        assertFalse(DownloadPolicy.isSafeSize(DownloadPolicy.MAX_DOWNLOAD_BYTES + 1))
        assertFalse(DownloadPolicy.isSafeSize(-1))
    }
}
