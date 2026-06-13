import AppKit
import Foundation

struct SlideConfig: Decodable {
    let name: String
    let version: String
    let defaultLocale: String
    let outputRoot: String
    let background: BackgroundConfig
    let caption: CaptionConfig
    let devices: [String: DeviceConfig]
    let slides: [Slide]
}

struct BackgroundConfig: Decodable {
    let color: String
}

struct CaptionConfig: Decodable {
    let fontSize: CGFloat
    let fontWeight: String?
    let color: String
    let topPadding: CGFloat
    let bottomPadding: CGFloat?
    let horizontalPadding: CGFloat
    let lineHeight: CGFloat
    let maxLines: Int
}

struct DeviceConfig: Decodable {
    let appStorePreset: String
    let canvas: SizeConfig
    let screenshotRoot: String
    let frame: FrameConfig
}

struct SizeConfig: Decodable {
    let width: Int
    let height: Int
}

struct FrameConfig: Decodable {
    let image: String
    let screen: RectConfig
    let screenCornerRadius: CGFloat?
    let scale: CGFloat
    let top: CGFloat
}

struct RectConfig: Decodable {
    let x: CGFloat
    let y: CGFloat
    let width: CGFloat
    let height: CGFloat
}

struct PointConfig: Decodable {
    let x: CGFloat
    let y: CGFloat
}

struct LoupeConfig: Decodable {
    let enabled: Bool?
    let center: PointConfig?
    let sourceCenter: PointConfig?
    let radius: CGFloat?
    let width: CGFloat?
    let height: CGFloat?
    let cornerRadius: CGFloat?
    let zoom: CGFloat?
    let borderColor: String?
    let borderWidth: CGFloat?
    let shadowColor: String?
    let shadowOpacity: CGFloat?
    let shadowBlur: CGFloat?
    let shadowOffset: PointConfig?
}

struct Slide: Decodable {
    let id: String
    let screenshot: String
    let captions: [String: String]
    let backgroundColor: String?
    let loupe: LoupeConfig?
}

enum ToolError: Error, CustomStringConvertible {
    case usage(String)
    case invalidConfig(String)
    case missingFile(String)
    case renderFailed(String)

    var description: String {
        switch self {
        case .usage(let message), .invalidConfig(let message), .missingFile(let message), .renderFailed(let message):
            return message
        }
    }
}

struct Arguments {
    var configPath: String?
    var device = "iphone"
    var locale: String?
    var outputRootOverride: String?
    var versionOverride: String?
    var slideId: String?
    var validateOnly = false
    var listSpecs = false
}

let appStorePresets: [String: Set<String>] = [
    "iphone-6.9": ["1290x2796", "1320x2868", "2796x1290", "2868x1320"],
    "ipad-13": ["2048x2732", "2064x2752", "2732x2048", "2752x2064"]
]

func parseArguments(_ raw: [String]) throws -> Arguments {
    var arguments = Arguments()
    var index = 1

    while index < raw.count {
        let arg = raw[index]
        switch arg {
        case "--config":
            index += 1
            guard index < raw.count else { throw ToolError.usage("--config requires a path") }
            arguments.configPath = raw[index]
        case "--device":
            index += 1
            guard index < raw.count else { throw ToolError.usage("--device requires iphone, ipad, or all") }
            arguments.device = raw[index]
        case "--locale":
            index += 1
            guard index < raw.count else { throw ToolError.usage("--locale requires a locale code") }
            arguments.locale = raw[index]
        case "--output":
            index += 1
            guard index < raw.count else { throw ToolError.usage("--output requires a path") }
            arguments.outputRootOverride = raw[index]
        case "--version":
            index += 1
            guard index < raw.count else { throw ToolError.usage("--version requires a version directory name") }
            arguments.versionOverride = raw[index]
        case "--slide":
            index += 1
            guard index < raw.count else { throw ToolError.usage("--slide requires a slide id") }
            arguments.slideId = raw[index]
        case "--validate-only":
            arguments.validateOnly = true
        case "--list-specs":
            arguments.listSpecs = true
        case "--help", "-h":
            printUsageAndExit()
        default:
            throw ToolError.usage("Unknown argument: \(arg)")
        }
        index += 1
    }

    return arguments
}

