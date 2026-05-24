const elements = {
  appLabel: document.getElementById("appLabel"),
  deviceTabs: document.getElementById("deviceTabs"),
  versionSelect: document.getElementById("versionSelect"),
  localeTabs: document.getElementById("localeTabs"),
  slideList: document.getElementById("slideList"),
  slideIdLabel: document.getElementById("slideIdLabel"),
  captionLabel: document.getElementById("captionLabel"),
  contextLabel: document.getElementById("contextLabel"),
  deviceFrameLabel: document.getElementById("deviceFrameLabel"),
  slideImage: document.getElementById("slideImage"),
  stage: document.getElementById("stage"),
  loupePreview: document.getElementById("loupePreview"),
  captionTopPadding: document.getElementById("captionTopPadding"),
  captionBottomPadding: document.getElementById("captionBottomPadding"),
  captionHorizontalPadding: document.getElementById("captionHorizontalPadding"),
  captionColor: document.getElementById("captionColor"),
  captionText: document.getElementById("captionText"),
  backgroundColor: document.getElementById("backgroundColor"),
  loupeFieldset: document.getElementById("loupeFieldset"),
  loupeControls: document.getElementById("loupeControls"),
  loupeEnabled: document.getElementById("loupeEnabled"),
  loupeCenterY: document.getElementById("loupeCenterY"),
  loupeWidth: document.getElementById("loupeWidth"),
  loupeHeight: document.getElementById("loupeHeight"),
  loupeCornerRadius: document.getElementById("loupeCornerRadius"),
  loupeZoom: document.getElementById("loupeZoom"),
  loupeBorderEnabled: document.getElementById("loupeBorderEnabled"),
  copyLoupeButton: document.getElementById("copyLoupeButton"),
  pasteLoupeButton: document.getElementById("pasteLoupeButton"),
  pasteLoupeLocalesButton: document.getElementById("pasteLoupeLocalesButton"),
  saveSlideButton: document.getElementById("saveSlideButton"),
  viewAllButton: document.getElementById("viewAllButton"),
  galleryOverlay: document.getElementById("galleryOverlay"),
  galleryBody: document.getElementById("galleryBody"),
  galleryLocaleTabs: document.getElementById("galleryLocaleTabs"),
  galleryIphoneRow: document.getElementById("galleryIphoneRow"),
  galleryIpadRow: document.getElementById("galleryIpadRow"),
  galleryIphoneZoomLabel: document.getElementById("galleryIphoneZoomLabel"),
  galleryIpadZoomLabel: document.getElementById("galleryIpadZoomLabel"),
  galleryCloseButton: document.getElementById("galleryCloseButton"),
  gallerySaveStatus: document.getElementById("gallerySaveStatus"),
  gallerySaveAllButton: document.getElementById("gallerySaveAllButton"),
  galleryTitle: document.getElementById("galleryTitle"),
  undoButton: document.getElementById("undoButton"),
  redoButton: document.getElementById("redoButton"),
  loadingIndicator: document.getElementById("loadingIndicator"),
  lastSavedLabel: document.getElementById("lastSavedLabel"),
  controls: document.getElementById("controls"),
  themeToggle: document.getElementById("themeToggle"),
  toast: document.getElementById("toast")
};

const captionFields = [
  elements.captionTopPadding,
  elements.captionBottomPadding,
  elements.captionHorizontalPadding
];

let state = null;
let activeSetId = null;
let activeSlideId = null;
let draftLoupe = null;
let dragSlideId = null;
let slidePreviewTimer = null;
let loupePreviewTimer = null;
let slidePreviewRequest = 0;
let slidePreviewChain = Promise.resolve();
let historyStack = [];
let redoStack = [];
let isApplyingHistory = false;
let loupeOverlayVisible = false;
let captionColorHistoryAnchor = null;
let captionPaddingHistoryAnchor = null;
let backgroundColorHistoryAnchor = null;
let galleryLocale = null;
let gallerySaveStatusTimer = null;
const galleryDeviceZoom = { iphone: 1, ipad: 1 };
let copiedLoupeSettings = null;

const PREVIEW_DEBOUNCE_MS = 16;
const PADDING_PREVIEW_DEBOUNCE_MS = 120;
const DEFAULT_CAPTION_COLOR = "#000000";
const GALLERY_ZOOM_MIN = 0.5;
const GALLERY_ZOOM_MAX = 3;
const GALLERY_ZOOM_STEP = 0.25;

function cacheBustedImageUrl(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_=${Date.now()}`;
}

function activeSet() {
  return state.sets.find((set) => set.id === activeSetId) || state.sets[0];
}

function activeSlide() {
  const set = activeSet();
  return set.slides.find((slide) => slide.id === activeSlideId) || set.slides[0];
}

function setSelection(updates) {
  const current = activeSet();
  const next = {
    device: current?.device,
    version: current?.version,
    locale: current?.locale,
    ...updates
  };

  const matchingSets = state.sets.filter((set) =>
    set.source === "generated" &&
    (!next.device || set.device === next.device) &&
    (!next.version || set.version === next.version) &&
    (!next.locale || set.locale === next.locale)
  );
  const fallbackSets = state.sets.filter((set) =>
    (!next.device || set.device === next.device) &&
    (!next.version || set.version === next.version)
  );
  const selectedSet = matchingSets[0] || fallbackSets[0] || state.sets[0];

  activeSetId = selectedSet.id;
  activeSlideId = selectedSet.slides[0]?.id || null;
  updateURLSelection(selectedSet);
  setVisualLoading(true);
  render();
}

function defaultLoupeHeight(canvas) {
  return Math.max(160, Math.round(canvas.height * 0.08));
}

function canvasSize() {
  return activeSet().canvas || { width: 1290, height: 2796 };
}

function iphoneCanvasSize() {
  const set = activeSet();
  if (!set || !state) {
    return { width: 1290, height: 2796 };
  }

  const iphoneSet = state.sets.find((candidate) =>
    candidate.source === "generated" &&
    candidate.version === set.version &&
    candidate.locale === set.locale &&
    candidate.device === "iphone"
  );
  return iphoneSet?.canvas || { width: 1290, height: 2796 };
}

function isIpadDevice() {
  return activeSet()?.device === "ipad";
}

function centeredLoupeY(loupe, canvas = canvasSize()) {
  return Math.round(loupe?.center?.y ?? canvas.height * 0.55);
}

function defaultLoupeZoom() {
  return isIpadDevice() ? 2.8 : 2;
}

function defaultLoupe() {
  const canvas = canvasSize();
  const loupeCanvas = iphoneCanvasSize();
  const width = Math.round(loupeCanvas.width);
  const height = defaultLoupeHeight(canvas);
  const cornerRadius = Math.min(96, Math.round(Math.min(width, height) * 0.42));
  const centerY = Math.round(canvas.height * 0.55);
  const centerX = loupeCanvas.width / 2;
  return {
    enabled: true,
    center: { x: centerX, y: centerY },
    sourceCenter: { x: centerX, y: centerY },
    width,
    height,
    cornerRadius,
    zoom: defaultLoupeZoom(),
    borderColor: "#000000",
    borderWidth: 2,
    shadowColor: "#000000",
    shadowOpacity: 0.22,
    shadowBlur: 28,
    shadowOffset: { x: 0, y: 18 }
  };
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 2200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return body;
}

function setBusy(isBusy) {
  const editable = Boolean(activeSet()?.editable);
  elements.saveSlideButton.disabled = isBusy || !editable;
  elements.viewAllButton.disabled = isBusy;
  elements.gallerySaveAllButton.disabled = isBusy || !editable;
  elements.loadingIndicator.hidden = !isBusy;
  elements.lastSavedLabel.hidden = isBusy;
  updateHistoryButtons(isBusy);
}

function setVisualLoading(isLoading) {
  elements.stage.classList.toggle("is-loading", isLoading);
  elements.slideList.classList.toggle("is-loading", isLoading);
}

function syncStageForDevice() {
  const device = activeSet()?.device;
  elements.stage.classList.toggle("device-ipad", device === "ipad");
}

function hideLoupeOverlay() {
  loupeOverlayVisible = false;
  elements.loupePreview.style.display = "none";
}

function unique(values) {
  return [...new Set(values)].filter(Boolean);
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

function setsMatching(filters) {
  return state.sets.filter((set) =>
    (!filters.device || set.device === filters.device) &&
    (!filters.version || set.version === filters.version) &&
    (!filters.locale || set.locale === filters.locale)
  );
}

function renderTabs(container, items, activeValue, onSelect) {
  container.innerHTML = "";
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab-button${item.value === activeValue ? " selected" : ""}`;
    button.textContent = item.label;
    button.addEventListener("click", () => onSelect(item.value));
    container.appendChild(button);
  });
}

