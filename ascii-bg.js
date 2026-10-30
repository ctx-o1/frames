// ASCII shader background: renders the painted landscape as drifting, glowing glyphs.
// Falls back to the plain CSS background if WebGL2 is unavailable.
// Press ` (or open with ?tune) to show a tuning panel; tweaks are kept in localStorage.

const IMAGE_URL = 'assets/ui/oil-landscape-background.png';
const RAMP = ' .:-~=+*o%#@';
const ATLAS_CELL = { w: 36, h: 60 };
const MAX_DPR = 1.75;
const STORAGE_KEY = 'frames.asciiBg';
const GUI_URL = 'https://cdn.jsdelivr.net/npm/lil-gui@0.19.2/+esm';

// Tunable parameters: [default, min, max, step]. Keys not in JS_ONLY reach the shaders as u_<key>.
const PARAMS = {
    Overall: {
        intensity: [0.42, 0, 1, 0.01],        // 0 = plain painting, 1 = full ASCII effect
        speed: [1, 0, 3, 0.01],
        brightness: [0.65, 0.6, 1.2, 0.01],
        vignette: [0.35, 0, 1, 0.01],
    },
    Glyphs: {
        cellWidth: [9, 5, 24, 1],          // CSS px
        cellHeight: [15, 8, 36, 1],
        flicker: [0.015, 0, 0.1, 0.001],   // share of cells flickering at any moment
    },
    Ink: {
        ink: [1, 0, 2, 0.01],
        inkOpacity: [1, 0, 1.5, 0.01],
        detail: [4, 0, 10, 0.1],           // brush-stroke contrast
        mist: [0.5, 0, 1.5, 0.01],
        mistSpeed: [1, 0, 4, 0.01],
    },
    Glow: {
        highlights: [1, 0, 2, 0.01],
        sparkle: [0.8, 0, 1.5, 0.01],
        glyphGlow: [0.6, 0, 2, 0.01],
        bloom: [1.25, 0, 3, 0.01],
        bloomRadius: [1, 0.25, 4, 0.05],
    },
    Painting: {
        baseBlur: [2, 0, 6, 0.1],
        baseWash: [0.3, 0, 1, 0.01],
    },
    Motion: {
        water: [1, 0, 3, 0.01],
        parallax: [0.012, 0, 0.05, 0.001],
    },
    Cursor: {
        lantern: [0.75, 0, 2, 0.01],
        lanternSize: [0.135, 0.03, 0.4, 0.005],
        ripple: [0.9, 0, 2, 0.01],
    },
};
const JS_ONLY = new Set(['speed', 'cellWidth', 'cellHeight', 'bloomRadius']);
const DEFAULTS = Object.fromEntries(
    Object.values(PARAMS).flatMap(group => Object.entries(group).map(([k, [v]]) => [k, v]))
);
const UNIFORM_KEYS = Object.keys(DEFAULTS).filter(k => !JS_ONLY.has(k));

function loadSettings() {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    } catch {
        return { ...DEFAULTS };
    }
}

function saveSettings(settings) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
}

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uImgSize;
uniform vec2 uMouse;      // device px, origin top-left
uniform vec2 uParallax;   // -1..1
uniform float uHover;     // 0..1, fades the lantern when the pointer leaves
uniform float u_parallax;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v;
}
// Screen px (top-left origin) -> image uv with object-fit: cover and a little parallax.
vec2 coverUv(vec2 px) {
    float s = max(uRes.x / uImgSize.x, uRes.y / uImgSize.y) * 1.04;
    vec2 uv = (px - uRes * 0.5) / (uImgSize * s) + 0.5;
    return uv + uParallax * u_parallax;
}
`;

// Pass 1: glyphs. out0 = ink (premultiplied), out1 = light emission.
const ASCII_FRAG = COMMON + `
uniform sampler2D uImage;
uniform sampler2D uAtlas;
uniform float uGlyphs;
uniform vec2 uCell;
uniform vec3 uRipple;     // xy device px, z = seconds since click
uniform float u_flicker, u_ink, u_inkOpacity, u_detail, u_mist, u_mistSpeed;
uniform float u_highlights, u_sparkle, u_water, u_lantern, u_lanternSize, u_ripple;
layout(location = 0) out vec4 outInk;
layout(location = 1) out vec4 outGlow;

