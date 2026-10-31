import { parseGIF, decompressFrames } from 'https://esm.sh/gifuct-js@2.0.0';

// Example GIF configuration - just change this path if you rename the file
const EXAMPLE_GIF_PATH = './ghibli-example.gif';

function createPatchCanvas(frame) {
    const canvas = document.createElement('canvas');
    canvas.width = frame.dims.width;
    canvas.height = frame.dims.height;
    const ctx = canvas.getContext('2d', { alpha: true });
    
    const imgData = new ImageData(
        new Uint8ClampedArray(frame.patch),
        frame.dims.width,
        frame.dims.height
    );
    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

const uploadZone = document.getElementById('uploadZone');
const uploadContainer = document.getElementById('uploadContainer');
const fileInput = document.getElementById('fileInput');
const filmScroll = document.getElementById('filmScroll');
const filmContainer = document.getElementById('filmContainer');
const infoPanel = document.getElementById('infoPanel');
const appStatus = document.getElementById('appStatus');
const toast = document.getElementById('toast');

// Play the upload view's exit animation, then hide it. Safe to call repeatedly.
let uploadLeaving = null;
function hideUpload() {
    if (uploadContainer.style.display === 'none') return Promise.resolve();
    if (uploadLeaving) return uploadLeaving;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        uploadContainer.style.display = 'none';
        return Promise.resolve();
    }
    uploadContainer.classList.add('leaving');
    const leave = new Promise((resolve) => {
        const done = () => {
            // showUpload() may have cancelled this exit; then leave the view alone
            if (uploadLeaving === leave) {
                uploadContainer.style.display = 'none';
                uploadContainer.classList.remove('leaving');
                uploadLeaving = null;
            }
            resolve();
        };
        uploadContainer.addEventListener('animationend', done, { once: true });
        setTimeout(done, 300);
    });
    uploadLeaving = leave;
    return leave;
}

// Bring the upload view back, cancelling an exit that is still playing.
function showUpload() {
    uploadLeaving = null;
    uploadContainer.classList.remove('leaving');
    uploadContainer.style.display = 'flex';
}

// The preview flies in from where the GIF came from: the example thumbnail (a fixed
// copy holds its place while the upload view leaves) or the point a file was dropped.
let flight = null;
function reducedMotion() {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function startFlight(img) {
    if (reducedMotion()) return;
    const rect = img.getBoundingClientRect();
    const ghost = img.cloneNode();
    ghost.className = 'flight-ghost';
    ghost.alt = '';
    Object.assign(ghost.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`
    });
    document.body.appendChild(ghost);
    flight = { ghost, rect, showcase: true };
}

function startFlightAt(x, y) {
    if (reducedMotion()) return;
    const size = 48;
    flight = { ghost: null, rect: { left: x - size / 2, top: y - size / 2, width: size }, showcase: false };
}

function cancelFlight() {
    flight?.ghost?.remove();
    flight = null;
    filmContainer.classList.remove('flying', 'showcase');
}

function landFlight(target) {
    if (!flight) return;
    const { ghost, rect } = flight;
    flight = null;
    const to = target.getBoundingClientRect();
    ghost?.remove();
    if (!to.width) return;
    const dx = rect.left - to.left;
    const dy = rect.top - to.top;
    const s = rect.width / to.width;
    target.style.transformOrigin = '0 0';
    target.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${s})`, borderRadius: '12px' },
        { transform: 'none', borderRadius: '8px' }
    ], { duration: 700, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
}

// Bumped by each new load and by reset, so a stale decode loop stops quietly.
let loadId = 0;

// Slim bar under the nav: sweeps while loading, then fills as frames decode.
const progressBar = document.getElementById('progressBar');
let progressTimer = 0;
function startProgress() {
    clearTimeout(progressTimer);
    progressBar.style.setProperty('--progress', 0);
    progressBar.classList.add('active', 'indeterminate');
}
function setProgress(fraction) {
    progressBar.classList.remove('indeterminate');
    progressBar.style.setProperty('--progress', fraction);
}
function endProgress() {
    setProgress(1);
    progressTimer = setTimeout(() => progressBar.classList.remove('active'), 300);
}

let toastTimer = 0;
function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 5000);
}

