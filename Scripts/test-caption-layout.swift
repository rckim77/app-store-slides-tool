// Run after swift build: xcrun swift Scripts/test-caption-layout.swift .build/debug/app-store-slides-tool
import AppKit
import Foundation

func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        FileHandle.standardError.write(Data(("error: " + message + "\n").utf8))
        exit(1)
    }
}
let renderer = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("caption-layout-\(UUID().uuidString)")
try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: temporary) }
func fixture(_ name: String, width: Int, height: Int, color: [UInt8]) throws {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    for y in 0..<height {
        for x in 0..<width {
            let offset = y * bitmap.bytesPerRow + x * 4
            for channel in 0..<4 { bitmap.bitmapData![offset + channel] = color[channel] }
        }
    }
    try bitmap.representation(using: .png, properties: [:])!.write(to: temporary.appendingPathComponent(name))
}
try fixture("frame.png", width: 100, height: 200, color: [0, 255, 0, 255])
try fixture("screenshot.png", width: 70, height: 160, color: [255, 0, 255, 255])
func device(_ preset: String, _ width: Int, _ height: Int, _ scale: Double) -> [String: Any] {
    ["appStorePreset": preset, "canvas": ["width": width, "height": height],
     "screenshotRoot": temporary.path,
     "frame": ["image": "frame.png", "screen": ["x": 15, "y": 20, "width": 70, "height": 160],
               "scale": scale, "top": 300]]
}
var config: [String: Any] = [
    "name": "Caption regression", "version": "test", "defaultLocale": "en_US", "outputRoot": "output",
    "background": ["color": "#FFFFFF"],
    "caption": ["fontSize": 90, "color": "#0000FF", "topPadding": 80, "bottomPadding": 45,
                "horizontalPadding": 90, "lineHeight": 1.1, "maxLines": 2],
    "devices": ["iphone": device("iphone-6.9", 1290, 2796, 12.5), "ipad": device("ipad-13", 2048, 2732, 18)],
    "slides": [["id": "slide", "screenshot": "screenshot.png", "captions": ["en_US": "ALPHA\nBETA"]]]
]
func render(_ positions: [String: String]?, valid: Bool = true) throws -> [String: Data] {
    var slide = (config["slides"] as! [[String: Any]])[0]
    slide["captionPositions"] = positions
    config["slides"] = [slide]
    let configURL = temporary.appendingPathComponent("config.json")
    try JSONSerialization.data(withJSONObject: config, options: [.sortedKeys]).write(to: configURL)
    let process = Process()
    process.executableURL = renderer
    process.arguments = ["--config", configURL.path, "--device", "all"]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try process.run(); process.waitUntilExit()
    check((process.terminationStatus == 0) == valid, "Unexpected renderer validation result")
    if !valid { return [:] }
    return try Dictionary(uniqueKeysWithValues: ["iphone", "ipad"].map { name in
        (name, try Data(contentsOf: temporary.appendingPathComponent("output/test/\(name)/en_US/slide.png")))
    })
}
struct Bounds {
    var minY = Int.max
    var maxY = -1
    var minX = Int.max
    var maxX = -1
    mutating func add(_ x: Int, _ y: Int) {
        minY = min(minY, y); maxY = max(maxY, y); minX = min(minX, x); maxX = max(maxX, x)
    }
}
func verify(_ data: Data, bottom: Bool, cropped: Bool = false) {
    let decoded = NSBitmapImageRep(data: data)!
    let bitmap = decoded.converting(to: .sRGB, renderingIntent: .default)!
    var text = Bounds(); var frame = Bounds()
    var textRows: [Int: Int] = [:]
    for y in 0..<bitmap.pixelsHigh {
        for x in 0..<bitmap.pixelsWide {
            var pixel = [Int](repeating: 0, count: bitmap.samplesPerPixel)
            bitmap.getPixel(&pixel, atX: x, y: y)
            if pixel[2] > 204 && pixel[0] < 90 && pixel[1] < 90 {
                text.add(x, y); textRows[y, default: 0] += 1
            }
            if pixel[1] > 204 && pixel[0] < 51 && pixel[2] < 51 {
                frame.add(x, y)
            }
        }
    }
    check(text.maxY >= 0 && frame.maxY >= 0, "Rendered caption and frame must be visible")
    check(bottom ? text.minY > frame.maxY : text.maxY < frame.minY, "Caption must be on requested side of frame")
    check(bottom ? text.minY > bitmap.pixelsHigh / 2 : text.maxY < bitmap.pixelsHigh / 2, "Caption must use requested canvas edge")
    check(bottom ? text.minY - frame.maxY > 40 : frame.minY - text.maxY > 40, "Screenshot gap must be preserved")
    check(bottom ? bitmap.pixelsHigh - text.maxY >= 80 : text.minY >= 80, "Outer caption padding must be preserved")
    if cropped { check(frame.minY == 0, "Oversized bottom frame must crop at top") }
    let middle = (text.minY + text.maxY) / 2
    let first = textRows.filter { $0.key < middle }.values.reduce(0, +)
    let second = textRows.filter { $0.key >= middle }.values.reduce(0, +)
    check(first > second, "ALPHA must remain above BETA; caption lines must not be reversed")
}
let legacy = try render(nil)
let explicitTop = try render(["iphone": "top", "ipad": "top"])
check(legacy == explicitTop, "Default and explicit top output must be byte-identical")
for data in legacy.values { verify(data, bottom: false) }
let mixed = try render(["iphone": "bottom"])
check(mixed["ipad"] == legacy["ipad"], "Editing iPhone must preserve iPad output")
verify(mixed["iphone"]!, bottom: true, cropped: true)
let allBottom = try render(["iphone": "bottom", "ipad": "bottom"])
check(allBottom["iphone"] == mixed["iphone"], "Editing iPad must preserve iPhone output")
verify(allBottom["ipad"]!, bottom: true, cropped: true)
_ = try render(["iphone": "left"], valid: false)
var namedCaption = config["caption"] as! [String: Any]
namedCaption["fontName"] = "ArialRoundedMTBold"
config["caption"] = namedCaption
let rounded = try render(["iphone": "bottom", "ipad": "bottom"])
check(rounded["iphone"] != allBottom["iphone"], "Named font must change rendered caption pixels")
for data in rounded.values { verify(data, bottom: true, cropped: true) }
namedCaption["fontName"] = "MissingAppStoreCaptionFont"
config["caption"] = namedCaption
_ = try render(nil, valid: false)
print("Caption renderer regression checks passed")