func printUsageAndExit() -> Never {
    print("""
    app-store-slides-tool

    Usage:
      swift run app-store-slides-tool --config <path-to-config.json> --device iphone --locale en_US

    Options:
      --config <path>       JSON configuration path
      --device <name>       iphone, ipad, or all
      --locale <code>       caption locale, defaults to config defaultLocale
      --slide <id>          render a single slide id
      --output <path>       override output root
      --version <name>      override output version directory (for example v1.11.0)
      --validate-only       validate config and inputs without rendering
      --list-specs          print supported App Store canvas presets
    """)
    exit(0)
}

func listSpecsAndExit() -> Never {
    for key in appStorePresets.keys.sorted() {
        let sizes = appStorePresets[key]!.sorted().joined(separator: ", ")
        print("\(key): \(sizes)")
    }
    exit(0)
}

func resolve(_ path: String, relativeTo baseURL: URL) -> URL {
    let expanded = NSString(string: path).expandingTildeInPath
    if expanded.hasPrefix("/") {
        return URL(fileURLWithPath: expanded).standardizedFileURL
    }
    return baseURL.appendingPathComponent(path).standardizedFileURL
}

func validate(device name: String, config: DeviceConfig) throws {
    let key = "\(config.canvas.width)x\(config.canvas.height)"
    guard let allowed = appStorePresets[config.appStorePreset] else {
        throw ToolError.invalidConfig("Unknown App Store preset '\(config.appStorePreset)' for \(name)")
    }
    guard allowed.contains(key) else {
        let sizes = allowed.sorted().joined(separator: ", ")
        throw ToolError.invalidConfig("\(name) canvas \(key) is not valid for \(config.appStorePreset). Allowed: \(sizes)")
    }
}

func image(at url: URL) throws -> NSImage {
    guard FileManager.default.fileExists(atPath: url.path) else {
        throw ToolError.missingFile("Missing file: \(url.path)")
    }
    guard let image = NSImage(contentsOf: url) else {
        throw ToolError.renderFailed("Could not load image: \(url.path)")
    }
    if let rep = image.representations.first {
        image.size = NSSize(width: rep.pixelsWide, height: rep.pixelsHigh)
    }
    return image
}

func nsColor(hex: String) throws -> NSColor {
    var value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.hasPrefix("#") {
        value.removeFirst()
    }
    guard value.count == 6, let intValue = Int(value, radix: 16) else {
        throw ToolError.invalidConfig("Invalid color: \(hex)")
    }

    let red = CGFloat((intValue >> 16) & 0xff) / 255.0
    let green = CGFloat((intValue >> 8) & 0xff) / 255.0
    let blue = CGFloat(intValue & 0xff) / 255.0
    return NSColor(calibratedRed: red, green: green, blue: blue, alpha: 1)
}

func font(for caption: CaptionConfig) -> NSFont {
    let weight: NSFont.Weight
    switch caption.fontWeight?.lowercased() {
    case "black", "heavy":
        weight = .heavy
    case "semibold":
        weight = .semibold
    case "medium":
        weight = .medium
    case "regular":
        weight = .regular
    default:
        weight = .bold
    }
    return NSFont.systemFont(ofSize: caption.fontSize, weight: weight)
}

func textWidth(_ text: String, attributes: [NSAttributedString.Key: Any]) -> CGFloat {
    NSString(string: text).size(withAttributes: attributes).width
}

func wrappedLines(text: String, maxWidth: CGFloat, maxLines: Int, attributes: [NSAttributedString.Key: Any]) -> [String] {
    let manualLines = text
        .components(separatedBy: .newlines)
        .flatMap { paragraph -> [String] in
            let words = paragraph.split(separator: " ").map(String.init)
            guard !words.isEmpty else { return [""] }

            var lines: [String] = []
            var current = ""

            for word in words {
                let candidate = current.isEmpty ? word : "\(current) \(word)"
                if textWidth(candidate, attributes: attributes) <= maxWidth || current.isEmpty {
                    current = candidate
                } else {
                    lines.append(current)
                    current = word
                }
            }

            if !current.isEmpty {
                lines.append(current)
            }
            return lines
        }

    if manualLines.count <= maxLines {
        return manualLines
    }

    var clipped = Array(manualLines.prefix(maxLines))
    let ellipsis = "..."
    var last = clipped[maxLines - 1]
    while textWidth(last + ellipsis, attributes: attributes) > maxWidth, !last.isEmpty {
        last.removeLast()
    }
    clipped[maxLines - 1] = last + ellipsis
    return clipped
}

