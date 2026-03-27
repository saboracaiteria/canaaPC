import * as THREE from 'three';
import { 
    initMultiplayer, connectLobby, cleanupMultiplayer, setupPresence, 
    startNetworkSync, registerKill as mpRegisterKill, registerTeamKill as mpRegisterTeamKill,
    myUserId, myRef, remotePlayers, 
    isMasterClient, roomPath, 
    serverTimeOffset, pvpMatchEndTime,
    setMyUserId, setRoomPath, setIsMasterClient, setMatchEndTime
} from './multiplayer.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getDatabase, ref, set, update, onValue, off, runTransaction } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js';
import { setupMinimap, drawMinimap, updateTimerUI, updateWeaponUI, updateGrenadeUI, triggerHitMarker, applyGraphicsSettings, showGameOver } from './ui.js';

import { firebaseConfig, GRAVITY, JUMP_FORCE, mazeSize, cellSize, PLAYER_SYNC_RATE, BOT_SYNC_RATE, config, TOTAL_TRACKS, mazeMap } from './constants.js';
import { 
    clearSceneObject, goFullscreen, logSystem, mulberry32, addEyes, 
    initAudio, resumeAudio, playSound, createProTexture, initSky 
} from './utils.js';
import { createHumanoidMesh, createHPBar } from './graphics.js';
import { 
    initWorld, createWorld, scene, camera, renderer, walls, ramps, 
    currentFloor, worldLights, skyMesh, skyUniforms, envGroup 
} from './world.js';
import { 
    createEnemyMesh, createRemotePlayerMesh, spawnEnemies, killEnemyLocal, updateEnemies 
} from './enemies.js';
import { 
    initInput, resetInput, updateYawPitch, keyState, moveInput, yaw, pitch, isManualFiring, isAiming,
    isChargingGrenade, chargingGrenadeType, grenadeChargeStartTime
} from './input.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log("Canaan Engine: DOMContentLoaded - Booting...");
    // Configuração Firebase
        
        let app, auth, db; 
        try { 
            app = initializeApp(firebaseConfig); 
            auth = getAuth(app); 
            db = getDatabase(app); 
            initMultiplayer(db);
        } catch (e) { 
            console.error("Firebase Init Error:", e); 
        }

        // Variáveis de Jogo e Sincronização Multiplayer
        let isMultiplayerMode = false, isCoopMode = false;
        let hasResetLobbyState = false; 
        let isThirdPerson = true, wasManualFiring = false, currentWeapon = 0;
        let velocityY = 0, isGrounded = true, recoil = 0, gunRecoilZ = 0, lastShotTime = 0, lastStepTime = 0;
        
        window.walkCycle = 0;
        let walkCycle = 0;
        let recoilAngle = 0;
        let fovKick = 0;
        let gunRecoil = 0; 
        let shakeIntensity = 0;
        let shakeTime = 0;
        
        const triggerShake = (intensity) => {
            shakeIntensity = intensity;
            shakeTime = 10; // Frames of shake
        };
        
        let minimapCanvas, minimapCtx;

        const bulletRaycaster = new THREE.Raycaster(), aimRaycaster = new THREE.Raycaster();
        let playerGroup, playerMesh, gunGroup, enemies = [], bullets = [], healthKits = [], armorVests = [], grenadePacks = [];
        // world-related variables are now imported from world.js
        let score = 0, playerHP = 100, playerArmor = 0, playerLives = 5, isPlaying = false, gamePaused = false, currentLevel = 1, maxLevels = 10, lobbyPlayerCount = 0;
        function isMobileDevice() {
            const ua = navigator.userAgent;
            const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
            const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
            
            // Handle iPad Pro which sometimes reports as Macintosh but has high touch points
            const isIPad = (navigator.platform === 'iPad' || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
            
            const isSmallScreen = window.innerWidth <= 1366; // Increased to catch iPad Pro 12.9
            
            // Mobile if it has a mobile UA OR it's an iPad OR it's a small-ish screen with touch support
            return isMobileUA || isIPad || (isTouch && isSmallScreen);
        }

        const storedMode = localStorage.getItem('canaan_control_mode');
        let isPC = storedMode !== null ? (storedMode === 'pc') : !isMobileDevice();
        let pvpTimer = 0, pvpTimerInterval = null, isInvincible = false, invincibilityTimeout = null; 
        let levelStartTime = 0; 
        let spawnedLevel = -1; 
        let settings = { fov: 70, sens: 0.005, volume: 0.5, isEditing: false, graphics: 'low' };

        let activeEffectIntervals = [];
        let hitMarkerTimeout = null; 
        let activeTextures = []; 
        

        const clock = new THREE.Clock(); 
        let pelvePivot, head, rightArm, leftArm, playerMeshParts, muzzleFlashLight, envStaticNodes = null; 

        // REUSABLE VECTORS (FIX LAG / GC POOL)
        const _v1 = new THREE.Vector3();
        const _v2 = new THREE.Vector3();
        const _v3 = new THREE.Vector3();
        const _v4 = new THREE.Vector3();
        const _v5 = new THREE.Vector3();
        const _vDir = new THREE.Vector3();
        const _vFwd = new THREE.Vector3(0, 0, -1);
        const _vRgt = new THREE.Vector3(1, 0, 0);
        const _vUp = new THREE.Vector3(0, 1, 0);
        const _vDown = new THREE.Vector3(0, -1, 0);

        let unsubLobbyPlayers = null, unsubGamePlayers = null, unsubMyPresence = null, unsubCoopLevel = null, unsubCoopKills = null, unsubCoopEnemies = null, unsubCoopKits = null, unsubGrenades = null;
        
        let remoteGrenadesHandled = new Set();

        let lastSentPosition = new THREE.Vector3(0, 0, 0), lastSentRotation = 0, lastSentTime = 0;

        let grenades = { explosive: 6, smoke: 6 }; 
        let activeGrenades = []; 
        let bgmPlayer = null; 
        let currentBgmTrack = 0; 

        let sharedMats = null;
        function initSharedMaterials() {
            sharedMats = {
                laserMat: new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 }),
                bulletGeo: new THREE.SphereGeometry(0.1, 4, 4),
                bulletLocalMat: new THREE.MeshBasicMaterial({ color: 0x00FF41 }),
                bulletRemoteMat: new THREE.MeshBasicMaterial({ color: 0xff0000 }),
                tracerHighGeo: new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6),
                tracerLowGeo: new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6),
                tracerSniperMat: new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.6 }),
                tracerRifleMat: new THREE.MeshBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.6 })
            };
        }





        function playMenuMusic() { 
            try {
                if (bgmPlayer) { 
                    bgmPlayer.pause(); 
                    bgmPlayer.onended = null; 
                    bgmPlayer = null; 
                } 
                const url = `sons/top1.mp3`; 
                bgmPlayer = new Audio(url); 
                bgmPlayer.loop = true; 
                bgmPlayer.volume = settings.volume; 
                bgmPlayer.play().catch(() => {}); 
                currentBgmTrack = 1; 
            } catch (e) { }
        }

        function playGameMusic() { 
            try {
                if (bgmPlayer) { 
                    bgmPlayer.pause(); 
                    bgmPlayer.onended = null; 
                } 
                let nextTrack; 
                const available = []; 
                for (let i = 2; i <= TOTAL_TRACKS; i++) if (i !== currentBgmTrack) available.push(i); 
                if (available.length > 0) nextTrack = available[Math.floor(Math.random() * available.length)]; 
                else nextTrack = 2; 
                currentBgmTrack = nextTrack; 
                const url = `sons/top${currentBgmTrack}.mp3`; 
                bgmPlayer = new Audio(url); 
                bgmPlayer.loop = false; 
                bgmPlayer.volume = settings.volume; 
                bgmPlayer.onended = () => { playGameMusic(); }; 
                bgmPlayer.play().catch(() => {}); 
            } catch (e) { }
        }



        function showLobby(mode) {
            cleanupMultiplayer(scene); 
            document.getElementById("start-view").style.display = "none"; 
            document.getElementById("lobby-screen").style.display = "flex";
            const title = document.getElementById("lobby-title");
            const btn = document.getElementById("start-mp-btn");
            if (btn) { btn.style.display = "block"; btn.classList.remove('disabled'); }
            const levelSelectDiv = document.getElementById("pvp-level-selection");
            hasResetLobbyState = false; 
            
            const urlParams = new URLSearchParams(window.location.search); 
            const roomID = urlParams.get('room') || 'global';
            
            if (mode === 'coop') {
                setRoomPath(`rooms/coop/${roomID}`); 
                isCoopMode = true; 
                title.innerText = "CO-OP PVE"; 
                title.style.color = "#FF00FF"; 
                btn.style.borderColor = "#FF00FF"; 
                btn.style.color = "#FF00FF"; 
                levelSelectDiv.style.display = "none";
                btn.onclick = () => { 
                    update(ref(db, `${roomPath}/state`), { gameRunning: true, level: 1, kills: 0, enemies: null, kits: null }).catch(() => {}); 
                    resetGame('coop'); 
                };
            } else {
                setRoomPath(`rooms/pvp/${roomID}`); 
                isCoopMode = false; 
                title.innerText = "PVP ONLINE"; 
                title.style.color = "#00f3ff"; 
                btn.style.borderColor = "#00f3ff"; 
                btn.style.color = "#00f3ff"; 
                levelSelectDiv.style.display = "block";
                btn.onclick = () => { 
                    currentLevel = parseInt(document.getElementById("pvp-level-select").value); 
                    const trueNow = Date.now() + serverTimeOffset; 
                    update(ref(db, `${roomPath}/state`), { gameRunning: true, level: currentLevel, endTime: trueNow + 240000, enemies: null }).catch(() => {}); 
                    resetGame('multi'); 
                };
            }

            connectLobby(auth, {
                onLobbyUpdate: (data, activeIds) => {
                    renderLobbyList(data, activeIds);
                },
                onGameStart: (state) => {
                    if (state && state.gameRunning === true && !isPlaying && !isMasterClient && document.getElementById("lobby-screen").style.display !== "none") { 
                        if (state.level) currentLevel = state.level; 
                        setTimeout(() => { resetGame(isCoopMode ? 'coop' : 'multi'); }, 500); 
                    }
                }
            });
        }

        function renderLobbyList(data, activeIds) {
            const listEl = document.getElementById("lobby-player-list"); 
            listEl.innerHTML = "";
            if (!data) { 
                listEl.innerHTML = '<div style="padding:10px; text-align:center">Nenhum operador nesta sala.</div>'; 
                return; 
            }
            
            let count = 0;
            if (activeIds && Array.isArray(activeIds)) {
                activeIds.forEach(key => {
                    count++; 
                    const div = document.createElement("div"); 
                    div.className = "lobby-player-item"; 
                    if (key === myUserId) div.classList.add("me");
                    let roleTag = (key === activeIds[0]) ? '<span style="color:gold; font-size:10px;"> [HOST]</span>' : '';
                    div.innerHTML = `<span>${key === myUserId ? "VOCÊ" : `Op. ${key.substring(0, 4)}`}${roleTag}</span> <span>ONLINE</span>`; 
                    listEl.appendChild(div);
                });
            }
            lobbyPlayerCount = count; 
            
            const isHost = (activeIds[0] === myUserId) || (activeIds.length === 1 && activeIds[0] === myUserId);
            const startBtn = document.getElementById("start-mp-btn");
            const statusEl = document.getElementById("connection-status");
            
            if (startBtn) {
                // In Coop, everyone should see the start button if it's a squad play, or at least the lead.
                // In PVP, only host starts.
                startBtn.style.display = (isHost || isCoopMode) ? "block" : "none";
                startBtn.classList.toggle('disabled', false); 
            }
            
            if (statusEl) {
                if (count >= 2) {
                    statusEl.innerText = "ESQUADRÃO PRONTO!";
                    statusEl.style.color = "#00FF41";
                } else {
                    statusEl.innerText = isHost ? "PRONTO PARA OPERAÇÃO SOLO..." : "AGUARDANDO HOST...";
                    statusEl.style.color = isHost ? "#00f3ff" : "#ffff00";
                }
            }
            
            document.getElementById("pvp-level-selection").style.display = (!isCoopMode) ? "block" : "none";
            if (count === 0) listEl.innerHTML = '<div style="padding:10px; text-align:center">Nenhum operador ativo.</div>';
        }

        function cleanupMp() {
            cleanupMultiplayer(scene);
        }

        function setupPresenceInit() {
            setupPresence(myUserId, roomPath, {
                onLocalPlayerUpdate: (d) => {
                    if (!d) return;
                    if (d.hp < playerHP) {
                        playerHP = d.hp; 
                        document.getElementById('hp-bar').style.width = playerHP + "%"; 
                        const hpEl = document.getElementById('hp'); 
                        if (hpEl) hpEl.innerText = Math.ceil(playerHP);
                        document.getElementById('damage-overlay').style.boxShadow = "inset 0 0 50px 20px rgba(255,0,0,0.5)"; 
                        setTimeout(() => document.getElementById('damage-overlay').style.boxShadow = "none", 200);
                        if (playerHP <= 0) respawnPvP();
                    }
                    if (d.kills !== undefined && !isCoopMode) { 
                        score = d.kills; 
                        const scoreEl = document.getElementById('score'); 
                        if (scoreEl) scoreEl.innerText = score; 
                    }
                    if (d.armor !== undefined) { 
                        playerArmor = d.armor; 
                        document.getElementById('armor-bar').style.width = playerArmor + "%"; 
                        const armorEl = document.getElementById('armor'); 
                        if (armorEl) armorEl.innerText = Math.ceil(playerArmor); 
                    }
                },
                onRemotePlayersUpdate: (d) => {
                    if (!d) return; 
                    const now = Date.now() + serverTimeOffset;
                    const activeIds = [];
                    let c = 0; 
                    Object.keys(d).forEach(k => { 
                        if (now - (d[k].lastUpdate || 0) < 10000) { 
                            if (d[k].x !== undefined) { 
                                activeIds.push(k);
                                if (k !== myUserId) {
                                    c++; 
                                    updateRemotePlayer(k, d[k]); 
                                }
                            } 
                        } 
                    });
                    document.getElementById('mp-count').innerText = c; 
                    setIsMasterClient(activeIds.sort()[0] === myUserId);
                    document.getElementById('master-status').style.display = isMasterClient ? 'block' : 'none'; 
                },
                onGrenadeUpdate: (data) => {
                    if (!data) return; 
                    Object.keys(data).forEach(k => { 
                        if (!remoteGrenadesHandled.has(k) && !k.startsWith(myUserId)) { 
                            remoteGrenadesHandled.add(k); 
                            const g = data[k]; 
                            const sphere = new THREE.Mesh(
                                new THREE.SphereGeometry(0.2, 8, 8), 
                                new THREE.MeshStandardMaterial({ color: g.type === 'explosive' ? 0x222200 : 0xaaaaaa })
                            ); 
                            sphere.position.set(g.x, g.y, g.z); 
                            scene.add(sphere); 
                            activeGrenades.push({ mesh: sphere, velocity: new THREE.Vector3(g.vx, g.vy, g.vz), type: g.type, life: 120 }); 
                        } 
                    });
                },
                onEnemiesUpdate: (data) => {
                    if (!data) { 
                        if (isMasterClient && enemies.length === 0) { 
                            const count = 15 + (currentLevel - 1) * 2; 
                            enemies = spawnEnemies(count, currentLevel, { scene, walls, playerGroup, remotePlayers, isMultiplayerMode, isCoopMode, isMasterClient, createHPBar, db, roomPath }); 
                        } 
                        return; 
                    }
                    const dataKeys = Object.keys(data);
                    if (enemies.length === 0 || dataKeys.length !== enemies.length) { 
                        syncEnemiesFromData(data, currentLevel); 
                    } else {
                        dataKeys.forEach(key => {
                            const d = data[key]; 
                            const idx = parseInt(key); 
                            const enemy = enemies.find(e => e.userData.index === idx);
                            if (enemy) {
                                enemy.userData.hp = d.hp; 
                                if (d.dead && !enemy.userData.dead) { killEnemyLocal(enemy, { dbUpdate: false, isMultiplayerMode, isCoopMode, registerKill, registerTeamKill, db, roomPath }); }
                                if (!isMasterClient && !d.dead) { 
                                    enemy.userData.targetPos = new THREE.Vector3(d.x, enemy.position.y, d.z); 
                                    enemy.userData.targetRot = d.rot; 
                                }
                            }
                        });
                    }
                },
                onCoopStateUpdate: (state) => {
                    if (!state || !isCoopMode) return;
                    const l = state.level || 1; 
                    const k = state.kills || 0;
                    if (l !== currentLevel) {
                        currentLevel = l; 
                        score = k;
                        spawnedLevel = -1; 
                        const scoreEl = document.getElementById('score'); 
                        if (scoreEl) scoreEl.innerText = score;
                        const levelDisplay = document.getElementById('level-display'); 
                        if (levelDisplay) levelDisplay.innerText = currentLevel;
                        const levelInd = document.getElementById('level-indicator'); 
                        if (levelInd) { 
                            levelInd.innerText = "ZONA COOP " + currentLevel; 
                            levelInd.style.display = 'block'; 
                            setTimeout(() => levelInd.style.display = 'none', 3000); 
                        }
                        
                        enemies.forEach(e => clearSceneObject(scene, e)); 
                        enemies = [];
                        
                        if (isMasterClient) {
                             update(ref(db, `${roomPath}/state`), { enemies: null, kits: null }).catch(() => {});
                             enemies = spawnEnemies(15 + (currentLevel - 1) * 2, currentLevel, { scene, walls, playerGroup, remotePlayers, isMultiplayerMode, isCoopMode, isMasterClient, createHPBar, db, roomPath });
                        }
                    } else if (k !== score) { 
                        score = k; 
                        const scoreEl = document.getElementById('score'); 
                        if (scoreEl) scoreEl.innerText = score; 
                    }
                }
            });
            startNetworkSync(playerGroup, yaw, pitch, moveInput, keyState, isGrounded, isInvincible, playerArmor);
        }

        function syncEnemiesFromData(data, level) {
            enemies.forEach(e => clearSceneObject(scene, e)); 
            enemies = [];
            Object.keys(data).forEach(key => {
                const d = data[key]; 
                const idx = parseInt(key); 
                const enemy = createEnemyMesh(d.x, d.z, level, idx); 
                enemy.userData.hp = d.hp !== undefined ? d.hp : 100;
                enemies.push(enemy); 
                scene.add(enemy);
                if (d.dead) { 
                    killEnemyLocal(enemy, { dbUpdate: false, isMultiplayerMode, isCoopMode, registerKill, registerTeamKill, db, roomPath }); 
                } else if (!isMasterClient) { 
                    enemy.userData.targetPos = new THREE.Vector3(d.x, enemy.position.y, d.z); 
                    enemy.userData.targetRot = d.rot; 
                }
            });
        }

        function updateRemotePlayer(id, d) {
            if (!remotePlayers[id]) {
                const m = createRemotePlayerMesh(); 
                m.position.set(d.x, d.y, d.z); 
                m.userData.id = id; 
                m.userData.isPlayer = true; 
                scene.add(m);
                remotePlayers[id] = { 
                    mesh: m, 
                    targetPos: new THREE.Vector3(d.x, d.y, d.z), 
                    targetRot: d.rot, 
                    targetPitch: d.pitch || 0, 
                    isMoving: d.isMoving || false, 
                    isGrounded: d.isGrounded !== false, 
                    invincible: d.invincible || false, 
                    hp: d.hp !== undefined ? d.hp : 100 
                };
            } else {
                const r = remotePlayers[id]; 
                r.targetPos.set(d.x, d.y, d.z); 
                r.targetRot = d.rot; 
                r.targetPitch = d.pitch || 0; 
                r.isMoving = d.isMoving || false; 
                r.isGrounded = d.isGrounded !== false; 
                r.invincible = d.invincible || false; 
                if (d.hp !== undefined) r.hp = d.hp;
            }
        }

        function getSafeSpawnPosition(isPVP) {
            let px = 5, pz = 5;
            let min = 1, max = mazeSize - 1;
            let attempts = 0;
            let safe = false;
            let safePlayerDist = isPVP ? 40 : 15; 

            while (!safe && attempts < 200) {
                attempts++;
                let rx = Math.floor(Math.random() * (max - min) + min);
                let rz = Math.floor(Math.random() * (max - min) + min);
                px = rx * 5;
                pz = rz * 5;
                let insideWall = false;

                for (let w of walls) {
                    let wdx = 2.8, wdz = 2.8;
                    if (w.geometry && w.geometry.parameters) {
                        wdx = (w.geometry.parameters.width / 2) + 1.2;
                        wdz = (w.geometry.parameters.depth / 2) + 1.2;
                    }
                    if (Math.abs(px - w.position.x) < wdx && Math.abs(pz - w.position.z) < wdz) {
                        insideWall = true; break;
                    }
                }

                if (insideWall) continue;

                if (isPVP) {
                    if (Math.abs(px - 50) < 15 && Math.abs(pz - 50) < 15) continue;
                    if (Math.abs(px - 20) < 6 && Math.abs(pz - 30) < 6) continue;
                    if (Math.abs(px - 80) < 6 && Math.abs(pz - 70) < 6) continue;
                }

                let tooClose = false;
                
                if (attempts > 100) safePlayerDist = 20; 
                if (attempts > 150) safePlayerDist = 10;

                Object.values(remotePlayers).forEach(rp => {
                    if (rp.mesh && rp.mesh.position.distanceTo(new THREE.Vector3(px, 0, pz)) < safePlayerDist) tooClose = true;
                });
                enemies.forEach(e => {
                    if (!e.userData.dead && e.position.distanceTo(new THREE.Vector3(px, 0, pz)) < 15) tooClose = true;
                });

                if (tooClose && attempts < 190) continue;
                safe = true;
            }
            return new THREE.Vector3(px, 2, pz);
        }

        function respawnPvP() {
            if (isMultiplayerMode && isCoopMode) { 
                playerLives--; 
                const livesEl = document.getElementById('lives-count'); 
                if (livesEl) livesEl.innerText = playerLives; 
                if (playerLives <= 0) { showGameOver(); return; } 
            }
            
            const isPVP = isMultiplayerMode && !isCoopMode; 
            const spawnPos = getSafeSpawnPosition(isPVP);

            playerHP = 100; 
            playerArmor = 0; 
            const hpEl = document.getElementById('hp'); 
            if (hpEl) hpEl.innerText = "100"; 
            const hpBar = document.getElementById('hp-bar'); 
            if (hpBar) hpBar.style.width = "100%"; 
            const armorBar = document.getElementById('armor-bar'); 
            if (armorBar) armorBar.style.width = "0%"; 
            const armorEl = document.getElementById('armor'); 
            if (armorEl) armorEl.innerText = "0";
            
            grenades = { explosive: 6, smoke: 6 }; 
            updateGrenadeUI(grenades);
            velocityY = 0; 
            isGrounded = true; 
            playerGroup.position.copy(spawnPos); 
            updateYawPitch(Math.random() * Math.PI * 2, 0); 
            
            if (invincibilityTimeout) clearTimeout(invincibilityTimeout); 
            isInvincible = true; 
            
            if (myRef) { 
                update(myRef, { hp: 100, armor: 0, x: spawnPos.x, z: spawnPos.z, invincible: true, lastRespawn: Date.now() }).catch(() => {}); 
            }
            
            invincibilityTimeout = setTimeout(() => { 
                isInvincible = false; 
                if (myRef) update(myRef, { invincible: false }).catch(() => {}); 
            }, 6000);
            
            isPlaying = true; 
            const o = document.getElementById('damage-overlay'); 
            if (o) { 
                o.style.backgroundColor = "rgba(0, 255, 255, 0.3)"; 
                setTimeout(() => o.style.backgroundColor = "transparent", 300); 
            }
        }

        function startPVPTimer() {
            if (pvpTimerInterval) clearInterval(pvpTimerInterval);
            pvpTimerInterval = setInterval(() => {
                if (!isPlaying || gamePaused || !pvpMatchEndTime) return; 
                const trueNow = Date.now() + serverTimeOffset; 
                const timeLeft = Math.max(0, Math.floor((pvpMatchEndTime - trueNow) / 1000));
                pvpTimer = timeLeft; 
                updateTimerUI(pvpTimer);
                if (pvpTimer <= 0) { 
                    clearInterval(pvpTimerInterval); 
                    isPlaying = false; 
                    let maxKills = score; 
                    let winnerId = myUserId; 
                    let isDraw = false;
                    
                    Object.keys(remotePlayers).forEach(id => { 
                        const pKills = remotePlayers[id].kills || 0; 
                        if (pKills > maxKills) { 
                            maxKills = pKills; 
                            winnerId = id; 
                            isDraw = false; 
                        } else if (pKills === maxKills) { 
                            isDraw = true; 
                        } 
                    });
                    
                    if (isDraw) { endPVPMatch(false, "EMPATE!"); } 
                    else if (winnerId === myUserId && maxKills > 0) { endPVPMatch(true, "VITÓRIA PVP!"); } 
                    else if (winnerId === myUserId && maxKills === 0) { endPVPMatch(false, "EMPATE! (0 KILLS)"); } 
                    else { endPVPMatch(false, "DERROTA PVP!"); }
                }
            }, 1000);
        }

        function registerKill() { 
            score++; 
            const scoreEl = document.getElementById('score'); 
            if (scoreEl) scoreEl.innerText = score; 
            if (isMultiplayerMode) { 
                mpRegisterKill(myUserId, score, roomPath, db); 
            } 
        }

        function registerTeamKill() {
            if (!isCoopMode) return;
            mpRegisterTeamKill(roomPath, db);
        }

        







        function onResize() { 
            camera.aspect = window.innerWidth / window.innerHeight; 
            camera.updateProjectionMatrix(); 
            renderer.setSize(window.innerWidth, window.innerHeight); 
        }

        function toggleCameraMode() {
            isThirdPerson = !isThirdPerson; 
            const ch = document.getElementById('crosshair'); 
            if (ch) ch.style.opacity = '0.9';
            
            if (playerMeshParts) { 
                if (playerMesh) playerMesh.traverse(m => { 
                    if (m.isMesh && m.material) { 
                        m.material.transparent = true; 
                        m.material.opacity = isInvincible ? 0.5 : 1.0; 
                        if (m.material.emissive) { 
                            if (isInvincible) m.material.emissive.setHex(0x00ffff); 
                            else m.material.emissive.setHex(0x000000); 
                        } 
                    } 
                }); 
                const vis = isThirdPerson; 
                playerMeshParts.torso.material.visible = vis; 
                playerMeshParts.vest.material.visible = vis; 
                playerMeshParts.rArmPivot.traverse(c => { if (c.material) c.material.depthTest = true; }); 
                playerMeshParts.lArmPivot.traverse(c => { if (c.material) c.material.depthTest = true; }); 
            }
            if (gunGroup && rightArm) { 
                if (gunGroup.parent !== rightArm) { rightArm.add(gunGroup); } 
                gunGroup.position.set(0, -0.65, -0.1); 
                gunGroup.rotation.set(-Math.PI / 2, 0, 0); 
            }
        }

        function processShooting() {
            const now = performance.now(); 
            let shouldFire = false;
            
            if (currentWeapon === 1) { 
                let shotFiredThisFrame = false; 
                if (wasManualFiring && !isManualFiring) { shotFiredThisFrame = true; } 
                if (shotFiredThisFrame && now - lastShotTime >= 1500) { shouldFire = true; } 
            } else { 
                if (isManualFiring && now - lastShotTime >= 140) { shouldFire = true; } 
            }
            
            wasManualFiring = isManualFiring; 
            if (!shouldFire) return;
            
            lastShotTime = now; 
            playSound('shoot', settings); 
            recoilAngle = 0.05; 
            updateYawPitch(yaw, Math.min(1.4, pitch + 0.01)); 
            gunRecoil = currentWeapon === 1 ? 0.6 : 0.15; 
            fovKick = currentWeapon === 1 ? 2 : 0.5;
            
            const f = gunGroup.getObjectByName("flash"); 
            if (f) { f.visible = true; setTimeout(() => f.visible = false, 40); } 
            muzzleFlashLight.intensity = 3; 
            setTimeout(() => muzzleFlashLight.intensity = 0, 50); 
            spawnBullet(null, null, false, currentWeapon);
            triggerShake(currentWeapon === 1 ? 0.3 : 0.08); 
        }

        function checkWall(nx, nz, cx, cz, cy) {
            const gridX = Math.floor((nx + cellSize / 2) / cellSize);
            const gridZ = Math.floor((nz + cellSize / 2) / cellSize);
            
            if (gridX >= 0 && gridX < mazeSize && gridZ >= 0 && gridZ < mazeSize) {
                if (mazeMap[gridZ][gridX] === 1) {
                    if (cy < 5.0) return true; // Most walls are 6m high
                }
            }
            
            if (ramps.length > 0) { 
                _v1.set(cx, cy + 0.5, cz); 
                _v2.set(nx, cy + 0.5, nz); 
                _vDir.subVectors(_v2, _v1); 
                const dist = _vDir.length(); 
                if (dist > 0) { 
                    _vDir.normalize(); 
                    aimRaycaster.set(_v1, _vDir);
                    aimRaycaster.far = dist + 0.4;
                    const hits = aimRaycaster.intersectObjects(ramps, true); 
                    if (hits.length > 0) { 
                        if (hits[0].normal && hits[0].normal.y < 0.2) { return true; } 
                    }
                }
            }
            return false;
        }

        function handleRemoteShoot(data) { 
            const pos = new THREE.Vector3(data.x, data.y, data.z); 
            const dir = new THREE.Vector3(data.dir.x, data.dir.y, data.dir.z); 
            spawnBullet(pos, dir, true, 1); 
        }

        function spawnBullet(pos, dir, isRemote = false, wpnType = 1) {
            if (!sharedMats) initSharedMaterials();
            
            const isSniper = wpnType === 1;
            const b = new THREE.Mesh(sharedMats.bulletGeo, isRemote ? sharedMats.bulletRemoteMat : sharedMats.bulletLocalMat); 
            const p = pos ? pos.clone() : new THREE.Vector3(); 
            const d = dir ? dir.clone() : new THREE.Vector3();
            
            if (!pos) { 
                if (gunGroup) { 
                    gunGroup.getWorldPosition(p); 
                    const gunDir = new THREE.Vector3(0, 0, -0.6); 
                    gunDir.applyQuaternion(gunGroup.getWorldQuaternion(new THREE.Quaternion())); 
                    p.add(gunDir); 
                } else { 
                    camera.getWorldPosition(p); 
                } 
            } 
            
            if (!dir) { camera.getWorldDirection(d); }
            
            // Tracer Effect
            if (!sharedMats) initSharedMaterials();
            const tracerGeo = isSniper ? sharedMats.tracerHighGeo : sharedMats.tracerLowGeo;
            const tracerMat = isSniper ? sharedMats.tracerSniperMat : sharedMats.tracerRifleMat;
            const tracer = new THREE.Mesh(tracerGeo, tracerMat);
            tracer.rotation.x = Math.PI / 2;
            b.add(tracer);

            const backPos = p.clone().sub(d.clone().multiplyScalar(1.0)); 
            b.position.copy(p); 
            b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), d);
            b.userData = { velocity: d.multiplyScalar(isSniper ? 6.5 : 4.5), life: 300, lastPos: backPos, isRemote: isRemote, weaponType: wpnType }; 
            scene.add(b); 
            bullets.push(b);
        }
        

        function createBloodEffect(point, bounceDir) {
            const particleCount = 8; 
            const group = new THREE.Group(); 
            group.position.copy(point); 
            group.position.add(bounceDir.clone().multiplyScalar(0.1)); 
            scene.add(group);
            
            const particles = []; 
            const mat = new THREE.MeshBasicMaterial({ color: 0x990000, transparent: true, opacity: 1 }); 
            const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
            
            for (let i = 0; i < particleCount; i++) { 
                const p = new THREE.Mesh(geo, mat); 
                const dir = bounceDir.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2)).normalize().multiplyScalar(Math.random() * 0.15 + 0.05); 
                group.add(p); 
                particles.push({ mesh: p, velocity: dir }); 
            }
            
            let frames = 0; 
            const maxFrames = 15; 
            const interval = setInterval(() => { 
                frames++; 
                mat.opacity = 1 - (frames / maxFrames); 
                particles.forEach(p => { 
                    p.velocity.y -= 0.01; 
                    p.mesh.position.add(p.velocity); 
                    p.mesh.scale.multiplyScalar(0.9); 
                }); 
                if (frames >= maxFrames) { 
                    clearInterval(interval); 
                    const idx = activeEffectIntervals.indexOf(interval);
                    if (idx > -1) activeEffectIntervals.splice(idx, 1);
                    scene.remove(group); 
                    mat.dispose(); 
                    geo.dispose(); 
                } 
            }, 30);
            activeEffectIntervals.push(interval);
        }

        function createImpactEffect(point, bounceDir) {
            const particleCount = 10; 
            const group = new THREE.Group(); 
            group.position.copy(point); 
            group.position.add(bounceDir.clone().multiplyScalar(0.05)); 
            scene.add(group);
            
            const particles = []; 
            const mat = new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 1 }); 
            const geo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
            
            for (let i = 0; i < particleCount; i++) { 
                const p = new THREE.Mesh(geo, mat); 
                const dir = bounceDir.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5)).normalize().multiplyScalar(Math.random() * 0.15 + 0.1); 
                group.add(p); 
                particles.push({ mesh: p, velocity: dir }); 
            }
            
            let frames = 0; 
            const maxFrames = 12; 
            const interval = setInterval(() => { 
                frames++; 
                mat.opacity = 1 - (frames / maxFrames); 
                particles.forEach(p => { 
                    p.mesh.position.add(p.velocity); 
                    p.mesh.scale.multiplyScalar(0.85); 
                }); 
                if (frames >= maxFrames) { 
                    clearInterval(interval); 
                    const idx = activeEffectIntervals.indexOf(interval);
                    if (idx > -1) activeEffectIntervals.splice(idx, 1);
                    scene.remove(group); 
                    mat.dispose(); 
                    geo.dispose(); 
                } 
            }, 30);
            activeEffectIntervals.push(interval);
        }

        function updateBullets() {
            let active = 0; 
            enemies.forEach(e => { if (!e.userData.dead) active++; });
            
            if (!isMultiplayerMode && enemies.length > 0 && active === 0 && isPlaying) { 
                nextLevel(); 
                return; 
            }
            
            for (let i = bullets.length - 1; i >= 0; i--) {
                const b = bullets[i]; 
                const pp = b.userData.lastPos ? b.userData.lastPos.clone() : b.position.clone(); 
                b.userData.lastPos = b.position.clone(); 
                b.position.add(b.userData.velocity); 
                b.userData.life--;
                
                let hit = false; 
                const d = b.position.distanceTo(pp); 
                const dir = b.userData.velocity.clone().normalize(); 
                bulletRaycaster.set(pp, dir); 
                bulletRaycaster.far = d;
                
                if (isMultiplayerMode && !isCoopMode) {
                    const targets = [];
            for (const key in remotePlayers) {
                if (remotePlayers[key].mesh) targets.push(remotePlayers[key].mesh);
            } 
                    const hits = bulletRaycaster.intersectObjects(targets, true);
                    if (hits.length > 0) {
                        let o = hits[0].object; 
                        while (o.parent && !o.userData.id) o = o.parent;
                        if (o.userData && o.userData.id) { 
                            if (remotePlayers[o.userData.id] && remotePlayers[o.userData.id].invincible) { hit = true; }
                            else {
                                hit = true; 
                                triggerHitMarker(); 
                                createBloodEffect(hits[0].point, b.userData.velocity.clone().multiplyScalar(-1).normalize());
                                const targetId = o.userData.id; 
                                const dmg = b.userData.weaponType === 1 ? 70 : 10; 
                                runTransaction(ref(db, `${roomPath}/players/${targetId}/hp`), (hp) => { 
                                    if (hp === null) return 100; 
                                    if (hp > 0) { let newHp = hp - dmg; return newHp <= 0 ? 0 : newHp; } 
                                    return 0; 
                                }).then((result) => { 
                                    if (result.committed && result.snapshot.val() === 0) { 
                                        if (!isCoopMode) registerKill(); 
                                    } 
                                }).catch(() => {});
                            }
                        }
                    }
                }
                
                if (!hit) {
                    // FIX LAG 1: Filtra apenas os bots VIVOS. Ignorar cadáveres poupa milhares de cálculos ao Android!
                    const aliveEnemies = enemies.filter(e => !e.userData.dead);
                    const hits = bulletRaycaster.intersectObjects(aliveEnemies, true); 
                    
                    let volumeHit = null;
                    if (b.userData.life > 295) { 
                        for (let e of aliveEnemies) { 
                            const dist = b.position.distanceTo(e.position); 
                            if (dist < 1.5) { volumeHit = e; break; } 
                        } 
                    }
                    
                    if (hits.length > 0 || volumeHit) {
                        let o = volumeHit; 
                        if (!o) { 
                            let hitObj = hits[0].object; o = hitObj; 
                            while (o && o.parent && !o.userData.isEnemyRoot) o = o.parent; 
                        }
                        
                        if (o && o.userData && o.userData.isEnemyRoot && !o.userData.dead) {
                            const dmg = b.userData.weaponType === 1 ? 100 : 15; 
                            hit = true; 
                            triggerHitMarker();
                            const hitPoint = (hits.length > 0 && hits[0].point) ? hits[0].point : b.position.clone(); 
                            createBloodEffect(hitPoint, b.userData.velocity.clone().multiplyScalar(-1).normalize());
                            
                            if (isMultiplayerMode) { 
                                runTransaction(ref(db, `${roomPath}/state/enemies/${o.userData.index}`), (ed) => { 
                                    if (ed && !ed.dead) { ed.hp -= dmg; if (ed.hp <= 0) { ed.hp = 0; ed.dead = true; } } 
                                    return ed; 
                                }).then((res) => { 
                                    const val = res.snapshot.val(); 
                                    if (res.committed && val && val.dead && !o.userData.dead) { 
                                        killEnemyLocal(o, { dbUpdate: false, isMultiplayerMode, isCoopMode, registerKill, registerTeamKill, db, roomPath }); 
                                        if (isCoopMode) registerTeamKill(); 
                                        else registerKill(); 
                                    } 
                                }).catch(() => {}); 
                            } else { 
                                o.userData.hp -= dmg; 
                                if (o.userData.hp <= 0) killEnemyLocal(o, { dbUpdate: true, isMultiplayerMode, isCoopMode, registerKill, registerTeamKill, db, roomPath }); 
                            }
                        }
                    }
                }
                
                if (!hit) { 
                    if (envGroup) {
                        const wh = bulletRaycaster.intersectObject(envGroup, true); 
                        if (wh.length > 0) { 
                            hit = true; 
                            createImpactEffect(wh[0].point, b.userData.velocity.clone().multiplyScalar(-1).normalize()); 
                        } 
                    }
                }
                
                if (hit || b.userData.life <= 0) { 
                    bullets.splice(i, 1); 
                    scene.remove(b); 
                    // PERFORMANCE: Recursive disposal to clean up tracers and nested meshes
                    b.traverse(node => {
                        if (node.isMesh) {
                            if (node.geometry) node.geometry.dispose();
                            if (node.material) {
                                if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
                                else node.material.dispose();
                            }
                        }
                    });
                }
            }
        }


        let activeDragEl = null;
        let dragOffset = { x: 0, y: 0 };

        function setupHUDDrag() { 
            const ids = ['fire-btn', 'jump-btn', 'aim-btn', 'swap-btn', 'grenade-btn', 'smoke-btn', 'joystick-zone', 'minimap-canvas', 'info-panel']; 
            
            try { 
                const saved = JSON.parse(localStorage.getItem('canaa_hud_pos')); 
                if (saved) { 
                    ids.forEach(id => { 
                        const el = document.getElementById(id); 
                        if (el && saved[id] && saved[id].left) { 
                            el.style.left = saved[id].left; 
                            el.style.top = saved[id].top; 
                            el.style.bottom = 'auto'; 
                            el.style.right = 'auto'; 
                        } 
                    }); 
                } 
            } catch(e) {} 
            
            // Re-assign pointerEvents to auto for all HUD elements to allow dragging
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.style.pointerEvents = 'auto';
                    
                    // Remove existing to prevent duplication
                    el.onmousedown = null;
                    el.ontouchstart = null;

                    el.onmousedown = (e) => {
                        if (!settings.isEditing) return;
                        activeDragEl = el;
                        const rect = el.getBoundingClientRect();
                        dragOffset.x = e.clientX - rect.left;
                        dragOffset.y = e.clientY - rect.top;
                    };
                    el.ontouchstart = (e) => {
                        if (!settings.isEditing) return;
                        activeDragEl = el;
                        const rect = el.getBoundingClientRect();
                        const touch = e.touches[0];
                        dragOffset.x = touch.clientX - rect.left;
                        dragOffset.y = touch.clientY - rect.top;
                        if (e.cancelable) e.preventDefault();
                    };
                }
            });

            // Global window listeners added only once (window.hudListenersAdded guard)
            if (!window.hudListenersAdded) {
                window.addEventListener('mousemove', (e) => {
                    if (!activeDragEl || !settings.isEditing) return;
                    activeDragEl.style.left = (e.clientX - dragOffset.x) + 'px';
                    activeDragEl.style.top = (e.clientY - dragOffset.y) + 'px';
                    activeDragEl.style.bottom = 'auto';
                    activeDragEl.style.right = 'auto';
                });
                window.addEventListener('touchmove', (e) => {
                    if (!activeDragEl || !settings.isEditing) return;
                    const touch = e.touches[0];
                    activeDragEl.style.left = (touch.clientX - dragOffset.x) + 'px';
                    activeDragEl.style.top = (touch.clientY - dragOffset.y) + 'px';
                    activeDragEl.style.bottom = 'auto';
                    activeDragEl.style.right = 'auto';
                    if (e.cancelable) e.preventDefault();
                }, { passive: false });
                window.addEventListener('mouseup', () => { activeDragEl = null; });
                window.addEventListener('touchend', () => { activeDragEl = null; });
                window.hudListenersAdded = true;
            }
        }

        function animate() {
            requestAnimationFrame(animate); 
            const dt = clock.getDelta();

            if (isPlaying && !gamePaused) {
                if (isPC) { 
                    moveInput.x = (keyState.a ? -1 : 0) + (keyState.d ? 1 : 0); 
                    moveInput.y = (keyState.w ? -1 : 0) + (keyState.s ? 1 : 0); 
                }
                
                playerGroup.rotation.y = yaw;
                camera.rotation.x = pitch; 
                
                if (Math.abs(moveInput.x) > 0.1 || Math.abs(moveInput.y) > 0.1 || keyState.w || keyState.s || keyState.a || keyState.d) { 
                    walkCycle += 0.2; 
                } else {
                    walkCycle = 0;
                }
                
                const lerpSpeed = Math.min(1.0, dt * 14.0);

                for (const key in remotePlayers) {
                    const r = remotePlayers[key];
                    const m = r.mesh; 
                    if (!m) continue;
                    _v1.copy(m.position); 
                    m.position.lerp(r.targetPos, lerpSpeed); 
                    const distMoved = _v1.distanceTo(m.position);
                    
                    let rd = r.targetRot - m.rotation.y; 
                    while (rd > Math.PI) rd -= Math.PI * 2; 
                    while (rd < -Math.PI) rd += Math.PI * 2; 
                    m.rotation.y += rd * lerpSpeed; 
                    
                    m.traverse(child => { 
                        if (child.isMesh && child.material) { 
                            child.material.transparent = true; 
                            child.material.opacity = r.invincible ? 0.5 : 1.0; 
                            if (child.material.emissive) { 
                                if (r.invincible) child.material.emissive.setHex(0x00ffff); 
                                else child.material.emissive.setHex(0x000000); 
                            } 
                        } 
                    });

                    const pivots = m.userData.pivots;
                    if (pivots) {
                        const isMoving = distMoved > 0.005 || r.isMoving; 
                        const isRemoteGrounded = r.isGrounded !== false;
                        
                        if (isMoving && isRemoteGrounded) { 
                            m.userData.walkCycle = (m.userData.walkCycle || 0) + 0.3; 
                        } else if (!isMoving) { 
                            m.userData.walkCycle = 0; 
                        }
                        
                        const wc = m.userData.walkCycle || 0;
                        if (pivots.head) pivots.head.rotation.x = r.targetPitch; 
                        const remotePitch = (Math.PI / 2) + r.targetPitch; 
                        const armSwing = (isMoving && isRemoteGrounded) ? Math.sin(wc) * 0.4 : 0;
                        
                        if (pivots.rArm) pivots.rArm.rotation.x = remotePitch - armSwing; 
                        if (pivots.lArm) pivots.lArm.rotation.x = remotePitch + armSwing;
                        
                        if (!isRemoteGrounded) { 
                            if (pivots.lLeg) pivots.lLeg.rotation.x = 1.6; 
                            if (pivots.lCanela) pivots.lCanela.rotation.x = -1.8; 
                            if (pivots.rLeg) pivots.rLeg.rotation.x = 0.2; 
                            if (pivots.rCanela) pivots.rCanela.rotation.x = -0.1; 
                        } else {
                            const baseCrouch = 0.15; 
                            const baseKnee = -0.3; 
                            if (!isMoving) { 
                                if (pivots.lLeg) pivots.lLeg.rotation.set(0.1, 0, 0); 
                                if (pivots.rLeg) pivots.rLeg.rotation.set(0.1, 0, 0); 
                                if (pivots.lCanela) pivots.lCanela.rotation.x = -0.1; 
                                if (pivots.rCanela) pivots.rCanela.rotation.x = -0.1; 
                            } else { 
                                const swingPhase = Math.cos(wc); 
                                const liftL = Math.max(0, swingPhase); 
                                const liftR = Math.max(0, -swingPhase); 
                                const kneeL = liftL * 0.9; 
                                const kneeR = liftR * 0.9; 
                                const legSwing = Math.sin(wc) * 0.6; 
                                if (pivots.lLeg) { pivots.lLeg.rotation.z = 0; pivots.lLeg.rotation.x = baseCrouch + legSwing; } 
                                if (pivots.rLeg) { pivots.rLeg.rotation.z = 0; pivots.rLeg.rotation.x = baseCrouch - legSwing; } 
                                if (pivots.lCanela) pivots.lCanela.rotation.x = baseKnee - kneeL; 
                                if (pivots.rCanela) pivots.rCanela.rotation.x = baseKnee - kneeR; 
                            }
                        }
                    }
                }

                const ch = document.getElementById('crosshair'); 
                const scope = document.getElementById('sniper-scope');
                if (isAiming && currentWeapon === 1) { 
                    if (scope) scope.style.display = 'block'; 
                    if (ch) ch.style.display = 'none'; 
                } else { 
                    if (scope) scope.style.display = 'none'; 
                    if (ch) { ch.style.display = 'block'; ch.style.opacity = '0.9'; } 
                }

                recoilAngle = THREE.MathUtils.lerp(recoilAngle, 0, 0.15); 
                fovKick = THREE.MathUtils.lerp(fovKick, 0, 0.4); 
                gunRecoil = THREE.MathUtils.lerp(gunRecoil, 0, 0.2);
                
                const activeAimFOV = currentWeapon === 1 ? 15 : config.aimFOV; 
                const targetFOV = isAiming ? activeAimFOV : settings.fov;
                camera.fov = targetFOV - fovKick; 
                camera.updateProjectionMatrix();

                if (scene.fog) { 
                    const targetFog = (isAiming && currentWeapon === 1) ? 0.01 : 0.045; 
                    scene.fog.density = THREE.MathUtils.lerp(scene.fog.density, targetFog, 0.1); 
                }

                let wallRetract = 0;
                if (!isThirdPerson) { 
                    camera.getWorldDirection(_vDir); 
                    aimRaycaster.set(camera.position, _vDir); 
                    const intersects = aimRaycaster.intersectObjects(walls); 
                    if (intersects.length > 0) { 
                        const dist = intersects[0].distance; 
                        if (dist < 1.0) wallRetract = (1.0 - dist) * 0.6; 
                    } 
                }

                if (playerMeshParts) { 
                    if (playerMesh) playerMesh.traverse(m => { 
                        if (m.isMesh && m.material) { 
                            m.material.transparent = true; 
                            m.material.opacity = isInvincible ? 0.5 : 1.0; 
                            if (m.material.emissive) { 
                                if (isInvincible) m.material.emissive.setHex(0x00ffff); 
                                else m.material.emissive.setHex(0x000000); 
                            } 
                        } 
                    });
                    
                    if (window.playerBodyMeshes) { 
                        window.playerBodyMeshes.forEach(m => m.visible = isThirdPerson); 
                    }
                    
                    if (!isGrounded) { 
                        playerMeshParts.lLegPivot.rotation.x = 1.6; 
                        playerMeshParts.lCanelaPivot.rotation.x = -1.8; 
                        playerMeshParts.rLegPivot.rotation.x = 0.2; 
                        playerMeshParts.rCanelaPivot.rotation.x = -0.1; 
                    } else {
                        const baseCrouch = 0.15; 
                        const baseKnee = -0.3; 
                        const isMoving = (Math.abs(moveInput.x) > 0.1 || Math.abs(moveInput.y) > 0.1);
                        
                        if (!isMoving) { 
                            playerMeshParts.lLegPivot.rotation.set(0.1, 0, 0); 
                            playerMeshParts.rLegPivot.rotation.set(0.1, 0, 0); 
                            playerMeshParts.lCanelaPivot.rotation.x = -0.1; 
                            playerMeshParts.rCanelaPivot.rotation.x = -0.1; 
                            playerMesh.position.y = 0.95; 
                        } else { 
                            const swingPhase = Math.cos(walkCycle); 
                            const liftL = Math.max(0, swingPhase); 
                            const liftR = Math.max(0, -swingPhase); 
                            const kneeL = liftL * 0.9; 
                            const kneeR = liftR * 0.9; 
                            const legSwing = Math.sin(walkCycle) * 0.5; 
                            
                            playerMeshParts.lLegPivot.rotation.z = 0; 
                            playerMeshParts.rLegPivot.rotation.z = 0; 
                            playerMeshParts.lLegPivot.rotation.x = baseCrouch + legSwing; 
                            playerMeshParts.rLegPivot.rotation.x = baseCrouch - legSwing; 
                            playerMeshParts.lCanelaPivot.rotation.x = baseKnee - kneeL; 
                            playerMeshParts.rCanelaPivot.rotation.x = baseKnee - kneeR; 
                            
                            playerMesh.position.y = 0.95 + Math.abs(Math.cos(walkCycle)) * 0.04; 
                            if (playerMeshParts.torso) playerMeshParts.torso.rotation.y = Math.sin(walkCycle) * 0.1; 
                        }
                    }
                    
                    const currentPitch = (Math.PI / 2) + pitch + recoilAngle;
                    
                    if (!isThirdPerson) {
                        const swayY = Math.sin(walkCycle * 2) * 0.03; 
                        const kickY = recoilAngle * 0.1; 
                        const kickZ = recoilAngle * 0.1;
                        
                        playerMeshParts.rArmPivot.rotation.set(currentPitch, 0, 0); 
                        playerMeshParts.lArmPivot.rotation.set(currentPitch, 0, 0);
                        _v1.set(0.25, 0.65 - swayY + kickY, 0.1 + kickZ + wallRetract + gunRecoil);
                        playerMeshParts.rArmPivot.position.lerp(_v1, 0.3); 
                        _v2.set(-0.25, 0.65 - swayY + kickY, 0.12 + kickZ + wallRetract + gunRecoil);
                        playerMeshParts.lArmPivot.position.lerp(_v2, 0.3); 
                        playerMeshParts.rElbow.rotation.set(0.2, 0, 0); 
                        playerMeshParts.lElbow.rotation.set(0.2, 0, 0);
                    } else {
                        playerMeshParts.rArmPivot.rotation.x = THREE.MathUtils.lerp(playerMeshParts.rArmPivot.rotation.x, currentPitch, 0.2); 
                        playerMeshParts.lArmPivot.rotation.x = THREE.MathUtils.lerp(playerMeshParts.lArmPivot.rotation.x, currentPitch, 0.2);
                        playerMeshParts.lArmPivot.rotation.z = THREE.MathUtils.lerp(playerMeshParts.lArmPivot.rotation.z, 0.5, 0.2); 
                        playerMeshParts.rArmPivot.rotation.z = THREE.MathUtils.lerp(playerMeshParts.rArmPivot.rotation.z, 0, 0.1);
                        playerMeshParts.rArmPivot.position.set(0.22, 0.7, 0); 
                        playerMeshParts.lArmPivot.position.set(-0.22, 0.7, 0);
                    }
                    
                    if (head) head.rotation.x = pitch;
                }
                
                if (isThirdPerson) {
                    const ay = yaw; 
                    const shoulderHeight = 2.0; 
                    const shoulderRight = 0.8; 
                    const camDist = 2.5; 
                    
                    _v1.set(shoulderRight, shoulderHeight, camDist); 
                    _v1.applyAxisAngle(_vUp, yaw); 
                    _v2.copy(playerGroup.position).add(_v1);
                    camera.position.lerp(_v2, 0.15);
                    
                    _v3.set(0, shoulderHeight - 0.8, -10);
                    _v3.applyAxisAngle(_vUp, yaw);
                    _v4.copy(playerGroup.position).add(_v3);
                    _v5.set(0, pitch * 5, 0);
                    camera.lookAt(_v4.add(_v5));
                    
                    if (camera.position.y < playerGroup.position.y + shoulderHeight) camera.position.y = playerGroup.position.y + shoulderHeight;
                } else {
                    _v1.set(0, 1.65, 0);
                    _v1.applyAxisAngle(_vUp, yaw);
                    camera.position.copy(playerGroup.position).add(_v1);
                    camera.rotation.set(pitch + recoilAngle * 0.5, yaw, 0);
                }

                if (shakeTime > 0) {
                    camera.position.x += (Math.random() - 0.5) * shakeIntensity;
                    camera.position.y += (Math.random() - 0.5) * shakeIntensity;
                    camera.position.z += (Math.random() - 0.5) * shakeIntensity;
                    shakeTime--;
                    shakeIntensity *= 0.9; 
                }
                
                const speed = 0.18; 
                _v1.copy(_vFwd).applyAxisAngle(_vUp, yaw); 
                _v2.copy(_vRgt).applyAxisAngle(_vUp, yaw);
                const mx = (_v1.x * -moveInput.y + _v2.x * moveInput.x) * speed; 
                const mz = (_v1.z * -moveInput.y + _v2.z * moveInput.x) * speed;
                
                if ((moveInput.x !== 0 || moveInput.y !== 0) && isGrounded && performance.now() - lastStepTime > 350) { 
                    playSound('step', settings); 
                    lastStepTime = performance.now(); 
                }

                if (!checkWall(playerGroup.position.x + mx, playerGroup.position.z, playerGroup.position.x, playerGroup.position.z, playerGroup.position.y)) playerGroup.position.x += mx;
                if (!checkWall(playerGroup.position.x, playerGroup.position.z + mz, playerGroup.position.x, playerGroup.position.z, playerGroup.position.y)) playerGroup.position.z += mz;
                
                let groundY = 0; 
                const playerRadius = 0.3; 
                
                // Reuse _v1 to _v5 for ray origins to avoid .clone() and new Vector3
                _v1.copy(playerGroup.position);
                _v2.copy(playerGroup.position).add(_v3.set(playerRadius, 0, 0));
                _v4.copy(playerGroup.position).add(_v3.set(-playerRadius, 0, 0));
                _v5.copy(playerGroup.position).add(_v3.set(0, 0, playerRadius));
                _vDir.copy(playerGroup.position).add(_v3.set(0, 0, -playerRadius));
                
                const raySources = [_v1, _v2, _v4, _v5, _vDir];
                
                for(let i = 0; i < 5; i++) {
                    const ro = raySources[i];
                    ro.y += 2; 
                    aimRaycaster.set(ro, _vDown);
                    aimRaycaster.far = 10;
                    const rampHits = aimRaycaster.intersectObjects([...ramps, ...walls], false); 
                    if (rampHits.length > 0) { 
                        if (rampHits[0].point.y > groundY) { 
                            groundY = rampHits[0].point.y; 
                        } 
                    } 
                }
                
                if (isGrounded && playerGroup.position.y > groundY + 0.1) isGrounded = false;
                if (!isGrounded) velocityY -= GRAVITY;
                playerGroup.position.y += velocityY;
                if (playerGroup.position.y <= groundY + 0.05) { playerGroup.position.y = groundY + 0.05; velocityY = 0; isGrounded = true; }

                processShooting(); 
                if (!envStaticNodes) envStaticNodes = [...ramps, ...walls];
                updateEnemies(dt, { 
                    enemies, isMultiplayerMode, isCoopMode, isMasterClient, roomPath, db, 
                    settings, playerGroup, remotePlayers, currentLevel, levelStartTime, 
                    envNodes: envStaticNodes, checkWall, applyDamage, camera, scene, runTransaction
                }); 
                updateHealthKits();
                updateArmorVests(); 
                updateGrenadePacks(); 
                drawMinimap({ 
                    isMultiplayerMode, isCoopMode, mazeMap, healthKits, armorVests, 
                    remotePlayers, enemies, playerGroup 
                });
                updateBullets(); 
                updateGrenades(); 

            } else if (!gamePaused && playerGroup) { 
                const t = Date.now() * 0.0005; 
                playerGroup.position.set(5, 0, 5); 
                playerGroup.rotation.y = Math.PI - 0.5; 
                
                camera.position.set( 5 + Math.cos(t * 0.5) * 2.5, 1.7, 5 + Math.sin(t * 0.5) * 2.5 ); 
                camera.lookAt(5, 1.45, 5); 
                
                if(playerMeshParts && playerMeshParts.rArmPivot) { 
                    playerMeshParts.rArmPivot.rotation.x = 1.2; 
                    playerMeshParts.lArmPivot.rotation.x = 1.2; 
                    playerGroup.scale.y = 1 + Math.sin(t * 4) * 0.005; 
                }
            }
            if (scene && camera && renderer) renderer.render(scene, camera);
        }

        function init() {
            // Debug detection
            console.log("Canaan Detection: isPC =", isPC, "isMobileDevice =", isMobileDevice(), "UA =", navigator.userAgent);
            
            initWorld(settings, onResize);
            startGameLogic();
            
            function startGameLogic() { 
                if (window.gameInitialized) return; 
                window.gameInitialized = true; 
                initSharedMaterials(); // FIX LAG: Garante recursos partilhados para não sobrecarregar
                createWorld(currentLevel, activeTextures, isMultiplayerMode, isCoopMode); 
                envStaticNodes = [...ramps, ...walls];
                createPlayer(); 
                spawnHealthKits(6); 
                spawnArmorVests(); 
                spawnGrenadePacks(); 
                setupMinimap(); 
                setupUI(); 
                setupHUDDrag(); 
            }
            

            
            document.getElementById('main-menu').style.display = 'none'; 
            document.getElementById('lobby-screen').style.display = 'none'; 
            document.getElementById('game-over-screen').style.display = 'none';
            
            const startOverlay = document.getElementById('start-screen-overlay'); 
            startOverlay.style.display = 'flex';
            
            const unlockAndStart = (e) => { 
                goFullscreen(); 
                startOverlay.style.display = 'none'; 
                document.getElementById('main-menu').style.display = 'block'; 
                
                initAudio(); 
                resumeAudio(); 
                
                playMenuMusic(); 
                startOverlay.removeEventListener('click', unlockAndStart); 
            };
            
            startOverlay.addEventListener('click', unlockAndStart); 
            window.addEventListener('resize', onResize); 
            animate();
        }

        function applyDamage(amount) {
            if (isInvincible) return; 
            let damage = amount; 
            
            if (playerArmor > 0) { 
                const absorb = damage * 0.5; 
                const remaining = damage - absorb; 
                playerArmor = Math.max(0, playerArmor - absorb); 
                damage = remaining; 
            }
            
            playerHP -= damage; 
            
            const hpEl = document.getElementById('hp'); 
            if (hpEl) hpEl.innerText = Math.ceil(playerHP); 
            
            const hpBar = document.getElementById('hp-bar'); 
            if (hpBar) hpBar.style.width = Math.max(0, playerHP) + "%"; 
            
            const armorBar = document.getElementById('armor-bar'); 
            if (armorBar) armorBar.style.width = Math.max(0, playerArmor) + "%"; 
            
            const armorEl = document.getElementById('armor'); 
            if (armorEl) armorEl.innerText = Math.ceil(playerArmor);
            
            const o = document.getElementById('damage-overlay'); 
            if (o) { 
                o.style.boxShadow = "inset 0 0 50px 20px rgba(255,0,0,0.5)"; 
                setTimeout(() => o.style.boxShadow = "none", 200); 
            }
            triggerShake(0.4); 
            
            if (myRef) update(myRef, { hp: playerHP, armor: playerArmor }); 
            if (playerHP <= 0) { 
                if (isCoopMode) respawnPvP(); 
                else showGameOver(); 
            }
        }

        function spawnArmorVests() { 
            armorVests.forEach(k => clearSceneObject(scene, k)); 
            armorVests = []; 
            const rng = mulberry32(currentLevel + 222); 
            
            for (let i = 0; i < 4; i++) { 
                let rx, rz; 
                do { 
                    rx = Math.floor(rng() * mazeSize); 
                    rz = Math.floor(rng() * mazeSize); 
                } while (mazeMap[rz][rx] === 1); 
                
                const k = new THREE.Mesh(
                    new THREE.BoxGeometry(0.8, 0.2, 0.8), 
                    new THREE.MeshStandardMaterial({ color: 0x0088FF, emissive: 0x002288 })
                ); 
                k.position.set(rx * 5, 0.5, rz * 5); 
                k.userData = { active: true }; 
                scene.add(k); 
                armorVests.push(k); 
            } 
        }

        function spawnGrenadePacks() { 
            grenadePacks.forEach(k => clearSceneObject(scene, k)); 
            grenadePacks = []; 
            
            const internalWalls = walls.filter(w => { 
                const px = w.position.x; 
                const pz = w.position.z; 
                return px > 5 && px < 90 && pz > 5 && pz < 90 && w.geometry && w.geometry.parameters && w.geometry.parameters.height === 6; 
            }); 
            
            const rng = mulberry32(currentLevel + 555); 
            let shuffledWalls = [...internalWalls]; 
            
            for (let i = shuffledWalls.length - 1; i > 0; i--) { 
                const j = Math.floor(rng() * (i + 1)); 
                [shuffledWalls[i], shuffledWalls[j]] = [shuffledWalls[j], shuffledWalls[i]]; 
            } 
            
            const selectedWalls = shuffledWalls.slice(0, Math.min(12, shuffledWalls.length)); 
            
            selectedWalls.forEach((w) => { 
                const k = new THREE.Mesh(
                    new THREE.BoxGeometry(0.6, 0.4, 0.4), 
                    new THREE.MeshStandardMaterial({ color: 0x556B2F, emissive: 0x223311 })
                ); 
                k.position.set(w.position.x, 6.2, w.position.z); 
                k.userData = { active: true }; 
                scene.add(k); 
                grenadePacks.push(k); 
            }); 
        }
        
        function updateGrenadePacks() { 
            grenadePacks.forEach((k) => { 
                if (!k.userData.active || playerGroup.position.distanceTo(k.position) >= 2.5) return; 
                playSound('heal', settings); 
                grenades.explosive += 5; 
                grenades.smoke += 5; 
                updateGrenadeUI(grenades); 
                clearSceneObject(scene, k); 
                k.userData.active = false; 
            }); 
        }

        function spawnHealthKits(count) {
            healthKits.forEach(k => clearSceneObject(scene, k)); 
            healthKits = []; 
            const rng = mulberry32(currentLevel + 999); 
            const kitsData = {};
            
            for (let i = 0; i < count; i++) { 
                let rx, rz; 
                const isPVP = isMultiplayerMode && !isCoopMode; 
                const isOpen = isPVP; 
                do { 
                    rx = Math.floor(rng() * mazeSize); 
                    rz = Math.floor(rng() * mazeSize); 
                } while (isOpen ? 
                    (rx === 0 || rx === mazeSize-1 || rz === 0 || rz === mazeSize-1 || (rx === 7 && rz === 7) || (rx === 12 && rz === 12)) : 
                    mazeMap[rz][rx] === 1); 
                
                const k = new THREE.Mesh(
                    new THREE.BoxGeometry(0.8, 0.8, 0.8), 
                    new THREE.MeshStandardMaterial({ color: 0x00FF41, emissive: 0x004400 })
                ); 
                k.position.set(rx * 5, 0.5, rz * 5); 
                k.userData = { index: i, taken: false }; 
                scene.add(k); 
                healthKits.push(k); 
                kitsData[i] = { x: rx * 5, z: rz * 5, taken: false }; 
            }
            
            if (isCoopMode && isMasterClient) { 
                update(ref(db, `${roomPath}/state/kits`), kitsData); 
            }
        }

        function updateHealthKits() { 
            healthKits.forEach((k, i) => { 
                if (k.userData.taken || playerGroup.position.distanceTo(k.position) >= 1.5 || playerHP >= 100) return; 
                playSound('heal', settings); 
                playerHP = Math.min(100, playerHP + 25); 
                
                const hpEl = document.getElementById('hp'); 
                if (hpEl) hpEl.innerText = playerHP; 
                const hpBar = document.getElementById('hp-bar'); 
                if (hpBar) hpBar.style.width = playerHP + "%"; 

                if (myRef) update(myRef, { hp: playerHP }).catch(() => {}); 

                if (isCoopMode) { 
                    update(ref(db, `${roomPath}/state/kits/${k.userData.index}`), { taken: true }).catch(() => {}); 
                } 

                clearSceneObject(scene, k); 
                k.userData.taken = true; 
            }); 
        }

        function updateArmorVests() { 
            armorVests.forEach((k) => { 
                if (!k.userData.active || playerGroup.position.distanceTo(k.position) >= 1.5 || playerArmor >= 100) return; 
                playSound('heal', settings); 
                playerArmor = Math.min(100, playerArmor + 50); 
                const armorBar = document.getElementById('armor-bar'); 
                if (armorBar) armorBar.style.width = playerArmor + "%"; 
                const armorEl = document.getElementById('armor'); 
                if (armorEl) armorEl.innerText = playerArmor; 
                if (myRef) update(myRef, { armor: playerArmor }).catch(() => {}); 
                clearSceneObject(scene, k); 
                k.userData.active = false; 
            }); 
        }

        function throwGrenade(type, chargeRatio = 0.5) {
            if (grenades[type] <= 0) return; 
            grenades[type]--; 
            updateGrenadeUI(grenades);
            
            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(0.2, 8, 8), 
                new THREE.MeshStandardMaterial({ color: type === 'explosive' ? 0x222200 : 0xaaaaaa })
            );
            
            const startPos = playerGroup.position.clone(); 
            startPos.y += 1.5; 
            
            const dir = new THREE.Vector3(0, 0, -1); 
            dir.applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch); 
            dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw); 
            
            sphere.position.copy(startPos); 
            scene.add(sphere);
            
            const force = 0.3 + (chargeRatio * 0.9); 
            const velocity = dir.multiplyScalar(force); 
            activeGrenades.push({ mesh: sphere, velocity: velocity.clone(), type: type, life: 120 });
            
            if (isMultiplayerMode) { 
                const gId = myUserId + '_' + Date.now(); 
                set(ref(db, `${roomPath}/grenades/${gId}`), { 
                    type: type, x: startPos.x, y: startPos.y, z: startPos.z, 
                    vx: velocity.x, vy: velocity.y, vz: velocity.z 
                }); 
                setTimeout(() => { remove(ref(db, `${roomPath}/grenades/${gId}`)); }, 3000); 
            }
        }

        function executeGrenadeThrow() { 
            if (!isChargingGrenade) return; 
            const holdTime = performance.now() - grenadeChargeStartTime; 
            let chargeRatio = holdTime / 1000; 
            if (chargeRatio > 1.0) chargeRatio = 1.0; 
            throwGrenade(chargingGrenadeType, chargeRatio); 
        }

        function updateGrenades() {
            for (let i = activeGrenades.length - 1; i >= 0; i--) {
                const g = activeGrenades[i]; 
                g.life--; 
                const oldPos = g.mesh.position.clone(); 
                g.velocity.y -= 0.02; 
                g.mesh.position.add(g.velocity);
                
                const dir = g.mesh.position.clone().sub(oldPos); 
                const dist = dir.length();
                
                if (dist > 0) { 
                    bulletRaycaster.set(oldPos, dir.normalize()); 
                    bulletRaycaster.far = dist; 
                    const hits = bulletRaycaster.intersectObjects([...walls, ...ramps], true); 
                    
                    if (hits.length > 0) { 
                        const hit = hits[0]; 
                        g.mesh.position.copy(hit.point).add(hit.normal.clone().multiplyScalar(0.05)); 
                        if (hit.normal) { 
                            g.velocity.reflect(hit.normal).multiplyScalar(0.5); 
                        } else { 
                            g.velocity.x *= -0.5; 
                            g.velocity.z *= -0.5; 
                        } 
                    } 
                }
                
                if (g.mesh.position.y < 0.2) { 
                    g.mesh.position.y = 0.2; 
                    g.velocity.y *= -0.5; 
                    g.velocity.x *= 0.8; 
                    g.velocity.z *= 0.8; 
                }
                
                if (g.life <= 0) { 
                    explodeGrenade(g); 
                    clearSceneObject(scene, g.mesh); 
                    activeGrenades.splice(i, 1); 
                }
            }
        }

        function explodeGrenade(g) {
            const isExp = g.type === 'explosive'; 
            const effectGroup = new THREE.Group(); 
            effectGroup.position.copy(g.mesh.position); 
            scene.add(effectGroup);
            
            if (isExp) {
                const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 }); 
                const flashMesh = new THREE.Mesh(new THREE.SphereGeometry(2, 16, 16), flashMat); 
                effectGroup.add(flashMesh);
                
                const cloudCount = 5; 
                const clouds = []; 
                const cloudGeo = new THREE.SphereGeometry(1, 8, 8); 
                
                for(let i=0; i < cloudCount; i++) { 
                    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 }); 
                    const mesh = new THREE.Mesh(cloudGeo, mat); 
                    mesh.position.set(
                        (Math.random() - 0.5) * 1.5, 
                        (Math.random() - 0.5) * 1.5, 
                        (Math.random() - 0.5) * 1.5
                    ); 
                    mesh.scale.setScalar(0.5 + Math.random() * 0.5); 
                    const expSpeed = 1.2 + Math.random() * 0.8; 
                    effectGroup.add(mesh); 
                    clouds.push({ mesh, mat, expSpeed, life: 0, maxLife: 20 + Math.random() * 15 }); 
                }
                
                const debrisCount = 20; 
                const debrisList = []; 
                const dGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1); 
                
                for(let i=0; i < debrisCount; i++) { 
                    const isSpark = Math.random() > 0.4; 
                    const dMat = new THREE.MeshBasicMaterial({ color: isSpark ? 0xffcc00 : 0x222222, transparent: true, opacity: 1 }); 
                    const dMesh = new THREE.Mesh(dGeo, dMat); 
                    const u = Math.random(); 
                    const v = Math.random(); 
                    const theta = 2 * Math.PI * u; 
                    const phi = Math.acos(2 * v - 1); 
                    const dir = new THREE.Vector3(
                        Math.sin(phi) * Math.cos(theta), 
                        Math.sin(phi) * Math.sin(theta), 
                        Math.cos(phi)
                    ); 
                    const speed = Math.random() * 2.5 + 1.0; 
                    effectGroup.add(dMesh); 
                    debrisList.push({ mesh: dMesh, velocity: dir.multiplyScalar(speed), mat: dMat, isSpark }); 
                }
                
                let frames = 0; 
                const maxFrames = 45; 
                
                const interval = setInterval(() => { 
                    frames++; 
                    if (flashMat.opacity > 0) { 
                        flashMat.opacity -= 0.15; 
                        flashMesh.scale.addScalar(0.3); 
                    } else if (flashMesh.visible) { 
                        flashMesh.visible = false; 
                    } 
                    
                    clouds.forEach(c => { 
                        c.life++; 
                        if (c.life < c.maxLife) { 
                            c.mesh.scale.addScalar(0.06 * c.expSpeed * (1 - c.life/c.maxLife)); 
                            c.mesh.position.y += 0.02; 
                            if (c.life < 4) c.mat.color.setHex(0xffffff); 
                            else if (c.life < 8) c.mat.color.setHex(0xffaa00); 
                            else if (c.life < 14) c.mat.color.setHex(0xbb2200); 
                            else c.mat.color.setHex(0x222222); 
                        } 
                        if (c.life > c.maxLife * 0.5) { 
                            c.mat.opacity -= 0.04; 
                        } 
                    }); 
                    
                    debrisList.forEach(d => { 
                        d.mesh.position.add(d.velocity); 
                        d.velocity.multiplyScalar(0.88); 
                        d.velocity.y -= 0.06; 
                        d.mesh.scale.multiplyScalar(0.9); 
                        if (d.isSpark) { 
                            d.mat.opacity -= 0.05; 
                            if(frames === 5) d.mat.color.setHex(0xff3300); 
                        } else { 
                            d.mat.opacity -= 0.02; 
                        } 
                    }); 
                    
                    if (frames >= maxFrames) { 
                        clearInterval(interval); 
                        const idx = activeEffectIntervals.indexOf(interval);
                        if (idx > -1) activeEffectIntervals.splice(idx, 1);
                        scene.remove(effectGroup); 
                        clouds.forEach(c => c.mat.dispose()); 
                        debrisList.forEach(d => d.mat.dispose()); 
                        flashMat.dispose(); 
                        flashMesh.geometry.dispose(); 
                        cloudGeo.dispose(); 
                        dGeo.dispose(); 
                    } 
                }, 30);
                activeEffectIntervals.push(interval);
            } else {
                const color = 0x777777; 
                const particles = []; 
                const pCount = 8; 
                const sGeo = new THREE.SphereGeometry(1, 12, 12);
                
                for(let i = 0; i < pCount; i++) { 
                    const mat = new THREE.MeshBasicMaterial({ color: color, transparent: false, opacity: 1.0, side: THREE.DoubleSide }); 
                    const mesh = new THREE.Mesh(sGeo, mat); 
                    mesh.position.set(
                        (Math.random() - 0.5) * 1.5, 
                        (Math.random() - 0.5) * 1.0, 
                        (Math.random() - 0.5) * 1.5
                    ); 
                    mesh.scale.setScalar(0.8 + Math.random() * 0.6); 
                    effectGroup.add(mesh); 
                    particles.push(mat); 
                }
                
                let expand = 0; 
                const interval = setInterval(() => { 
                    expand++; 
                    const expandRate = 0.02; 
                    effectGroup.scale.setScalar(1 + expand * expandRate); 
                    if (expand > 190) { 
                        particles.forEach(m => { 
                            m.transparent = true; 
                            m.opacity -= 0.02; 
                        }); 
                        if (particles[0].opacity <= 0) { 
                            clearInterval(interval); 
                            const idx = activeEffectIntervals.indexOf(interval);
                            if (idx > -1) activeEffectIntervals.splice(idx, 1);
                            scene.remove(effectGroup); 
                            particles.forEach(m => m.dispose()); 
                            sGeo.dispose(); 
                        } 
                    } 
                }, 50);
                activeEffectIntervals.push(interval);
            }
            
            if (g.type === 'explosive') {
                const range = 6.5; 
                enemies.forEach(e => { 
                    if (!e.userData.dead && e.position.distanceTo(g.mesh.position) < range) { 
                        const dmg = 300; 
                        
                        if (isMultiplayerMode) {
                            runTransaction(ref(db, `${roomPath}/state/enemies/${e.userData.index}`), (ed) => { 
                                if (ed && !ed.dead) { 
                                    ed.hp -= dmg; 
                                    if (ed.hp <= 0) { ed.hp = 0; ed.dead = true; } 
                                } 
                                return ed; 
                            }).then((res) => { 
                                if (res.committed && res.snapshot.val() && res.snapshot.val().dead && !e.userData.dead) { 
                                    killEnemyLocal(e, { dbUpdate: false, isMultiplayerMode, isCoopMode, registerKill, registerTeamKill, db, roomPath }); 
                                    if (isCoopMode) registerTeamKill(); 
                                    else registerKill(); 
                                } 
                            });
                        } else {
                            e.userData.hp -= dmg; 
                            if (e.userData.hp <= 0) killEnemyLocal(e, { dbUpdate: true, isMultiplayerMode, isCoopMode, registerKill, registerTeamKill, db, roomPath }); 
                        }
                    } 
                });
                
                if (isMultiplayerMode && !isCoopMode) { 
                    Object.keys(remotePlayers).forEach(id => { 
                        const rp = remotePlayers[id]; 
                        if (rp.mesh.position.distanceTo(g.mesh.position) < range) { 
                            runTransaction(ref(db, `${roomPath}/players/${id}/hp`), (hp) => { 
                                if (hp > 0) return Math.max(0, hp - 80); 
                                return 0; 
                            }).then((result) => { 
                                if (result.committed && result.snapshot.val() === 0) registerKill(); 
                            }); 
                        } 
                    }); 
                }
                
                if (playerGroup.position.distanceTo(g.mesh.position) < range) { 
                    applyDamage(50); 
                }
                const distToPlayer = playerGroup.position.distanceTo(g.mesh.position);
                if (distToPlayer < range * 2) {
                    const shakeMult = 1.0 - (distToPlayer / (range * 2));
                    triggerShake(1.5 * shakeMult);
                }
            }
        }


        function createPlayer() {
            const char = createHumanoidMesh({
                torsoColor: 0x222222,
                vestColor: 0x2F4F2F,
                skinColor: 0xffdbac,
                bootColor: 0x111111,
                helmetColor: 0x2F4F2F
            });
            
            playerGroup = char.group;
            playerGroup.position.set(5, 0, 5);
            scene.add(playerGroup);
            
            pelvePivot = char.pelvePivot;
            playerMesh = char.pelvePivot;
            head = char.headPivot;
            rightArm = char.rForearm;
            leftArm = char.lForearm;
            
            playerMeshParts = { 
                torso: char.torso, 
                vest: char.vest, 
                lLegPivot: char.lLegPivot, 
                rLegPivot: char.rLegPivot, 
                rArmPivot: char.rArmPivot, 
                lArmPivot: char.lArmPivot, 
                rElbow: char.rElbow, 
                lElbow: char.lElbow, 
                rCanelaPivot: char.rCanelaPivot, 
                lCanelaPivot: char.lCanelaPivot,
                head: char.headPivot
            };

            // Gun logic (attached to right arm)
            gunGroup = new THREE.Group(); 
            const wMat = new THREE.MeshStandardMaterial({ color: 0x111111 }); 
            gunGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.6), wMat)); 
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4), wMat); 
            barrel.rotation.x = Math.PI / 2; 
            barrel.position.z = -0.4; 
            gunGroup.add(barrel); 
            const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.15), wMat); 
            scope.rotation.x = Math.PI / 2; 
            scope.position.y = 0.1; 
            gunGroup.add(scope); 
            const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), wMat); 
            rearSight.position.set(0, 0.12, 0.25); 
            gunGroup.add(rearSight); 
            muzzleFlashLight = new THREE.PointLight(0xffaa00, 0, 4); 
            muzzleFlashLight.position.set(0, 0, -0.6); 
            gunGroup.add(muzzleFlashLight); 
            const flash = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.01, 0.2), new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.5 })); 
            flash.rotation.x = Math.PI / 2; 
            flash.position.z = -0.6; 
            flash.visible = false; 
            flash.name = "flash"; 
            gunGroup.add(flash); 
            gunGroup.position.set(0, -0.2, 0); 
            gunGroup.rotation.x = -Math.PI / 2; 
            
            // Attached to the forearm (rElbow is parent of forearm/gun)
            char.rElbow.add(gunGroup);

            window.playerBodyMeshes = [char.torso, char.vest, char.head];

            window.playerBodyMeshes = [char.torso, char.vest, char.head];
        }

        async function resetGame(mode = 'single') {
            try {
                document.getElementById('main-menu').style.display = 'none'; 
                document.getElementById('hud').style.display = 'block'; 
                document.getElementById('crosshair').style.display = 'block'; 
                if (!isPC) document.getElementById('mobile-ui').style.display = 'block'; 
                document.getElementById('lobby-screen').style.display = 'none';
                
                isMultiplayerMode = (mode === 'multi' || mode === 'coop'); 
                isCoopMode = (mode === 'coop');
                
                const minimapCanvasEl = document.getElementById('minimap-canvas'); 
                if (minimapCanvasEl) { minimapCanvasEl.style.display = (isMultiplayerMode && !isCoopMode) ? 'none' : 'block'; }
                
                if (mode === 'single') await cleanupMp(); 
                if (mode === 'single') currentLevel = 1;
                
                spawnedLevel = -1; 
                playerHP = 100; 
                playerArmor = 0; 
                grenades = { explosive: 6, smoke: 6 }; 
                updateGrenadeUI(grenades); 
                currentWeapon = 0; 
                updateWeaponUI(currentWeapon);
                
                playerLives = 5; 
                resetInput();
                updateYawPitch(0, 0); 
                if (resetInput) resetInput(); 
                velocityY = 0; isGrounded = true; 
                camera.rotation.set(0, 0, 0);
                
                if (!isMultiplayerMode || isCoopMode) { score = 0; }
                
                const isPVP = isMultiplayerMode && !isCoopMode;
                const dispMode = isPVP ? 'none' : 'inline';
                
                ['weapon-display', 'lives-display', 'grenade-display', 'smoke-display'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = dispMode;
                });
                
                const pvpTimerDisp = document.getElementById('pvp-timer-display'); 
                if (pvpTimerDisp) pvpTimerDisp.style.display = isPVP ? 'inline' : 'none'; 
                
                const livesCount = document.getElementById('lives-count'); 
                if (livesCount) livesCount.innerText = playerLives; 
                const armorEl = document.getElementById('armor'); 
                if (armorEl) armorEl.innerText = 0; 
                
                if (mode === 'multi') { 
                    setRoomPath(`rooms/pvp/global`); 
                    if (!pvpMatchEndTime || pvpMatchEndTime < (Date.now() + serverTimeOffset)) {
                        const trueNow = Date.now() + serverTimeOffset; 
                         // Note: mpMatchEndTime is read-only from import, local logic should handle it
                    }
                    startPVPTimer(); 
                }
                if (mode === 'coop') { 
                    setRoomPath(`rooms/coop/global`); 
                    if (currentLevel === 0) currentLevel = 1; 
                }

                playGameMusic();
                const hpEl = document.getElementById('hp'); if (hpEl) hpEl.innerText = 100; 
                const scoreEl = document.getElementById('score'); if (scoreEl) scoreEl.innerText = score; 
                const levelDisplay = document.getElementById('level-display'); if (levelDisplay) levelDisplay.innerText = currentLevel;
                
                ['game-over-screen', 'win-screen', 'lobby-screen'].forEach(id => { 
                    const el = document.getElementById(id); if (el) el.style.display = 'none'; 
                }); 
                document.getElementById('pause-btn').style.display = 'flex'; 
                document.getElementById('damage-overlay').style.boxShadow = "none";
                
                const ms = document.getElementById('multiplayer-status'); 
                if (ms) { 
                    ms.style.display = isMultiplayerMode ? 'block' : 'none'; 
                    if (isCoopMode) { 
                        ms.innerHTML = `CO-OP: <span id="mp-count">0</span> OP | ROOM: <span id="room-id">${myUserId ? myUserId.substring(0, 6) : '...'}</span>`; 
                        ms.style.color = "#00FF41"; 
                    } else { 
                        ms.innerHTML = `ONLINE: <span id="mp-count">0</span> PL | ROOM: <span id="room-id">${myUserId ? myUserId.substring(0, 6) : '...'}</span>`; 
                        ms.style.color = "#00f3ff"; 
                    } 
                } 
                document.getElementById('master-status').style.display = 'none';

                createWorld(currentLevel, activeTextures, isMultiplayerMode, isCoopMode);
                envStaticNodes = [...ramps, ...walls];
                
                const spawnPos = getSafeSpawnPosition(isMultiplayerMode && !isCoopMode);
                playerGroup.position.copy(spawnPos);
                
                activeEffectIntervals.forEach(clearInterval);
                activeEffectIntervals = [];

                enemies.forEach(e => clearSceneObject(scene, e)); enemies = []; 
                healthKits.forEach(k => clearSceneObject(scene, k)); healthKits = []; 
                armorVests.forEach(k => clearSceneObject(scene, k)); armorVests = []; 
                grenadePacks.forEach(k => clearSceneObject(scene, k)); grenadePacks = [];
                bullets.forEach(b => scene.remove(b)); bullets = []; 
                activeGrenades.forEach(g => clearSceneObject(scene, g.mesh)); activeGrenades = [];

                if (isMultiplayerMode) { 
                    setupPresenceInit(); 
                }
                
                if (!isMultiplayerMode) { 
                    const botCount = 15 + (currentLevel - 1) * 2; 
                    enemies = spawnEnemies(botCount, currentLevel, { scene, walls, playerGroup, remotePlayers, isMultiplayerMode, isCoopMode, isMasterClient, createHPBar, db, roomPath }); 
                }
                
                const kitCount = currentLevel <= 2 ? 6 : 8; 
                spawnHealthKits(kitCount); 
                spawnArmorVests(); 
                spawnGrenadePacks(); 
                
                isPlaying = true; 
                gamePaused = false; 
                levelStartTime = performance.now(); 
                
                const ind = document.getElementById('level-indicator'); 
                if (ind) { 
                    ind.innerText = isCoopMode ? "COOP ZONE " + currentLevel : (isMultiplayerMode ? "PVP ZONE" : "LEVEL 1"); 
                    ind.style.display = 'block'; 
                    setTimeout(() => ind.style.display = 'none', 3000); 
                }
                
                if (isPC) { 
                    try { 
                        const pl = document.body.requestPointerLock(); 
                        if (pl) pl.catch(() => {}); 
                    } catch(e){} 
                } 
                syncMobileUIVisibility();
            } catch (e) { 
                console.error("Fatal Engine Error:", e);
                logSystem("Fatal error: " + e.message, "error"); 
                document.getElementById('main-menu').style.display = 'block'; 
            }
        }

        function showGameOver() { 
            isPlaying = false; 
            document.exitPointerLock(); 
            if (bgmPlayer) bgmPlayer.pause(); 
            document.getElementById('game-over-screen').style.display = 'flex'; 
            syncMobileUIVisibility();
            document.getElementById('pause-btn').style.display = 'none'; 
        }

        function nextLevel() { 
            if (currentLevel >= maxLevels) { 
                isPlaying = false; 
                document.exitPointerLock(); 
                if (bgmPlayer) bgmPlayer.pause(); 
                const winScreen = document.getElementById('win-screen'); 
                if (winScreen) { 
                    winScreen.querySelector('h1').innerText = 'MISSION ACCOMPLISHED'; 
                    const pEl = winScreen.querySelector('p'); 
                    if(pEl) pEl.innerText = 'You conquered all 10 levels! Mission accomplished successfully!'; 
                    winScreen.style.display = 'flex'; 
                } 
                syncMobileUIVisibility();
                return; 
            } 
            currentLevel++; 
            isPlaying = false; 
            if (bgmPlayer) bgmPlayer.pause(); 
            document.getElementById('level-complete-screen').style.display = 'flex'; 
            document.getElementById('pause-btn').style.display = 'none'; 
            document.exitPointerLock(); 
        }
        const resumeGame = () => { 
            document.getElementById('settings-view').style.display = 'none'; 
            document.getElementById('main-menu').style.display = 'none'; 
            document.getElementById('hud').style.display = 'block'; 
            document.getElementById('crosshair').style.display = 'block'; 
            syncMobileUIVisibility();
            document.getElementById('main-menu').classList.remove('paused-mode'); 
            document.querySelectorAll('.menu-sidebar, .menu-header, .char-info').forEach(el => el.style.opacity = '1'); 
            document.querySelectorAll('.menu-sidebar, .menu-header, .char-info').forEach(el => el.style.pointerEvents = 'auto'); 
            isPlaying = true; 
            gamePaused = false; 
            if (isPC) { 
                try { 
                    const promise = document.body.requestPointerLock(); 
                    if (promise) { promise.catch(err => { }); } 
                } catch (e) { } 
            } 
        };
        
        const inviteAction = async (btnElement) => { 
            const originalHTML = btnElement.innerHTML; 
            try { 
                btnElement.innerText = "GENERATING..."; 
                const link = "https://canaa-zona-de-combate.onrender.com"; 
                let copied = false; 
                if (navigator.clipboard && navigator.clipboard.writeText) { 
                    try { await navigator.clipboard.writeText(link); copied = true; } catch (err) { } 
                } 
                if (!copied) { 
                    const textArea = document.createElement("textarea"); 
                    textArea.value = link; 
                    textArea.style.position = "fixed"; 
                    textArea.style.left = "-9999px"; 
                    textArea.style.top = "0"; 
                    document.body.appendChild(textArea); 
                    textArea.focus(); 
                    textArea.select(); 
                    try { document.execCommand('copy'); copied = true; } catch (e) { } 
                    document.body.removeChild(textArea); 
                } 
                if (copied) { btnElement.innerText = "LINK COPIED! ✅"; } 
                else { btnElement.innerText = "COPY FAILED ❌"; } 
                
                const qrPopup = document.getElementById('qr-popup'); 
                const qrImg = document.getElementById('qr-image'); 
                const qrText = document.getElementById('qr-link-text'); 
                qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(link)}`; 
                qrText.innerText = link; 
                qrPopup.style.display = 'flex'; 
                setTimeout(() => btnElement.innerHTML = originalHTML, 2000); 
            } catch (e) { 
                btnElement.innerText = "ERROR ❌"; 
                setTimeout(() => btnElement.innerHTML = originalHTML, 2000);
            }
        };

        function syncMobileUIVisibility() {
            const mUI = document.getElementById('mobile-ui');
            if (mUI) {
                // Show mobile UI only if in mobile mode AND game is active
                mUI.style.display = (!isPC && isPlaying) ? 'block' : 'none';
                if (mUI.style.display === 'block') window.dispatchEvent(new Event('resize'));
            }
        }

        function setupUI() {
            const modeBtn = document.getElementById('mode-switch-btn');
            
            const pcIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`;
            const mobileIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>`;

            // Initial button icon based on detection
            if (modeBtn) modeBtn.innerHTML = isPC ? pcIcon : mobileIcon;
            
            // Sync initial HUD state
            syncMobileUIVisibility();

            const toggleMode = (e) => {
                if (e.cancelable) e.preventDefault();
                isPC = !isPC; 
                localStorage.setItem('canaan_control_mode', isPC ? 'pc' : 'mobile');
                if (modeBtn) modeBtn.innerHTML = isPC ? pcIcon : mobileIcon; 
                syncMobileUIVisibility();
            };

            if (modeBtn) {
                modeBtn.addEventListener('click', toggleMode);
                modeBtn.addEventListener('touchstart', toggleMode, { passive: false });
            }

            document.getElementById('play-btn').onclick = () => { resetGame('single'); }; 
            document.getElementById('multiplayer-btn').onclick = () => showLobby('pvp'); 
            document.getElementById('coop-btn').onclick = () => showLobby('coop');
            
            const fsHandler = (e) => {
                if (e && e.cancelable) e.preventDefault();
                goFullscreen();
            };
            
            const fsBtn = document.getElementById('fullscreen-btn');
            if (fsBtn) {
                fsBtn.addEventListener('click', fsHandler);
                fsBtn.addEventListener('touchstart', fsHandler, { passive: false });
            }
            
            const mFsBtn = document.getElementById('mobile-fs-btn');
            if (mFsBtn) mFsBtn.onclick = fsHandler;

            const exitBtn = document.getElementById('mobile-exit-btn');
            if (exitBtn) {
                exitBtn.onclick = () => {
                    window.close();
                    setTimeout(() => window.location.href = "about:blank", 100);
                };
            }

            const inviteBtn = document.getElementById('invite-btn'); 
            if (inviteBtn) inviteBtn.onclick = () => inviteAction(inviteBtn); 
            const pauseInviteBtn = document.getElementById('pause-invite-btn'); 
            if (pauseInviteBtn) {
                pauseInviteBtn.addEventListener('click', () => inviteAction(pauseInviteBtn));
                pauseInviteBtn.addEventListener('touchstart', (e) => { e.preventDefault(); inviteAction(pauseInviteBtn); }, { passive: false });
            }
            
            document.getElementById('lobby-back-btn').onclick = () => {  
                document.getElementById('lobby-screen').style.display = 'none'; 
                document.getElementById('start-view').style.removeProperty('display'); 
                document.getElementById('start-view').style.display = 'flex'; 
            };
            
            const pauseBtnEl = document.getElementById('pause-btn');
            const pauseGameHandler = (e) => { 
                if (e) e.stopPropagation(); 
                if (e && e.type === 'touchstart') e.preventDefault();
                if (!isPlaying) return; 
                isPlaying = false; 
                gamePaused = true; 
                if (document.exitPointerLock) document.exitPointerLock(); 
                document.getElementById('settings-view').style.display = 'block'; 
                document.getElementById('start-view').style.setProperty('display', 'none', 'important'); 
                document.getElementById('main-menu').style.display = 'block'; 
                document.getElementById('main-menu').classList.add('paused-mode'); 
                document.querySelectorAll('.menu-sidebar, .menu-header, .char-info').forEach(el => el.style.opacity = '0'); 
                document.querySelectorAll('.menu-sidebar, .menu-header, .char-info').forEach(el => el.style.pointerEvents = 'none'); 
                syncMobileUIVisibility();
            };
            pauseBtnEl.addEventListener('click', pauseGameHandler);
            pauseBtnEl.addEventListener('touchstart', pauseGameHandler, { passive: false });
            
            document.getElementById('main-menu').addEventListener('click', (e) => { 
                if (gamePaused && e.target.id === 'main-menu') { resumeGame(); } 
            });
            document.getElementById('main-menu').addEventListener('touchstart', (e) => { 
                if (gamePaused && e.target.id === 'main-menu') { resumeGame(); } 
            }, { passive: true });
            
            document.getElementById('settings-btn').onclick = () => { 
                document.getElementById('start-view').style.setProperty('display', 'none', 'important'); 
                document.getElementById('settings-view').style.display = 'block'; 
                document.querySelectorAll('.menu-sidebar, .menu-header, .char-info').forEach(el => el.style.opacity = '0');
                if (document.getElementById('skin-select')) {
                    document.getElementById('skin-select').value = settings.skin || 'ninja';
                }
            };
            
            const backBtnEl = document.getElementById('back-btn');
            const backBtnHandler = (e) => { 
                if (e.type === 'touchstart' && e.cancelable) e.preventDefault();
                if (gamePaused) { resumeGame(); } 
                else { 
                    document.getElementById('settings-view').style.display = 'none'; 
                    document.getElementById('start-view').style.removeProperty('display'); 
                    document.getElementById('start-view').style.display = 'flex'; 
                    document.querySelectorAll('.menu-sidebar, .menu-header, .char-info').forEach(el => el.style.opacity = '1');
                } 
            };
            backBtnEl.onclick = null;
            backBtnEl.addEventListener('click', backBtnHandler);
            backBtnEl.addEventListener('touchstart', backBtnHandler, { passive: false });
            
            const editHudBtnEl = document.getElementById('edit-hud-btn');
            const editHudHandler = (e) => { 
                if (e.type === 'touchstart' && e.cancelable) e.preventDefault();
                settings.isEditing = true; 
                document.getElementById('settings-view').style.display = 'none'; 
                document.getElementById('main-menu').style.display = 'none'; 
                document.getElementById('hud').style.display = 'block'; 
                document.getElementById('crosshair').style.display = 'block'; 
                document.getElementById('mobile-ui').style.display = 'block'; 
                document.getElementById('save-hud-btn').style.display = 'block'; 
                setupHUDDrag(); // Reactivate drag listeners
            };
            editHudBtnEl.onclick = null;
            editHudBtnEl.addEventListener('click', editHudHandler);
            editHudBtnEl.addEventListener('touchstart', editHudHandler, { passive: false });
            
            const saveHudBtnEl = document.getElementById('save-hud-btn');
            const saveHudHandler = (e) => { 
                if (e.type === 'touchstart' && e.cancelable) e.preventDefault();
                settings.isEditing = false; 
                document.getElementById('save-hud-btn').style.display = 'none'; 
                document.getElementById('hud').style.display = 'none'; 
                document.getElementById('crosshair').style.display = 'none'; 
                document.getElementById('mobile-ui').style.display = 'none'; 
                document.getElementById('main-menu').style.display = 'block'; 
                document.getElementById('settings-view').style.display = 'block'; 
                const els = ['fire-btn', 'jump-btn', 'aim-btn', 'swap-btn', 'grenade-btn', 'smoke-btn', 'joystick-zone', 'minimap-canvas', 'info-panel']; 
                const pos = {}; 
                els.forEach(id => { 
                    const el = document.getElementById(id); 
                    if(el) pos[id] = { left: el.style.left, top: el.style.top, bottom: el.style.bottom, right: el.style.right }; 
                }); 
                localStorage.setItem('canaa_hud_pos', JSON.stringify(pos)); 
            };
            saveHudBtnEl.onclick = null;
            saveHudBtnEl.addEventListener('click', saveHudHandler);
            saveHudBtnEl.addEventListener('touchstart', saveHudHandler, { passive: false });
            
            const abortBtnEl = document.getElementById('abort-mission-btn');
            const abortBtnHandler = (e) => { 
                if (e.type === 'touchstart' && e.cancelable) e.preventDefault();
                document.getElementById('settings-view').style.display = 'none'; 
                document.getElementById('hud').style.display = 'none'; 
                document.getElementById('mobile-ui').style.display = 'none'; 
                document.getElementById('crosshair').style.display = 'none'; 
                document.getElementById('main-menu').style.display = 'block'; 
                document.getElementById('start-view').style.removeProperty('display'); 
                document.getElementById('start-view').style.display = 'flex'; 
                document.getElementById('main-menu').classList.remove('paused-mode'); 
                document.querySelectorAll('.menu-sidebar, .menu-header, .char-info').forEach(el => el.style.opacity = '1'); 
                document.querySelectorAll('.menu-sidebar, .menu-header, .char-info').forEach(el => el.style.pointerEvents = 'auto'); 
                isPlaying = false; gamePaused = false; scene.add(camera); cleanupMp(); playMenuMusic(); 
            };
            abortBtnEl.onclick = null;
            abortBtnEl.addEventListener('click', abortBtnHandler);

            // Handlers para telas de fim de jogo
            document.getElementById('retry-btn').onclick = () => { 
                if (isMultiplayerMode) { 
                    document.getElementById('game-over-screen').style.display = 'none'; 
                    showLobby(isCoopMode ? 'coop' : 'pvp'); 
                } else { 
                    resetGame('single'); 
                } 
            };
            document.getElementById('win-retry-btn').onclick = () => { 
                if (isMultiplayerMode) { 
                    document.getElementById('win-screen').style.display = 'none'; 
                    showLobby(isCoopMode ? 'coop' : 'pvp'); 
                } else { 
                    resetGame('single'); 
                } 
            };
            document.getElementById('continue-btn').onclick = () => {
                document.getElementById('level-complete-screen').style.display = 'none'; 
                nextLevel();
            };
            const returnToMenu = () => { 
                document.getElementById('game-over-screen').style.display = 'none'; 
                document.getElementById('win-screen').style.display = 'none'; 
                document.getElementById('main-menu').style.display = 'block'; 
                document.getElementById('start-view').style.removeProperty('display'); 
                document.getElementById('start-view').style.display = 'flex'; 
                document.getElementById('hud').style.display = 'none'; 
                document.getElementById('crosshair').style.display = 'none'; 
                scene.add(camera); 
                playMenuMusic(); 
            };
            document.getElementById('menu-return-btn').onclick = returnToMenu;
            document.getElementById('win-menu-btn').onclick = returnToMenu;
        }

        function toggleWeapon() { 
            currentWeapon = currentWeapon === 0 ? 1 : 0; 
            updateWeaponUI(currentWeapon);
            wasManualFiring = false; // Reset wasManualFiring when weapon changes
            playSound('step', settings); 
        }
        
        initInput({
            settings,
            gamePaused: () => gamePaused,
            isPlaying: () => isPlaying,
            toggleCameraMode,
            toggleWeapon,
            executeGrenadeThrow,
            resumeGame,
            jumpForce: JUMP_FORCE,
            onPause: () => { 
                isPlaying = false; gamePaused = true; 
                if (document.exitPointerLock) document.exitPointerLock(); 
                document.getElementById('settings-view').style.display = 'block'; 
                document.getElementById('start-view').style.setProperty('display', 'none', 'important'); 
                document.getElementById('main-menu').style.display = 'block'; 
                document.getElementById('main-menu').classList.add('paused-mode'); 
                document.querySelectorAll('.menu-sidebar, .menu-header, .char-info').forEach(el => el.style.opacity = '0'); 
                document.querySelectorAll('.menu-sidebar, .menu-header, .char-info').forEach(el => el.style.pointerEvents = 'none'); 
            },
            onJump: () => {
                if (isGrounded) { velocityY = JUMP_FORCE; isGrounded = false; playSound('jump', settings); }
            },
            setPitch: (p) => { updateYawPitch(yaw, p); },
            setYaw: (y) => { updateYawPitch(y, pitch); }
        });
        
        setupUI();
        init();

        const skinSelect = document.getElementById('skin-select');
        if (skinSelect) {
            skinSelect.onchange = (e) => {
                settings.skin = e.target.value;
                if (playerMeshParts) {
                    const s = settings.skin;
                    let tc = 0x222222, vc = 0x2F4F2F, sc = 0xffdbac;
                    if (s === 'ninja') { tc = 0x050505; vc = 0x111111; sc = 0xdddddd; }
                    else if (s === 'desert') { tc = 0x8b4513; vc = 0xd2b48c; sc = 0xffe4b5; }
                    else if (s === 'frozen') { tc = 0x004488; vc = 0x0088ff; sc = 0xccffff; }
                    else if (s === 'gold') { tc = 0x443300; vc = 0xffd700; sc = 0xffeeaa; }
                    
                    if (playerMeshParts.torso) playerMeshParts.torso.material.color.setHex(tc);
                    if (playerMeshParts.vest) playerMeshParts.vest.material.color.setHex(vc);
                    if (playerMeshParts.head) playerMeshParts.head.material.color.setHex(sc);
                }
            };
        }

        // AUTO-LOGIN & IDENTITY SYNC
        import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js').then(({ onAuthStateChanged, signInAnonymously }) => {
            onAuthStateChanged(auth, (user) => { 
                if (user) { 
                    setMyUserId(user.uid); 
                } else {
                    signInAnonymously(auth).catch(e => console.error("Guest login failed:", e));
                }
            });
        });
    });
