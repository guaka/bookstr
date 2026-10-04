import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

import org.gradle.testing.jacoco.tasks.JacocoReport
import org.gradle.api.tasks.Sync
import org.gradle.api.tasks.testing.Test

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
    id("jacoco")
}

val sharedReaderDirectory = rootProject.file("../shared/reader")
val sharedReaderSpeechFile = rootProject.file("../web/reader-speech.js")
val sharedReaderTypographyFile = rootProject.file("../web/reader-typography.js")
val sharedReaderChromeFile = rootProject.file("../web/reader-chrome.js")
val generatedReaderAssets = layout.buildDirectory.dir("generated/reader-assets")
val syncReaderAssets by tasks.registering(Sync::class) {
    from(sharedReaderDirectory) {
        include("reader.html", "epub.min.js", "jszip.min.js")
    }
    from(rootProject.file("../web")) {
        include("comic-reader.html", "vendor/libarchive.js", "vendor/libarchive.wasm")
    }
    from(sharedReaderSpeechFile)
    from(sharedReaderTypographyFile)
    from(sharedReaderChromeFile)
    into(generatedReaderAssets)
}

// Keep BuildConfig stable across no-change builds so a displayed timestamp does not invalidate
// Kotlin compilation. It advances whenever an app source or shared reader asset changes.
val newestSourceChange = (
    fileTree("src/main").files +
        fileTree(sharedReaderDirectory).files +
        sharedReaderSpeechFile +
        sharedReaderTypographyFile +
        sharedReaderChromeFile
)
    .maxOfOrNull(File::lastModified)
    ?: System.currentTimeMillis()
val sourceChangeTime = Instant.ofEpochMilli(newestSourceChange)
    .atZone(ZoneId.systemDefault())
val buildDate = sourceChangeTime.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
val versionTimestamp = sourceChangeTime.format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmm"))
val timestampVersionCode = (sourceChangeTime.toEpochSecond() / 60).toInt()

// Release-signing secrets stay outside the repository. Set these environment variables before
// building a distributable APK: BOOKSTR_KEYSTORE_FILE, BOOKSTR_KEYSTORE_PASSWORD,
// BOOKSTR_KEY_ALIAS, and BOOKSTR_KEY_PASSWORD.
val releaseKeystoreFile = providers.environmentVariable("BOOKSTR_KEYSTORE_FILE").orNull
val releaseKeystorePassword = providers.environmentVariable("BOOKSTR_KEYSTORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("BOOKSTR_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("BOOKSTR_KEY_PASSWORD").orNull

android {
    namespace = "app.bookstr"
    compileSdk = 35
    ndkVersion = "27.2.12479018"
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }

    defaultConfig {
        applicationId = "app.bookstr"
        minSdk = 27
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }
        targetSdk = 35
        versionCode = timestampVersionCode
        versionName = "0.0.3-$versionTimestamp"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "BUILD_DATE", "\"$buildDate\"")
    }

    sourceSets.getByName("main").assets.srcDir(generatedReaderAssets)

    signingConfigs {
        create("release") {
            releaseKeystoreFile?.let { storeFile = file(it) }
            storePassword = releaseKeystorePassword
            keyAlias = releaseKeyAlias
            keyPassword = releaseKeyPassword
        }
    }

    buildTypes {
        debug {
            isTestCoverageEnabled = true
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
        unitTests.isIncludeAndroidResources = true
    }
}

tasks.named("preBuild").configure {
    dependsOn(syncReaderAssets)
}

val verifyDisposableAndroidDevice by tasks.registering(Exec::class) {
    group = "verification"
    description = "Keep connected Android tests off devices with personal app data"
    commandLine("bash", rootProject.file("scripts/require-emulator.sh"), android.sdkDirectory.resolve("platform-tools/adb"))
}

tasks.matching { it.name == "connectedDebugAndroidTest" }.configureEach {
    dependsOn(verifyDisposableAndroidDevice)
}

