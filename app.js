const video = document.querySelector('#camera-preview');
const previewFrame = document.querySelector('#preview-frame');
const placeholder = document.querySelector('#camera-placeholder');
const placeholderTitle = document.querySelector('#placeholder-title');
const placeholderCopy = document.querySelector('#placeholder-copy');
const startButton = document.querySelector('#start-camera');
const captureButton = document.querySelector('#capture-photo');
const switchButton = document.querySelector('#switch-camera');
const stopButton = document.querySelector('#stop-camera');
const status = document.querySelector('#camera-status');
const statusText = document.querySelector('#status-text');
const liveLabel = document.querySelector('#live-label');
const resolutionLabel = document.querySelector('#preview-resolution');
const intensityInput = document.querySelector('#intensity');
const intensityValue = document.querySelector('#intensity-value');
const pixelPreview = document.querySelector('#pixel-preview');
const pixelSizeControl = document.querySelector('#pixel-size-control');
const pixelSizeInput = document.querySelector('#pixel-size');
const pixelSizeValue = document.querySelector('#pixel-size-value');
const filterButtons = [...document.querySelectorAll('.filter-card')];
const captureFlash = document.querySelector('#capture-flash');
const HALFTONE_CELL_SIZE = 10;
const HALFTONE_RENDER_SCALE = 4;
const halftoneSampleCanvas = document.createElement('canvas');
const halftoneSampleContext = halftoneSampleCanvas.getContext('2d', { willReadFrequently: true });
const EFFECT_RENDER_WIDTH = 480;
const EFFECT_CAPTURE_WIDTH = 960;
const ASCII_CHARACTERS = ' .,:;!+*#%@M';
const effectSourceCanvas = document.createElement('canvas');
const effectSourceContext = effectSourceCanvas.getContext('2d', { willReadFrequently: true });
const effectResultCanvas = document.createElement('canvas');
const effectResultContext = effectResultCanvas.getContext('2d', { willReadFrequently: true });
const asciiSampleCanvas = document.createElement('canvas');
const asciiSampleContext = asciiSampleCanvas.getContext('2d', { willReadFrequently: true });
let effectImageData = null;

const filters = {
  original: () => 'none',
  golden: (amount) => `sepia(${0.42 * amount}) saturate(${1 + 0.28 * amount}) contrast(${1 + 0.04 * amount})`,
  rose: (amount) => `sepia(${0.2 * amount}) hue-rotate(${-12 * amount}deg) saturate(${1 + 0.16 * amount}) brightness(${1 + 0.025 * amount})`,
  film: (amount) => `contrast(${1 + 0.17 * amount}) saturate(${1 - 0.38 * amount}) sepia(${0.12 * amount}) brightness(${1 + 0.025 * amount})`,
  dream: (amount) => `hue-rotate(${12 * amount}deg) saturate(${1 + 0.22 * amount}) brightness(${1 + 0.07 * amount}) contrast(${1 - 0.08 * amount})`,
  mono: (amount) => `grayscale(${amount}) contrast(${1 + 0.08 * amount})`,
  pixel: () => 'none',
  halftone: () => 'none',
  ascii: () => 'none',
  vhs: () => 'none',
  risograph: () => 'none',
  blueprint: () => 'none',
  glitch: () => 'none',
  crt: () => 'none'
};

const canvasFilters = new Set(['ascii', 'vhs', 'risograph', 'blueprint', 'glitch', 'crt']);

let stream = null;
let facingMode = 'user';
let selectedFilter = 'original';
let captureInProgress = false;
let effectAnimationFrame = null;
let pointerPosition = { x: 0.5, y: 0.5 };

