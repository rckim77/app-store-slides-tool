const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const developmentRoot = path.resolve(root, "..");
const publicRoot = path.join(__dirname, "public");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png"
};

const imageExtensions = new Set([".jpeg", ".jpg", ".png"]);
const options = parseArgs(process.argv.slice(2));

function parseArgs(args) {
  const parsed = {
    config: null,
    configDir: null,
    device: "iphone",
    locale: null,
    port: Number(process.env.PORT || 4321),
    renderOnStart: true,
    slidesRoot: null,
    version: null,
    open: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--config":
        parsed.config = path.resolve(args[++index]);
        break;
      case "--config-dir":
        parsed.configDir = path.resolve(args[++index]);
        break;
      case "--device":
        parsed.device = args[++index];
        break;
      case "--locale":
        parsed.locale = args[++index];
        break;
      case "--no-render":
      case "--no-initial-render":
        parsed.renderOnStart = false;
        break;
      case "--open":
        parsed.open = true;
        break;
      case "--slides-root":
      case "--output-root":
        parsed.slidesRoot = path.resolve(args[++index]);
        break;
      case "--port":
        parsed.port = Number(args[++index]);
        break;
      case "--version":
        parsed.version = args[++index];
        break;
      case "--help":
      case "-h":
        printUsageAndExit();
        break;
      default:
        throw new Error(`Unknown editor argument: ${arg}`);
    }
  }

  if (!Number.isInteger(parsed.port) || parsed.port <= 0) {
    throw new Error("--port must be a positive integer");
  }

  return parsed;
}

function printUsageAndExit() {
  console.log(`app-store-slides-tool editor

Usage:
  Scripts/editor.sh --device iphone --locale en --port 4321
  Scripts/editor.sh --config <path> --slides-root <path> --version v1.10.1 --no-render

Options:
  --config <path>       JSON configuration path
  --config-dir <path>   Directory of JSON configs; matching locales are editable from one editor session
  --device <name>       Preferred starting device tab
  --locale <code>       Preferred starting locale tab
  --version <version>   Preferred starting version
  --slides-root <path>  Existing slide output folder to browse; may be an output root or a version folder
  --no-render           Do not rerender slides on editor startup
  --open                Open the editor URL after the server starts
  --port <port>         localhost port, defaults to 4321`);
  process.exit(0);
}

function configPaths() {
  if (!options.configDir) {
    if (!options.config) {
      throw new Error("Pass --config <path> or --config-dir <path>");
    }
    return [options.config];
  }
  if (!isDirectory(options.configDir)) {
    throw new Error(`Missing config directory: ${options.configDir}`);
  }
  const paths = fs.readdirSync(options.configDir)
    .filter((name) => path.extname(name).toLowerCase() === ".json")
    .map((name) => path.join(options.configDir, name))
    .sort();
  if (paths.length === 0) {
    throw new Error(`No JSON configs found in ${options.configDir}`);
  }
  return paths;
}

function primaryConfigPath() {
  return configPaths()[0];
}

function readConfig(configPath = primaryConfigPath()) {
  const body = fs.readFileSync(configPath, "utf8");
  return JSON.parse(body);
}

function readConfigEntries() {
  return configPaths().map((configPath) => ({
    configPath,
    config: readConfig(configPath)
  }));
}