tasks.matching { it.name == "packageRelease" }.configureEach {
    doFirst {
        val missing = buildList {
            if (releaseKeystoreFile.isNullOrBlank()) add("BOOKSTR_KEYSTORE_FILE")
            if (releaseKeystorePassword.isNullOrBlank()) add("BOOKSTR_KEYSTORE_PASSWORD")
            if (releaseKeyAlias.isNullOrBlank()) add("BOOKSTR_KEY_ALIAS")
            if (releaseKeyPassword.isNullOrBlank()) add("BOOKSTR_KEY_PASSWORD")
        }
        check(missing.isEmpty()) {
            "Release signing requires environment variables: ${missing.joinToString(", ")}."
        }
        check(file(releaseKeystoreFile!!).isFile) {
            "Release keystore not found: $releaseKeystoreFile"
        }
    }
}

jacoco {
    toolVersion = "0.8.12"
}

tasks.withType<Test>().configureEach {
    finalizedBy("jacocoDebugUnitTestReport")
}

tasks.register<JacocoReport>("jacocoDebugUnitTestReport") {
    dependsOn("testDebugUnitTest")
    group = "verification"
    description = "Generate JaCoCo coverage report for debug unit tests"

    reports {
        xml.required.set(true)
        html.required.set(true)
        csv.required.set(false)
    }

    val mainKotlin = fileTree("$buildDir/tmp/kotlin-classes/debug")
    val mainJava = fileTree("$buildDir/intermediates/javac/debug/classes")
    val coverageExclusions = arrayOf(
        "**/R.class",
        "**/R$*.class",
        "**/BuildConfig.*",
        "**/*\$Lambda$*.*",
        "**/*\$inlined$*",
        // These are exercised by the separate Android e2e suite, not JVM unit tests.
        "**/ui/**",
        "**/*Activity*",
        "**/*Service*",
        "**/BookstrApp*",
        "**/ComposableSingletons*",
    )

    classDirectories.setFrom(
        mainKotlin.matching { exclude(*coverageExclusions) },
        mainJava.matching { exclude(*coverageExclusions) },
    )

    sourceDirectories.setFrom(
        fileTree("src/main/kotlin"),
        fileTree("src/main/java"),
    )

    executionData.setFrom(
        layout.buildDirectory.file(
            "outputs/unit_test_code_coverage/debugUnitTest/testDebugUnitTest.exec",
        ),
    )
}

dependencies {
    implementation("com.ibm.icu:icu4j:76.1")
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("com.k2fsa.sherpa:sherpa-onnx:1.13.8@aar")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.media:media:1.7.0")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.navigation:navigation-compose:2.8.4")

    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.bouncycastle:bcprov-jdk18on:1.80")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("fr.acinq.secp256k1:secp256k1-kmp-jni-jvm:0.15.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("com.squareup.okhttp3:okhttp-tls:4.12.0")

    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    implementation("androidx.webkit:webkit:1.12.1")

    implementation("fr.acinq.secp256k1:secp256k1-kmp:0.15.0")
    implementation("fr.acinq.secp256k1:secp256k1-kmp-jni-android:0.15.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlin:kotlin-test-junit:2.0.21")
    // Real org.json for JVM unit tests (Android stubs are incomplete)
    testImplementation("org.json:json:20240303")

    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

// Includes UI/service classes and combines JVM and device execution data.
// Copy the emulator's run-as-accessible coverage file into app/build/coverage/full.ec.
tasks.register<JacocoReport>("jacocoCombinedDebugReport") {
    group = "verification"
    dependsOn("testDebugUnitTest", "compileDebugKotlin", "compileDebugJavaWithJavac")
    reports { xml.required.set(true); html.required.set(true) }
    classDirectories.setFrom(fileTree("$buildDir/tmp/kotlin-classes/debug"), fileTree("$buildDir/intermediates/javac/debug/classes"))
    sourceDirectories.setFrom(files("src/main/java"))
    executionData.setFrom(
        layout.buildDirectory.file("outputs/unit_test_code_coverage/debugUnitTest/testDebugUnitTest.exec"),
        layout.buildDirectory.file("coverage/full.ec"),
        layout.buildDirectory.file("coverage/narration-new.ec"),
    )
}