function setCanvasSize(canvas, width, height) {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function drawOrientedSource(context, source, width, height) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  if (facingMode === 'user') {
    context.translate(width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(source, 0, 0, width, height);
  context.setTransform(1, 0, 0, 1, 0, 0);
}

function luminanceAt(pixels, offset) {
  return pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722;
}

function sampleChannel(pixels, width, height, x, y, channel) {
  const sampleX = Math.max(0, Math.min(width - 1, Math.round(x)));
  const sampleY = Math.max(0, Math.min(height - 1, Math.round(y)));
  return pixels[(sampleY * width + sampleX) * 4 + channel];
}

function drawAscii(context, source, width, height) {
  if (!asciiSampleContext) return;
  const columns = Math.max(1, Math.floor(width / 7));
  const rows = Math.max(1, Math.floor(height / 10));
  setCanvasSize(asciiSampleCanvas, columns, rows);
  asciiSampleContext.drawImage(source, 0, 0, columns, rows);
  const pixels = asciiSampleContext.getImageData(0, 0, columns, rows).data;
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  context.fillStyle = '#06120a';
  context.fillRect(0, 0, width, height);
  context.font = `${Math.ceil(cellHeight)}px monospace`;
  context.textBaseline = 'top';
  context.shadowColor = '#7dff83';
  context.shadowBlur = 3;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const luminance = luminanceAt(pixels, (row * columns + column) * 4) / 255;
      const characterIndex = Math.min(ASCII_CHARACTERS.length - 1, Math.floor(luminance * ASCII_CHARACTERS.length));
      if (characterIndex === 0) continue;
      const brightness = Math.round(95 + luminance * 160);
      context.fillStyle = `rgb(${Math.round(brightness * 0.62)} ${brightness} ${Math.round(brightness * 0.55)})`;
      context.fillText(ASCII_CHARACTERS[characterIndex], column * cellWidth, row * cellHeight);
    }
  }
  context.shadowBlur = 0;
}