function renderVersionSelect() {
  const set = activeSet();
  const versions = unique(setsMatching({ device: set.device }).map((candidate) => candidate.version));
  elements.versionSelect.innerHTML = "";
  versions.forEach((version) => {
    const option = document.createElement("option");
    option.value = version;
    option.textContent = version;
    option.selected = version === set.version;
    elements.versionSelect.appendChild(option);
  });
}

function renderNavigation() {
  const set = activeSet();
  const devices = unique(state.sets.map((candidate) => candidate.device)).sort((left, right) => {
    const order = { iphone: 0, ipad: 1 };
    return (order[left] ?? 99) - (order[right] ?? 99);
  });
  const locales = sortLocales(setsMatching({ device: set.device, version: set.version }).map((candidate) => candidate.locale));

  renderTabs(
    elements.deviceTabs,
    devices.map((device) => ({
      value: device,
      label: device === "iphone" ? "iPhone" : device === "ipad" ? "iPad" : device
    })),
    set.device,
    (device) => setSelection({ device, version: null, locale: null })
  );
  renderVersionSelect();
  renderTabs(
    elements.localeTabs,
    locales.map((locale) => ({ value: locale, label: locale })),
    set.locale,
    (locale) => setSelection({ locale })
  );
}

function updateURLSelection(set) {
  const url = new URL(window.location.href);
  url.searchParams.set("device", set.device);
  url.searchParams.set("version", set.version);
  url.searchParams.set("locale", set.locale);
  window.history.replaceState(null, "", url);
}

function renderSlideList() {
  const set = activeSet();
  const canvas = set.canvas || { width: 1290, height: 2796 };
  const editable = Boolean(set.editable);
  elements.slideList.className = `slide-list device-${set.device}${editable ? " reorderable" : ""}`;
  elements.slideList.classList.add("is-loading");
  elements.slideList.style.setProperty("--slide-aspect-ratio", `${canvas.width} / ${canvas.height}`);
  elements.slideList.innerHTML = "";
  set.slides.forEach((slide) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `slide-button${slide.id === activeSlideId ? " selected" : ""}`;
    button.dataset.slideId = slide.id;
    button.innerHTML = `
      ${editable ? `<span class="slide-drag-handle" draggable="true" aria-label="Reorder slide">⠿</span>` : ""}
      <img class="slide-thumb" alt="" src="${cacheBustedImageUrl(slide.imageUrl)}">
      <span class="slide-copy">
        <span class="slide-title">${slide.caption.replace(/\n/g, " ")}</span>
        <span class="slide-subtitle">${slide.filename || slide.id}</span>
      </span>
    `;
    button.addEventListener("click", (event) => {
      if (event.target.closest(".slide-drag-handle")) {
        return;
      }
      selectSlide(slide.id);
    });

    if (editable) {
      const handle = button.querySelector(".slide-drag-handle");
      handle.addEventListener("dragstart", (event) => {
        dragSlideId = slide.id;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", slide.id);
        button.classList.add("dragging");
      });
      handle.addEventListener("dragend", () => {
        dragSlideId = null;
        button.classList.remove("dragging");
        clearSlideDropIndicators();
      });
    }

    elements.slideList.appendChild(button);
  });
  window.requestAnimationFrame(() => {
    elements.slideList.classList.remove("is-loading");
  });
}

function clearSlideDropIndicators() {
  elements.slideList.querySelectorAll(".slide-button.drop-before, .slide-button.drop-after").forEach((button) => {
    button.classList.remove("drop-before", "drop-after");
  });
}

function computeReorderIds(fromId, toId, insertBefore) {
  const ids = activeSet().slides.map((slide) => slide.id);
  const fromIndex = ids.indexOf(fromId);
  let toIndex = ids.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return ids;
  }

  ids.splice(fromIndex, 1);
  if (fromIndex < toIndex) {
    toIndex -= 1;
  }
  if (!insertBefore) {
    toIndex += 1;
  }
  ids.splice(toIndex, 0, fromId);
  return ids;
}

async function reorderSlides(fromId, toId, insertBefore) {
  const set = activeSet();
  if (!set?.editable || fromId === toId) {
    return;
  }

  const slideIds = computeReorderIds(fromId, toId, insertBefore);
  try {
    state = await api("/api/slides/reorder", {
      method: "POST",
      body: JSON.stringify({
        setId: set.id,
        slideIds
      })
    });
    activeSetId = state.activeSetId || set.id;
    renderSlideList();
    showToast("Slide order updated");
  } catch (error) {
    showToast(error.message);
  }
}

function captionPaddingValues() {
  return {
    topPadding: Number(elements.captionTopPadding.value),
    bottomPadding: Number(elements.captionBottomPadding.value),
    horizontalPadding: Number(elements.captionHorizontalPadding.value)
  };
}

