import AppKit

let outputPath = CommandLine.arguments.dropFirst().first ?? "AIAgentIcon.png"
let size = NSSize(width: 1024, height: 1024)
let image = NSImage(size: size)

image.lockFocus()

NSColor(calibratedRed: 0.063, green: 0.075, blue: 0.094, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: size.width, height: size.height), xRadius: 220, yRadius: 220).fill()

let shadow = NSShadow()
shadow.shadowColor = NSColor.black.withAlphaComponent(0.22)
shadow.shadowBlurRadius = 28
shadow.shadowOffset = NSSize(width: 0, height: -12)
shadow.set()

let gold = NSColor(calibratedRed: 0.957, green: 0.827, blue: 0.369, alpha: 1)
let blue = NSColor(calibratedRed: 0.384, green: 0.714, blue: 0.796, alpha: 1)
let green = NSColor(calibratedRed: 0.482, green: 0.788, blue: 0.314, alpha: 1)

let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center

let font = NSFont.systemFont(ofSize: 520, weight: .heavy)
let attributes: [NSAttributedString.Key: Any] = [
    .font: font,
    .foregroundColor: gold,
    .paragraphStyle: paragraph
]

let text = "A"
let textRect = NSRect(x: 0, y: 250, width: size.width, height: 560)
text.draw(in: textRect, withAttributes: attributes)

shadow.shadowBlurRadius = 0
shadow.set()

blue.setFill()
NSBezierPath(roundedRect: NSRect(x: 220, y: 180, width: 584, height: 84), xRadius: 42, yRadius: 42).fill()

green.setFill()
NSBezierPath(ovalIn: NSRect(x: 748, y: 738, width: 128, height: 128)).fill()

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