let currentFrames = [];
let currentFileName = '';
let currentGifUrl = null;

uploadZone.addEventListener('click', (event) => {
    if (event.target !== fileInput) fileInput.click();
});

uploadZone.addEventListener('keydown', (event) => {
    if (event.target === uploadZone && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        fileInput.click();
    }
});

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'image/gif') {
        startFlightAt(e.clientX, e.clientY);
        handleFile(file);
    }
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
});

// Load example GIF
document.getElementById('loadExampleBtn')?.addEventListener('click', async () => {
    const loadBtn = document.getElementById('loadExampleBtn');
    
    try {
        if (loadBtn) loadBtn.disabled = true;
        
        // Start the exit animation while the example downloads
        const exampleName = EXAMPLE_GIF_PATH.split('/').pop();
        startProgress();
        const thumb = loadBtn?.querySelector('img');
        if (thumb) startFlight(thumb);
        hideUpload();

        const response = await fetch(EXAMPLE_GIF_PATH);
        if (!response.ok) throw new Error('Failed to load example');
        const blob = await response.blob();
        const file = new File([blob], exampleName, { type: 'image/gif' });
        await handleFile(file);
    } catch (err) {
        console.error('Failed to load example:', err);
        cancelFlight();
        showUpload();
        endProgress();
        showToast('Could not load the example GIF. Try uploading your own.');
    } finally {
        // Restore button state
        if (loadBtn) loadBtn.disabled = false;
    }
});

async function handleFile(file) {
    const thisLoad = ++loadId;
    appStatus.textContent = `Decoding ${file.name}.`;
    currentFileName = file.name.replace(/\.[^/.]+$/, "");
    currentFrames = [];
    
    // Store original GIF URL but don't display yet
    if (currentGifUrl) {
        URL.revokeObjectURL(currentGifUrl);
    }
    currentGifUrl = URL.createObjectURL(file);
    
    // Clear and hide everything first. The exit animation runs on the compositor,
    // so reading and parsing happen while it plays instead of after it.
    filmScroll.innerHTML = '';
    filmContainer.classList.remove('visible');
    startProgress();
    const uploadHidden = hideUpload();
    const gifImage = document.getElementById('gifImage');
    gifImage.src = currentGifUrl;
    const previewReady = gifImage.decode().catch(() => {});
    
    try {
        const buffer = await file.arrayBuffer();
        if (thisLoad !== loadId) return;
        const gif = parseGIF(buffer);
        const frames = decompressFrames(gif, true);
        
        if (frames.length === 0) {
            throw new Error('No frames found in GIF');
        }
        
        const width = gif.lsd.width;
        const height = gif.lsd.height;
        const totalDuration = frames.reduce((sum, f) => sum + (f.delay || 100), 0);

        // Update info footer data
        document.getElementById('dimVal').textContent = `${width}×${height}`;
        document.getElementById('frameVal').textContent = frames.length;
        document.getElementById('durVal').textContent = `${(totalDuration/1000).toFixed(1)}s`;

        // Set CSS custom property for aspect ratio
        const aspectRatio = width / height;
        filmScroll.style.setProperty('--gif-aspect-ratio', aspectRatio);

        const mainCanvas = document.createElement('canvas');
        mainCanvas.width = width;
        mainCanvas.height = height;
        // Enable alpha for proper transparency handling
        const ctx = mainCanvas.getContext('2d', { alpha: true });
        // Disable alpha premultiplication for accurate GIF rendering
        ctx.imageSmoothingEnabled = false;

        // Show the preview now; frame cards animate in as they are decoded
        const downloadAll = document.getElementById('downloadAll');
        downloadAll.disabled = true;
        await Promise.all([uploadHidden, previewReady]);
        if (thisLoad !== loadId) return;
        filmContainer.classList.toggle('flying', !!flight);
        filmContainer.classList.toggle('showcase', !!flight?.showcase);
        filmContainer.classList.add('visible');
        landFlight(gifImage);
        
        // Store previous frame canvas for disposal type 3 (restore to previous)
        let previousFrameCanvas = null;
        
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const patchCanvas = createPatchCanvas(frame);
            
            if (i > 0) {
                const prev = frames[i - 1];
                if (prev.disposalType === 2) {
                    // Restore to background color (clear to transparent)
                    ctx.clearRect(0, 0, width, height);
                } else if (prev.disposalType === 3 && i > 1) {
                    // Restore to previous - use saved state
                    if (previousFrameCanvas) {
                        ctx.clearRect(0, 0, width, height);
                        ctx.drawImage(previousFrameCanvas, 0, 0);
                    } else {
                        ctx.clearRect(0, 0, width, height);
                    }
                }
            }
            
            // Save state before drawing this frame (for next frame's disposal type 3)
            if (frame.disposalType === 3) {
                previousFrameCanvas = document.createElement('canvas');
                previousFrameCanvas.width = width;
                previousFrameCanvas.height = height;
                previousFrameCanvas.getContext('2d', { alpha: true }).drawImage(mainCanvas, 0, 0);
            }
            
            // Draw current frame with transparency support
            ctx.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
            
            // Create frame canvas with transparency
            const frameCanvas = document.createElement('canvas');
            frameCanvas.width = width;
            frameCanvas.height = height;
            const frameCtx = frameCanvas.getContext('2d', { alpha: true });
            frameCtx.imageSmoothingEnabled = false;
            frameCtx.drawImage(mainCanvas, 0, 0);
            
            currentFrames.push({
                canvas: frameCanvas,
                delay: frame.delay || 100,
                index: i
            });
            filmScroll.appendChild(createFrameCard(currentFrames[i], i));
            setProgress((i + 1) / frames.length);
            
            // Allow UI to breathe every few frames
            if (i % 3 === 0) {
                await new Promise(r => requestAnimationFrame(r));
                if (thisLoad !== loadId) return;
            }
        }

        downloadAll.disabled = false;
        endProgress();
        appStatus.textContent = `${frames.length} frames ready. Select a frame to copy it, or download the frames.`;
        document.getElementById('downloadAll').focus({ preventScroll: true });
        
    } catch (err) {
        if (thisLoad !== loadId) return;
        console.error(err);
        endProgress();
        showToast('Could not read that GIF: ' + err.message);
        resetApp();
    }
}

