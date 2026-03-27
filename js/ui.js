import { mazeSize, cellSize } from './constants.js';

let minimapCanvas = null;
let minimapCtx = null;
let offscreenMainmap = null;
let offscreenCtx = null;

export function setupMinimap() { 
    minimapCanvas = document.createElement('canvas'); 
    minimapCanvas.id = 'minimap-canvas'; 
    minimapCanvas.width = 100; 
    minimapCanvas.height = 100; 
    minimapCanvas.className = 'minimap-container'; 
    document.body.appendChild(minimapCanvas); 
    minimapCtx = minimapCanvas.getContext('2d', { alpha: false }); 
    
    offscreenMainmap = document.createElement('canvas');
    offscreenMainmap.width = 100;
    offscreenMainmap.height = 100;
    offscreenCtx = offscreenMainmap.getContext('2d', { alpha: false });
}

function preRenderMap(mazeMap) {
    if (!offscreenCtx || !mazeMap) return;
    const s = 100 / (mazeSize * cellSize); 
    offscreenCtx.fillStyle = '#111'; 
    offscreenCtx.fillRect(0, 0, 100, 100); 
    offscreenCtx.fillStyle = '#444'; // Wall color
    
    for (let i = 0; i < mazeSize; i++) {
        for (let j = 0; j < mazeSize; j++) {
            if (mazeMap[i][j] === 1) {
                offscreenCtx.fillRect(j * cellSize * s, i * cellSize * s, cellSize * s, cellSize * s);
            }
        }
    }
    offscreenMainmap.ready = true;
}

export function drawMinimap(state) {
    const { 
        isMultiplayerMode, isCoopMode, mazeMap, healthKits, armorVests, 
        remotePlayers, enemies, playerGroup 
    } = state;

    if (isMultiplayerMode && !isCoopMode) return; 
    if (!minimapCtx) return;
    
    if (!offscreenMainmap.ready) preRenderMap(mazeMap);
    
    // 1. Copy static map
    minimapCtx.drawImage(offscreenMainmap, 0, 0);
    
    const s = 100 / (mazeSize * cellSize); 
    
    // 2. Dynamic entities
    minimapCtx.fillStyle = '#00FF41'; 
    healthKits.forEach(k => { if (!k.userData.taken) minimapCtx.fillRect(k.position.x * s, k.position.z * s, 2, 2); });
    
    minimapCtx.fillStyle = '#0088FF'; 
    armorVests.forEach(k => { if (k.userData.active) minimapCtx.fillRect(k.position.x * s, k.position.z * s, 2, 2); });
    
    if (isMultiplayerMode) { 
        minimapCtx.fillStyle = isCoopMode ? '#00FF41' : '#f33'; 
        for (const key in remotePlayers) {
            const r = remotePlayers[key];
            if (r.mesh) minimapCtx.fillRect(r.mesh.position.x * s, r.mesh.position.z * s, 3, 3);
        } 
    }
    
    if (!isMultiplayerMode || isCoopMode) { 
        minimapCtx.fillStyle = '#f33'; 
        enemies.forEach(e => { if (!e.userData.dead && e.visible) minimapCtx.fillRect(e.position.x * s, e.position.z * s, 2, 2); }); 
    }
    
    minimapCtx.fillStyle = '#fff'; 
    minimapCtx.beginPath(); 
    minimapCtx.arc(playerGroup.position.x * s, playerGroup.position.z * s, 3.5, 0, Math.PI * 2); 
    minimapCtx.fill();
}

export function updateTimerUI(pvpTimer) { 
    const mins = Math.floor(pvpTimer / 60); 
    const secs = pvpTimer % 60; 
    const display = document.getElementById('tactical-timer'); 
    if (display) display.innerText = mins.toString().padStart(2, '0') + ":" + secs.toString().padStart(2, '0'); 
}

export function updateWeaponUI(currentWeapon) {
    const wpnDisplay = document.getElementById('weapon-display'); 
    if (wpnDisplay) { wpnDisplay.innerText = currentWeapon === 1 ? "SNIPER" : "RIFLE"; } 
}

export function updateGrenadeUI(grenades) {
    const gEl = document.getElementById('grenade-count'); 
    if (gEl) gEl.innerText = grenades.explosive; 
    const sEl = document.getElementById('smoke-count'); 
    if (sEl) sEl.innerText = grenades.smoke; 
}

export function triggerHitMarker() { 
    const c = document.getElementById('crosshair'); 
    if (!c) return;
    c.classList.add('hit-marker'); 
    setTimeout(() => c.classList.remove('hit-marker'), 150); 
}

export function applyGraphicsSettings(quality, { settings, renderer, scene, muzzleFlashLight }) {
    settings.graphics = quality;
    if (quality === 'low') { 
        renderer.shadowMap.enabled = false; 
        renderer.setPixelRatio(1); 
        scene.traverse(child => { if (child.isMesh && child.material && child.material.map) { child.material.map.generateMipmaps = false; } }); 
        if (muzzleFlashLight) muzzleFlashLight.visible = false; 
    } else { 
        renderer.shadowMap.enabled = true; 
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); 
        scene.traverse(child => { if (child.isMesh && child.material && child.material.map) { child.material.map.generateMipmaps = true; } }); 
        if (muzzleFlashLight) muzzleFlashLight.visible = true; 
    }
}

export function showGameOver(isMultiplayerMode, isCoopMode, showLobby, resetGame) {
    document.getElementById('game-over-screen').style.display = 'flex';
    document.getElementById('hud').style.display = 'none';
    document.getElementById('mobile-ui').style.display = 'none';
}