function drawPixelEffect(filter, source, context, width, height, timestamp) {
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  const sourcePixels = sourceContext.getImageData(0, 0, width, height).data;
  if (!effectImageData || effectImageData.width !== width || effectImageData.height !== height) {
    effectImageData = context.createImageData(width, height);
  }
  const output = effectImageData;
  const pixels = output.data;
  const time = timestamp / 1000;
  const motionX = (pointerPosition.x - 0.5) * 12;
  const split = filter === 'vhs' ? 1.5 : Math.sin(time * 7) * 3 + motionX;
  const jitter = filter === 'vhs' ? Math.round(Math.sin(time * 38) * 1.4) : 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (filter === 'risograph') {
        const luminance = luminanceAt(sourcePixels, offset) / 255;
        const grain = ((((x * 374761393 + y * 668265263) ^ (x * y * 982451653)) >>> 0) % 100) / 100 - 0.5;
        const tone = Math.max(0, Math.min(1, (luminance - 0.38) * 2.8 + 0.5 + grain * 0.4));
        pixels[offset] = 255 - tone * 115;
        pixels[offset + 1] = 48 + tone * 207;
        pixels[offset + 2] = 132 + tone * 73;
      } else if (filter === 'blueprint') {
        const left = Math.max(0, x - 1);
        const right = Math.min(width - 1, x + 1);
        const top = Math.max(0, y - 1);
        const bottom = Math.min(height - 1, y + 1);
        const topLeft = luminanceAt(sourcePixels, (top * width + left) * 4);
        const topCenter = luminanceAt(sourcePixels, (top * width + x) * 4);
        const topRight = luminanceAt(sourcePixels, (top * width + right) * 4);
        const middleLeft = luminanceAt(sourcePixels, (y * width + left) * 4);
        const middleRight = luminanceAt(sourcePixels, (y * width + right) * 4);
        const bottomLeft = luminanceAt(sourcePixels, (bottom * width + left) * 4);
        const bottomCenter = luminanceAt(sourcePixels, (bottom * width + x) * 4);
        const bottomRight = luminanceAt(sourcePixels, (bottom * width + right) * 4);
        const horizontal = -topLeft + topRight - 2 * middleLeft + 2 * middleRight - bottomLeft + bottomRight;
        const vertical = -topLeft - 2 * topCenter - topRight + bottomLeft + 2 * bottomCenter + bottomRight;
        const edge = Math.min(1, Math.sqrt(horizontal * horizontal + vertical * vertical) / 1020);
        const inverse = 1 - luminanceAt(sourcePixels, offset) / 255;
        const base = 18 + inverse * 42;
        const line = edge * 210;
        pixels[offset] = 4 + line * 0.35;
        pixels[offset + 1] = base + line * 0.8;
        pixels[offset + 2] = 42 + inverse * 90 + line * 0.8;
      } else if (filter === 'glitch') {
        const offsetX = Math.round(split);
        const redShift = Math.round(Math.sin(time * 11) * 2 + offsetX);
        const blueShift = -Math.round(Math.cos(time * 8) * 2 + offsetX);
        pixels[offset] = sampleChannel(sourcePixels, width, height, x + redShift, y, 0);
        pixels[offset + 1] = sourcePixels[offset + 1];
        pixels[offset + 2] = sampleChannel(sourcePixels, width, height, x + blueShift, y, 2);
      } else if (filter === 'vhs') {
        const rowShift = Math.round(Math.sin(y * 0.11 + time * 0.7) * 1.5);
        const shiftedY = y + jitter + rowShift;
        pixels[offset] = sampleChannel(sourcePixels, width, height, x + split, shiftedY, 0);
        pixels[offset + 1] = sampleChannel(sourcePixels, width, height, x, shiftedY, 1);
        pixels[offset + 2] = sampleChannel(sourcePixels, width, height, x - split, shiftedY, 2);
        const scanline = y % 3 === 0 ? 0.78 : 1;
        pixels[offset] *= scanline;
        pixels[offset + 1] *= scanline;
        pixels[offset + 2] *= scanline;
      } else {
        const nx = ((x + 0.5) / width) * 2 - 1;
        const ny = ((y + 0.5) / height) * 2 - 1;
        const radiusSquared = nx * nx + ny * ny;
        const sourceX = Math.round((nx * (1 + 0.12 * radiusSquared) + 1) * width / 2 - 0.5);
        const sourceY = Math.round((ny * (1 + 0.12 * radiusSquared) + 1) * height / 2 - 0.5);
        const sampleOffset = (Math.max(0, Math.min(height - 1, sourceY)) * width + Math.max(0, Math.min(width - 1, sourceX))) * 4;
        const luminance = luminanceAt(sourcePixels, sampleOffset) / 255;
        const scanline = y % 3 === 0 ? 0.76 : 1;
        const vignette = Math.max(0.18, 1 - radiusSquared * 0.34);
        const glow = Math.pow(luminance, 0.78) * vignette * scanline;
        pixels[offset] = glow * 255;
        pixels[offset + 1] = glow * 190;
        pixels[offset + 2] = glow * 72;
      }
      pixels[offset + 3] = 255;
    }
  }
  context.putImageData(output, 0, 0);

  if (filter === 'vhs') {
    const fontSize = Math.max(10, Math.round(width / 38));
    context.save();
    context.font = `500 ${fontSize}px monospace`;
    context.textBaseline = 'bottom';
    context.shadowColor = '#75ff89';
    context.shadowBlur = fontSize;
    context.fillStyle = '#9bff9e';
    context.fillText('REC ● 04:20:1994', Math.round(width * 0.045), height - Math.round(height * 0.055));
    context.restore();
  }
}

function renderCanvasEffect(filter, source, context, width, height, timestamp) {
  if (filter === 'ascii') drawAscii(context, source, width, height);
  else drawPixelEffect(filter, source, context, width, height, timestamp);
}

function stopEffectRendering() {
  if (effectAnimationFrame !== null) {
    cancelAnimationFrame(effectAnimationFrame);
    effectAnimationFrame = null;
  }
}

