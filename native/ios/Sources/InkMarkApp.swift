import UIKit
import NativeShell
import UniformTypeIdentifiers

@main
final class InkMarkApp: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Workspace", sessionRole: session.role)
        configuration.delegateClass = WorkspaceScene.self
        return configuration
    }
}

final class WorkspaceScene: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = WorkspaceController()
        window.makeKeyAndVisible()
        self.window = window
    }
}

/** A single document workspace; UIKit owns safe areas, keyboard avoidance and file sharing. */
final class WorkspaceController: UIViewController, UIDocumentPickerDelegate {
    private let workspace = NshAppView()
    private var picking: NshHostReply?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        workspace.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(workspace)
        NSLayoutConstraint.activate([
            workspace.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            workspace.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            workspace.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            workspace.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
        ])
        workspace.onError = { [weak self] message in self?.showFailure(message) }
        workspace.handle("files.pick") { [weak self] value, reply in
            guard let self else { reply.reject("应用已关闭"); return }
            guard self.picking == nil, self.presentedViewController == nil else { reply.reject("请先完成当前系统操作"); return }
            guard let options = value as? [String: Any], let multiple = options["multiple"] as? Bool,
                  options["directory"] as? Bool == false else { reply.reject("无效的文件选择请求"); return }
            let types: [UTType] = options["extensions"] as? [String] == ["json"] ? [.json] : [.data]
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
            picker.allowsMultipleSelection = multiple
            picker.delegate = self
            self.picking = reply
            self.present(picker, animated: true)
        }
        workspace.handle("files.export") { [weak self] value, reply in
            guard let self else { reply.reject("应用已关闭"); return }
            do {
                let request = try ExportFile(value)
                Task {
                    do {
                        let url = try await Task.detached(priority: .userInitiated) { try request.write() }.value
                        guard self.presentedViewController == nil else {
                            try FileManager.default.removeItem(at: url.deletingLastPathComponent())
                            reply.reject("请先完成当前系统操作"); return
                        }
                        let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                        if let popover = share.popoverPresentationController {
                            popover.sourceView = self.view
                            popover.sourceRect = CGRect(x: self.view.bounds.midX, y: self.view.bounds.midY, width: 1, height: 1)
                            popover.permittedArrowDirections = []
                        }
                        share.completionWithItemsHandler = { _, completed, _, error in
                            if !completed || error != nil { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
                            if let error { reply.reject(error.localizedDescription) }
                            else { reply.resolve(completed ? "shared" : "cancelled") }
                        }
                        self.present(share, animated: true)
                    } catch { reply.reject(error.localizedDescription) }
                }
            } catch { reply.reject(error.localizedDescription) }
        }
        do {
            guard let url = Bundle.main.url(forResource: "bundle", withExtension: "nshc", subdirectory: "nsh") else {
                throw ExportError.message("工作台资源缺失，请重新安装 InkMark")
            }
            try workspace.loadBundle(at: url)
        } catch { showFailure(error.localizedDescription) }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        picking?.resolve([])
        picking = nil
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let reply = picking else { return }
        picking = nil
        Task {
            do { reply.resolve(try await Task.detached(priority: .userInitiated) { try DocumentPicker.read(urls) }.value) }
            catch { reply.reject(error.localizedDescription) }
        }
    }

    private func showFailure(_ message: String) {
        let alert = UIAlertController(title: "工作台无法加载", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }
}
