package app.openforge.openforge_companion

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

private const val SETTINGS_CHANNEL = "app.openforge.companion/settings"
private const val OPEN_APP_SETTINGS = "openAppSettings"

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, SETTINGS_CHANNEL)
            .setMethodCallHandler { call, result ->
                if (call.method != OPEN_APP_SETTINGS) {
                    result.notImplemented()
                    return@setMethodCallHandler
                }

                val intent = Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", packageName, null),
                )
                try {
                    startActivity(intent)
                } catch (_: RuntimeException) {
                    // Restricted profiles may not expose application settings.
                }
                result.success(null)
            }
    }
}
