pluginManagement {
    val flutterSdkPath =
        run {
            val properties = java.util.Properties()
            file("local.properties").inputStream().use { properties.load(it) }
            val flutterSdkPath = properties.getProperty("flutter.sdk")
            require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
            flutterSdkPath
        }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "9.1.0" apply false
    // Version the Kotlin runtime used by AGP Built-in Kotlin without applying legacy KGP.
    id("org.jetbrains.kotlin.android") version "2.4.0" apply false
}

include(":app")

// Keep published plugin runtime sources while replacing only their legacy-KGP
// build definitions. Remove each override when its upstream release migrates.
mapOf(
    "bonsoir_android" to ("bonsoir_android.gradle" to "7.1.2"),
    "mobile_scanner" to ("mobile_scanner.gradle" to "7.4.0"),
).forEach { (plugin, override) ->
    val (buildFile, supportedVersion) = override
    val pluginProject = project(":$plugin")
    val resolvedPackage = pluginProject.projectDir.parentFile.name
    require(resolvedPackage == "$plugin-$supportedVersion") {
        "Update $plugin's Built-in Kotlin build override for resolved package $resolvedPackage"
    }

    val overrideBuildFile = rootDir.resolve("plugin-builds/$buildFile")
    pluginProject.buildFileName = pluginProject.projectDir
        .toPath()
        .relativize(overrideBuildFile.toPath())
        .toString()
}
