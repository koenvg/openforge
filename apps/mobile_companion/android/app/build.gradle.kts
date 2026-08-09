plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android plugin.
    id("dev.flutter.flutter-gradle-plugin")
}

val releaseSigningEnvironment = mapOf(
    "OPENFORGE_ANDROID_KEYSTORE_PATH" to System.getenv("OPENFORGE_ANDROID_KEYSTORE_PATH"),
    "OPENFORGE_ANDROID_STORE_PASSWORD" to System.getenv("OPENFORGE_ANDROID_STORE_PASSWORD"),
    "OPENFORGE_ANDROID_KEY_ALIAS" to System.getenv("OPENFORGE_ANDROID_KEY_ALIAS"),
    "OPENFORGE_ANDROID_KEY_PASSWORD" to System.getenv("OPENFORGE_ANDROID_KEY_PASSWORD"),
)
val missingReleaseSigningValues = releaseSigningEnvironment
    .filterValues { it.isNullOrBlank() }
    .keys
val releaseBuildRequested = gradle.startParameter.taskNames.any {
    it.contains("release", ignoreCase = true)
}

if (releaseBuildRequested && missingReleaseSigningValues.isNotEmpty()) {
    throw GradleException(
        "Android release signing requires: ${missingReleaseSigningValues.sorted().joinToString(", ")}",
    )
}

android {
    namespace = "com.openforge.app.companion"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    signingConfigs {
        if (missingReleaseSigningValues.isEmpty()) {
            create("release") {
                storeFile = file(releaseSigningEnvironment.getValue("OPENFORGE_ANDROID_KEYSTORE_PATH")!!)
                storePassword = releaseSigningEnvironment.getValue("OPENFORGE_ANDROID_STORE_PASSWORD")
                keyAlias = releaseSigningEnvironment.getValue("OPENFORGE_ANDROID_KEY_ALIAS")
                keyPassword = releaseSigningEnvironment.getValue("OPENFORGE_ANDROID_KEY_PASSWORD")
            }
        }
    }

    defaultConfig {
        applicationId = "com.openforge.app.companion"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
        }
    }
}

flutter {
    source = "../.."
}