function globalCaptionColorValue() {
  return elements.captionColor.value || DEFAULT_CAPTION_COLOR;
}

function globalBackgroundColorValue() {
  return elements.backgroundColor.value || activeSet()?.defaultBackgroundColor || "#FFFFFF";
}

function syncGlobalColorsFromState() {
  const set = activeSet();
  if (!set) {
    return;
  }

  const caption = set.captionConfig || {};
  elements.captionColor.value = state?.globalCaptionColor || caption.color || DEFAULT_CAPTION_COLOR;
  elements.backgroundColor.value = state?.globalBackgroundColor || set.defaultBackgroundColor || "#FFFFFF";
  elements.captionTopPadding.value = Math.round(caption.topPadding || 0);
  elements.captionBottomPadding.value = Math.round(caption.bottomPadding || 0);
  elements.captionHorizontalPadding.value = Math.round(caption.horizontalPadding || 0);
  elements.stage.style.background = elements.backgroundColor.value;
}

function cloneLoupe(loupe) {
  return loupe ? structuredClone(loupe) : null;
}

function currentSnapshot() {
  updateLoupeFromControls();
  return {
    caption: captionPaddingValues(),
    captionColor: globalCaptionColorValue(),
    backgroundColor: globalBackgroundColorValue(),
    captionText: elements.captionText.value,
    loupe: draftLoupe.enabled ? cloneLoupe(draftLoupe) : null
  };
}

function snapshotKey(snapshot) {
  return JSON.stringify(snapshot);
}

function applyEditorState(nextState) {
  const { previewRefresh: _previewRefresh, ...editorStateBody } = nextState;
  state = editorStateBody;
  activeSetId = state.activeSetId || activeSetId;
  updateURLSelection(activeSet());
}

function captureLoupeAcrossLocales(slideId) {
  const set = activeSet();
  const locales = {};
  state.sets
    .filter((candidate) =>
      candidate.source === "generated" &&
      candidate.version === set.version &&
      candidate.device === set.device &&
      candidate.editable
    )
    .forEach((candidate) => {
      const slide = candidate.slides.find((item) => item.id === slideId);
      locales[candidate.locale] = slide?.loupe ? cloneLoupe(slide.loupe) : null;
    });
  return { slideId, locales };
}

function commitLoupePasteHistory(before) {
  pushHistorySnapshot(before);
  pushHistorySnapshot(currentSnapshot());
  updateHistoryButtons();
}

function updateHistoryButtons(isBusy = false) {
  const editable = Boolean(activeSet()?.editable);
  elements.undoButton.disabled = isBusy || !editable || historyStack.length < 2;
  elements.redoButton.disabled = isBusy || !editable || redoStack.length === 0;
}

function resetHistory() {
  historyStack = activeSet()?.editable ? [currentSnapshot()] : [];
  redoStack = [];
  updateHistoryButtons();
}

function pushHistorySnapshot(snapshot) {
  const last = historyStack[historyStack.length - 1];
  if (!last || snapshotKey(last) !== snapshotKey(snapshot)) {
    historyStack.push(snapshot);
    if (historyStack.length > 100) {
      historyStack.shift();
    }
    redoStack = [];
    updateHistoryButtons();
  }
}

function recordHistory() {
  if (isApplyingHistory || !activeSet()?.editable) {
    return;
  }

  pushHistorySnapshot(currentSnapshot());
}

function commitCaptionColorHistory() {
  if (isApplyingHistory || !activeSet()?.editable || !captionColorHistoryAnchor) {
    return;
  }

  pushHistorySnapshot(captionColorHistoryAnchor);
  pushHistorySnapshot(currentSnapshot());
  captionColorHistoryAnchor = null;
}

function commitBackgroundColorHistory() {
  if (isApplyingHistory || !activeSet()?.editable || !backgroundColorHistoryAnchor) {
    return;
  }

  pushHistorySnapshot(backgroundColorHistoryAnchor);
  pushHistorySnapshot(currentSnapshot());
  backgroundColorHistoryAnchor = null;
}

function commitCaptionPaddingHistory() {
  if (isApplyingHistory || !activeSet()?.editable || !captionPaddingHistoryAnchor) {
    return;
  }

  pushHistorySnapshot(captionPaddingHistoryAnchor);
  pushHistorySnapshot(currentSnapshot());
  captionPaddingHistoryAnchor = null;
}

async function applySnapshot(snapshot) {
  if (!snapshot || !activeSet()?.editable) {
    return;
  }

  isApplyingHistory = true;
  setBusy(true);
  try {
    const set = activeSet();
    if (snapshot.loupeLocalesRestore) {
      applyEditorState(await api("/api/loupe/restore-locales", {
        method: "POST",
        body: JSON.stringify({
          setId: set.id,
          slideId: snapshot.loupeLocalesRestore.slideId,
          locales: snapshot.loupeLocalesRestore.locales
        })
      }));
    } else if (snapshot.loupePasteAllLocales) {
      applyEditorState(await api("/api/loupe/paste-locales", {
        method: "POST",
        body: JSON.stringify({
          setId: set.id,
          slideId: snapshot.loupePasteAllLocales.slideId,
          enabled: snapshot.loupePasteAllLocales.enabled,
          loupe: snapshot.loupePasteAllLocales.loupe
        })
      }));
    }

    elements.captionTopPadding.value = String(snapshot.caption.topPadding);
    elements.captionBottomPadding.value = String(snapshot.caption.bottomPadding);
    elements.captionHorizontalPadding.value = String(snapshot.caption.horizontalPadding);
    elements.captionColor.value = snapshot.captionColor || DEFAULT_CAPTION_COLOR;
    elements.captionText.value = snapshot.captionText;
    elements.backgroundColor.value = snapshot.backgroundColor;
    elements.stage.style.background = snapshot.backgroundColor;
    draftLoupe = snapshot.loupe ? cloneLoupe(snapshot.loupe) : defaultLoupe();
    elements.loupeEnabled.checked = Boolean(snapshot.loupe);
    syncControlsFromLoupe();
    syncLoupeSectionEnabled();
    loupeOverlayVisible = Boolean(snapshot.loupe);
    updateLoupePreview();

    const crossLocaleLoupeChange = Boolean(snapshot.loupeLocalesRestore || snapshot.loupePasteAllLocales);
    await previewSlide({
      recordHistory: false,
      refreshAllSlides: crossLocaleLoupeChange
    });
    if (crossLocaleLoupeChange) {
      renderSlideList();
      if (!elements.galleryOverlay.hidden) {
        renderGallery();
      }
    }
  } finally {
    isApplyingHistory = false;
    setBusy(false);
    updateHistoryButtons();
  }
}

