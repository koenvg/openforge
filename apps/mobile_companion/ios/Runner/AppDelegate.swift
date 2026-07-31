import Flutter
import UIKit

private enum SettingsChannel {
  static let name = "app.openforge.companion/settings"
  static let openAppSettings = "openAppSettings"
}

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let settingsChannel = FlutterMethodChannel(
      name: SettingsChannel.name,
      binaryMessenger: engineBridge.applicationRegistrar.messenger()
    )
    settingsChannel.setMethodCallHandler { call, result in
      guard call.method == SettingsChannel.openAppSettings else {
        result(FlutterMethodNotImplemented)
        return
      }
      guard
        let settingsUrl = URL(string: UIApplication.openSettingsURLString),
        UIApplication.shared.canOpenURL(settingsUrl)
      else {
        result(nil)
        return
      }
      UIApplication.shared.open(settingsUrl, options: [:], completionHandler: nil)
      result(nil)
    }
  }
}
