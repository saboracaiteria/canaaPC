import * as THREE from 'three';

export function clearSceneObject(scene, obj) {
    if (!obj) return;
    scene.remove(obj);
    obj.traverse(child => {
        if (child.isMesh || child.isLine || child.isPoints) {
            if (child.geometry && child.geometry.dispose) {
                child.geometry.dispose();
            }
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => {
                        if (m.map && m.map.dispose) m.map.dispose();
                        if (m.dispose) m.dispose();
                    });
                } else {
                    if (child.material.map && child.material.map.dispose) child.material.map.dispose();
                    if (child.material.dispose) child.material.dispose();
                }
            }
        }
        if (child.isLight && child.dispose) {
            child.dispose();
        }
    });
}

export function goFullscreen() {
    const doc = document.documentElement;
    if (doc.requestFullscreen) {
        doc.requestFullscreen().catch(()=>{});
    } else if (doc.webkitRequestFullscreen) {
        doc.webkitRequestFullscreen();
    } else if (doc.mozRequestFullScreen) {
        doc.mozRequestFullScreen();
    } else if (doc.msRequestFullscreen) {
        doc.msRequestFullscreen();
    } else {
        const isIPhone = /iPhone|iPod/.test(navigator.userAgent);
        if (isIPhone && !window.navigator.standalone) {
            alert("⚠️ A Apple bloqueia o Ecrã Inteiro no navegador.\n\nPara jogar sem bordas, partilhe esta página e clique em 'Adicionar ao Ecrã Principal' (Add to Home Screen). Depois abra o jogo pela nova aplicação!");
            window.scrollTo(0, 1);
        }
    }
}

export function logSystem(msg, type = "normal") { 
    const el = document.getElementById("connection-log"); 
    if (!el) return; 
    const line = document.createElement("div"); 
    line.innerText = `> ${msg}`; 
    if (type === "error") line.className = "log-error"; 
    if (type === "success") line.className = "log-success"; 
    el.appendChild(line); 
    el.scrollTop = el.scrollHeight; 
}

export function mulberry32(a) { 
    return function () { 
        var t = a += 0x6D2B79F5; 
        t = Math.imul(t ^ t >>> 15, t | 1); 
        t ^= t + Math.imul(t ^ t >>> 7, t | 61); 
        return ((t ^ t >>> 14) >>> 0) / 4294967296; 
    } 
}

export function addEyes(headMesh) {
    const eyeGeo = new THREE.BoxGeometry(0.05, 0.05, 0.02);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupilGeo = new THREE.BoxGeometry(0.02, 0.02, 0.01);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.06, 0.05, -0.125);
    headMesh.add(leftEye);

    const leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
    leftPupil.position.set(0, 0, -0.01);
    leftEye.add(leftPupil);

    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.06, 0.05, -0.125);
    headMesh.add(rightEye);

    const rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
    rightPupil.position.set(0, 0, -0.01);
    rightEye.add(rightPupil);
}

let audioCtx = null;
export function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

export function resumeAudio() {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

const soundCache = { shoot: new Audio('sons/tiro.mp3') };
// Silenciar erros de carregamento inicial
Object.values(soundCache).forEach(a => a.addEventListener('error', () => {}));

export function playSound(type, settings) {
    try {
        const ctx = initAudio();
        const osc = ctx.createOscillator(), gain = ctx.createGain(), now = ctx.currentTime, vol = settings.volume;
        osc.connect(gain);
        gain.connect(ctx.destination);

        if (type === 'shoot') {
            const audio = soundCache.shoot.cloneNode();
            audio.volume = settings.volume;
            audio.play().catch(() => { });
        } else if (type === 'jump') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(200, now); osc.frequency.linearRampToValueAtTime(400, now + 0.2);
            gain.gain.setValueAtTime(0.3 * vol, now); gain.gain.linearRampToValueAtTime(0.01, now + 0.2);
            osc.start(now); osc.stop(now + 0.2);
        } else if (type === 'step') {
            osc.type = 'triangle'; osc.frequency.setValueAtTime(100, now);
            gain.gain.setValueAtTime(0.2 * vol, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.start(now); osc.stop(now + 0.05);
        } else if (type === 'heal') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(600, now); osc.frequency.linearRampToValueAtTime(1200, now + 0.1);
            gain.gain.setValueAtTime(0.3 * vol, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now); osc.stop(now + 0.3);
        }
    } catch (e) {
        // Ignorar erros de áudio se o contexto ou arquivo falhar
    }
}