void main() {
    vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
    vec2 cell = floor(px / uCell);
    vec2 inCell = fract(px / uCell);
    vec2 center = (cell + 0.5) * uCell;

    vec2 uv = coverUv(center);
    float t = uTime;

    // Water below the horizon ripples sideways.
    float water = smoothstep(0.58, 0.66, uv.y);
    uv.x += water * u_water * (sin(uv.y * 140.0 - t * 1.3) * 0.0025
                   + (noise(vec2(uv.y * 40.0, t * 0.4)) - 0.5) * 0.004);

    vec3 col = texture(uImage, uv).rgb;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    // Local contrast against a blurred copy pulls brush strokes out of the pale haze.
    float soft = dot(textureLod(uImage, uv, 4.5).rgb, vec3(0.299, 0.587, 0.114));
    float detail = soft - lum;

    // Slow drifting mist.
    vec2 mp = uv * vec2(3.0, 5.0);
    float mt = t * u_mistSpeed;
    float mist = fbm(mp + vec2(mt * 0.035, mt * 0.008) + fbm(mp * 0.7 - mt * 0.02) * 1.5);

    // Ink: dark areas become dense glyphs; mist adds faint wandering characters.
    float ink = smoothstep(0.05, 0.55, 0.97 - lum);
    ink += max(detail, 0.0) * u_detail + (mist - 0.5) * u_mist;
    ink = clamp(ink * u_ink, 0.0, 1.0);

    // Light: painted highlights, the cursor lantern and click ripples.
    float warm = clamp((col.r - col.b) * 6.0 + 0.4, 0.0, 1.0);
    float light = smoothstep(0.86, 0.96, lum) * (0.25 + 0.5 * warm) + max(-detail - 0.01, 0.0) * 4.0;
    light *= u_highlights;
    light *= 1.0 + u_sparkle * (noise(cell * 0.35 + vec2(t * 0.6, 0.0) * water + t * 0.15) - 0.5);

    float d = length(center - uMouse) / max(uRes.y, 1.0);
    float lantern = exp(-d * d / (u_lanternSize * u_lanternSize)) * uHover * u_lantern;
    light += lantern;

    float rd = length(center - uRipple.xy) / max(uRes.y, 1.0);
    float ring = exp(-pow((rd - uRipple.z * 0.45) * 18.0, 2.0)) * exp(-uRipple.z * 1.6);
    light += ring * u_ripple;
    light = clamp(light, 0.0, 1.0);

    // A few cells flicker to a neighbouring glyph now and then.
    float flick = step(1.0 - u_flicker, hash(cell + floor(t * 3.0))) * (hash(cell * 1.7 + floor(t * 3.0)) - 0.5) * 3.0;

    bool lit = light > ink * 0.9;
    float level = lit ? light : ink;
    float idx = clamp(floor(level * (uGlyphs - 1.0) + 0.5 + flick), 0.0, uGlyphs - 1.0);
    float cov = texture(uAtlas, vec2((idx + inCell.x) / uGlyphs, inCell.y)).r;

    if (lit) {
        vec3 tint = mix(vec3(0.55, 0.78, 1.0), vec3(1.0, 0.8, 0.5), clamp(warm + lantern * 0.6, 0.0, 1.0));
        outInk = vec4(0.0);
        outGlow = vec4(tint * cov * (0.55 + light), 1.0);
    } else {
        vec3 inkCol = mix(col * 0.5, vec3(0.16, 0.3, 0.5), 0.5);
        float a = min(cov * (0.35 + 0.6 * ink) * u_inkOpacity, 1.0);
        outInk = vec4(inkCol * a, a);
        outGlow = vec4(0.0, 0.0, 0.0, 1.0);
    }
}`;

// Separable gaussian blur for the bloom.
const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 outColor;
void main() {
    vec3 c = texture(uTex, vUv).rgb * 0.227;
    c += texture(uTex, vUv + uDir * 1.385).rgb * 0.316;
    c += texture(uTex, vUv - uDir * 1.385).rgb * 0.316;
    c += texture(uTex, vUv + uDir * 3.231).rgb * 0.070;
    c += texture(uTex, vUv - uDir * 3.231).rgb * 0.070;
    outColor = vec4(c, 1.0);
}`;