function writeConfig(config, configPath = primaryConfigPath()) {
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function resolveFromConfig(configPath, value) {
  if (path.isAbsolute(value)) {
    return path.normalize(value);
  }
  return path.resolve(path.dirname(configPath), value);
}

function outputRoot(config, configPath = primaryConfigPath()) {
  return resolveFromConfig(configPath, config.outputRoot);
}

function scanRoots(config, configPath = primaryConfigPath()) {
  const requestedRoot = options.slidesRoot || outputRoot(config, configPath);
  if (isVersionDirectory(path.basename(requestedRoot))) {
    return [{
      root: path.dirname(requestedRoot),
      versions: [path.basename(requestedRoot)]
    }];
  }

  if (!isDirectory(requestedRoot)) {
    return [];
  }

  return [{
    root: requestedRoot,
    versions: fs.readdirSync(requestedRoot).filter(isVersionDirectory).sort(compareVersionsDescending)
  }];
}

function outputDirectory(config, version, locale, deviceName) {
  return path.join(outputRoot(config), version, locale, deviceName);
}

function renderedFile(config, slideId, version, locale, deviceName) {
  return path.join(outputDirectory(config, version, locale, deviceName), `${slideId}.png`);
}

function renderSlides(config, deviceName, locale, slideId = null, configPath = primaryConfigPath(), outputVersion = null) {
  const script = path.join(root, "Scripts/render.sh");
  const args = [
    "--config",
    configPath,
    "--device",
    deviceName,
    "--locale",
    locale
  ];
  if (outputVersion) {
    args.push("--version", outputVersion);
  }
  if (slideId) {
    args.push("--slide", slideId);
  }
  const result = spawnSync(script, args, {
    cwd: root,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(details || "Slide render failed");
  }
}

function editorURL() {
  const url = new URL(`http://127.0.0.1:${options.port}`);
  if (options.device) {
    url.searchParams.set("device", options.device);
  }
  if (options.version) {
    url.searchParams.set("version", options.version);
  }
  if (options.locale) {
    url.searchParams.set("locale", options.locale);
  }
  return url.toString();
}

function slideEntry(config, configuredSlide, locale, filePath) {
  return {
    id: configuredSlide.id,
    caption: slideCaption(config, configuredSlide, locale),
    filename: path.basename(filePath),
    imageUrl: imageURLFor(filePath),
    imagePath: filePath,
    backgroundColor: configuredSlide.backgroundColor || config.background.color,
    usesDefaultBackground: !configuredSlide.backgroundColor,
    loupe: configuredSlide.loupe || null
  };
}

function slidesForDeviceDir(config, deviceDir, locale) {
  const slides = [];
  const seen = new Set();

  for (const configuredSlide of config.slides) {
    const filePath = path.join(deviceDir, `${configuredSlide.id}.png`);
    if (!isFile(filePath)) {
      continue;
    }
    slides.push(slideEntry(config, configuredSlide, locale, filePath));
    seen.add(configuredSlide.id);
  }

  for (const name of fs.readdirSync(deviceDir).sort()) {
    if (!imageExtensions.has(path.extname(name).toLowerCase())) {
      continue;
    }
    const id = path.basename(name, path.extname(name));
    if (seen.has(id)) {
      continue;
    }
    const filePath = path.join(deviceDir, name);
    slides.push({
      id,
      caption: id,
      filename: name,
      imageUrl: imageURLFor(filePath),
      imagePath: filePath,
      backgroundColor: config.background.color,
      usesDefaultBackground: true,
      loupe: null
    });
  }

  return slides;
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function fileVersion(filePath) {
  try {
    return String(Math.round(fs.statSync(filePath).mtimeMs));
  } catch {
    return String(Date.now());
  }
}

function isVersionDirectory(name) {
  return /^v\d+(?:\.\d+){1,3}$/.test(name);
}

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function versionParts(version) {
  return version.replace(/^v/, "").split(".").map((part) => Number(part) || 0);
}

function compareVersionsDescending(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (b[index] || 0) - (a[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return left.localeCompare(right);
}

function sortLocales(locales) {
  const preferredLocale = "en_US";
  return unique(locales).sort((left, right) => {
    if (left === preferredLocale) {
      return -1;
    }
    if (right === preferredLocale) {
      return 1;
    }
    return left.localeCompare(right);
  });
}

function imageURLFor(filePath) {
  const encodedPath = Buffer.from(filePath).toString("base64url");
  return `/image/${encodedPath}?v=${fileVersion(filePath)}`;
}

function slideCaption(config, slide, locale) {
  return slide.captions[locale] || slide.captions[config.defaultLocale] || slide.id;
}

function frameLabel(config, deviceName) {
  const image = config.devices[deviceName]?.frame?.image;
  return image ? path.basename(image) : "Frame not configured";
}

function configHasLocale(config, locale) {
  return config.defaultLocale === locale || config.slides.some((slide) =>
    slide.captions && Object.prototype.hasOwnProperty.call(slide.captions, locale)
  );
}

function generatedSlideSets(config, configPath, includeReadOnlyLocales) {
  const sets = [];
  const editableOutputRoot = outputRoot(config, configPath);

  for (const scanRoot of scanRoots(config, configPath)) {
    for (const version of scanRoot.versions) {
      const versionDir = path.join(scanRoot.root, version);
      if (!isDirectory(versionDir)) {
        continue;
      }
      for (const locale of fs.readdirSync(versionDir).filter((name) => isDirectory(path.join(versionDir, name))).sort()) {
        if (!includeReadOnlyLocales && !configHasLocale(config, locale)) {
          continue;
        }
        const localeDir = path.join(versionDir, locale);
        for (const deviceName of fs.readdirSync(localeDir).filter((name) => isDirectory(path.join(localeDir, name))).sort()) {
          const deviceDir = path.join(localeDir, deviceName);
          const slides = slidesForDeviceDir(config, deviceDir, locale);

          if (slides.length === 0) {
            continue;
          }

          const isEditable = version === config.version
            && Boolean(config.devices[deviceName])
            && configHasLocale(config, locale)
            && isWithin(editableOutputRoot, deviceDir);
          sets.push({
            id: ["generated", version, locale, deviceName].join(":"),
            source: "generated",
            sourceLabel: isEditable ? "Current config" : "Generated output",
            version,
            locale,
            device: deviceName,
            editable: isEditable,
            configPath: isEditable ? configPath : null,
            outputDir: deviceDir,
            canvas: config.devices[deviceName]?.canvas || null,
            frameLabel: frameLabel(config, deviceName),
            defaultBackgroundColor: config.background.color,
            captionConfig: isEditable ? config.caption : null,
            slides
          });
        }
      }
    }
  }

  return sets;
}

function walkImages(directory, files = []) {
  if (!isDirectory(directory)) {
    return files;
  }

  for (const name of fs.readdirSync(directory)) {
    if (name === ".DS_Store" || name.endsWith(".xcresult")) {
      continue;
    }
    const filePath = path.join(directory, name);
    if (isDirectory(filePath)) {
      walkImages(filePath, files);
    } else if (imageExtensions.has(path.extname(name).toLowerCase())) {
      files.push(filePath);
    }
  }
  return files;
}

function matchingScreenshotRoots(config) {
  const appNames = new Set([
    normalizeName(config.name),
    normalizeName(path.basename(outputRoot(config, primaryConfigPath())))
  ]);

  const roots = [];
  for (const projectName of fs.readdirSync(developmentRoot)) {
    const projectPath = path.join(developmentRoot, projectName);
    if (!isDirectory(projectPath)) {
      continue;
    }
    const normalizedProject = normalizeName(projectName);
    const matchesApp = [...appNames].some((name) => name && (normalizedProject.includes(name) || name.includes(normalizedProject)));
    if (!matchesApp) {
      continue;
    }

    const screenshotsRoot = path.join(projectPath, "build", "AppStore", "Screenshots");
    if (isDirectory(screenshotsRoot)) {
      roots.push(screenshotsRoot);
    }
  }
  return roots;
}

function archiveDeviceFor(filePath) {
  const name = path.basename(filePath).toLowerCase();
  const fullPath = filePath.toLowerCase();
  if (name.includes("iphone") || (fullPath.includes("/raw/") && !name.includes("ipad"))) {
    return "iphone";
  }
  if (name.includes("ipad")) {
    return "ipad";
  }
  return null;
}

function archiveLocaleFor(filePath, versionDir) {
  const relativeParts = path.relative(versionDir, filePath).split(path.sep);
  const bracketMatch = path.basename(filePath).match(/\[([a-z]{2}(?:[-_][A-Z]{2})?)\]/);
  if (bracketMatch) {
    return bracketMatch[1].replace("_", "-");
  }
  const framedIndex = relativeParts.indexOf("framed");
  if (framedIndex >= 0 && relativeParts[framedIndex + 1]) {
    return relativeParts[framedIndex + 1];
  }
  return path.basename(path.dirname(filePath));
}

function archiveSlideNumber(filePath) {
  const match = path.basename(filePath).match(/(?:Display - |^)(\d+)/);
  return match ? match[1].padStart(2, "0") : path.basename(filePath, path.extname(filePath));
}

function archiveSlideSets(config) {
  const setsByKey = new Map();
  for (const screenshotsRoot of matchingScreenshotRoots(config)) {
    const projectName = path.relative(developmentRoot, screenshotsRoot).split(path.sep)[0];
    for (const version of fs.readdirSync(screenshotsRoot).filter(isVersionDirectory).sort(compareVersionsDescending)) {
      const versionDir = path.join(screenshotsRoot, version);
      const files = walkImages(versionDir)
        .filter((filePath) => !filePath.includes(`${path.sep}raw${path.sep}`))
        .sort();

      for (const filePath of files) {
        const deviceName = archiveDeviceFor(filePath);
        if (!deviceName) {
          continue;
        }
        const locale = archiveLocaleFor(filePath, versionDir);
        const key = ["archive", version, locale, deviceName].join(":");
        if (!setsByKey.has(key)) {
          setsByKey.set(key, {
            id: key,
            source: "archive",
            sourceLabel: `App archive: ${projectName}`,
            version,
            locale,
            device: deviceName,
            editable: false,
            configPath: null,
            outputDir: path.dirname(filePath),
            canvas: config.devices[deviceName]?.canvas || null,
            frameLabel: frameLabel(config, deviceName),
            defaultBackgroundColor: config.background.color,
            captionConfig: null,
            slides: []
          });
        }

        const set = setsByKey.get(key);
        const slideNumber = archiveSlideNumber(filePath);
        set.slides.push({
          id: `${slideNumber}-${path.basename(filePath, path.extname(filePath))}`,
          caption: path.basename(filePath, path.extname(filePath)),
          filename: path.basename(filePath),
          imageUrl: imageURLFor(filePath),
          imagePath: filePath,
          backgroundColor: null,
          usesDefaultBackground: false,
          loupe: null
        });
      }
    }
  }

  return [...setsByKey.values()].map((set) => ({
    ...set,
    slides: set.slides.sort((left, right) => left.id.localeCompare(right.id))
  }));
}

function allSlideSets() {
  const entries = readConfigEntries();
  const generatedSets = entries.flatMap(({ config, configPath }) =>
    generatedSlideSets(config, configPath, entries.length === 1)
  );
  const primaryConfig = entries[0].config;
  return [...generatedSets, ...archiveSlideSets(primaryConfig)].sort((left, right) => {
    const versionDiff = compareVersionsDescending(left.version, right.version);
    if (versionDiff !== 0) {
      return versionDiff;
    }
    return [left.device, left.locale, left.source].join(":").localeCompare([right.device, right.locale, right.source].join(":"));
  });
}

function selectedSet(sets, query) {
  const preferred = {
    device: query.device || options.device,
    version: query.version || options.version || null,
    locale: query.locale || options.locale || null,
    source: query.source || null
  };

  const currentVersion = readConfig().version;
  const exact = sets.find((set) =>
    (!preferred.device || set.device === preferred.device) &&
    (!preferred.version || set.version === preferred.version) &&
    (!preferred.locale || set.locale === preferred.locale) &&
    (!preferred.source || set.source === preferred.source)
  );
  if (exact) {
    return exact;
  }

  const withoutSource = sets.find((set) =>
    set.source === "generated" &&
    (!preferred.device || set.device === preferred.device) &&
    (!preferred.version || set.version === preferred.version) &&
    (!preferred.locale || set.locale === preferred.locale)
  );
  if (withoutSource) {
    return withoutSource;
  }

  return sets.find((set) => set.editable && set.version === currentVersion && set.device === preferred.device)
    || sets.find((set) => set.version === currentVersion && set.device === preferred.device)
    || sets.find((set) => set.device === preferred.device)
    || sets[0]
    || null;
}

function unique(values) {
  return [...new Set(values)].filter(Boolean);
}

function editorState(query = {}) {
  const config = readConfig();
  const sets = allSlideSets();
  const activeSet = selectedSet(sets, query);

  return {
    appName: config.name,
    configVersion: config.version,
    configPath: options.configDir || primaryConfigPath(),
    globalCaptionColor: globalCaptionColor(),
    globalBackgroundColor: globalBackgroundColor(),
    developmentRoot,
    sets,
    activeSetId: activeSet?.id || null,
    devices: unique(sets.map((set) => set.device)).sort(),
    versions: unique(sets.map((set) => set.version)).sort(compareVersionsDescending),
    locales: sortLocales(sets.map((set) => set.locale)),
    sources: unique(sets.map((set) => set.source)).sort(),
    selected: activeSet ? {
      device: activeSet.device,
      version: activeSet.version,
      locale: activeSet.locale,
      source: activeSet.source
    } : null
  };
}

function normalizeColor(value, fieldName) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${fieldName} must be a #RRGGBB color`);
  }
  return value.toUpperCase();
}

function clampedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function sanitizedPoint(value, fallback, canvas) {
  return {
    x: clampedNumber(value && value.x, fallback.x, 0, canvas.width),
    y: clampedNumber(value && value.y, fallback.y, 0, canvas.height)
  };
}

function loupeReferenceCanvas(config, deviceName) {
  return config.devices.iphone?.canvas || config.devices[deviceName]?.canvas;
}

function sanitizeLoupe(value, referenceCanvas, deviceName = "iphone") {
  if (!value || value.enabled === false) {
    return null;
  }

  // Loupe coordinates are stored in iPhone canvas space so one slide config works on both devices.
  const centerX = referenceCanvas.width / 2;
  const fallbackY = referenceCanvas.height * 0.55;
  const centerY = clampedNumber(value.center && value.center.y, fallbackY, 0, referenceCanvas.height);
  const center = { x: centerX, y: centerY };
  const width = clampedNumber(value.width, referenceCanvas.width, 48, referenceCanvas.width);
  const height = clampedNumber(
    value.height,
    Math.max(160, Math.round(referenceCanvas.height * 0.08)),
    0,
    referenceCanvas.height
  );
  const cornerRadius = clampedNumber(
    value.cornerRadius,
    48,
    0,
    Math.min(width, height) / 2
  );
  const borderWidth = value.borderWidth === 0
    ? 0
    : clampedNumber(value.borderWidth, 2, 0, 12);

  return {
    enabled: true,
    center,
    sourceCenter: { x: centerX, y: centerY },
    width,
    height,
    cornerRadius,
    zoom: clampedNumber(value.zoom, deviceName === "ipad" ? 2.8 : 2, 1.1, 6),
    borderColor: borderWidth > 0 ? normalizeColor(value.borderColor || "#000000", "loupe.borderColor") : null,
    borderWidth,
    shadowColor: normalizeColor(value.shadowColor || "#000000", "loupe.shadowColor"),
    shadowOpacity: clampedNumber(value.shadowOpacity, 0.22, 0, 1),
    shadowBlur: clampedNumber(value.shadowBlur, 28, 0, 120),
    shadowOffset: sanitizedPoint(value.shadowOffset, { x: 0, y: 18 }, { width: 200, height: 200 })
  };
}

function sanitizeCaptionText(value) {
  if (typeof value !== "string") {
    throw new Error("captionText must be a string");
  }

  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    throw new Error("captionText cannot be empty");
  }

  const lines = normalized.split("\n");
  if (lines.length > 2) {
    return lines.slice(0, 2).join("\n");
  }

  return normalized;
}

const DEFAULT_CAPTION_COLOR = "#000000";

function sanitizeCaption(value, existing) {
  if (!value) {
    return existing;
  }

  const next = {
    ...existing,
    topPadding: clampedNumber(value.topPadding, existing.topPadding, 0, 900),
    bottomPadding: clampedNumber(value.bottomPadding, existing.bottomPadding || 0, 0, 900),
    horizontalPadding: clampedNumber(value.horizontalPadding, existing.horizontalPadding, 0, 700)
  };

  if (Object.prototype.hasOwnProperty.call(value, "color")) {
    next.color = normalizeColor(value.color, "caption.color") || DEFAULT_CAPTION_COLOR;
  }

  return next;
}

function localeFromConfigPath(configPath) {
  return path.basename(configPath, path.extname(configPath));
}

function allLocaleConfigEntries() {
  return readConfigEntries();
}

function syncVersionAcrossLocales(targetVersion) {
  if (!targetVersion) {
    return;
  }
  for (const { configPath, config } of allLocaleConfigEntries()) {
    if (config.version === targetVersion) {
      continue;
    }
    config.version = targetVersion;
    writeConfig(config, configPath);
  }
}

function globalCaptionColor() {
  const entries = readConfigEntries();
  if (entries.length === 0) {
    return DEFAULT_CAPTION_COLOR;
  }
  return entries[0].config.caption?.color || DEFAULT_CAPTION_COLOR;
}

function syncCaptionColorAcrossLocales(color) {
  const normalized = normalizeColor(color, "caption.color") || DEFAULT_CAPTION_COLOR;
  for (const { configPath, config } of readConfigEntries()) {
    config.caption = {
      ...config.caption,
      color: normalized
    };
    writeConfig(config, configPath);
  }
  return normalized;
}

function captionPaddingFingerprint(caption) {
  return JSON.stringify({
    topPadding: caption.topPadding,
    bottomPadding: caption.bottomPadding,
    horizontalPadding: caption.horizontalPadding
  });
}

function captionPaddingWillChange(caption, padding) {
  if (!padding) {
    return false;
  }
  const paddingOnly = { ...padding };
  delete paddingOnly.color;
  return captionPaddingFingerprint(caption)
    !== captionPaddingFingerprint(sanitizeCaption(paddingOnly, caption));
}

function syncCaptionPaddingAcrossLocales(padding) {
  const paddingOnly = { ...padding };
  delete paddingOnly.color;
  for (const { configPath, config } of readConfigEntries()) {
    config.caption = sanitizeCaption(paddingOnly, config.caption);
    writeConfig(config, configPath);
  }
  return paddingOnly;
}

function globalBackgroundColor() {
  const entries = readConfigEntries();
  if (entries.length === 0) {
    return "#FFFFFF";
  }
  return entries[0].config.background?.color || "#FFFFFF";
}

function syncBackgroundColorAcrossLocales(color) {
  const normalized = normalizeColor(color, "background.color");
  for (const { configPath, config } of readConfigEntries()) {
    config.background = {
      ...config.background,
      color: normalized
    };
    for (const slide of config.slides) {
      delete slide.backgroundColor;
    }
    writeConfig(config, configPath);
  }
  return normalized;
}

function renderAllSlidesForCaptionColor(outputVersion) {
  for (const { configPath, config } of allLocaleConfigEntries()) {
    const locale = localeFromConfigPath(configPath);
    renderSlides(config, "all", locale, null, configPath, outputVersion);
  }
}

function renderAllSlidesForBackgroundColor(outputVersion) {
  for (const { configPath, config } of allLocaleConfigEntries()) {
    const locale = localeFromConfigPath(configPath);
    renderSlides(config, "all", locale, null, configPath, outputVersion);
  }
}

function renderAllSlidesForCaptionPadding(outputVersion) {
  for (const { configPath, config } of allLocaleConfigEntries()) {
    const locale = localeFromConfigPath(configPath);
    renderSlides(config, "all", locale, null, configPath, outputVersion);
  }
}

function previewRefreshScope({
  captionColorChanged,
  backgroundColorChanged,
  captionPaddingChanged,
  refreshAllSlides,
  loupeChanged,
  singleSlideId
}) {
  if (captionColorChanged || backgroundColorChanged || captionPaddingChanged || refreshAllSlides) {
    return "all-slides";
  }
  if (loupeChanged || singleSlideId) {
    return "active-slide";
  }
  return "none";
}

function applyLoupeToSlide(slide, loupe, deviceName, config) {
  if (loupe) {
    slide.loupe = sanitizeLoupe(loupe, loupeReferenceCanvas(config, deviceName), deviceName);
  } else {
    delete slide.loupe;
  }
}

function repairStoredLoupeCenters(config) {
  const referenceCanvas = config.devices.iphone?.canvas;
  if (!referenceCanvas) {
    return false;
  }

  let changed = false;
  for (const slide of config.slides) {
    if (!slide.loupe) {
      continue;
    }
    const repaired = sanitizeLoupe(slide.loupe, referenceCanvas, "iphone");
    if (JSON.stringify(repaired) !== JSON.stringify(slide.loupe)) {
      slide.loupe = repaired;
      changed = true;
    }
  }

  return changed;
}

function applyLoupeForSlideAcrossLocales(targetSet, slideId, localeLoupeMap) {
  const outputVersion = targetSet.version;
  const deviceName = targetSet.device;

  for (const { configPath, config } of allLocaleConfigEntries()) {
    const locale = localeFromConfigPath(configPath);
    if (!Object.prototype.hasOwnProperty.call(localeLoupeMap, locale)) {
      continue;
    }

    const device = config.devices[deviceName];
    if (!device) {
      continue;
    }

    const slide = config.slides.find((candidate) => candidate.id === slideId);
    if (!slide) {
      continue;
    }

    const loupe = localeLoupeMap[locale];
    if (loupe) {
      applyLoupeToSlide(slide, loupe, deviceName, config);
    } else {
      delete slide.loupe;
    }

    writeConfig(config, configPath);
    renderSlides(config, deviceName, locale, slideId, configPath, outputVersion);
  }
}

function pasteLoupeAcrossLocales(payload) {
  const sets = allSlideSets();
  const targetSet = sets.find((set) => set.id === payload.setId);
  if (!targetSet || !targetSet.editable) {
    throw new Error("Only the current generated config version can be edited");
  }

  syncVersionAcrossLocales(targetSet.version);

  const slideId = payload.slideId;
  if (!slideId) {
    throw new Error("slideId is required");
  }

  const loupeEnabled = payload.enabled !== false && payload.loupe;
  const localeLoupeMap = {};
  for (const { configPath } of allLocaleConfigEntries()) {
    const locale = localeFromConfigPath(configPath);
    localeLoupeMap[locale] = loupeEnabled ? payload.loupe : null;
  }

  applyLoupeForSlideAcrossLocales(targetSet, slideId, localeLoupeMap);

  return editorState({
    device: targetSet.device,
    version: targetSet.version,
    locale: targetSet.locale,
    source: targetSet.source
  });
}

function restoreLoupeAcrossLocales(payload) {
  const sets = allSlideSets();
  const targetSet = sets.find((set) => set.id === payload.setId);
  if (!targetSet || !targetSet.editable) {
    throw new Error("Only the current generated config version can be edited");
  }

  syncVersionAcrossLocales(targetSet.version);

  const slideId = payload.slideId;
  if (!slideId) {
    throw new Error("slideId is required");
  }

  if (!payload.locales || typeof payload.locales !== "object") {
    throw new Error("locales must be an object");
  }

  applyLoupeForSlideAcrossLocales(targetSet, slideId, payload.locales);

  return editorState({
    device: targetSet.device,
    version: targetSet.version,
    locale: targetSet.locale,
    source: targetSet.source
  });
}

function previewCaption(payload) {
  const sets = allSlideSets();
  const targetSet = sets.find((set) => set.id === payload.setId);
  if (!targetSet || !targetSet.editable) {
    throw new Error("Only the current generated config version can be previewed");
  }

  syncVersionAcrossLocales(targetSet.version);

  const config = readConfig(targetSet.configPath);
  const device = config.devices[targetSet.device];
  let singleSlideId = null;
  let loupeChanged = false;
  let captionColorChanged = false;
  let backgroundColorChanged = false;
  let captionPaddingChanged = false;

  if (Object.prototype.hasOwnProperty.call(payload, "captionColor")) {
    const previousColor = globalCaptionColor();
    const nextColor = syncCaptionColorAcrossLocales(payload.captionColor);
    captionColorChanged = previousColor !== nextColor;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "backgroundColor")) {
    const previousColor = globalBackgroundColor();
    const nextColor = syncBackgroundColorAcrossLocales(payload.backgroundColor);
    backgroundColorChanged = previousColor !== nextColor;
  }

  if (payload.caption) {
    captionPaddingChanged = captionPaddingWillChange(config.caption, payload.caption);
    syncCaptionPaddingAcrossLocales(payload.caption);
    config.caption = readConfig(targetSet.configPath).caption;
  }

  if (payload.slideId) {
    const slide = config.slides.find((candidate) => candidate.id === payload.slideId);
    if (!slide) {
      throw new Error(`Unknown editable slide '${payload.slideId}'`);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "captionText")) {
      slide.captions[targetSet.locale] = sanitizeCaptionText(payload.captionText);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "loupe")) {
      applyLoupeToSlide(slide, payload.loupe, targetSet.device, config);
      loupeChanged = true;
    }

    singleSlideId = payload.slideId;
  }

  writeConfig(config, targetSet.configPath);

  if (captionColorChanged) {
    renderAllSlidesForCaptionColor(targetSet.version);
  } else if (backgroundColorChanged) {
    renderAllSlidesForBackgroundColor(targetSet.version);
  } else if (captionPaddingChanged || payload.refreshAllSlides) {
    renderAllSlidesForCaptionPadding(targetSet.version);
  } else if (loupeChanged && singleSlideId) {
    renderSlides(config, targetSet.device, targetSet.locale, singleSlideId, targetSet.configPath, targetSet.version);
  } else if (singleSlideId) {
    renderSlides(config, targetSet.device, targetSet.locale, singleSlideId, targetSet.configPath, targetSet.version);
  }

  return {
    ...editorState({
      device: targetSet.device,
      version: targetSet.version,
      locale: targetSet.locale,
      source: targetSet.source
    }),
    previewRefresh: previewRefreshScope({
      captionColorChanged,
      backgroundColorChanged,
      captionPaddingChanged: captionPaddingChanged || Boolean(payload.refreshAllSlides),
      refreshAllSlides: Boolean(payload.refreshAllSlides),
      loupeChanged,
      singleSlideId
    })
  };
}

