package app.bookstr.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.bookstr.data.BookRightsMetadata
import app.bookstr.data.RIGHTS_OPEN_LICENSE
import app.bookstr.data.RIGHTS_PUBLIC_DOMAIN

@Composable
fun RightsMarker(
    rightsStatus: String,
    license: String?,
    licenseUrl: String?,
    rightsSource: String?,
    modifier: Modifier = Modifier,
) {
    val rights = BookRightsMetadata.normalize(rightsStatus, license, licenseUrl, rightsSource)
    val isOpen = rights.status == RIGHTS_PUBLIC_DOMAIN || rights.status == RIGHTS_OPEN_LICENSE
    Text(
        text = rights.compactLabel,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        color = if (isOpen) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier
            .semantics { contentDescription = rights.accessibleLabel }
            .background(
                if (isOpen) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                RoundedCornerShape(4.dp),
            )
            .padding(horizontal = 5.dp, vertical = 1.dp),
    )
}