func bitmapImage(width: Int, height: Int, draw: () throws -> Void) throws -> NSImage {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: width,
        pixelsHigh: height,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        throw ToolError.renderFailed("Could not allocate \(width)x\(height) canvas")
    }

    bitmap.size = NSSize(width: width, height: height)
    guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw ToolError.renderFailed("Could not create bitmap context")
    }

    let previousContext = NSGraphicsContext.current
    NSGraphicsContext.current = context
    defer {
        context.flushGraphics()
        NSGraphicsContext.current = previousContext
    }

    try draw()

    let image = NSImage(size: NSSize(width: width, height: height))
    image.addRepresentation(bitmap)
    return image
}

func pngData(from image: NSImage) throws -> Data {
    if let bitmap = image.representations.compactMap({ $0 as? NSBitmapImageRep }).first,
       let data = bitmap.representation(using: .png, properties: [:]) {
        return data
    }

    guard let tiffData = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiffData),
          let data = bitmap.representation(using: .png, properties: [:]) else {
        throw ToolError.renderFailed("Could not encode PNG")
    }
    return data
}

func compositeDevice(screenshot: NSImage, frame: NSImage, frameConfig: FrameConfig) throws -> NSImage {
    let frameSize = frame.size
    let frameWidth = Int(frameSize.width.rounded())
    let frameHeight = Int(frameSize.height.rounded())

    return try bitmapImage(width: frameWidth, height: frameHeight) {
        NSColor.clear.setFill()
        NSRect(origin: .zero, size: frameSize).fill()

        let screen = frameConfig.screen
        let screenRect = NSRect(
            x: screen.x,
            y: frameSize.height - screen.y - screen.height,
            width: screen.width,
            height: screen.height
        )

        if let radius = frameConfig.screenCornerRadius, radius > 0 {
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(roundedRect: screenRect, xRadius: radius, yRadius: radius).addClip()
            screenshot.draw(in: screenRect, from: .zero, operation: .sourceOver, fraction: 1.0)
            NSGraphicsContext.restoreGraphicsState()
        } else {
            screenshot.draw(in: screenRect, from: .zero, operation: .sourceOver, fraction: 1.0)
        }
        frame.draw(in: NSRect(origin: .zero, size: frameSize), from: .zero, operation: .sourceOver, fraction: 1.0)
    }
}

func clamped(_ value: CGFloat, min lower: CGFloat, max upper: CGFloat) -> CGFloat {
    Swift.max(lower, Swift.min(value, upper))
}

func resolvedLoupeCenterX(canvasWidth: CGFloat) -> CGFloat {
    canvasWidth / 2
}

func renderLoupe(
    baseImage: NSImage,
    loupe: LoupeConfig,
    canvasWidth: CGFloat,
    canvasHeight: CGFloat,
    deviceName: String
) throws -> NSImage {
    guard loupe.enabled ?? true else {
        return baseImage
    }
    guard let center = loupe.center else {
        return baseImage
    }

    let loupeWidth = clamped(loupe.width ?? canvasWidth, min: 48, max: canvasWidth)
    let loupeHeight = clamped(loupe.height ?? max(160, canvasHeight * 0.08), min: 0, max: canvasHeight)
    let cornerRadius = clamped(loupe.cornerRadius ?? 48, min: 0, max: min(loupeWidth, loupeHeight) / 2)
    let zoom = clamped(loupe.zoom ?? 2, min: 1.1, max: 6)
    let sourceCenter = loupe.sourceCenter ?? center
    let centerX = resolvedLoupeCenterX(canvasWidth: canvasWidth)
    let centerY = clamped(center.y, min: 0, max: canvasHeight)
    let sourceCenterX = resolvedLoupeCenterX(canvasWidth: canvasWidth)
    let sourceCenterY = clamped(sourceCenter.y, min: 0, max: canvasHeight)
    let loupeRect = NSRect(
        x: centerX - (loupeWidth / 2),
        y: canvasHeight - centerY - (loupeHeight / 2),
        width: loupeWidth,
        height: loupeHeight
    )
    let loupeCenter = NSPoint(x: centerX, y: canvasHeight - centerY)
    let sourceCenterFromBottom = NSPoint(x: sourceCenterX, y: canvasHeight - sourceCenterY)
    let zoomedImageRect = NSRect(
        x: loupeCenter.x - (sourceCenterFromBottom.x * zoom),
        y: loupeCenter.y - (sourceCenterFromBottom.y * zoom),
        width: canvasWidth * zoom,
        height: canvasHeight * zoom
    )

    return try bitmapImage(width: Int(canvasWidth), height: Int(canvasHeight)) {
        baseImage.draw(
            in: NSRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight),
            from: .zero,
            operation: .sourceOver,
            fraction: 1.0
        )

        let loupePath = NSBezierPath(roundedRect: loupeRect, xRadius: cornerRadius, yRadius: cornerRadius)
        let shadowOpacity = clamped(loupe.shadowOpacity ?? 0.22, min: 0, max: 1)
        if shadowOpacity > 0 {
            let shadow = NSShadow()
            shadow.shadowColor = try nsColor(hex: loupe.shadowColor ?? "#000000").withAlphaComponent(shadowOpacity)
            shadow.shadowBlurRadius = loupe.shadowBlur ?? 28
            let shadowOffset = loupe.shadowOffset ?? PointConfig(x: 0, y: 18)
            shadow.shadowOffset = NSSize(width: shadowOffset.x, height: -shadowOffset.y)

            NSGraphicsContext.saveGraphicsState()
            shadow.set()
            NSColor.black.withAlphaComponent(0.02).setFill()
            loupePath.fill()
            NSGraphicsContext.restoreGraphicsState()
        }

        NSGraphicsContext.saveGraphicsState()
        loupePath.addClip()
        baseImage.draw(in: zoomedImageRect, from: .zero, operation: .sourceOver, fraction: 1.0)
        NSGraphicsContext.restoreGraphicsState()

        let borderWidth = loupe.borderWidth ?? 2
        if borderWidth > 0 {
            (try nsColor(hex: loupe.borderColor ?? "#000000")).setStroke()
            loupePath.lineWidth = borderWidth
            loupePath.stroke()
        }
    }
}