function drawHalftone(context, source, width, height) {
  if (!halftoneSampleContext) return;

  const columns = Math.max(1, Math.ceil(width / HALFTONE_CELL_SIZE));
  const rows = Math.max(1, Math.ceil(height / HALFTONE_CELL_SIZE));
  if (halftoneSampleCanvas.width !== columns || halftoneSampleCanvas.height !== rows) {
    halftoneSampleCanvas.width = columns;
    halftoneSampleCanvas.height = rows;
  }
  halftoneSampleContext.drawImage(source, 0, 0, columns, rows);
  const pixels = halftoneSampleContext.getImageData(0, 0, columns, rows).data;
  const cellWidth = context.canvas.width / columns;
  const cellHeight = context.canvas.height / rows;
  const maxRadius = Math.min(cellWidth, cellHeight) / 2;

  context.fillStyle = '#fff';
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  context.fillStyle = '#111';
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const offset = (row * columns + column) * 4;
      const luminance = (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) / 255;
      const radius = maxRadius * Math.sqrt(1 - luminance);
      if (radius < 0.1) continue;

      context.beginPath();
      context.arc((column + 0.5) * cellWidth, (row + 0.5) * cellHeight, radius, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function updateEffectRendering() {
  stopEffectRendering();
  const isPixelated = selectedFilter === 'pixel';
  const isHalftone = selectedFilter === 'halftone';
  const isCanvasEffect = canvasFilters.has(selectedFilter);
  previewFrame.classList.toggle('is-pixelated', isPixelated);
  previewFrame.classList.toggle('is-halftone', isHalftone);
  previewFrame.classList.toggle('is-canvas-effect', isCanvasEffect);
  previewFrame.classList.toggle('is-crt', selectedFilter === 'crt');
  pixelPreview.style.setProperty('--halftone-opacity', String(Number(intensityInput.value) / 100));
  if ((!isPixelated && !isHalftone && !isCanvasEffect) || !stream) return;

  const drawFrame = () => {
    if (!stream || (selectedFilter !== 'pixel' && selectedFilter !== 'halftone' && !canvasFilters.has(selectedFilter))) {
      effectAnimationFrame = null;
      return;
    }

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
      const context = pixelPreview.getContext('2d');
      if (context && isPixelated) {
        const pixelSize = Number(pixelSizeInput.value);
        const width = Math.max(1, Math.ceil(video.videoWidth / pixelSize));
        const height = Math.max(1, Math.ceil(video.videoHeight / pixelSize));
        if (pixelPreview.width !== width || pixelPreview.height !== height) {
          pixelPreview.width = width;
          pixelPreview.height = height;
        }
        context.drawImage(video, 0, 0, width, height);
      } else if (context && isHalftone) {
        const columns = Math.ceil(video.videoWidth / HALFTONE_CELL_SIZE);
        const rows = Math.ceil(video.videoHeight / HALFTONE_CELL_SIZE);
        const width = columns * HALFTONE_RENDER_SCALE;
        const height = rows * HALFTONE_RENDER_SCALE;
        if (pixelPreview.width !== width || pixelPreview.height !== height) {
          pixelPreview.width = width;
          pixelPreview.height = height;
        }
        drawHalftone(context, video, video.videoWidth, video.videoHeight);
      } else if (context && isCanvasEffect && effectSourceContext && effectResultContext) {
        const width = Math.min(video.videoWidth, EFFECT_RENDER_WIDTH);
        const height = Math.max(1, Math.round(video.videoHeight * width / video.videoWidth));
        setCanvasSize(effectSourceCanvas, width, height);
        setCanvasSize(effectResultCanvas, width, height);
        setCanvasSize(pixelPreview, width, height);
        drawOrientedSource(effectSourceContext, video, width, height);
        renderCanvasEffect(selectedFilter, effectSourceCanvas, effectResultContext, width, height, performance.now());
        context.globalAlpha = 1;
        context.drawImage(effectSourceCanvas, 0, 0, width, height);
        context.globalAlpha = Number(intensityInput.value) / 100;
        context.drawImage(effectResultCanvas, 0, 0, width, height);
        context.globalAlpha = 1;
      }
    }

    effectAnimationFrame = requestAnimationFrame(drawFrame);
  };

  effectAnimationFrame = requestAnimationFrame(drawFrame);
}

function renderFilter() {
  const amount = Number(intensityInput.value) / 100;
  const filter = filters[selectedFilter](amount);
  video.style.filter = filter;
  intensityValue.textContent = `${intensityInput.value}%`;
  intensityInput.style.setProperty('--range-progress', `${intensityInput.value}%`);
  pixelSizeControl.hidden = selectedFilter !== 'pixel';
  pixelSizeValue.textContent = `${pixelSizeInput.value} px`;
  const pixelRange = pixelSizeInput.max - pixelSizeInput.min;
  const pixelProgress = ((pixelSizeInput.value - pixelSizeInput.min) / pixelRange) * 100;
  pixelSizeInput.style.setProperty('--range-progress', `${pixelProgress}%`);
  updateEffectRendering();
}

function setCameraStatus(message, isOn = false) {
  statusText.textContent = message;
  status.classList.toggle('is-on', isOn);
  document.querySelector('.live-badge').classList.toggle('is-live', isOn);
  liveLabel.textContent = isOn ? 'LIVE' : 'PREVIEW';
}

function setCameraControls(isOn) {
  captureButton.disabled = !isOn;
  switchButton.disabled = !isOn;
  stopButton.disabled = !isOn;
  startButton.hidden = isOn;
}

function showCameraError(error) {
  let title = 'Could not start your camera';
  let message = 'Check your camera connection and browser permissions, then try again.';

  if (!window.isSecureContext) {
    title = 'A secure connection is needed';
    message = 'Open this page over HTTPS or on localhost to use your camera.';
  } else if (error?.name === 'NotSupportedError') {
    title = 'Camera access is not supported';
    message = 'Try opening this page in a browser that supports camera access.';
  } else if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    title = 'Camera permission needed';
    message = 'Allow camera access in your browser settings, then try again.';
  } else if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    title = 'No camera found';
    message = 'Connect a camera to your device and try again.';
  } else if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
    title = 'Camera is busy';
    message = 'Close other apps using your camera, then give it another try.';
  }

  placeholderTitle.textContent = title;
  placeholderCopy.textContent = message;
  placeholder.classList.remove('is-hidden');
  setCameraStatus('Camera unavailable');
}

