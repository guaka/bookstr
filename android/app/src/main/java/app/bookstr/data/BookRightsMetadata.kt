package app.bookstr.data

import java.net.URI

const val RIGHTS_PUBLIC_DOMAIN = "public_domain"
const val RIGHTS_OPEN_LICENSE = "open_license"
const val RIGHTS_COPYRIGHTED = "copyrighted"
const val RIGHTS_UNKNOWN = "unknown"

private val RIGHTS_STATUS_ALIASES = mapOf(
    RIGHTS_PUBLIC_DOMAIN to RIGHTS_PUBLIC_DOMAIN,
    "pd" to RIGHTS_PUBLIC_DOMAIN,
    RIGHTS_OPEN_LICENSE to RIGHTS_OPEN_LICENSE,
    "open" to RIGHTS_OPEN_LICENSE,
    RIGHTS_COPYRIGHTED to RIGHTS_COPYRIGHTED,
    "copyright" to RIGHTS_COPYRIGHTED,
)

data class BookRights(
    val status: String = RIGHTS_UNKNOWN,
    val license: String? = null,
    val licenseUrl: String? = null,
    val source: String? = null,
) {
    val compactLabel: String
        get() = when (status) {
            RIGHTS_PUBLIC_DOMAIN -> if (isCc0(license)) "CC0" else "PD"
            RIGHTS_OPEN_LICENSE -> creativeCommonsCode(license) ?: "OPEN"
            else -> "©"
        }

    val accessibleLabel: String
        get() = when (status) {
            RIGHTS_PUBLIC_DOMAIN -> license ?: "Public domain"
            RIGHTS_OPEN_LICENSE -> license ?: "Open license"
            RIGHTS_COPYRIGHTED -> "Copyrighted"
            else -> "No open license identified"
        }
}

object BookRightsMetadata {
    fun normalize(
        status: String? = null,
        license: String? = null,
        licenseUrl: String? = null,
        source: String? = null,
        copyright: Boolean? = null,
    ): BookRights {
        val statement = license.clean()
        val safeUrl = safeHttpUrl(licenseUrl.clean() ?: urlFrom(statement))
        val explicitStatus = normalizeRightsStatus(status)
        val detected = explicitStatus ?: when {
            copyright == false -> RIGHTS_PUBLIC_DOMAIN
            copyright == true -> RIGHTS_COPYRIGHTED
            isPublicDomainStatement(statement, safeUrl) -> RIGHTS_PUBLIC_DOMAIN
            isOpenLicenseStatement(statement, safeUrl) -> RIGHTS_OPEN_LICENSE
            isCopyrightStatement(statement) -> RIGHTS_COPYRIGHTED
            else -> RIGHTS_UNKNOWN
        }
        val normalizedStatement = statement ?: "Public domain in the U.S.".takeIf { copyright == false }
        val hasEvidence = detected != RIGHTS_UNKNOWN || normalizedStatement != null || safeUrl != null
        return BookRights(
            status = detected,
            license = normalizedStatement,
            licenseUrl = safeUrl,
            source = source.clean().takeIf { hasEvidence },
        )
    }

    fun preferred(current: BookRights, incoming: BookRights): BookRights {
        if (incoming.status != RIGHTS_UNKNOWN) return incoming
        if (current.status != RIGHTS_UNKNOWN) return current
        return if (incoming.license != null || incoming.licenseUrl != null || incoming.source != null) incoming else current
    }

    private fun isPublicDomainStatement(statement: String?, url: String?): Boolean {
        val value = listOfNotNull(statement, url).joinToString(" ").lowercase()
        return value.contains("public domain") || value.contains("no known copyright restrictions") ||
            value.contains("creativecommons.org/publicdomain") ||
            Regex("(?:^|[^a-z0-9])cc\\s*0(?:[^a-z0-9]|$)", RegexOption.IGNORE_CASE).containsMatchIn(value)
    }

    private fun isOpenLicenseStatement(statement: String?, url: String?): Boolean {
        val value = listOfNotNull(statement, url).joinToString(" ").lowercase()
        return value.contains("creative commons") || value.contains("creativecommons.org/licenses/") ||
            Regex("(?:^|[^a-z0-9])cc\\s+(?:by|sa|nc|nd)", RegexOption.IGNORE_CASE).containsMatchIn(value) ||
            value.contains("gnu free documentation") || value.contains("gfdl") ||
            value.contains("free art license") || value.contains("open publication license") ||
            value.contains("unlicense")
    }

    private fun isCopyrightStatement(statement: String?): Boolean {
        val value = statement.orEmpty().lowercase()
        return value.contains("all rights reserved") || value.contains("copyrighted") ||
            value.contains("copyright ") || value.contains("©")
    }
}

private fun normalizeRightsStatus(value: String?): String? {
    val cleaned = value.clean() ?: return null
    val normalized = cleaned.lowercase().replace('-', '_').replace(' ', '_')
    return RIGHTS_STATUS_ALIASES[normalized]
}

private fun String?.clean(): String? = this?.trim()?.takeIf {
    it.isNotEmpty() && !it.equals("null", ignoreCase = true) && !it.equals("undefined", ignoreCase = true)
}

private fun safeHttpUrl(value: String?): String? {
    val candidate = value.clean() ?: return null
    return runCatching {
        URI(candidate).takeIf { uri ->
            (uri.scheme.equals("http", ignoreCase = true) || uri.scheme.equals("https", ignoreCase = true)) &&
                !uri.host.isNullOrBlank()
        }?.toString()
    }.getOrNull()
}

private fun urlFrom(value: String?): String? = value?.let {
    Regex("https?://[^\\s<>\"']+", RegexOption.IGNORE_CASE).find(it)?.value?.trimEnd('.', ',', ')')
}

private fun isCc0(value: String?): Boolean = value?.let {
    Regex("(?:^|[^a-z0-9])cc\\s*0(?:[^a-z0-9]|$)", RegexOption.IGNORE_CASE).containsMatchIn(it)
} == true

private fun creativeCommonsCode(value: String?): String? {
    val statement = value ?: return null
    val match = Regex(
        "(?:creative\\s+commons\\s+)?CC\\s*[- ]?((?:BY)(?:[- ](?:SA|NC|ND)){0,2})(?:\\s*(\\d+(?:\\.\\d+)?))?",
        setOf(RegexOption.IGNORE_CASE),
    ).find(statement) ?: return null
    val terms = match.groupValues[1].uppercase().replace(' ', '-')
    val version = match.groupValues[2]
    return buildString {
        append("CC ")
        append(terms)
        if (version.isNotBlank()) append(" $version")
    }
}
