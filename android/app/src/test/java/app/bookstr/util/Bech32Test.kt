package app.bookstr.util

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class Bech32Test {
    @Test
    fun roundTripNpub() {
        val hex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"
        val bytes = hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        val npub = Bech32.encode("npub", bytes)
        assertTrue(npub.startsWith("npub1"))
        val decoded = Bech32.decode("npub", npub)
        assertArrayEquals(bytes, decoded)
    }

    @Test
    fun decodeKnownNpub() {
        // fiatjaf's well-known pubkey
        val npub = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"
        val decoded = Bech32.decode("npub", npub)
        assertEquals(32, decoded.size)
        val hex = decoded.joinToString("") { "%02x".format(it) }
        assertEquals("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d", hex)
    }
}