async function startCamera(mode = facingMode, exactMode = false) {
  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraError({ name: window.isSecureContext ? 'NotSupportedError' : 'SecurityError' });
    return false;
  }

  startButton.disabled = true;
  startButton.querySelector('span').textContent = 'Connecting…';
  setCameraStatus('Requesting access');

  let nextStream;
  try {
    nextStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: exactMode ? { exact: mode } : { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
  } catch (error) {
    startButton.disabled = false;
    startButton.querySelector('span').textContent = 'Try again';
    showCameraError(error);
    return false;
  }

  const previousStream = stream;
  stream = nextStream;
  facingMode = mode;
  video.srcObject = stream;
  previewFrame.classList.toggle('is-front-camera', facingMode === 'user');
  try {
    await video.play();
  } catch {
    // The browser may defer playback; the stream is still available after a user gesture.
  }
  previousStream?.getTracks().forEach((track) => track.stop());

  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings?.() || {};
  resolutionLabel.textContent = settings.width && settings.height ? `${settings.width} × ${settings.height}` : 'CAMERA ON';
  placeholder.classList.add('is-hidden');
  previewFrame.classList.add('has-stream');
  setCameraControls(true);
  setCameraStatus('Camera is on', true);
  updateEffectRendering();
  startButton.disabled = false;
  startButton.querySelector('span').textContent = 'Turn on camera';

  track?.addEventListener('ended', () => {
    if (stream?.getVideoTracks().includes(track)) stopCamera('Camera disconnected');
  }, { once: true });
  return true;
}

function stopCamera(message = 'Camera is off') {
  stopEffectRendering();
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  previewFrame.classList.remove('has-stream');
  placeholder.classList.remove('is-hidden');
  placeholderTitle.textContent = 'Your moment starts here';
  placeholderCopy.textContent = 'Turn on your camera to see the magic.';
  resolutionLabel.textContent = 'READY WHEN YOU ARE';
  setCameraControls(false);
  startButton.disabled = false;
  startButton.querySelector('span').textContent = 'Turn on camera';
  setCameraStatus(message);
}

