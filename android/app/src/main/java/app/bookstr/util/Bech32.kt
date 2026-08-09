package app.bookstr.util

object Bech32 {
    private const val CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
    private val GENERATOR = intArrayOf(0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3)

    fun decode(hrp: String, input: String): ByteArray {
        val lower = input.lowercase()
        val pos = lower.lastIndexOf('1')
        require(pos >= 1) { "Invalid bech32 string" }
        require(lower.substring(0, pos) == hrp) { "Invalid HRP" }

        val dataPart = lower.substring(pos + 1)
        require(dataPart.length >= 6) { "Invalid bech32 string" }
        val values = IntArray(dataPart.length)
        for (i in dataPart.indices) {
            val idx = CHARSET.indexOf(dataPart[i])
            require(idx >= 0) { "Invalid bech32 character" }
            values[i] = idx
        }
        require(verifyChecksum(hrp, values)) { "Invalid bech32 checksum" }

        val payload = values.copyOf(values.size - 6)
        return convertBits(payload, 5, 8, false)
    }

    fun encode(hrp: String, data: ByteArray): String {
        val values = convertBitsToInt(data, 8, 5, true)
        val checksum = createChecksum(hrp, values)
        val combined = values + checksum
        return buildString {
            append(hrp)
            append('1')
            for (v in combined) {
                append(CHARSET[v])
            }
        }
    }

    private fun verifyChecksum(hrp: String, values: IntArray): Boolean =
        polymod(hrpExpand(hrp) + values.toList()) == 1

    private fun createChecksum(hrp: String, values: IntArray): IntArray {
        val polymod = polymod(hrpExpand(hrp) + values.toList() + listOf(0, 0, 0, 0, 0, 0)) xor 1
        return IntArray(6) { i -> (polymod shr (5 * (5 - i))) and 31 }
    }

    private fun hrpExpand(hrp: String): List<Int> {
        val result = mutableListOf<Int>()
        for (c in hrp) {
            result.add(c.code shr 5)
        }
        result.add(0)
        for (c in hrp) {
            result.add(c.code and 31)
        }
        return result
    }

    private fun polymod(values: List<Int>): Int {
        var chk = 1
        for (v in values) {
            val top = chk shr 25
            chk = ((chk and 0x1ffffff) shl 5) xor v
            for (i in 0..4) {
                if (((top shr i) and 1) == 1) {
                    chk = chk xor GENERATOR[i]
                }
            }
        }
        return chk
    }

    private fun convertBits(data: IntArray, fromBits: Int, toBits: Int, pad: Boolean): ByteArray {
        var acc = 0
        var bits = 0
        val maxv = (1 shl toBits) - 1
        val result = mutableListOf<Int>()
        for (value in data) {
            acc = (acc shl fromBits) or value
            bits += fromBits
            while (bits >= toBits) {
                bits -= toBits
                result.add((acc shr bits) and maxv)
            }
        }
        if (pad && bits > 0) {
            result.add((acc shl (toBits - bits)) and maxv)
        }
        return result.map { it.toByte() }.toByteArray()
    }

    private fun convertBitsToInt(data: ByteArray, fromBits: Int, toBits: Int, pad: Boolean): IntArray {
        var acc = 0
        var bits = 0
        val maxv = (1 shl toBits) - 1
        val result = mutableListOf<Int>()
        for (byte in data) {
            acc = (acc shl fromBits) or (byte.toInt() and 0xff)
            bits += fromBits
            while (bits >= toBits) {
                bits -= toBits
                result.add((acc shr bits) and maxv)
            }
        }
        if (pad && bits > 0) {
            result.add((acc shl (toBits - bits)) and maxv)
        }
        return result.toIntArray()
    }
}
