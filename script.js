import { parseGIF, decompressFrames } from 'https://esm.sh/gifuct-js@2.0.0';

// Example GIF configuration - just change this path if you rename the file
const EXAMPLE_GIF_PATH = './bomb.gif';

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
const loading = document.getElementById('loading');
const loadingFilename = document.getElementById('loadingFilename');

let currentFrames = [];
let currentFileName = '';
let currentGifUrl = null;

uploadZone.addEventListener('click', () => fileInput.click());

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
    if (file && file.type === 'image/gif') handleFile(file);
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
});

// Load example GIF
document.getElementById('loadExampleBtn')?.addEventListener('click', async () => {
    const loadBtn = document.getElementById('loadExampleBtn');
    const originalText = loadBtn?.textContent;
    
    try {
        // Show loading state on button
        if (loadBtn) loadBtn.textContent = 'Loading...';
        if (loadBtn) loadBtn.disabled = true;
        
        // Show loading screen immediately
        loading.classList.add('active');
        const exampleName = EXAMPLE_GIF_PATH.split('/').pop();
        if (loadingFilename) loadingFilename.textContent = exampleName;
        uploadContainer.style.display = 'none';
        
        const response = await fetch(EXAMPLE_GIF_PATH);
        if (!response.ok) throw new Error('Failed to load example');
        const blob = await response.blob();
        const file = new File([blob], exampleName, { type: 'image/gif' });
        await handleFile(file);
    } catch (err) {
        console.error('Failed to load example:', err);
        loading.classList.remove('active');
        uploadContainer.style.display = 'flex';
        alert('Could not load example GIF. Please try uploading your own.');
    } finally {
        // Restore button state
        if (loadBtn) loadBtn.textContent = originalText;
        if (loadBtn) loadBtn.disabled = false;
    }
});

async function handleFile(file) {
    currentFileName = file.name.replace(/\.[^/.]+$/, "");
    currentFrames = [];
    
    // Store original GIF URL but don't display yet
    if (currentGifUrl) {
        URL.revokeObjectURL(currentGifUrl);
    }
    currentGifUrl = URL.createObjectURL(file);
    
    // Clear and hide everything first
    filmScroll.innerHTML = '';
    filmContainer.classList.remove('visible');
    uploadContainer.style.display = 'none';
    loading.classList.add('active');
    
    // Show filename in loading screen
    if (loadingFilename) {
        loadingFilename.textContent = file.name;
    }
    
    try {
        const buffer = await file.arrayBuffer();
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

        // Process all frames while keeping loading screen visible
        const progressText = document.querySelector('#loading .loading-text');
        
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

            // Update progress text
            if (progressText) {
                progressText.textContent = `Decoding frames... ${i + 1} / ${frames.length}`;
            }
            
            // Allow UI to breathe every few frames
            if (i % 3 === 0) await new Promise(r => requestAnimationFrame(r));
        }

        // All frames ready - build the DOM
        renderFilmStrip();
        
        // Set the GIF source
        document.getElementById('gifImage').src = currentGifUrl;

        // Hide loading, show everything at once
        loading.classList.remove('active');
        filmContainer.classList.add('visible');
        
    } catch (err) {
        console.error(err);
        loading.classList.remove('active');
        alert('Error reading GIF: ' + err.message);
        resetApp();
    }
}

function renderFilmStrip() {
    filmScroll.innerHTML = '';
    
    currentFrames.forEach((frame, idx) => {
        const card = document.createElement('div');
        card.className = 'frame-card';
        card.style.zIndex = idx;
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
        copyOverlay.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Copied!</span>
        `;
        
        // Redesigned minimal download button - icon only, top right
        const dlBtn = document.createElement('button');
        dlBtn.className = 'frame-download';
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
        imgWrap.appendChild(copyOverlay);
        imgWrap.appendChild(dlBtn);
        card.appendChild(imgWrap);
        
        filmScroll.appendChild(card);
    });
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
        setTimeout(() => {
            overlay.classList.remove('show');
        }, 1500);
    } catch (err) {
        console.error('Failed to copy:', err);
        // Fallback: create a temporary textarea to copy data URL
        try {
            const dataUrl = currentFrames[idx].canvas.toDataURL('image/png');
            const textarea = document.createElement('textarea');
            textarea.value = dataUrl;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            
            overlay.classList.add('show');
            setTimeout(() => {
                overlay.classList.remove('show');
            }, 1500);
        } catch (fallbackErr) {
            console.error('Fallback copy failed:', fallbackErr);
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
    uploadContainer.style.display = 'flex';
    fileInput.value = '';
    if (loadingFilename) loadingFilename.textContent = '';
    loading.classList.remove('active');
    // Remove url param from address bar
    if (window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }
};

// Load GIF from URL query parameter
async function loadFromUrlParam() {
    const params = new URLSearchParams(window.location.search);
    const url = params.get('url');
    if (!url) return;

    try {
        loading.classList.add('active');
        if (loadingFilename) loadingFilename.textContent = url;
        uploadContainer.style.display = 'none';

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
        loading.classList.remove('active');
        uploadContainer.style.display = 'flex';
        alert('Could not load GIF from URL: ' + err.message);
    }
}

// Check for URL param on page load
loadFromUrlParam();
