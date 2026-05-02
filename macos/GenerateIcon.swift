import AppKit

let outputPath = CommandLine.arguments.dropFirst().first ?? "AIAgentIcon.png"
let size = NSSize(width: 1024, height: 1024)
let image = NSImage(size: size)

image.lockFocus()

// Background gradient
let bgGradient = NSGradient(starting: NSColor(calibratedRed: 0.05, green: 0.05, blue: 0.12, alpha: 1.0),
                           ending: NSColor(calibratedRed: 0.10, green: 0.08, blue: 0.20, alpha: 1.0))
bgGradient?.draw(in: NSRect(x: 0, y: 0, width: size.width, height: size.height), angle: 135)

// Outer glow ring
let glowRing = NSColor(calibratedRed: 0.30, green: 0.60, blue: 0.90, alpha: 0.3)
glowRing.setStroke()
let ringPath = NSBezierPath(ovalIn: NSRect(x: 80, y: 80, width: 864, height: 864))
ringPath.lineWidth = 24
ringPath.stroke()

// Inner hexagon
let hexPath = NSBezierPath()
let center = NSPoint(x: size.width / 2, y: size.height / 2)
let radius: CGFloat = 280
for i in 0..<6 {
    let angle = CGFloat(i) * CGFloat.pi / 3 - CGFloat.pi / 6
    let point = NSPoint(x: center.x + radius * cos(angle), y: center.y + radius * sin(angle))
    if i == 0 {
        hexPath.move(to: point)
    } else {
        hexPath.line(to: point)
    }
}
hexPath.close()

let hexFill = NSColor(calibratedRed: 0.12, green: 0.12, blue: 0.22, alpha: 1.0)
hexFill.setFill()
hexPath.fill()

let hexStroke = NSColor(calibratedRed: 0.50, green: 0.75, blue: 1.0, alpha: 0.8)
hexStroke.setStroke()
hexPath.lineWidth = 12
hexPath.stroke()

// Inner circle
let innerRing = NSBezierPath(ovalIn: NSRect(x: 312, y: 312, width: 400, height: 400))
let innerFill = NSColor(calibratedRed: 0.08, green: 0.08, blue: 0.16, alpha: 1.0)
innerFill.setFill()
innerRing.fill()

let innerStroke = NSColor(calibratedRed: 0.60, green: 0.85, blue: 1.0, alpha: 0.5)
innerStroke.setStroke()
innerRing.lineWidth = 6
innerRing.stroke()

// Center dot
let dotPath = NSBezierPath(ovalIn: NSRect(x: 462, y: 462, width: 100, height: 100))
let dotFill = NSColor(calibratedRed: 0.90, green: 0.85, blue: 0.30, alpha: 1.0)
dotFill.setFill()
dotPath.fill()

// Circuit lines from hexagon vertices
let circuitColor = NSColor(calibratedRed: 0.30, green: 0.75, blue: 0.90, alpha: 0.4)
circuitColor.setStroke()
for i in 0..<6 {
    let angle = CGFloat(i) * CGFloat.pi / 3 - CGFloat.pi / 6
    let hexPoint = NSPoint(x: center.x + radius * cos(angle), y: center.y + radius * sin(angle))
    let lineLen: CGFloat = 100 + CGFloat(i % 3) * 40
    let endPoint = NSPoint(x: center.x + (radius + lineLen) * cos(angle), y: center.y + (radius + lineLen) * sin(angle))
    let circuitPath = NSBezierPath()
    circuitPath.move(to: hexPoint)
    circuitPath.line(to: endPoint)
    circuitPath.lineWidth = 4
    circuitPath.stroke()
}

// Small accent dots at circuit endpoints
let accentColor = NSColor(calibratedRed: 0.40, green: 0.90, blue: 0.80, alpha: 0.8)
accentColor.setFill()
for i in 0..<6 {
    let angle = CGFloat(i) * CGFloat.pi / 3 - CGFloat.pi / 6
    let lineLen: CGFloat = 100 + CGFloat(i % 3) * 40
    let dotPoint = NSPoint(x: center.x + (radius + lineLen) * cos(angle), y: center.y + (radius + lineLen) * sin(angle))
    let dotRect = NSRect(x: dotPoint.x - 8, y: dotPoint.y - 8, width: 16, height: 16)
    let dot = NSBezierPath(ovalIn: dotRect)
    dot.fill()
}

image.unlockFocus()

guard
    let tiff = image.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let png = bitmap.representation(using: .png, properties: [:])
else {
    FileHandle.standardError.write(Data("failed to render icon\n".utf8))
    exit(1)
}

try png.write(to: URL(fileURLWithPath: outputPath))