async function undoEdit() {
  if (historyStack.length < 2) {
    return;
  }

  const current = historyStack.pop();
  redoStack.push(current);
  updateHistoryButtons(true);
  await applySnapshot(historyStack[historyStack.length - 1]);
}

async function redoEdit() {
  if (redoStack.length === 0) {
    return;
  }

  const next = redoStack.pop();
  historyStack.push(next);
  updateHistoryButtons(true);
  await applySnapshot(next);
}

const LOUPE_STEPPER_IDS = new Set([
  "loupeCenterY",
  "loupeWidth",
  "loupeHeight",
  "loupeCornerRadius",
  "loupeZoom"
]);

function isLoupeStepperInput(input) {
  return Boolean(input?.id && LOUPE_STEPPER_IDS.has(input.id));
}

function clampLoupeZoom(input) {
  const min = 1.1;
  const max = 4;
  const value = Number(input.value);
  if (!Number.isFinite(value)) {
    const fallback = defaultLoupeZoom();
    input.value = fallback.toFixed(2);
    return fallback;
  }
  const clamped = Math.min(max, Math.max(min, Math.round(value * 100) / 100));
  input.value = clamped.toFixed(2);
  return clamped;
}

function stepperBounds(input, fallbackMax = 360) {
  const min = input.hasAttribute("min") ? Number(input.min) : 0;
  const max = input.hasAttribute("max") ? Number(input.max) : fallbackMax;
  return {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : fallbackMax
  };
}

function clampCaptionValue(input) {
  const { min, max } = stepperBounds(input, 360);
  const value = Number(input.value);
  if (!Number.isFinite(value)) {
    input.value = String(min);
    return min;
  }
  const clamped = Math.min(max, Math.max(min, Math.round(value)));
  input.value = String(clamped);
  return clamped;
}

function bumpStepperValue(input, delta) {
  const current = Number(input.value);
  input.value = String((Number.isFinite(current) ? current : 0) + delta);
  return input.id === "loupeZoom" ? clampLoupeZoom(input) : clampCaptionValue(input);
}

function isGlobalCaptionPaddingInput(input) {
  return input && (
    input.id === "captionTopPadding" ||
    input.id === "captionBottomPadding" ||
    input.id === "captionHorizontalPadding"
  );
}

function slidePreviewPayload(options = {}) {
  updateLoupeFromControls();
  const set = activeSet();
  const slide = activeSlide();
  return {
    setId: set.id,
    slideId: slide.id,
    caption: captionPaddingValues(),
    captionColor: globalCaptionColorValue(),
    backgroundColor: globalBackgroundColorValue(),
    captionText: elements.captionText.value,
    loupe: draftLoupe.enabled ? draftLoupe : null,
    refreshAllSlides: Boolean(options.refreshAllSlides)
  };
}

function applyOptimisticCaptionText() {
  const text = elements.captionText.value;
  elements.captionLabel.textContent = text;
  const slide = activeSet()?.slides.find((candidate) => candidate.id === activeSlideId);
  if (slide) {
    slide.caption = text;
  }
  updateActiveSlideThumb();
}

function updateActiveSlideThumb() {
  const slide = activeSlide();
  if (!slide || !activeSlideId) {
    return;
  }

  const button = elements.slideList.querySelector(`.slide-button[data-slide-id="${CSS.escape(activeSlideId)}"]`);
  if (!button) {
    renderSlideList();
    return;
  }

  const thumb = button.querySelector(".slide-thumb");
  const title = button.querySelector(".slide-title");
  if (thumb) {
    thumb.src = cacheBustedImageUrl(slide.imageUrl);
  }
  if (title) {
    title.textContent = slide.caption.replace(/\n/g, " ");
  }
}

function mergeScheduledPreviewOptions(current, next) {
  if (!current) {
    return { ...next };
  }
  return {
    ...current,
    ...next,
    refreshAllSlides: Boolean(current.refreshAllSlides || next.refreshAllSlides),
    optimisticCaption: Boolean(current.optimisticCaption || next.optimisticCaption),
    recordHistory: Object.prototype.hasOwnProperty.call(next, "recordHistory")
      ? next.recordHistory
      : current.recordHistory
  };
}

function scheduleSlidePreview(options = {}) {
  if (!activeSet()?.editable) {
    return;
  }

  if (options.optimisticCaption) {
    applyOptimisticCaptionText();
  }

  window.clearTimeout(loupePreviewTimer);
  loupePreviewTimer = null;

  scheduleSlidePreview.pendingOptions = mergeScheduledPreviewOptions(
    scheduleSlidePreview.pendingOptions,
    options
  );
  const debounceMs = scheduleSlidePreview.pendingOptions.refreshAllSlides
    ? PADDING_PREVIEW_DEBOUNCE_MS
    : PREVIEW_DEBOUNCE_MS;

  window.clearTimeout(slidePreviewTimer);
  slidePreviewTimer = window.setTimeout(() => {
    const pendingOptions = scheduleSlidePreview.pendingOptions || {};
    scheduleSlidePreview.pendingOptions = null;
    enqueuePreviewSlide(pendingOptions).catch((error) => showToast(error.message));
  }, debounceMs);
}

function scheduleLoupePreview() {
  if (!activeSet()?.editable) {
    return;
  }

  if (scheduleSlidePreview.pendingOptions?.refreshAllSlides) {
    return;
  }

  loupeOverlayVisible = true;
  updateLoupePreview();
  window.clearTimeout(loupePreviewTimer);
  loupePreviewTimer = window.setTimeout(() => {
    enqueuePreviewSlide({ recordHistory: false }).catch((error) => showToast(error.message));
  }, PREVIEW_DEBOUNCE_MS);
}

function enqueuePreviewSlide(options = {}) {
  slidePreviewChain = slidePreviewChain
    .then(() => previewSlide(options))
    .catch((error) => {
      showToast(error.message);
    });
  return slidePreviewChain;
}

async function previewSlide(options = {}) {
  const set = activeSet();
  if (!set?.editable) {
    return;
  }

  if (options.recordHistory !== false) {
    recordHistory();
  }

  const requestId = ++slidePreviewRequest;
  setBusy(true);
  try {
    const refreshAllSlides = Boolean(options.refreshAllSlides);
    const nextState = await api("/api/preview", {
      method: "POST",
      body: JSON.stringify(slidePreviewPayload({ refreshAllSlides }))
    });
    if (requestId !== slidePreviewRequest) {
      return;
    }
    const previewRefresh = nextState.previewRefresh;
    const { previewRefresh: _previewRefresh, ...editorStateBody } = nextState;
    state = editorStateBody;
    activeSetId = state.activeSetId || set.id;
    updateURLSelection(activeSet());
    const refreshedSlide = activeSet().slides.find((candidate) => candidate.id === activeSlideId) || activeSet().slides[0];
    if (refreshedSlide) {
      hideLoupeOverlay();
      elements.slideImage.src = cacheBustedImageUrl(refreshedSlide.imageUrl);
      elements.captionLabel.textContent = refreshedSlide.caption;
      elements.captionText.value = refreshedSlide.caption;
    }
    renderSlideList();
    if (!elements.galleryOverlay.hidden) {
      renderGallery();
    }
    syncGlobalColorsFromState();
  } catch (error) {
    if (requestId === slidePreviewRequest) {
      showToast(error.message);
    }
  } finally {
    if (requestId === slidePreviewRequest) {
      setBusy(false);
    }
  }
}