function reorderSlides(payload) {
  const sets = allSlideSets();
  const targetSet = sets.find((set) => set.id === payload.setId);
  if (!targetSet || !targetSet.editable) {
    throw new Error("Only the current generated config version can be reordered");
  }

  if (!Array.isArray(payload.slideIds) || payload.slideIds.length === 0) {
    throw new Error("slideIds must be a non-empty array");
  }

  syncVersionAcrossLocales(targetSet.version);

  for (const { configPath, config } of allLocaleConfigEntries()) {
    const slidesById = new Map(config.slides.map((slide) => [slide.id, slide]));
    if (payload.slideIds.length !== config.slides.length) {
      throw new Error("slideIds must include every slide exactly once");
    }

    config.slides = payload.slideIds.map((slideId) => {
      const slide = slidesById.get(slideId);
      if (!slide) {
        throw new Error(`Unknown slide '${slideId}'`);
      }
      return slide;
    });
    writeConfig(config, configPath);
  }

  return editorState({
    device: targetSet.device,
    version: targetSet.version,
    locale: targetSet.locale,
    source: targetSet.source
  });
}

function saveAllSlides(payload) {
  const sets = allSlideSets();
  const targetSet = sets.find((set) => set.id === payload.setId);
  if (!targetSet || !targetSet.editable) {
    throw new Error("Only the current generated config version can be edited");
  }

  syncVersionAcrossLocales(targetSet.version);

  const config = readConfig(targetSet.configPath);
  const device = config.devices[targetSet.device];
  let captionColorChanged = false;
  let backgroundColorChanged = false;
  let loupeChanged = false;

  if (Object.prototype.hasOwnProperty.call(payload, "captionColor")) {
    const previousColor = globalCaptionColor();
    const nextColor = syncCaptionColorAcrossLocales(payload.captionColor);
    captionColorChanged = previousColor !== nextColor;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "backgroundColor")) {
    const previousColor = globalBackgroundColor();
    const nextColor = syncBackgroundColorAcrossLocales(payload.backgroundColor);
    backgroundColorChanged = previousColor !== nextColor;
  }

  let captionPaddingChanged = false;
  if (payload.caption) {
    const previousPadding = JSON.stringify(config.caption);
    syncCaptionPaddingAcrossLocales(payload.caption);
    config.caption = readConfig(targetSet.configPath).caption;
    captionPaddingChanged = previousPadding !== JSON.stringify(config.caption);
  }

  if (payload.slideId) {
    const slide = config.slides.find((candidate) => candidate.id === payload.slideId);
    if (!slide) {
      throw new Error(`Unknown editable slide '${payload.slideId}'`);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "captionText")) {
      slide.captions[targetSet.locale] = sanitizeCaptionText(payload.captionText);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "loupe")) {
      applyLoupeToSlide(slide, payload.loupe, targetSet.device, config);
      loupeChanged = true;
    }
  }

  repairStoredLoupeCenters(config);

  writeConfig(config, targetSet.configPath);

  if (captionColorChanged) {
    renderAllSlidesForCaptionColor(targetSet.version);
  } else if (backgroundColorChanged) {
    renderAllSlidesForBackgroundColor(targetSet.version);
  } else if (captionPaddingChanged) {
    renderAllSlidesForCaptionPadding(targetSet.version);
  } else {
    renderSlides(config, "all", targetSet.locale, null, targetSet.configPath, targetSet.version);
  }

  return editorState({
    device: targetSet.device,
    version: targetSet.version,
    locale: targetSet.locale,
    source: targetSet.source
  });
}