function createFrameCard(frame, idx) {
    const card = document.createElement('div');
    card.className = 'frame-card';
    card.style.zIndex = idx;
    card.style.setProperty('--i', idx);
    // Only the first screenful develops out of blur; later cards just rise in
    if (idx >= 24) card.classList.add('late');
    card.title = 'Click to copy';
    
    // Frame number badge - now outside the image
    const badge = document.createElement('div');
    badge.className = 'frame-badge';
    badge.textContent = String(idx + 1).padStart(3, '0');
    
    const imgWrap = document.createElement('div');
    imgWrap.className = 'frame-image';
    
    const canvas = frame.canvas;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    
    // Copy overlay - shows on click feedback
    const copyOverlay = document.createElement('div');
    copyOverlay.className = 'copy-overlay';
    copyOverlay.setAttribute('aria-hidden', 'true');
    copyOverlay.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Copied!</span>
    `;
    
    // Redesigned minimal download button - icon only, top right
    const dlBtn = document.createElement('button');
    dlBtn.className = 'frame-download';
    dlBtn.type = 'button';
    dlBtn.setAttribute('aria-label', `Download frame ${idx + 1}`);
    dlBtn.title = `Download frame ${idx + 1}`;
    dlBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
    `;
    dlBtn.onclick = (e) => {
        e.stopPropagation();
        downloadFrame(idx);
    };
    
    // Click to copy
    card.addEventListener('click', async (e) => {
        // Don't copy if clicking download button
        if (e.target.closest('.frame-download')) return;
        await copyFrame(idx, copyOverlay);
    });
    
    card.appendChild(badge);
    imgWrap.appendChild(canvas);
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'frame-copy';
    copyBtn.setAttribute('aria-label', `Copy frame ${idx + 1} to clipboard`);
    imgWrap.appendChild(copyBtn);
    imgWrap.appendChild(copyOverlay);
    imgWrap.appendChild(dlBtn);
    card.appendChild(imgWrap);
    
    return card;
}