export function createProTexture(type, colorHex) {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    ctx.fillStyle = colorHex;
    ctx.fillRect(0, 0, size, size);
    
    const imgData = ctx.getImageData(0, 0, size, size);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        const grain = (Math.random() - 0.5) * 30;
        data[i] = Math.max(0, Math.min(255, data[i] + grain));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + grain));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + grain));
    }
    ctx.putImageData(imgData, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    
    if (type === 'bricks') {
        ctx.strokeStyle = `rgba(0,0,0,0.4)`;
        ctx.lineWidth = 4;
        const brickH = 64;
        const brickW = 128;
        for (let y = 0; y <= size; y += brickH) {
            const offset = (y / brickH) % 2 === 0 ? 0 : brickW / 2;
            for (let x = -brickW; x <= size; x += brickW) {
                ctx.strokeRect(x + offset, y, brickW, brickH);
                ctx.fillStyle = `rgba(0,0,0,0.1)`;
                if (Math.random() > 0.5) ctx.fillRect(x + offset, y, brickW, brickH);
            }
        }
    } else if (type === 'tiles') {
        ctx.strokeStyle = `rgba(0,0,0,0.3)`;
        ctx.lineWidth = 3;
        const tileS = 128;
        for (let y = 0; y <= size; y += tileS) {
            for (let x = 0; x <= size; x += tileS) {
                ctx.strokeRect(x, y, tileS, tileS);
                if (((x + y) / tileS) % 2 === 0) {
                    ctx.fillStyle = `rgba(255,255,255,0.05)`;
                    ctx.fillRect(x + 2, y + 2, tileS - 4, tileS - 4);
                }
            }
        }
    } else if (type === 'metal') {
        ctx.strokeStyle = `rgba(255,255,255,0.1)`;
        ctx.lineWidth = 1;
        for (let i = 0; i < 50; i++) {
            ctx.beginPath();
            ctx.moveTo(Math.random() * size, Math.random() * size);
            ctx.lineTo(Math.random() * size, Math.random() * size);
            ctx.stroke();
        }
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        const boltS = size / 4;
        for (let y = boltS / 2; y < size; y += boltS) {
            for (let x = boltS / 2; x < size; x += boltS) {
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    } else if (type === 'camo') {
        const colors = ['#3e4c36', '#595138', '#2a3325', '#1a1a1a'];
        const pixelSize = 32;
        for (let y = 0; y < size; y += pixelSize) {
            for (let x = 0; x < size; x += pixelSize) {
                const col = colors[Math.floor(Math.random() * colors.length)];
                ctx.fillStyle = col;
                ctx.fillRect(x, y, pixelSize, pixelSize);
            }
        }
        const imgData = ctx.getImageData(0, 0, size, size);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            const noise = (Math.random() - 0.5) * 40;
            data[i] = Math.max(0, Math.min(255, data[i] + noise));
            data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
            data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
        }
        ctx.putImageData(imgData, 0, 0);
    }
    
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (type === 'bricks' || type === 'tiles') { tex.repeat.set(1, 1); }
    tex.magFilter = type === 'camo' ? THREE.NearestFilter : THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipMapLinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

export function initSky(scene) {
    const vertexShader = `
        varying vec3 vWorldPosition; 
        void main() { 
            vec4 worldPosition = modelMatrix * vec4( position, 1.0 ); 
            vWorldPosition = worldPosition.xyz; 
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); 
        }`;
    const fragmentShader = `
        uniform vec3 topColor; 
        uniform vec3 bottomColor; 
        uniform float offset; 
        uniform float exponent; 
        varying vec3 vWorldPosition; 
        void main() { 
            float h = normalize( vWorldPosition + offset ).y; 
            gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( max( h, 0.0 ), exponent ), 0.0 ) ), 1.0 ); 
        }`;
    const uniforms = {
        "topColor": { value: new THREE.Color(0x0077ff) },
        "bottomColor": { value: new THREE.Color(0xffffff) },
        "offset": { value: 33 },
        "exponent": { value: 0.6 }
    };
    const skyGeo = new THREE.SphereGeometry(1000, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        side: THREE.BackSide
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyMesh);
    return skyMesh;
}
