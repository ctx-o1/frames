import { parseGIF, decompressFrames } from 'https://esm.sh/gifuct-js@2.0.0';

function createPatchCanvas(frame) {
    const canvas = document.createElement('canvas');
    canvas.width = frame.dims.width;
    canvas.height = frame.dims.height;
    const ctx = canvas.getContext('2d');
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
const infoFooter = document.getElementById('infoFooter');
const loading = document.getElementById('loading');
const loadingFilename = document.getElementById('loadingFilename');

let currentFrames = [];
let currentFileName = '';
let currentGifUrl = null;
let isGridView = false;

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
    infoFooter.classList.remove('visible');
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
        const ctx = mainCanvas.getContext('2d');

        // Process all frames while keeping loading screen visible
        const progressText = document.querySelector('#loading .loading-text');
        
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            
            const patchCanvas = createPatchCanvas(frame);
            
            if (i > 0) {
                const prev = frames[i - 1];
                if (prev.disposalType === 2) {
                    ctx.clearRect(0, 0, width, height);
                } else if (prev.disposalType === 3 && i > 1) {
                    ctx.clearRect(0, 0, width, height);
                    for (let j = 0; j < i - 1; j++) {
                        const f = frames[j];
                        const skip = j > 0 && frames[j - 1].disposalType === 3;
                        if (!skip) {
                            ctx.drawImage(createPatchCanvas(f), f.dims.left, f.dims.top);
                        }
                    }
                }
            }
            
            ctx.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
            
            const frameCanvas = document.createElement('canvas');
            frameCanvas.width = width;
            frameCanvas.height = height;
            frameCanvas.getContext('2d').drawImage(mainCanvas, 0, 0);
            
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
        infoFooter.classList.add('visible');
        
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
        
        const imgWrap = document.createElement('div');
        imgWrap.className = 'frame-image';
        
        const badge = document.createElement('div');
        badge.className = 'frame-badge';
        badge.textContent = String(idx + 1).padStart(3, '0');
        
        const canvas = frame.canvas;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        
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
        
        imgWrap.appendChild(badge);
        imgWrap.appendChild(canvas);
        imgWrap.appendChild(dlBtn);
        card.appendChild(imgWrap);
        
        filmScroll.appendChild(card);
    });
}

function downloadFrame(idx) {
    const link = document.createElement('a');
    const num = String(idx + 1).padStart(3, '0');
    link.download = `${currentFileName}_${num}.png`;
    link.href = currentFrames[idx].canvas.toDataURL('image/png');
    link.click();
}

document.getElementById('viewToggle').addEventListener('click', toggleViewMode);

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



function toggleViewMode() {
    isGridView = !isGridView;
    const filmScroll = document.getElementById('filmScroll');
    const gridIcon = document.getElementById('gridIcon');
    const scrollIcon = document.getElementById('scrollIcon');
    
    if (isGridView) {
        filmScroll.classList.add('grid-mode');
        gridIcon.style.display = 'none';
        scrollIcon.style.display = 'block';
    } else {
        filmScroll.classList.remove('grid-mode');
        gridIcon.style.display = 'block';
        scrollIcon.style.display = 'none';
    }
}

window.resetApp = function() {
    // Clear canvas references to free memory
    currentFrames.forEach(f => {
        f.canvas.width = 0;
        f.canvas.height = 0;
    });
    currentFrames = [];
    currentFileName = '';
    isGridView = false;
    const filmScroll = document.getElementById('filmScroll');
    const gridIcon = document.getElementById('gridIcon');
    const scrollIcon = document.getElementById('scrollIcon');
    filmScroll.classList.remove('grid-mode');
    gridIcon.style.display = 'block';
    scrollIcon.style.display = 'none';
    if (currentGifUrl) {
        URL.revokeObjectURL(currentGifUrl);
        currentGifUrl = null;
    }
    document.getElementById('gifImage').src = '';
    filmScroll.innerHTML = '';
    filmContainer.classList.remove('visible');
    infoFooter.classList.remove('visible');
    uploadContainer.style.display = 'block';
    fileInput.value = '';
    if (loadingFilename) loadingFilename.textContent = '';
    loading.classList.remove('active');
};



