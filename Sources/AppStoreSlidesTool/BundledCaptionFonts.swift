import AppKit
import CoreText

enum BundledCaptionFonts {
    private static let dmSansDescriptor: Result<NSFontDescriptor, Error> = Result {
        guard let url = Bundle.module.url(forResource: "DMSans", withExtension: "ttf", subdirectory: "Fonts") else {
            throw ToolError.invalidConfig("Bundled DM Sans font is missing")
        }
        guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
              let descriptor = descriptors.first else {
            throw ToolError.invalidConfig("Could not read bundled DM Sans font")
        }
        return descriptor as NSFontDescriptor
    }

    static func dmSans(size: CGFloat, weight: String?) throws -> NSFont {
        let weightValue: Double
        switch weight?.lowercased() {
        case "thin": weightValue = 100
        case "ultralight": weightValue = 200
        case "light": weightValue = 300
        case "regular": weightValue = 400
        case "medium": weightValue = 500
        case "semibold": weightValue = 600
        case "heavy": weightValue = 800
        case "black": weightValue = 900
        default: weightValue = 700
        }
        let descriptor = try dmSansDescriptor.get().addingAttributes([
            .variation: [
                NSNumber(value: 0x77676874): weightValue, // wght
                NSNumber(value: 0x6f70737a): Double(min(40, max(9, size))) // opsz
            ]
        ])
        guard let font = NSFont(descriptor: descriptor, size: size) else {
            throw ToolError.invalidConfig("Could not create bundled DM Sans caption font")
        }
        return font
    }
}
