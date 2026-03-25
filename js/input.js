import * as THREE from 'three';
import { playSound } from './utils.js';

export const keyState = { w: false, a: false, s: false, d: false };
export const moveInput = { x: 0, y: 0 };
export let yaw = 0;
export let pitch = 0;
export let isManualFiring = false;
export let isAiming = false;
export let isChargingGrenade = false;
export let chargingGrenadeType = 'explosive';
export let grenadeChargeStartTime = 0;

let settingsRef = null;
let gamePausedRef = null;
let isPlayingRef = null;
let toggleCameraModeRef = null;
let toggleWeaponRef = null;
let executeGrenadeThrowRef = null;
let resumeGameRef = null;
let JUMP_FORCE = 0.25;
let velocityYRef = null;
let isGroundedRef = null;

export function initInput(callbacks, initialState) {
    const { 
        settings, 
        gamePaused, 
        isPlaying, 
        toggleCameraMode, 
        toggleWeapon, 
        executeGrenadeThrow, 
        resumeGame,
        jumpForce,
        setPitch,
        setYaw
    } = callbacks;

    settingsRef = settings;
    gamePausedRef = gamePaused;
    isPlayingRef = isPlaying;
    toggleCameraModeRef = toggleCameraMode;
    toggleWeaponRef = toggleWeapon;
    executeGrenadeThrowRef = executeGrenadeThrow;
    resumeGameRef = resumeGame;
    JUMP_FORCE = jumpForce || 0.25;

    document.addEventListener('mousemove', (e) => { 
        if (document.pointerLockElement === document.body && isPlayingRef() && !gamePausedRef() && !settingsRef.isEditing) { 
            yaw -= e.movementX * settingsRef.sens; 
            pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * settingsRef.sens)); 
        } 
    });

    document.addEventListener('keydown', (e) => {
        const k = e.code;
        if (k === 'Escape') { 
            if (isPlayingRef()) { 
                // This logic might need to stay in main or be passed as a callback
                callbacks.onPause();
            } else if (gamePausedRef()) { 
                resumeGameRef(); 
            } else if (document.getElementById('settings-view').style.display !== 'none') { 
                document.getElementById('back-btn').click(); 
            } return; 
        }
        
        if (!isPlayingRef()) return; 
        if (k === 'KeyW') keyState.w = true; 
        if (k === 'KeyA') keyState.a = true; 
        if (k === 'KeyS') keyState.s = true; 
        if (k === 'KeyD') keyState.d = true; 
        if (k === 'Space') callbacks.onJump();
        if (k === 'KeyV') toggleCameraModeRef(); 
        if (k === 'KeyQ') toggleWeaponRef();
        if (k === 'KeyG') { if(!isChargingGrenade) { isChargingGrenade = true; chargingGrenadeType = 'explosive'; grenadeChargeStartTime = performance.now(); } }
        if (k === 'KeyF') { if(!isChargingGrenade) { isChargingGrenade = true; chargingGrenadeType = 'smoke'; grenadeChargeStartTime = performance.now(); } }
    });

    document.addEventListener('keyup', (e) => { 
        const k = e.code; 
        if (k === 'KeyW') keyState.w = false; 
        if (k === 'KeyA') keyState.a = false; 
        if (k === 'KeyS') keyState.s = false; 
        if (k === 'KeyD') keyState.d = false; 
        if (k === 'KeyG' && isChargingGrenade && chargingGrenadeType === 'explosive') { executeGrenadeThrowRef(); isChargingGrenade = false; } 
        if (k === 'KeyF' && isChargingGrenade && chargingGrenadeType === 'smoke') { executeGrenadeThrowRef(); isChargingGrenade = false; } 
    });

    document.addEventListener('mousedown', (e) => { 
        if (isPlayingRef() && !gamePausedRef() && !settingsRef.isEditing) { 
            if (document.pointerLockElement !== document.body) { 
                try { const pl = document.body.requestPointerLock(); if (pl) pl.catch(() => {}); } catch(err){} 
            } 
            if (e.button === 0) { isManualFiring = true; isAiming = true; } 
            if (e.button === 2) isAiming = true; 
        } 
    });

    document.addEventListener('mouseup', () => { isManualFiring = false; isAiming = false; }); 
    
    setupMobileControls(callbacks);
}