function updateSlide(slideId, payload) {
  const sets = allSlideSets();
  const targetSet = sets.find((set) => set.id === payload.setId);
  if (!targetSet || !targetSet.editable) {
    throw new Error("Only the current generated config version can be edited");
  }

  syncVersionAcrossLocales(targetSet.version);

  const config = readConfig(targetSet.configPath);
  const device = config.devices[targetSet.device];
  const slide = config.slides.find((candidate) => candidate.id === slideId);
  if (!device || !slide) {
    throw new Error(`Unknown editable slide '${slideId}'`);
  }

  const previousCaption = JSON.stringify(config.caption);

  let loupeChanged = false;
  let captionColorChanged = false;
  let backgroundColorChanged = false;

  if (Object.prototype.hasOwnProperty.call(payload, "captionColor")) {
    const previousColor = globalCaptionColor();
    const nextColor = syncCaptionColorAcrossLocales(payload.captionColor);
    captionColorChanged = previousColor !== nextColor;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "backgroundColor")) {
    const previousColor = globalBackgroundColor();
    const nextColor = syncBackgroundColorAcrossLocales(payload.backgroundColor);
    backgroundColorChanged = previousColor !== nextColor;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "loupe")) {
    applyLoupeToSlide(slide, payload.loupe, targetSet.device, config);
    loupeChanged = true;
  }

  let captionPaddingChanged = false;
  if (Object.prototype.hasOwnProperty.call(payload, "caption")) {
    const previousPadding = previousCaption;
    syncCaptionPaddingAcrossLocales(payload.caption);
    config.caption = readConfig(targetSet.configPath).caption;
    captionPaddingChanged = previousPadding !== JSON.stringify(config.caption);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "captionText")) {
    slide.captions[targetSet.locale] = sanitizeCaptionText(payload.captionText);
  }

  writeConfig(config, targetSet.configPath);

  if (captionColorChanged) {
    renderAllSlidesForCaptionColor(targetSet.version);
  } else if (backgroundColorChanged) {
    renderAllSlidesForBackgroundColor(targetSet.version);
  } else if (captionPaddingChanged) {
    renderAllSlidesForCaptionPadding(targetSet.version);
  } else if (loupeChanged) {
    renderSlides(config, targetSet.device, targetSet.locale, slideId, targetSet.configPath, targetSet.version);
  } else {
    renderSlides(config, targetSet.device, targetSet.locale, slideId, targetSet.configPath, targetSet.version);
  }

  return editorState({
    device: targetSet.device,
    version: targetSet.version,
    locale: targetSet.locale,
    source: targetSet.source
  });
}