function normalizeDraftLoupe(loupe) {
  const canvas = canvasSize();
  const loupeCanvas = iphoneCanvasSize();
  const centerY = centeredLoupeY(loupe, canvas);
  const centerX = loupeCanvas.width / 2;
  return {
    ...loupe,
    center: { x: centerX, y: centerY },
    sourceCenter: { x: centerX, y: centerY }
  };
}

function syncLoupeSectionEnabled() {
  const editable = Boolean(activeSet()?.editable);
  const loupeOn = elements.loupeEnabled.checked;
  elements.loupeFieldset.classList.toggle("loupe-enabled", loupeOn);
  elements.loupeControls.querySelectorAll("input, button.stepper-button").forEach((control) => {
    control.disabled = !editable || !loupeOn;
  });
  updateLoupeClipboardButtons();
}

function updateLoupeClipboardButtons() {
  const editable = Boolean(activeSet()?.editable);
  const device = activeSet()?.device;
  const canPaste = Boolean(
    editable &&
    copiedLoupeSettings &&
    copiedLoupeSettings.device === device
  );
  elements.copyLoupeButton.disabled = !editable;
  elements.pasteLoupeButton.disabled = !canPaste;
  elements.pasteLoupeLocalesButton.disabled = !canPaste;
}

function copyLoupeSettings() {
  if (!activeSet()?.editable) {
    return;
  }

  updateLoupeFromControls();
  copiedLoupeSettings = {
    device: activeSet().device,
    enabled: elements.loupeEnabled.checked,
    loupe: elements.loupeEnabled.checked ? cloneLoupe(draftLoupe) : null
  };
  updateLoupeClipboardButtons();
  showToast(`Loupe copied for ${copiedLoupeSettings.device}`);
}

function applyCopiedLoupeToControls() {
  if (!copiedLoupeSettings) {
    return;
  }

  if (copiedLoupeSettings.enabled && copiedLoupeSettings.loupe) {
    draftLoupe = normalizeDraftLoupe(structuredClone(copiedLoupeSettings.loupe));
    elements.loupeEnabled.checked = true;
  } else {
    elements.loupeEnabled.checked = false;
    draftLoupe = defaultLoupe();
  }
  syncControlsFromLoupe();
  syncLoupeSectionEnabled();
}

