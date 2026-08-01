import Flutter
import UIKit

class SceneDelegate: FlutterSceneDelegate {
  private var privacyCover: UIView?

  override func sceneWillResignActive(_ scene: UIScene) {
    super.sceneWillResignActive(scene)
    guard privacyCover == nil, let window else { return }

    let cover = UIView(frame: window.bounds)
    cover.backgroundColor = .systemBackground
    cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]

    let title = UILabel()
    title.text = "OpenForge Companion"
    title.font = .preferredFont(forTextStyle: .headline)
    title.textColor = .label
    title.translatesAutoresizingMaskIntoConstraints = false
    cover.addSubview(title)
    NSLayoutConstraint.activate([
      title.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
      title.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
    ])

    window.addSubview(cover)
    privacyCover = cover
  }

  override func sceneDidBecomeActive(_ scene: UIScene) {
    privacyCover?.removeFromSuperview()
    privacyCover = nil
    super.sceneDidBecomeActive(scene)
  }
}
