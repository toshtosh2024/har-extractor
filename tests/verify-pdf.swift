import Foundation
import PDFKit
import AppKit

// Optional second argument: directory for page PNGs used in visual checks.
guard CommandLine.arguments.count >= 2,
      let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else {
  fputs("Usage: swift tests/verify-pdf.swift file.pdf [png-directory]\n", stderr)
  exit(1)
}
print("Pages: \(document.pageCount)")
for index in 0..<document.pageCount {
  guard let page = document.page(at: index) else { exit(1) }
  let bounds = page.bounds(for: .mediaBox)
  print("Page \(index + 1): \(bounds.width) × \(bounds.height) pt")
  if CommandLine.arguments.count > 2 {
    let directory = URL(fileURLWithPath: CommandLine.arguments[2])
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let scale = min(2.0, 1600 / max(bounds.width, bounds.height))
    let width = max(1, Int(ceil(bounds.width * scale)))
    let height = max(1, Int(ceil(bounds.height * scale)))
    guard let bitmap = NSBitmapImageRep(
      bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
      colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ), let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else { exit(1) }
    let context = graphics.cgContext
    context.setFillColor(NSColor.white.cgColor)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: context)
    guard let png = bitmap.representation(using: .png, properties: [:]) else { exit(1) }
    try png.write(to: directory.appendingPathComponent("page-\(index + 1).png"))
  }
}