export function resetInput() {
    yaw = 0;
    pitch = 0;
    keyState.w = keyState.a = keyState.s = keyState.d = false;
    moveInput.x = moveInput.y = 0;
}

function setupMobileControls(callbacks) { 
    let joyId = null, aimId = null, fireId = null, jSX, jSY, lTX, lTY, fTX, fTY; 
    const jz = document.getElementById('joystick-zone'); 
    
    jz.addEventListener('touchstart', (e) => { 
        if (!settingsRef.isEditing) { 
            e.preventDefault();
            const t = e.changedTouches[0]; joyId = t.identifier; jSX = t.clientX; jSY = t.clientY; 
        } 
    }, { passive: false }); 
    
    jz.addEventListener('touchmove', (e) => { 
        if (settingsRef.isEditing) return; 
        e.preventDefault();
        for (let t of e.changedTouches) {
            if (t.identifier === joyId) { 
                const dx = t.clientX - jSX, dy = t.clientY - jSY, d = Math.min(50, Math.sqrt(dx * dx + dy * dy)), a = Math.atan2(dy, dx); 
                const knob = document.getElementById('joystick-knob');
                if (knob) knob.style.transform = `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px)`; 
                moveInput.x = (Math.cos(a) * d) / 50; 
                moveInput.y = (Math.sin(a) * d) / 50; 
            } 
        }
    }, { passive: false }); 
    
    jz.addEventListener('touchend', (e) => { 
        for (let t of e.changedTouches) {
            if (t.identifier === joyId) { 
                joyId = null; 
                const knob = document.getElementById('joystick-knob');
                if (knob) knob.style.transform = ''; 
                moveInput.x = 0; 
                moveInput.y = 0; 
            } 
        }
    }); 
    
    document.getElementById('aim-zone').addEventListener('touchstart', (e) => { 
        e.preventDefault();
        const t = e.changedTouches[0]; aimId = t.identifier; lTX = t.clientX; lTY = t.clientY; 
    }, { passive: false }); 
    
    document.getElementById('aim-zone').addEventListener('touchmove', (e) => { 
        e.preventDefault();
        for (let t of e.changedTouches) {
            if (t.identifier === aimId) { 
                yaw -= (t.clientX - lTX) * settingsRef.sens * 2.2; 
                pitch = Math.max(-1.5, Math.min(1.5, pitch - (t.clientY - lTY) * settingsRef.sens * 2.2)); 
                lTX = t.clientX; lTY = t.clientY; 
            } 
        }
    }, { passive: false }); 
    
    const fb = document.getElementById('fire-btn'); 
    fb.addEventListener('touchstart', (e) => { 
        e.preventDefault(); const t = e.changedTouches[0]; fireId = t.identifier; fTX = t.clientX; fTY = t.clientY; isManualFiring = true; isAiming = true; 
    }, { passive: false }); 
    
    fb.addEventListener('touchmove', (e) => { 
        if (settingsRef.isEditing) return; 
        e.preventDefault();
        for (let t of e.changedTouches) {
            if (t.identifier === fireId) { 
                yaw -= (t.clientX - fTX) * settingsRef.sens * 2.2; 
                pitch = Math.max(-1.5, Math.min(1.5, pitch - (t.clientY - fTY) * settingsRef.sens * 2.2)); 
                fTX = t.clientX; fTY = t.clientY; 
            } 
        }
    }, { passive: false }); 
    
    fb.addEventListener('touchend', () => { isManualFiring = false; isAiming = false; }); 
    
    document.getElementById('aim-btn').addEventListener('touchstart', (e) => { e.preventDefault(); isAiming = !isAiming; }, { passive: false }); 
    document.getElementById('jump-btn').addEventListener('touchstart', (e) => { e.preventDefault(); callbacks.onJump(); }, { passive: false }); 
    document.getElementById('cam-toggle-btn').addEventListener('touchstart', (e) => { e.preventDefault(); toggleCameraModeRef(); }, { passive: false }); 
    document.getElementById('swap-btn').addEventListener('touchstart', (e) => { e.preventDefault(); toggleWeaponRef(); }, { passive: false }); 
}

export function updateYawPitch(y, p) {
    yaw = y;
    pitch = p;
}