async function copyFrame(idx, overlay) {
    try {
        const canvas = currentFrames[idx].canvas;
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
        ]);
        
        // Show copied feedback
        overlay.classList.add('show');
        appStatus.textContent = `Frame ${idx + 1} copied to clipboard.`;
        setTimeout(() => {
            overlay.classList.remove('show');
        }, 1500);
    } catch (err) {
        console.error('Failed to copy:', err);
        // Fallback: create a temporary textarea to copy data URL
        try {
            const dataUrl = currentFrames[idx].canvas.toDataURL('image/png');
            const textarea = document.createElement('textarea');
            const previouslyFocused = document.activeElement;
            textarea.value = dataUrl;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            const copied = document.execCommand('copy');
            document.body.removeChild(textarea);
            previouslyFocused?.focus({ preventScroll: true });
            if (!copied) throw new Error('Clipboard copy was not supported');
            
            overlay.classList.add('show');
            appStatus.textContent = `Frame ${idx + 1} copied as a data URL.`;
            setTimeout(() => {
                overlay.classList.remove('show');
            }, 1500);
        } catch (fallbackErr) {
            console.error('Fallback copy failed:', fallbackErr);
            appStatus.textContent = `Could not copy frame ${idx + 1}. Use its download button instead.`;
        }
    }
}

function downloadFrame(idx) {
    const link = document.createElement('a');
    const num = String(idx + 1).padStart(3, '0');
    link.download = `${currentFileName}_${num}.png`;
    link.href = currentFrames[idx].canvas.toDataURL('image/png');
    link.click();
}

document.getElementById('downloadAll').addEventListener('click', async () => {
    if (!currentFrames.length) return;
    
    try {
        const zip = new JSZip();
        currentFrames.forEach((frame, i) => {
            const num = String(i + 1).padStart(3, '0');
            const data = frame.canvas.toDataURL('image/png').split(',')[1];
            zip.file(`${currentFileName}_${num}.png`, data, {base64: true});
        });
        const blob = await zip.generateAsync({type: 'blob'});
        saveAs(blob, `${currentFileName}_frames.zip`);
    } catch(e) {
        currentFrames.forEach((_, i) => setTimeout(() => downloadFrame(i), i * 100));
    }
});



window.resetApp = function() {
    loadId++;
    endProgress();
    // Clear canvas references to free memory
    currentFrames.forEach(f => {
        f.canvas.width = 0;
        f.canvas.height = 0;
    });
    currentFrames = [];
    currentFileName = '';
    if (currentGifUrl) {
        URL.revokeObjectURL(currentGifUrl);
        currentGifUrl = null;
    }
    document.getElementById('gifImage').src = '';
    filmScroll.innerHTML = '';
    filmContainer.classList.remove('visible');
    cancelFlight();
    showUpload();
    fileInput.value = '';
    document.getElementById('downloadAll').disabled = false;
    // Remove url param from address bar
    if (window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    appStatus.textContent = 'Ready to upload a GIF.';
    uploadZone.focus({ preventScroll: true });
};

// Load GIF from URL query parameter
async function loadFromUrlParam() {
    const params = new URLSearchParams(window.location.search);
    const url = params.get('url');
    if (!url) return;

    try {
        startProgress();
        hideUpload();

        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch GIF');
        
        const blob = await response.blob();
        if (!blob.type.includes('image/gif')) {
            throw new Error('URL does not point to a valid GIF');
        }
        
        const fileName = url.split('/').pop() || 'image.gif';
        const file = new File([blob], fileName, { type: 'image/gif' });
        await handleFile(file);
    } catch (err) {
        console.error('Failed to load from URL:', err);
        showUpload();
        endProgress();
        showToast('Could not load GIF from URL: ' + err.message);
    }
}

// Check for URL param on page load
loadFromUrlParam();
