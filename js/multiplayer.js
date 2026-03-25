import { ref, set, onValue, off, onDisconnect, update, remove, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import * as THREE from 'three';
import { PLAYER_SYNC_RATE } from './constants.js';
import { logSystem, clearSceneObject } from './utils.js';

export let myUserId = null;
export let myRef = null;
export let remotePlayers = {};
export let isMasterClient = false;
export let roomPath = '';
export let serverTimeOffset = 0;
export let pvpMatchEndTime = 0;

export function setMyUserId(val) { myUserId = val; }
export function setRoomPath(val) { roomPath = val; }
export function setIsMasterClient(val) { isMasterClient = val; }
export function setMatchEndTime(val) { pvpMatchEndTime = val; }

let database = null;
let networkInterval = null;
let unsubLobbyPlayers = null, unsubGamePlayers = null, unsubMyPresence = null, unsubCoopLevel = null, unsubCoopEnemies = null, unsubGrenades = null;
let remoteGrenadesHandled = new Set();

export function initMultiplayer(db) {
    database = db;
    onValue(ref(db, ".info/serverTimeOffset"), (snap) => { serverTimeOffset = snap.val() || 0; });
}

export function cleanupMultiplayer(scene) {
    if (myRef) remove(myRef).catch(() => { });
    if (networkInterval) clearInterval(networkInterval); 
    if (unsubLobbyPlayers) unsubLobbyPlayers(); 
    if (unsubGamePlayers) unsubGamePlayers(); 
    if (unsubMyPresence) unsubMyPresence(); 
    if (unsubCoopLevel) unsubCoopLevel(); 
    if (unsubCoopEnemies) unsubCoopEnemies(); 
    if (unsubGrenades) unsubGrenades();
    
    remoteGrenadesHandled.clear();
    for (const key in remotePlayers) {
        const rp = remotePlayers[key];
        if (rp.mesh) { scene.remove(rp.mesh); clearSceneObject(scene, rp.mesh); }
    }
    remotePlayers = {}; 
    networkInterval = null; 
    myRef = null;
    myUserId = null;
    roomPath = '';
    isMasterClient = false;
}

export function connectLobby(auth, callbacks) {
    const { onLobbyUpdate, onGameStart, onMatchTimerUpdate } = callbacks;
    
    onValue(ref(database, `${roomPath}/state`), (snapshot) => { 
        const state = snapshot.val(); 
        const trueNow = Date.now() + serverTimeOffset; 
        if (state && state.endTime && state.endTime > trueNow - 10000) { 
            pvpMatchEndTime = state.endTime; 
        } 
        if (state && state.gameRunning === true) {
            onGameStart(state);
        }
    });

    const lobbyRef = ref(database, `${roomPath}/players/${myUserId}`); 
    onDisconnect(lobbyRef).remove(); 
    set(lobbyRef, { id: myUserId, lastUpdate: serverTimestamp(), status: 'lobby' }).catch(() => {});
    
    if (networkInterval) clearInterval(networkInterval); 
    networkInterval = setInterval(() => { 
        update(lobbyRef, { lastUpdate: serverTimestamp() }).catch(() => {}); 
    }, 5000);
    
    if (unsubLobbyPlayers) unsubLobbyPlayers(); 
    unsubLobbyPlayers = onValue(ref(database, roomPath + '/players'), (snapshot) => {
        const data = snapshot.val();
        const now = Date.now() + serverTimeOffset; 
        const activeIds = data ? Object.keys(data).filter(key => { 
            const p = data[key]; 
            return p.lastUpdate && (now - p.lastUpdate < 60000); 
        }).sort() : [];
        
        isMasterClient = (activeIds.length > 0 && activeIds[0] === myUserId);
        onLobbyUpdate(data, activeIds);
    }, (error) => logSystem("Erro DB: " + error.message, "error"));
}

export function setupPresence(userId, path, callbacks) {
    myUserId = userId;
    roomPath = path;
    const { onLocalPlayerUpdate, onRemotePlayersUpdate, onGrenadeUpdate, onEnemiesUpdate, onCoopStateUpdate } = callbacks;

    myRef = ref(database, `${roomPath}/players/${myUserId}`); 
    onDisconnect(myRef).remove(); 
    set(myRef, { id: myUserId, x: 5, y: 0, z: 5, rot: 0, hp: 100, kills: 0, deaths: 0, lastUpdate: serverTimestamp() }).catch(() => {});
    
    if (unsubMyPresence) unsubMyPresence();
    unsubMyPresence = onValue(myRef, (s) => onLocalPlayerUpdate(s.val()));

    if (unsubGamePlayers) unsubGamePlayers();
    unsubGamePlayers = onValue(ref(database, roomPath + '/players'), (s) => onRemotePlayersUpdate(s.val()));

    if (unsubGrenades) unsubGrenades();
    unsubGrenades = onValue(ref(database, roomPath + '/grenades'), (s) => onGrenadeUpdate(s.val()));

    if (unsubCoopEnemies) unsubCoopEnemies();
    unsubCoopEnemies = onValue(ref(database, `${roomPath}/state/enemies`), (s) => onEnemiesUpdate(s.val()));

    if (onCoopStateUpdate) {
        if (unsubCoopLevel) unsubCoopLevel();
        unsubCoopLevel = onValue(ref(database, `${roomPath}/state`), (s) => onCoopStateUpdate(s.val()));
    }
}

export function startNetworkSync(playerGroup, inputYaw, inputPitch, moveInput, keyState, isGrounded, isInvincible, playerArmor) {
    if (networkInterval) clearInterval(networkInterval);
    let lastSentPosition = new THREE.Vector3();
    let lastSentRotation = 0;
    let lastSentTime = 0;
    let lastSentMoving = false;

    networkInterval = setInterval(() => {
        if (!myRef) return; 
        const p = playerGroup.position, r = inputYaw, now = Date.now(); 
        const currentMoving = (Math.abs(moveInput.x) > 0.1 || Math.abs(moveInput.y) > 0.1 || keyState.w || keyState.a || keyState.s || keyState.d);
        
        if (p.distanceTo(lastSentPosition) > 0.05 || Math.abs(r - lastSentRotation) > 0.05 || (now - lastSentTime > 2000) || lastSentMoving !== currentMoving) { 
            if (now - lastSentTime < PLAYER_SYNC_RATE) return; 
            
            update(myRef, { 
                x: parseFloat(p.x.toFixed(2)), 
                y: parseFloat(p.y.toFixed(2)), 
                z: parseFloat(p.z.toFixed(2)), 
                rot: parseFloat(r.toFixed(2)), 
                pitch: parseFloat(inputPitch.toFixed(2)), 
                isMoving: currentMoving, 
                isGrounded: isGrounded, 
                invincible: isInvincible, 
                lastUpdate: serverTimestamp(), 
                armor: playerArmor 
            }).catch(() => {}); 
            lastSentPosition.copy(p); 
            lastSentRotation = r; 
            lastSentTime = now; 
            lastSentMoving = currentMoving; 
        }
    }, PLAYER_SYNC_RATE / 2);
}

export function registerKill(userId, currentScore, roomPath, database) {
    if (userId && myRef) { 
        runTransaction(ref(database, `${roomPath}/players/${userId}/kills`), (k) => (k || 0) + 1).catch(() => {}); 
    }
}

export function registerTeamKill(roomPath, database) {
    runTransaction(ref(database, `${roomPath}/state`), (s) => { 
        if (!s) s = { kills: 0, level: 1 }; 
        s.kills = (s.kills || 0) + 1; 
        const killsNeeded = 20 + (s.level * 5); 
        if (s.kills >= killsNeeded) { s.level = (s.level || 1) + 1; s.kills = 0; } 
        return s; 
    }).catch(() => {}); 
}