async function pasteLoupeToCurrentSlide() {
  if (!activeSet()?.editable || !copiedLoupeSettings) {
    return;
  }
  if (copiedLoupeSettings.device !== activeSet().device) {
    showToast(`Copied loupe is for ${copiedLoupeSettings.device} only`);
    return;
  }

  const before = currentSnapshot();
  applyCopiedLoupeToControls();
  setBusy(true);
  try {
    await previewSlide({ recordHistory: false });
    commitLoupePasteHistory(before);
    showToast("Loupe pasted to this slide");
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function pasteLoupeToAllLocales() {
  const set = activeSet();
  const slide = activeSlide();
  if (!set?.editable || !copiedLoupeSettings) {
    return;
  }
  if (copiedLoupeSettings.device !== set.device) {
    showToast(`Copied loupe is for ${copiedLoupeSettings.device} only`);
    return;
  }

  const before = {
    ...currentSnapshot(),
    loupeLocalesRestore: captureLoupeAcrossLocales(slide.id)
  };

  setBusy(true);
  try {
    applyEditorState(await api("/api/loupe/paste-locales", {
      method: "POST",
      body: JSON.stringify({
        setId: set.id,
        slideId: slide.id,
        enabled: copiedLoupeSettings.enabled,
        loupe: copiedLoupeSettings.loupe
      })
    }));
    applyCopiedLoupeToControls();
    const after = {
      ...currentSnapshot(),
      loupePasteAllLocales: {
        slideId: slide.id,
        enabled: copiedLoupeSettings.enabled,
        loupe: copiedLoupeSettings.loupe ? cloneLoupe(copiedLoupeSettings.loupe) : null
      }
    };
    pushHistorySnapshot(before);
    pushHistorySnapshot(after);
    selectSlide(slide.id);
    renderSlideList();
    showToast("Loupe pasted to this slide in every locale");
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
    updateHistoryButtons();
  }
}

function selectSlide(slideId) {
  activeSlideId = slideId;
  const slide = activeSlide();
  draftLoupe = slide.loupe ? normalizeDraftLoupe(structuredClone(slide.loupe)) : defaultLoupe();
  hideLoupeOverlay();

  elements.slideIdLabel.textContent = slide.id;
  elements.captionLabel.textContent = slide.caption;
  elements.captionText.value = slide.caption;
  const nextImageUrl = new URL(slide.imageUrl, window.location.href).href;
  if (elements.slideImage.src !== nextImageUrl) {
    setVisualLoading(true);
    elements.slideImage.src = slide.imageUrl;
  } else {
    setVisualLoading(false);
  }
  syncGlobalColorsFromState();
  elements.deviceFrameLabel.textContent = activeSet().frameLabel || "Frame not configured";
  elements.loupeEnabled.checked = Boolean(activeSet().editable && slide.loupe && slide.loupe.enabled !== false);
  syncControlsFromSet();
  syncControlsFromLoupe();
  syncLoupeSectionEnabled();
  renderSlideList();
  updateEditableState();
  resetHistory();
}

function syncControlsFromSet() {
  const set = activeSet();
  const canvas = canvasSize();
  const loupeCanvas = iphoneCanvasSize();
  elements.loupeWidth.min = 120;
  elements.loupeWidth.max = Math.round(loupeCanvas.width);
  elements.loupeHeight.min = 0;
  elements.loupeHeight.max = Math.round(canvas.height);
  elements.loupeCornerRadius.max = Math.round(Math.min(canvas.width, canvas.height) / 2);
  elements.loupeCenterY.min = 0;
  elements.loupeCenterY.max = Math.round(canvas.height);
  elements.loupeCenterY.value = centeredLoupeY(draftLoupe, canvas);
}

function syncControlsFromLoupe() {
  const canvas = canvasSize();
  const fallbackWidth = draftLoupe.width || ((draftLoupe.radius || 180) * 2);
  elements.loupeCenterY.value = centeredLoupeY(draftLoupe, canvas);
  elements.loupeWidth.value = Math.round(fallbackWidth);
  elements.loupeHeight.value = Math.round(draftLoupe.height || defaultLoupeHeight(activeSet().canvas || { height: 2796 }));
  elements.loupeCornerRadius.value = Math.round(draftLoupe.cornerRadius ?? 48);
  elements.loupeZoom.value = Number(draftLoupe.zoom).toFixed(2);
  elements.loupeBorderEnabled.checked = (draftLoupe.borderWidth ?? 2) > 0;
}

function formatSavedTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function updateLastSavedLabel(date = new Date()) {
  elements.lastSavedLabel.textContent = `Last saved: ${formatSavedTime(date)}`;
}

function updateLoupeFromControls() {
  const canvas = canvasSize();
  const loupeCanvas = iphoneCanvasSize();
  const centerY = Number(elements.loupeCenterY.value);
  const centerX = loupeCanvas.width / 2;
  draftLoupe.enabled = elements.loupeEnabled.checked;
  draftLoupe.center = { x: centerX, y: centerY };
  draftLoupe.sourceCenter = { x: centerX, y: centerY };
  draftLoupe.width = Number(elements.loupeWidth.value);
  draftLoupe.height = Number(elements.loupeHeight.value);
  draftLoupe.cornerRadius = Number(elements.loupeCornerRadius.value);
  draftLoupe.zoom = clampLoupeZoom(elements.loupeZoom);
  draftLoupe.borderColor = "#000000";
  draftLoupe.borderWidth = elements.loupeBorderEnabled.checked ? 2 : 0;
}

function updateEditableState() {
  const editable = Boolean(activeSet().editable);
  elements.controls.classList.toggle("read-only", !editable);
  elements.saveSlideButton.disabled = !editable;
  elements.gallerySaveAllButton.disabled = !editable;
  elements.contextLabel.textContent = editable
    ? `${activeSet().version} / ${activeSet().locale} / ${activeSet().device} · edits save to ${activeSet().configPath}`
    : `${activeSet().version} / ${activeSet().locale} / ${activeSet().device} · read-only ${activeSet().sourceLabel}`;

  elements.controls.querySelectorAll("input, button, textarea").forEach((control) => {
    control.disabled = !editable;
  });
  elements.captionColor.disabled = !editable;
  elements.backgroundColor.disabled = !editable;
  elements.captionTopPadding.disabled = !editable;
  elements.captionBottomPadding.disabled = !editable;
  elements.captionHorizontalPadding.disabled = !editable;
  document.querySelectorAll(".global-caption-padding .stepper-button").forEach((button) => {
    button.disabled = !editable;
  });
  syncLoupeSectionEnabled();
  updateLoupeClipboardButtons();
  updateHistoryButtons();
}

function renderedScale() {
  const rect = elements.slideImage.getBoundingClientRect();
  const set = activeSet();
  const canvas = set.canvas || {
    width: elements.slideImage.naturalWidth || rect.width,
    height: elements.slideImage.naturalHeight || rect.height
  };
  return {
    x: rect.width / canvas.width,
    y: rect.height / canvas.height,
    rect,
    canvas
  };
}

function updateLoupePreview() {
  if (!state || !activeSet()?.editable || !activeSlideId || !elements.slideImage.complete || !loupeOverlayVisible) {
    elements.loupePreview.style.display = "none";
    return;
  }

  updateLoupeFromControls();
  const scale = renderedScale();
  const imageScale = Math.min(scale.x, scale.y);
  const width = draftLoupe.width * scale.x;
  const height = draftLoupe.height * scale.y;
  const cornerRadius = (draftLoupe.cornerRadius ?? 48) * Math.min(scale.x, scale.y);
  const borderWidth = (draftLoupe.borderWidth ?? 0) * Math.min(scale.x, scale.y);
  const center = {
    x: draftLoupe.center.x * scale.x,
    y: draftLoupe.center.y * scale.y
  };
  const source = {
    x: draftLoupe.sourceCenter.x * imageScale,
    y: draftLoupe.sourceCenter.y * imageScale
  };

  elements.loupePreview.style.display = draftLoupe.enabled ? "block" : "none";

  if (!draftLoupe.enabled) {
    return;
  }

  elements.loupePreview.style.left = `${center.x - (width / 2)}px`;
  elements.loupePreview.style.top = `${center.y - (height / 2)}px`;
  elements.loupePreview.style.width = `${width}px`;
  elements.loupePreview.style.height = `${height}px`;
  elements.loupePreview.style.borderRadius = `${cornerRadius}px`;
  elements.loupePreview.style.border = borderWidth > 0 ? `${borderWidth}px solid ${draftLoupe.borderColor || "#000000"}` : "0";
  elements.loupePreview.style.backgroundImage = `url("${elements.slideImage.src}")`;
  elements.loupePreview.style.backgroundSize = `${scale.canvas.width * imageScale * draftLoupe.zoom}px ${scale.canvas.height * imageScale * draftLoupe.zoom}px`;
  elements.loupePreview.style.backgroundPosition = `${(width / 2) - (source.x * draftLoupe.zoom)}px ${(height / 2) - (source.y * draftLoupe.zoom)}px`;
}

function preferredTheme() {
  return window.localStorage.getItem("slide-editor-theme");
}

function systemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  elements.themeToggle.textContent = theme === "dark" ? "☀" : "☾";
  elements.themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
}

function initTheme() {
  applyTheme(preferredTheme() || systemTheme());
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || systemTheme();
  const next = current === "dark" ? "light" : "dark";
  window.localStorage.setItem("slide-editor-theme", next);
  applyTheme(next);
}

async function refreshState(selection = activeSet()) {
  const query = new URLSearchParams({
    device: selection.device,
    version: selection.version,
    locale: selection.locale
  });
  state = await api(`/api/state?${query.toString()}`);
  activeSetId = state.activeSetId || state.sets[0]?.id;
}

function savePayload() {
  updateLoupeFromControls();
  const set = activeSet();
  const slide = activeSlide();
  return {
    setId: set.id,
    slideId: slide.id,
    backgroundColor: globalBackgroundColorValue(),
    loupe: draftLoupe.enabled ? draftLoupe : null,
    caption: captionPaddingValues(),
    captionColor: globalCaptionColorValue(),
    captionText: elements.captionText.value
  };
}

async function saveActiveSlide() {
  const slide = activeSlide();
  setBusy(true);
  try {
    state = await api(`/api/slides/${encodeURIComponent(slide.id)}`, {
      method: "POST",
      body: JSON.stringify(savePayload())
    });
    activeSetId = state.activeSetId || activeSet().id;
    selectSlide(slide.id);
    renderNavigation();
    updateLastSavedLabel();
    showToast("Saved and rerendered slide");
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

function galleryRowForDevice(device) {
  return device === "ipad" ? elements.galleryIpadRow : elements.galleryIphoneRow;
}

function galleryZoomLabelForDevice(device) {
  return device === "ipad" ? elements.galleryIpadZoomLabel : elements.galleryIphoneZoomLabel;
}

function galleryDeviceFromRow(row) {
  if (!row) {
    return null;
  }
  if (row.classList.contains("gallery-row-ipad")) {
    return "ipad";
  }
  if (row.classList.contains("gallery-row-iphone")) {
    return "iphone";
  }
  return null;
}

function setGalleryDeviceZoom(device, zoom) {
  const clamped = Math.min(GALLERY_ZOOM_MAX, Math.max(GALLERY_ZOOM_MIN, zoom));
  galleryDeviceZoom[device] = clamped;
  const row = galleryRowForDevice(device);
  if (row) {
    row.style.setProperty("--gallery-zoom", String(clamped));
  }
  const label = galleryZoomLabelForDevice(device);
  if (label) {
    label.textContent = `${Math.round(clamped * 100)}%`;
  }
}

function syncGalleryDeviceZoomStyles() {
  setGalleryDeviceZoom("iphone", galleryDeviceZoom.iphone);
  setGalleryDeviceZoom("ipad", galleryDeviceZoom.ipad);
}

function initGalleryScrollHandlers() {
  if (initGalleryScrollHandlers.initialized) {
    return;
  }
  initGalleryScrollHandlers.initialized = true;

  const galleryBody = elements.galleryBody;
  if (!galleryBody) {
    return;
  }

  [elements.galleryIphoneRow, elements.galleryIpadRow].forEach((row) => {
    row.addEventListener(
      "wheel",
      (event) => {
        if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
          return;
        }

        event.preventDefault();
        galleryBody.scrollTop += event.deltaY;
      },
      { passive: false }
    );
  });
}

function initGalleryZoomHandlers() {
  if (initGalleryZoomHandlers.initialized) {
    return;
  }
  initGalleryZoomHandlers.initialized = true;

  elements.galleryOverlay.addEventListener("click", (event) => {
    const button = event.target.closest("[data-gallery-zoom-step][data-gallery-device]");
    if (!button) {
      return;
    }
    event.stopPropagation();
    const device = button.dataset.galleryDevice;
    const step = Number(button.dataset.galleryZoomStep);
    const current = galleryDeviceZoom[device] || 1;
    setGalleryDeviceZoom(device, current + step);
  });

  elements.galleryOverlay.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      const row = event.target.closest(".gallery-row");
      const device = galleryDeviceFromRow(row);
      if (!device || !event.target.closest(".gallery-slide")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const step = event.deltaY < 0 ? GALLERY_ZOOM_STEP : -GALLERY_ZOOM_STEP;
      const current = galleryDeviceZoom[device] || 1;
      setGalleryDeviceZoom(device, current + step);
    },
    { passive: false }
  );
}

function galleryLocales() {
  const set = activeSet();
  if (!set) {
    return [];
  }
  return sortLocales(
    state.sets
      .filter((candidate) => candidate.source === "generated" && candidate.version === set.version)
      .map((candidate) => candidate.locale)
  );
}

function setForGallery(device, locale) {
  const set = activeSet();
  if (!set) {
    return null;
  }
  return state.sets.find((candidate) =>
    candidate.source === "generated" &&
    candidate.version === set.version &&
    candidate.locale === locale &&
    candidate.device === device
  ) || null;
}

function renderGalleryRow(container, device, locale) {
  const slideSet = setForGallery(device, locale);
  container.innerHTML = "";
  if (!slideSet || slideSet.slides.length === 0) {
    const empty = document.createElement("p");
    empty.className = "gallery-empty";
    empty.textContent = "No slides found";
    container.appendChild(empty);
    return;
  }

  slideSet.slides.forEach((slide) => {
    const item = document.createElement("figure");
    item.className = "gallery-slide";
    const caption = slide.caption.replace(/"/g, "&quot;").replace(/\n/g, " ");
    item.innerHTML = `<img alt="${caption}" src="${cacheBustedImageUrl(slide.imageUrl)}">`;
    container.appendChild(item);
  });
}

function renderGalleryLocaleTabs() {
  const locales = galleryLocales();
  const activeLocale = galleryLocale || activeSet()?.locale || locales[0];
  galleryLocale = activeLocale;
  renderTabs(
    elements.galleryLocaleTabs,
    locales.map((locale) => ({ value: locale, label: locale })),
    activeLocale,
    (locale) => {
      galleryLocale = locale;
      renderGalleryContent();
      renderGalleryLocaleTabs();
    }
  );
}

function renderGalleryContent() {
  const set = activeSet();
  if (!set || !galleryLocale) {
    return;
  }
  elements.galleryTitle.textContent = set.version;
  renderGalleryRow(elements.galleryIphoneRow, "iphone", galleryLocale);
  renderGalleryRow(elements.galleryIpadRow, "ipad", galleryLocale);
}

function renderGallery() {
  renderGalleryLocaleTabs();
  renderGalleryContent();
  syncGalleryDeviceZoomStyles();
}

function openGallery() {
  if (!state || !activeSet()) {
    return;
  }
  galleryLocale = activeSet().locale;
  renderGallery();
  elements.galleryOverlay.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeGallery() {
  elements.galleryOverlay.hidden = true;
  document.body.style.overflow = "";
  setGallerySaveStatus("");
}

function setGallerySaveStatus(text, options = {}) {
  const status = elements.gallerySaveStatus;
  if (!status) {
    return;
  }

  window.clearTimeout(gallerySaveStatusTimer);
  status.classList.remove("is-fading");
  if (!text) {
    status.hidden = true;
    status.textContent = "";
    status.classList.remove("is-visible");
    return;
  }

  status.textContent = text;
  status.hidden = false;
  status.classList.add("is-visible");

  if (options.fadeAfterMs) {
    gallerySaveStatusTimer = window.setTimeout(() => {
      status.classList.add("is-fading");
      gallerySaveStatusTimer = window.setTimeout(() => {
        setGallerySaveStatus("");
      }, 400);
    }, options.fadeAfterMs);
  }
}

async function saveAllSlidesFromGallery() {
  const slide = activeSlide();
  setGallerySaveStatus("Saving…");
  setBusy(true);
  try {
    state = await api("/api/slides/save-all", {
      method: "POST",
      body: JSON.stringify(savePayload())
    });
    activeSetId = state.activeSetId || activeSet().id;
    selectSlide(slide.id);
    renderNavigation();
    renderSlideList();
    renderGallery();
    updateLastSavedLabel();
    setGallerySaveStatus("Saved", { fadeAfterMs: 2000 });
  } catch (error) {
    setGallerySaveStatus("");
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

function render() {
  const set = activeSet();
  if (!set) {
    showToast("No slide sets found");
    return;
  }

  elements.appLabel.textContent = "App Store Slide Editor";
  syncStageForDevice();
  renderNavigation();
  selectSlide(activeSlideId || set.slides[0]?.id);
}

async function load() {
  const params = new URLSearchParams(window.location.search);
  await refreshState({
    device: params.get("device") || "",
    version: params.get("version") || "",
    locale: params.get("locale") || ""
  });
  activeSlideId = activeSet()?.slides[0]?.id;
  render();
}

elements.slideList.addEventListener("dragover", (event) => {
  if (!dragSlideId || !activeSet()?.editable) {
    return;
  }

  const target = event.target.closest(".slide-button");
  if (!target || target.dataset.slideId === dragSlideId) {
    return;
  }

  event.preventDefault();
  clearSlideDropIndicators();
  const rect = target.getBoundingClientRect();
  const insertBefore = event.clientY < rect.top + (rect.height / 2);
  target.classList.add(insertBefore ? "drop-before" : "drop-after");
});

elements.slideList.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget || !elements.slideList.contains(event.relatedTarget)) {
    clearSlideDropIndicators();
  }
});

elements.slideList.addEventListener("drop", (event) => {
  if (!dragSlideId || !activeSet()?.editable) {
    return;
  }

  event.preventDefault();
  const target = event.target.closest(".slide-button");
  clearSlideDropIndicators();
  if (!target || target.dataset.slideId === dragSlideId) {
    return;
  }

  const rect = target.getBoundingClientRect();
  const insertBefore = event.clientY < rect.top + (rect.height / 2);
  reorderSlides(dragSlideId, target.dataset.slideId, insertBefore);
});

elements.slideImage.addEventListener("load", () => {
  setVisualLoading(false);
  updateLoupePreview();
});
window.addEventListener("resize", updateLoupePreview);

elements.backgroundColor.addEventListener("focus", () => {
  backgroundColorHistoryAnchor = currentSnapshot();
});

elements.backgroundColor.addEventListener("input", () => {
  elements.stage.style.background = elements.backgroundColor.value;
  scheduleSlidePreview({ refreshAllSlides: true, recordHistory: false });
});

elements.backgroundColor.addEventListener("change", () => {
  commitBackgroundColorHistory();
  scheduleSlidePreview({ refreshAllSlides: true, recordHistory: false });
});

elements.captionColor.addEventListener("focus", () => {
  captionColorHistoryAnchor = currentSnapshot();
});

elements.captionColor.addEventListener("input", () => {
  scheduleSlidePreview({ refreshAllSlides: true, recordHistory: false });
});

elements.captionColor.addEventListener("change", () => {
  commitCaptionColorHistory();
  scheduleSlidePreview({ refreshAllSlides: true, recordHistory: false });
});

elements.versionSelect.addEventListener("change", () => {
  setSelection({ version: elements.versionSelect.value, locale: null });
});

captionFields.forEach((input) => {
  input.addEventListener("focus", () => {
    captionPaddingHistoryAnchor = currentSnapshot();
  });
  input.addEventListener("input", () => {
    clampCaptionValue(input);
    scheduleSlidePreview({ refreshAllSlides: true, recordHistory: false });
  });
  input.addEventListener("change", () => {
    clampCaptionValue(input);
    commitCaptionPaddingHistory();
    scheduleSlidePreview({ refreshAllSlides: true, recordHistory: false });
  });
});

elements.captionText.addEventListener("input", () => scheduleSlidePreview({ optimisticCaption: true }));
elements.captionText.addEventListener("change", () => scheduleSlidePreview({ optimisticCaption: true }));

document.querySelectorAll(".stepper-button").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.target);
    if (!target) {
      return;
    }
    const step = Number(button.dataset.step || 0);
    bumpStepperValue(target, step);
    if (isLoupeStepperInput(target)) {
      scheduleLoupePreview();
      return;
    }
    if (isGlobalCaptionPaddingInput(target)) {
      scheduleSlidePreview({ refreshAllSlides: true, recordHistory: false });
      return;
    }
    scheduleSlidePreview();
  });
});

