import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var serverProcess: Process?
    private let portRange = 47891...47899
    private var activePort = 47891
    private var activeURL: URL?
    private var expectedBuildId: String?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        configureMenu()
        createWindow()
        showLoading()
        startOrAttachServer()
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let process = serverProcess, process.isRunning {
            process.terminate()
        }
    }

    private func createWindow() {
        let config = WKWebViewConfiguration()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Station Agent"
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = false
        window.minSize = NSSize(width: 1040, height: 680)
        window.center()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func configureMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu(title: "Station Agent")
        appMenu.addItem(NSMenuItem(title: "关于 Station Agent", action: #selector(showAbout), keyEquivalent: ""))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "隐藏 Station Agent", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        appMenu.addItem(NSMenuItem(title: "退出 Station Agent", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(NSMenuItem(title: "撤销", action: Selector(("undo:")), keyEquivalent: "z"))
        editMenu.addItem(NSMenuItem(title: "重做", action: Selector(("redo:")), keyEquivalent: "Z"))
        editMenu.addItem(.separator())
        editMenu.addItem(NSMenuItem(title: "剪切", action: Selector(("cut:")), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "复制", action: Selector(("copy:")), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "粘贴", action: Selector(("paste:")), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "全选", action: Selector(("selectAll:")), keyEquivalent: "a"))
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        let viewMenuItem = NSMenuItem()
        let viewMenu = NSMenu(title: "视图")
        viewMenu.addItem(NSMenuItem(title: "重新加载", action: #selector(reloadClient), keyEquivalent: "r"))
        viewMenu.addItem(NSMenuItem(title: "复制本地地址", action: #selector(copyLocalURL), keyEquivalent: "l"))
        viewMenuItem.submenu = viewMenu
        mainMenu.addItem(viewMenuItem)

        let diagnosticsMenuItem = NSMenuItem()
        let diagnosticsMenu = NSMenu(title: "诊断")
        diagnosticsMenu.addItem(NSMenuItem(title: "打开日志文件", action: #selector(openLogFile), keyEquivalent: ""))
        diagnosticsMenu.addItem(NSMenuItem(title: "打开数据目录", action: #selector(openDataDirectory), keyEquivalent: ""))
        diagnosticsMenuItem.submenu = diagnosticsMenu
        mainMenu.addItem(diagnosticsMenuItem)

        NSApp.mainMenu = mainMenu
    }

    private func startOrAttachServer() {
        guard let appRoot = bundledAppRoot() else {
            showFatalError("客户端资源缺失：Contents/Resources/app 不存在。")
            return
        }
        expectedBuildId = readBuildId(appRoot: appRoot)

        if let port = portRange.first(where: { isHealthy(port: $0, expectedAppRoot: appRoot) }) {
            activePort = port
            loadClient(port: port)
            return
        }

        guard let nodeURL = findNodeExecutable() else {
            showFatalError("未找到 Node.js。请先安装 Node.js 22+，或把 node 放到 /opt/homebrew/bin/node 或 /usr/local/bin/node。")
            return
        }

        for port in portRange {
            activePort = port
            if startServer(nodeURL: nodeURL, appRoot: appRoot, port: port), waitForHealth(port: port, appRoot: appRoot) {
                loadClient(port: port)
                return
            }
            stopServer()
        }

        showFatalError("无法启动本地 Agent 服务。请查看 ~/Library/Application Support/Station Agent/server.log。")
    }

    private func bundledAppRoot() -> URL? {
        let resourceURL = Bundle.main.resourceURL
        let appRoot = resourceURL?.appendingPathComponent("app", isDirectory: true)
        if let appRoot, FileManager.default.fileExists(atPath: appRoot.path) {
            return appRoot
        }
        return nil
    }

    private func readBuildId(appRoot: URL) -> String? {
        let buildInfoURL = appRoot.appendingPathComponent("build-info.json")
        guard
            let data = try? Data(contentsOf: buildInfoURL),
            let object = try? JSONSerialization.jsonObject(with: data),
            let payload = object as? [String: Any]
        else {
            return nil
        }
        return payload["id"] as? String
    }

    private func supportDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let directory = base.appendingPathComponent("Station Agent", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private func logURL() -> URL {
        supportDirectory().appendingPathComponent("server.log")
    }

    private func startServer(nodeURL: URL, appRoot: URL, port: Int) -> Bool {
        let process = Process()
        process.executableURL = nodeURL
        process.arguments = ["src/server.mjs", "--port", "\(port)"]
        process.currentDirectoryURL = appRoot

        var environment = ProcessInfo.processInfo.environment
        environment["AIAGENT_DATA_DIR"] = supportDirectory().path
        environment["AIAGENT_WORKSPACE_ROOT"] = FileManager.default.homeDirectoryForCurrentUser.path
        process.environment = environment

        let logURL = logURL()
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        if let logHandle = try? FileHandle(forWritingTo: logURL) {
            _ = try? logHandle.seekToEnd()
            process.standardOutput = logHandle
            process.standardError = logHandle
        }

        do {
            try process.run()
            serverProcess = process
            return true
        } catch {
            return false
        }
    }

    private func stopServer() {
        if let process = serverProcess, process.isRunning {
            process.terminate()
        }
        serverProcess = nil
    }

    private func waitForHealth(port: Int, appRoot: URL) -> Bool {
        for _ in 0..<40 {
            if isHealthy(port: port, expectedAppRoot: appRoot) {
                return true
            }
            Thread.sleep(forTimeInterval: 0.15)
        }
        return false
    }

    private func isHealthy(port: Int, expectedAppRoot: URL? = nil) -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/health"),
              let data = try? Data(contentsOf: url, options: [.uncached]) else {
            return false
        }

        guard
            let object = try? JSONSerialization.jsonObject(with: data),
            let payload = object as? [String: Any],
            payload["name"] as? String == "Station Agent"
        else {
            return false
        }

        guard let expectedAppRoot else {
            return true
        }

        if let paths = payload["paths"] as? [String: Any],
           let appRoot = paths["appRoot"] as? String {
            let sameRoot = URL(fileURLWithPath: appRoot).standardizedFileURL.path == expectedAppRoot.standardizedFileURL.path
            if !sameRoot {
                return false
            }
            if let expectedBuildId,
               let build = payload["build"] as? [String: Any],
               let buildId = build["id"] as? String {
                return buildId == expectedBuildId
            }
            return expectedBuildId == nil
        }

        return false
    }

    private func loadClient(port: Int) {
        guard let url = URL(string: "http://127.0.0.1:\(port)") else {
            showFatalError("客户端 URL 无效。")
            return
        }
        activeURL = url
        webView.load(URLRequest(url: url))
    }

    private func findNodeExecutable() -> URL? {
        if let bundledNode = Bundle.main.resourceURL?
            .appendingPathComponent("runtime", isDirectory: true)
            .appendingPathComponent("bin", isDirectory: true)
            .appendingPathComponent("node"),
           FileManager.default.isExecutableFile(atPath: bundledNode.path) {
            return bundledNode
        }

        let candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node"
        ]

        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return URL(fileURLWithPath: candidate)
        }

        return nil
    }

    private func showFatalError(_ message: String) {
        let html = """
        <!doctype html>
        <html lang=\"zh-CN\">
        <meta charset=\"utf-8\">
        <body style=\"font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#eef1f2;color:#17191c;margin:0;padding:48px;\">
          <h1 style=\"font-size:24px;margin:0 0 12px;\">Station Agent 启动失败</h1>
          <p style=\"line-height:1.6;max-width:720px;\">\(escapeHTML(message))</p>
        </body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func showLoading() {
        let html = """
        <!doctype html>
        <html lang=\"zh-CN\">
        <meta charset=\"utf-8\">
        <body style=\"font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#eef1f2;color:#17191c;margin:0;display:grid;place-items:center;min-height:100vh;\">
          <main style=\"width:min(560px,calc(100vw - 64px));\">
            <div style=\"width:56px;height:56px;border-radius:16px;background:#101318;margin-bottom:22px;box-shadow:0 18px 50px rgba(22,26,29,.18);\"></div>
            <h1 style=\"font-size:28px;margin:0 0 10px;letter-spacing:0;\">Station Agent</h1>
            <p style=\"line-height:1.6;color:#687076;margin:0;\">正在启动本地 Agent 服务，加载工作区、技能和安全策略。</p>
          </main>
        </body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if isAllowedLocalURL(url) {
            decisionHandler(.allow)
            return
        }

        if url.scheme == "http" || url.scheme == "https" {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    private func isAllowedLocalURL(_ url: URL) -> Bool {
        guard let host = url.host,
              let port = url.port,
              (url.scheme == "http"),
              (host == "127.0.0.1" || host == "localhost") else {
            return false
        }
        return portRange.contains(port)
    }

    @objc private func reloadClient() {
        if let activeURL {
            webView.load(URLRequest(url: activeURL))
        } else {
            startOrAttachServer()
        }
    }

    @objc private func copyLocalURL() {
        guard let activeURL else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(activeURL.absoluteString, forType: .string)
    }

    @objc private func openLogFile() {
        NSWorkspace.shared.open(logURL())
    }

    @objc private func openDataDirectory() {
        NSWorkspace.shared.open(supportDirectory())
    }

    @objc private func showAbout() {
        let alert = NSAlert()
        alert.messageText = "Station Agent"
        alert.informativeText = "本地优先的专业 AI Agent 桌面客户端\nVersion 0.1.0"
        alert.addButton(withTitle: "确定")
        alert.runModal()
    }

    private func escapeHTML(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