function sendJSON(response, status, body) {
  response.writeHead(status, { "Content-Type": contentTypes[".json"] });
  response.end(JSON.stringify(body));
}

function sendError(response, error) {
  sendJSON(response, 500, { error: error.message || String(error) });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function canServeImage(filePath) {
  const allowedRoots = [
    developmentRoot,
    ...readConfigEntries().flatMap(({ config, configPath }) => [
      outputRoot(config, configPath),
      path.dirname(configPath)
    ])
  ];
  if (options.slidesRoot) {
    allowedRoots.push(options.slidesRoot);
    if (isVersionDirectory(path.basename(options.slidesRoot))) {
      allowedRoots.push(path.dirname(options.slidesRoot));
    }
  }
  return allowedRoots.some((allowedRoot) => isWithin(allowedRoot, filePath));
}

function serveFile(response, filePath) {
  if (!isFile(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": contentTypes[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(response);
}

async function handleRequest(request, response) {
  const requestURL = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && requestURL.pathname === "/api/state") {
    sendJSON(response, 200, editorState(Object.fromEntries(requestURL.searchParams)));
    return;
  }

  if (request.method === "POST" && requestURL.pathname === "/api/preview") {
    const payload = JSON.parse(await readBody(request) || "{}");
    sendJSON(response, 200, previewCaption(payload));
    return;
  }

  if (request.method === "POST" && requestURL.pathname === "/api/slides/reorder") {
    const payload = JSON.parse(await readBody(request) || "{}");
    sendJSON(response, 200, reorderSlides(payload));
    return;
  }

  if (request.method === "POST" && requestURL.pathname === "/api/slides/save-all") {
    const payload = JSON.parse(await readBody(request) || "{}");
    sendJSON(response, 200, saveAllSlides(payload));
    return;
  }

  if (request.method === "POST" && requestURL.pathname === "/api/loupe/paste-locales") {
    const payload = JSON.parse(await readBody(request) || "{}");
    sendJSON(response, 200, pasteLoupeAcrossLocales(payload));
    return;
  }

  if (request.method === "POST" && requestURL.pathname === "/api/loupe/restore-locales") {
    const payload = JSON.parse(await readBody(request) || "{}");
    sendJSON(response, 200, restoreLoupeAcrossLocales(payload));
    return;
  }

  if (request.method === "POST" && requestURL.pathname === "/api/render") {
    const payload = JSON.parse(await readBody(request) || "{}");
    const sets = allSlideSets();
    const targetSet = sets.find((set) => set.id === payload.setId && set.editable);
    if (!targetSet) {
      throw new Error("Only the current generated config version can be rerendered");
    }
    const config = readConfig(targetSet.configPath);
    renderSlides(config, targetSet.device, targetSet.locale, null, targetSet.configPath, targetSet.version);
    sendJSON(response, 200, editorState({
      device: targetSet.device,
      version: targetSet.version,
      locale: targetSet.locale,
      source: targetSet.source
    }));
    return;
  }

  const slideMatch = requestURL.pathname.match(/^\/api\/slides\/([^/]+)$/);
  if (request.method === "POST" && slideMatch) {
    const payload = JSON.parse(await readBody(request) || "{}");
    sendJSON(response, 200, updateSlide(decodeURIComponent(slideMatch[1]), payload));
    return;
  }

  const imageMatch = requestURL.pathname.match(/^\/image\/([^/]+)$/);
  if (request.method === "GET" && imageMatch) {
    const filePath = path.normalize(Buffer.from(imageMatch[1], "base64url").toString("utf8"));
    if (!canServeImage(filePath)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    serveFile(response, filePath);
    return;
  }

  const safePath = requestURL.pathname === "/" ? "/index.html" : requestURL.pathname;
  const filePath = path.normalize(path.join(publicRoot, safePath));
  if (!isWithin(publicRoot, filePath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  serveFile(response, filePath);
}

try {
  const initialEntries = readConfigEntries();
  const initialConfig = initialEntries[0].config;
  if (options.renderOnStart) {
    for (const { config, configPath } of initialEntries) {
      renderSlides(config, "all", options.locale || config.defaultLocale, null, configPath);
    }
  }

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => sendError(response, error));
  });

  server.on("error", (error) => {
    if (error && error.code === "EADDRINUSE") {
      const url = editorURL();
      console.log(`App Store slide editor is already running at ${url}`);
      if (options.open) {
        spawnSync("open", [url]);
      }
      process.exit(0);
    }
    throw error;
  });

  server.listen(options.port, "127.0.0.1", () => {
    const url = editorURL();
    console.log(`App Store slide editor running at ${url}`);
    console.log(`Config: ${options.configDir || primaryConfigPath()}`);
    console.log(`Development root: ${developmentRoot}`);
    console.log(`Slides root: ${options.slidesRoot || outputRoot(initialConfig, initialEntries[0].configPath)}`);
    if (!options.renderOnStart) {
      console.log("Initial render skipped.");
    }
    if (options.open) {
      spawnSync("open", [url]);
    }
  });
} catch (error) {
  console.error(`error: ${error.message || String(error)}`);
  process.exit(1);
}