async function switchCamera() {
  const nextMode = facingMode === 'user' ? 'environment' : 'user';
  const previousMode = facingMode;
  const switched = await startCamera(nextMode, true);
  if (!switched && stream) {
    facingMode = previousMode;
    placeholder.classList.add('is-hidden');
    startButton.querySelector('span').textContent = 'Turn on camera';
    setCameraStatus('Could not switch camera', true);
  }
}

function capturePhoto() {
  if (!stream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || captureInProgress) return;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return;

  captureInProgress = true;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    captureInProgress = false;
    setCameraStatus('Could not save photo', true);
    return;
  }

  context.filter = filters[selectedFilter](Number(intensityInput.value) / 100);
  const isCanvasEffect = canvasFilters.has(selectedFilter);
  if (facingMode === 'user' && !isCanvasEffect) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }
  if (selectedFilter === 'pixel') {
    const pixelCanvas = document.createElement('canvas');
    pixelCanvas.width = Math.max(1, Math.ceil(width / Number(pixelSizeInput.value)));
    pixelCanvas.height = Math.max(1, Math.ceil(height / Number(pixelSizeInput.value)));
    const pixelContext = pixelCanvas.getContext('2d');
    if (pixelContext) {
      pixelContext.drawImage(video, 0, 0, pixelCanvas.width, pixelCanvas.height);
      context.imageSmoothingEnabled = false;
      context.drawImage(pixelCanvas, 0, 0, width, height);
    }
  } else if (selectedFilter === 'halftone') {
    context.drawImage(video, 0, 0, width, height);
    context.globalAlpha = Number(intensityInput.value) / 100;
    drawHalftone(context, video, width, height);
    context.globalAlpha = 1;
  } else if (isCanvasEffect && effectSourceContext && effectResultContext) {
    const renderWidth = Math.min(width, EFFECT_CAPTURE_WIDTH);
    const renderHeight = Math.max(1, Math.round(height * renderWidth / width));
    setCanvasSize(effectSourceCanvas, renderWidth, renderHeight);
    setCanvasSize(effectResultCanvas, renderWidth, renderHeight);
    drawOrientedSource(effectSourceContext, video, renderWidth, renderHeight);
    renderCanvasEffect(selectedFilter, effectSourceCanvas, effectResultContext, renderWidth, renderHeight, performance.now());
    context.drawImage(effectSourceCanvas, 0, 0, width, height);
    context.globalAlpha = Number(intensityInput.value) / 100;
    context.drawImage(effectResultCanvas, 0, 0, width, height);
    context.globalAlpha = 1;
  } else {
    context.drawImage(video, 0, 0, width, height);
  }
  canvas.toBlob((blob) => {
    captureInProgress = false;
    if (!blob) {
      setCameraStatus('Could not save photo', true);
      return;
    }
    const url = URL.createObjectURL(blob);
    const download = document.createElement('a');
    download.href = url;
    download.download = `luma-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    download.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setCameraStatus('Photo saved', true);
    captureFlash.classList.remove('flash');
    void captureFlash.offsetWidth;
    captureFlash.classList.add('flash');
  }, 'image/png');
}

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selectedFilter = button.dataset.filter;
    filterButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle('is-selected', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    const index = filterButtons.indexOf(button) + 1;
    document.querySelector('.filter-count').innerHTML = `${String(index).padStart(2, '0')} <span>/ ${String(filterButtons.length).padStart(2, '0')}</span>`;
    renderFilter();
  });
});

intensityInput.addEventListener('input', renderFilter);
pixelSizeInput.addEventListener('input', renderFilter);
previewFrame.addEventListener('pointermove', (event) => {
  const bounds = previewFrame.getBoundingClientRect();
  pointerPosition = {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
  };
});
startButton.addEventListener('click', () => startCamera());
captureButton.addEventListener('click', capturePhoto);
switchButton.addEventListener('click', switchCamera);
stopButton.addEventListener('click', () => stopCamera());
document.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && !event.repeat && !event.target.matches('button, input, textarea, select')) {
    event.preventDefault();
    capturePhoto();
  }
});
window.addEventListener('pagehide', () => stream?.getTracks().forEach((track) => track.stop()));

renderFilter();