[
  elements.loupeCenterY,
  elements.loupeWidth,
  elements.loupeHeight,
  elements.loupeCornerRadius,
  elements.loupeZoom
].forEach((input) => {
  input.addEventListener("input", () => {
    if (input.id === "loupeZoom") {
      clampLoupeZoom(input);
    } else {
      clampCaptionValue(input);
    }
    scheduleLoupePreview();
  });
  input.addEventListener("change", () => {
    if (input.id === "loupeZoom") {
      clampLoupeZoom(input);
    } else {
      clampCaptionValue(input);
    }
    scheduleLoupePreview();
  });
});

elements.loupeBorderEnabled.addEventListener("input", scheduleLoupePreview);
elements.loupeBorderEnabled.addEventListener("change", scheduleLoupePreview);

elements.copyLoupeButton.addEventListener("click", copyLoupeSettings);
elements.pasteLoupeButton.addEventListener("click", () => pasteLoupeToCurrentSlide().catch((error) => showToast(error.message)));
elements.pasteLoupeLocalesButton.addEventListener("click", () => pasteLoupeToAllLocales().catch((error) => showToast(error.message)));

elements.loupeEnabled.addEventListener("change", () => {
  if (elements.loupeEnabled.checked && (!draftLoupe || draftLoupe.enabled === false)) {
    draftLoupe = defaultLoupe();
    syncControlsFromLoupe();
  }
  syncLoupeSectionEnabled();
  scheduleLoupePreview();
});

elements.themeToggle.addEventListener("click", toggleTheme);
elements.saveSlideButton.addEventListener("click", saveActiveSlide);
elements.viewAllButton.addEventListener("click", openGallery);
elements.galleryCloseButton.addEventListener("click", closeGallery);
elements.gallerySaveAllButton.addEventListener("click", () => saveAllSlidesFromGallery().catch((error) => showToast(error.message)));
elements.galleryOverlay.addEventListener("click", (event) => {
  if (event.target === elements.galleryOverlay) {
    closeGallery();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.galleryOverlay.hidden) {
    closeGallery();
  }
});
elements.undoButton.addEventListener("click", () => undoEdit().catch((error) => showToast(error.message)));
elements.redoButton.addEventListener("click", () => redoEdit().catch((error) => showToast(error.message)));

initTheme();
initGalleryScrollHandlers();
initGalleryZoomHandlers();
load().catch((error) => showToast(error.message));
