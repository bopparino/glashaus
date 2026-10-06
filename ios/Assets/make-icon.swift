// Original typographic asset. Run from ios/ to rebuild Assets.xcassets/AppIcon.appiconset/icon.png.
import AppKit
let size = NSSize(width: 1024, height: 1024)
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
    bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor(white: 0.06, alpha: 1).setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()
let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 640, weight: .regular), .foregroundColor: NSColor(white: 0.95, alpha: 1)]
let glyph = NSAttributedString(string: "g", attributes: attributes)
let measured = glyph.size()
glyph.draw(at: NSPoint(x: (size.width - measured.width) / 2, y: (size.height - measured.height) / 2 + 48))
NSGraphicsContext.restoreGraphicsState()
let data = bitmap.representation(using: .png, properties: [:])!
try data.write(to: URL(fileURLWithPath: "Assets.xcassets/AppIcon.appiconset/icon.png"))