func renderBaseSlide(
    slide: Slide,
    slideConfig: SlideConfig,
    deviceName: String,
    device: DeviceConfig,
    locale: String,
    configBaseURL: URL
) throws -> NSImage {
    let canvasWidth = CGFloat(device.canvas.width)
    let canvasHeight = CGFloat(device.canvas.height)
    let frameURL = resolve(device.frame.image, relativeTo: configBaseURL)
    let screenshotRoot = resolve(device.screenshotRoot, relativeTo: configBaseURL)
    let screenshotURL = screenshotRoot.appendingPathComponent(slide.screenshot)
    let frameImage = try image(at: frameURL)
    let screenshotImage = try image(at: screenshotURL)
    let deviceImage = try compositeDevice(screenshot: screenshotImage, frame: frameImage, frameConfig: device.frame)

    let backgroundColor = try nsColor(hex: slide.backgroundColor ?? slideConfig.background.color)
    let captionColor = try nsColor(hex: slideConfig.caption.color)
    let captionFont = font(for: slideConfig.caption)
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center

    let attributes: [NSAttributedString.Key: Any] = [
        .font: captionFont,
        .foregroundColor: captionColor,
        .paragraphStyle: paragraph
    ]

    let captionText = slide.captions[locale] ?? slide.captions[slideConfig.defaultLocale] ?? slide.id
    let maxTextWidth = canvasWidth - (slideConfig.caption.horizontalPadding * 2)
    let lines = wrappedLines(
        text: captionText,
        maxWidth: maxTextWidth,
        maxLines: slideConfig.caption.maxLines,
        attributes: attributes
    )
    let lineHeight = slideConfig.caption.fontSize * slideConfig.caption.lineHeight
    let captionBlockHeight = CGFloat(lines.count) * lineHeight
    let computedDeviceTop = slideConfig.caption.topPadding
        + captionBlockHeight
        + (slideConfig.caption.bottomPadding ?? 0)
    let deviceTop = max(device.frame.top, computedDeviceTop)

    return try bitmapImage(width: device.canvas.width, height: device.canvas.height) {
        backgroundColor.setFill()
        NSRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight).fill()

        for (index, line) in lines.enumerated() {
            let top = slideConfig.caption.topPadding + (CGFloat(index) * lineHeight)
            let descentPadding = ceil(slideConfig.caption.fontSize * 0.08)
            let rect = NSRect(
                x: slideConfig.caption.horizontalPadding,
                y: canvasHeight - top - lineHeight - descentPadding,
                width: maxTextWidth,
                height: lineHeight + (descentPadding * 2)
            )
            NSString(string: line).draw(with: rect, options: [.usesLineFragmentOrigin], attributes: attributes)
        }

        let scaledFrameSize = NSSize(
            width: deviceImage.size.width * device.frame.scale,
            height: deviceImage.size.height * device.frame.scale
        )
        let frameRect = NSRect(
            x: (canvasWidth - scaledFrameSize.width) / 2,
            y: canvasHeight - deviceTop - scaledFrameSize.height,
            width: scaledFrameSize.width,
            height: scaledFrameSize.height
        )
        deviceImage.draw(in: frameRect, from: .zero, operation: .sourceOver, fraction: 1.0)
    }
}