const COMPOSITE_FRAG = COMMON + `
uniform sampler2D uImage;
uniform sampler2D uInk;
uniform sampler2D uGlow;
uniform sampler2D uBloom;
uniform float u_intensity, u_brightness, u_vignette, u_glyphGlow, u_bloom, u_baseBlur, u_baseWash;
out vec4 outColor;
void main() {
    vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
    vec2 uv = coverUv(px);
    vec3 base = textureLod(uImage, uv, u_baseBlur).rgb;
    base = mix(base, vec3(0.78, 0.85, 0.93), u_baseWash) * u_brightness;

    vec4 ink = texture(uInk, vUv);
    vec3 col = base * (1.0 - ink.a) + ink.rgb;
    col += texture(uGlow, vUv).rgb * u_glyphGlow;
    col += texture(uBloom, vUv).rgb * u_bloom;

    // Gentle vignette and soft shoulder so glow never clips harshly.
    vec2 q = vUv - 0.5;
    col *= 1.0 - dot(q, q) * u_vignette;
    col = 1.0 - exp(-col * 1.9);
    col /= 1.0 - exp(-1.9);
    outColor = vec4(mix(textureLod(uImage, uv, 0.0).rgb, col, u_intensity), 1.0);
}`;

function compile(gl, type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
}

function program(gl, frag) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
        const name = gl.getActiveUniform(p, i).name;
        uniforms[name] = gl.getUniformLocation(p, name);
    }
    return { p, u: uniforms };
}

function texture(gl, source, { mipmap = false, linear = true } = {}) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const filter = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmap ? gl.LINEAR_MIPMAP_LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mipmap) gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
}

function renderTarget(gl, w, h, count = 1) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const textures = [];
    for (let i = 0; i < count; i++) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
        textures.push(tex);
    }
    gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    return { fb, textures, w, h };
}

