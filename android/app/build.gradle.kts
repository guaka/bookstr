import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

import org.gradle.testing.jacoco.tasks.JacocoReport
import org.gradle.api.tasks.testing.Test

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
    id("jacoco")
}

// Keep BuildConfig stable across no-change builds so a displayed timestamp does not invalidate
// Kotlin compilation. It advances whenever an app source or asset changes.
val newestSourceChange = fileTree("src/main").files.maxOfOrNull(File::lastModified)
    ?: System.currentTimeMillis()
val sourceChangeTime = Instant.ofEpochMilli(newestSourceChange)
    .atZone(ZoneId.systemDefault())
val buildDate = sourceChangeTime.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
val versionTimestamp = sourceChangeTime.format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmm"))
val timestampVersionCode = (sourceChangeTime.toEpochSecond() / 60).toInt()

android {
    namespace = "app.bookstr"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.bookstr"
        minSdk = 27
        targetSdk = 35
        versionCode = timestampVersionCode
        versionName = "0.0.3-$versionTimestamp"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "BUILD_DATE", "\"$buildDate\"")
    }

    buildTypes {
        debug {
            isTestCoverageEnabled = true
        }
        release {
            isMinifyEnabled = false
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

    classDirectories.setFrom(
        files(mainKotlin, mainJava).asFileTree.matching {
            exclude(
                "**/R.class",
                "**/R$*.class",
                "**/BuildConfig.*",
                "**/*\$Lambda$*.*",
                "**/*Companion*",
                "**/*\$inlined$*",
            )
        },
    )

    sourceDirectories.setFrom(
        fileTree("src/main/kotlin"),
        fileTree("src/main/java"),
    )

    executionData.setFrom(
        fileTree(layout.buildDirectory).include(
            "jacoco/testDebugUnitTest.exec",
            "jacoco/testDebugUnitTest/**",
            "**/coverage.exec",
            "**/*.ec",
        ),
    )
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

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
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
