package app.bookstr.util

object Bech32 {
    private const val CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

    fun decode(hrp: String, input: String): ByteArray {
        val lower = input.lowercase()
        val pos = lower.lastIndexOf('1')
        require(pos >= 1) { "Invalid bech32 string" }
        require(lower.substring(0, pos) == hrp) { "Invalid HRP" }

        val data = IntArray(lower.length - 1 - pos)
        for (i in data.indices) {
            val idx = CHARSET.indexOf(lower[pos + 1 + i])
            require(idx >= 0) { "Invalid bech32 character" }
            data[i] = idx
        }

        return convertBits(data, 5, 8, false)
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
}