function glyphAtlas() {
    const c = document.createElement('canvas');
    c.width = ATLAS_CELL.w * RAMP.length;
    c.height = ATLAS_CELL.h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#fff';
    ctx.font = `500 ${ATLAS_CELL.h * 0.78}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    [...RAMP].forEach((ch, i) => ctx.fillText(ch, (i + 0.5) * ATLAS_CELL.w, ATLAS_CELL.h * 0.54));
    return c;
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

async function init() {
    const canvas = document.getElementById('asciiBg');
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) return;

    const image = await loadImage(IMAGE_URL);
    const imgTex = texture(gl, image, { mipmap: true });
    const atlasTex = texture(gl, glyphAtlas());

    const ascii = program(gl, ASCII_FRAG);
    const blur = program(gl, BLUR_FRAG);
    const composite = program(gl, COMPOSITE_FRAG);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const settings = loadSettings();
    let dpr = 1, glyphTarget, bloomA, bloomB;
    const mouse = { x: 0, y: 0, tx: 0, ty: 0, s: 0, ts: 0 };
    const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
    const ripple = { x: -1e4, y: -1e4, at: -1e4 };

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const w = Math.max(1, Math.round(innerWidth * dpr));
        const h = Math.max(1, Math.round(innerHeight * dpr));
        if (canvas.width === w && canvas.height === h && glyphTarget) return;
        canvas.width = w;
        canvas.height = h;
        [glyphTarget, bloomA, bloomB].forEach(t => t && (gl.deleteFramebuffer(t.fb), t.textures.forEach(x => gl.deleteTexture(x))));
        glyphTarget = renderTarget(gl, w, h, 2);
        const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
        bloomA = renderTarget(gl, bw, bh);
        bloomB = renderTarget(gl, bw, bh);
    }

    function setCommon(prog, t) {
        const u = prog.u;
        gl.uniform2f(u.uRes, canvas.width, canvas.height);
        gl.uniform1f(u.uTime, t);
        gl.uniform2f(u.uImgSize, image.naturalWidth, image.naturalHeight);
        gl.uniform2f(u.uMouse, mouse.x * dpr, mouse.y * dpr);
        gl.uniform2f(u.uParallax, parallax.x, parallax.y);
        gl.uniform1f(u.uHover, mouse.s);
        for (const key of UNIFORM_KEYS) {
            if (u['u_' + key]) gl.uniform1f(u['u_' + key], settings[key]);
        }
    }

    function bind(unit, tex, loc) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(loc, unit);
    }

    function draw(t) {
        // Glyph pass
        gl.bindFramebuffer(gl.FRAMEBUFFER, glyphTarget.fb);
        gl.viewport(0, 0, glyphTarget.w, glyphTarget.h);
        gl.useProgram(ascii.p);
        setCommon(ascii, t);
        gl.uniform1f(ascii.u.uGlyphs, RAMP.length);
        gl.uniform2f(ascii.u.uCell, settings.cellWidth * dpr, settings.cellHeight * dpr);
        gl.uniform3f(ascii.u.uRipple, ripple.x * dpr, ripple.y * dpr, t - ripple.at);
        bind(0, imgTex, ascii.u.uImage);
        bind(1, atlasTex, ascii.u.uAtlas);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Bloom: downsample emission, then blur horizontally and vertically twice.
        gl.useProgram(blur.p);
        let src = glyphTarget.textures[1];
        for (let i = 0; i < 2; i++) {
            for (const [dst, dir] of [[bloomA, [1, 0]], [bloomB, [0, 1]]]) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
                gl.viewport(0, 0, dst.w, dst.h);
                const spread = (i + 1) * settings.bloomRadius;
                gl.uniform2f(blur.u.uDir, dir[0] * spread / dst.w, dir[1] * spread / dst.h);
                bind(0, src, blur.u.uTex);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                src = dst.textures[0];
            }
        }

        // Composite to screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(composite.p);
        setCommon(composite, t);
        bind(0, imgTex, composite.u.uImage);
        bind(1, glyphTarget.textures[0], composite.u.uInk);
        bind(2, glyphTarget.textures[1], composite.u.uGlow);
        bind(3, bloomB.textures[0], composite.u.uBloom);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // The shader clock runs at settings.speed, so ripples are timed on it too.
    let raf = 0, clock = 0, last = performance.now();
    function frame(now) {
        raf = 0;
        clock += Math.min((now - last) / 1000, 0.1) * settings.speed;
        last = now;
        const t = clock;
        const k = 0.08;
        mouse.x += (mouse.tx - mouse.x) * k;
        mouse.y += (mouse.ty - mouse.y) * k;
        mouse.s += (mouse.ts - mouse.s) * 0.05;
        parallax.x += (parallax.tx - parallax.x) * 0.04;
        parallax.y += (parallax.ty - parallax.y) * 0.04;
        draw(t);
        if (!reducedMotion.matches && !document.hidden) raf = requestAnimationFrame(frame);
    }
    function kick() {
        if (!raf) {
            last = performance.now();
            raf = requestAnimationFrame(frame);
        }
    }

    addEventListener('pointermove', (e) => {
        if (!mouse.ts) { mouse.x = e.clientX; mouse.y = e.clientY; }
        mouse.ts = e.pointerType === 'touch' ? 0 : 1;
        mouse.tx = e.clientX;
        mouse.ty = e.clientY;
        parallax.tx = (e.clientX / innerWidth) * 2 - 1;
        parallax.ty = (e.clientY / innerHeight) * 2 - 1;
        if (reducedMotion.matches) { mouse.x = mouse.tx; mouse.y = mouse.ty; mouse.s = mouse.ts; kick(); }
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { mouse.ts = 0; });
    addEventListener('pointerdown', (e) => {
        ripple.x = e.clientX;
        ripple.y = e.clientY;
        ripple.at = clock;
    }, { passive: true });
    addEventListener('resize', () => { resize(); kick(); });
    document.addEventListener('visibilitychange', kick);
    reducedMotion.addEventListener('change', kick);
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => location.reload());

    let gui = null;
    async function toggleTuner() {
        if (gui) {
            gui._hidden ? gui.show() : gui.hide();
            return;
        }
        const { GUI } = await import(GUI_URL);
        gui = new GUI({ title: 'ASCII background' });
        gui.domElement.classList.add('ascii-tuner');
        for (const [name, group] of Object.entries(PARAMS)) {
            const folder = gui.addFolder(name);
            for (const [key, [, min, max, step]] of Object.entries(group)) {
                folder.add(settings, key, min, max, step);
            }
            if (name !== 'Overall') folder.close();
        }
        gui.add({
            copy: () => navigator.clipboard?.writeText(JSON.stringify(settings, null, 2)),
        }, 'copy').name('Copy settings as JSON');
        gui.add({
            reset: () => {
                Object.assign(settings, DEFAULTS);
                gui.controllersRecursive().forEach(c => c.updateDisplay());
                saveSettings(settings);
                kick();
            },
        }, 'reset').name('Reset to defaults');
        gui.onChange(() => {
            saveSettings(settings);
            kick();
        });
    }

    addEventListener('keydown', (e) => {
        if (e.key !== '`' || e.target.closest?.('input, textarea, [contenteditable]')) return;
        toggleTuner().catch(err => console.warn('Could not load tuning panel:', err));
    });
    if (new URLSearchParams(location.search).has('tune')) {
        toggleTuner().catch(err => console.warn('Could not load tuning panel:', err));
    }

    resize();
    kick();
    requestAnimationFrame(() => canvas.classList.add('ready'));
}

init().catch((err) => console.warn('ASCII background disabled:', err));