func renderSlide(
    slide: Slide,
    slideConfig: SlideConfig,
    outputVersion: String,
    deviceName: String,
    device: DeviceConfig,
    locale: String,
    configBaseURL: URL,
    outputRoot: URL
) throws -> URL {
    let baseSlide = try renderBaseSlide(
        slide: slide,
        slideConfig: slideConfig,
        deviceName: deviceName,
        device: device,
        locale: locale,
        configBaseURL: configBaseURL
    )
    let output: NSImage
    if let loupe = slide.loupe {
        output = try renderLoupe(
            baseImage: baseSlide,
            loupe: loupe,
            canvasWidth: CGFloat(device.canvas.width),
            canvasHeight: CGFloat(device.canvas.height),
            deviceName: deviceName
        )
    } else {
        output = baseSlide
    }

    let localeOutput = outputRoot
        .appendingPathComponent(outputVersion)
        .appendingPathComponent(deviceName)
        .appendingPathComponent(locale)
    try FileManager.default.createDirectory(at: localeOutput, withIntermediateDirectories: true)

    let outputURL = localeOutput.appendingPathComponent("\(slide.id).png")
    try pngData(from: output).write(to: outputURL, options: .atomic)
    return outputURL
}

func run() throws {
    let args = try parseArguments(CommandLine.arguments)
    if args.listSpecs {
        listSpecsAndExit()
    }

    guard let configPath = args.configPath else {
        throw ToolError.usage("--config is required")
    }

    let configURL = URL(fileURLWithPath: NSString(string: configPath).expandingTildeInPath)
    let configBaseURL = configURL.deletingLastPathComponent()
    let data = try Data(contentsOf: configURL)
    let slideConfig = try JSONDecoder().decode(SlideConfig.self, from: data)
    let locale = args.locale ?? slideConfig.defaultLocale
    let outputRoot = resolve(args.outputRootOverride ?? slideConfig.outputRoot, relativeTo: configBaseURL)
    let outputVersion = args.versionOverride ?? slideConfig.version

    let deviceNames: [String]
    if args.device == "all" {
        deviceNames = slideConfig.devices.keys.sorted()
    } else {
        deviceNames = [args.device]
    }

    for deviceName in deviceNames {
        guard let device = slideConfig.devices[deviceName] else {
            throw ToolError.invalidConfig("Unknown device '\(deviceName)'")
        }
        try validate(device: deviceName, config: device)

        let frameURL = resolve(device.frame.image, relativeTo: configBaseURL)
        _ = try image(at: frameURL)

        let screenshotRoot = resolve(device.screenshotRoot, relativeTo: configBaseURL)
        let slidesToRender: [Slide]
        if let slideId = args.slideId {
            guard let slide = slideConfig.slides.first(where: { $0.id == slideId }) else {
                throw ToolError.invalidConfig("Unknown slide '\(slideId)'")
            }
            slidesToRender = [slide]
        } else {
            slidesToRender = slideConfig.slides
        }

        for slide in slidesToRender {
            let screenshotURL = screenshotRoot.appendingPathComponent(slide.screenshot)
            guard FileManager.default.fileExists(atPath: screenshotURL.path) else {
                throw ToolError.missingFile("Missing screenshot for \(slide.id): \(screenshotURL.path)")
            }
        }

        if args.validateOnly {
            print("Validated \(deviceName): \(device.canvas.width)x\(device.canvas.height), \(slidesToRender.count) slides")
            continue
        }

        for slide in slidesToRender {
            let outputURL = try renderSlide(
                slide: slide,
                slideConfig: slideConfig,
                outputVersion: outputVersion,
                deviceName: deviceName,
                device: device,
                locale: locale,
                configBaseURL: configBaseURL,
                outputRoot: outputRoot
            )
            print("Generated \(outputURL.path)")
        }
    }
}

do {
    try run()
} catch let error as ToolError {
    fputs("error: \(error.description)\n", stderr)
    exit(1)
} catch {
    fputs("error: \(error.localizedDescription)\n", stderr)
    exit(1)
}
