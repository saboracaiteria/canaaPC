import * as THREE from 'three';
import { mazeSize, mazeMap } from './constants.js';
import { clearSceneObject, mulberry32, playSound } from './utils.js';
import { createHumanoidMesh, createHPBar } from './graphics.js';
import { ref, update } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js';

const _v1 = new THREE.Vector3();
const _vDir = new THREE.Vector3();
const _enemyDir = new THREE.Vector3();
const _botPos = new THREE.Vector3();
const _botDownRay = new THREE.Raycaster();
const _losRay = new THREE.Raycaster();
const _downVec = new THREE.Vector3(0, -1, 0);
const _sp = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const BOT_SYNC_RATE = 100; // ms

let sharedMats = null;
function initSharedMaterials() {
    if (sharedMats) return;
    sharedMats = {
        laserMat: new THREE.LineBasicMaterial({ color: 0xFF0000, transparent: true, opacity: 0.8 })
    };
}

export function createEnemyMesh(x, z, level, index) {
    const char = createHumanoidMesh({
        torsoColor: level === 5 ? 0x442200 : 0x222200,
        vestColor: level === 5 ? 0xff00ff : 0xff3333,
        skinColor: 0xffdbac,
        isEnemy: true
    });
    
    const group = char.group;
    group.position.set(x, 0, z);
    group.userData = { 
        isEnemyRoot: true, 
        hp: 100, 
        maxHp: 100,
        dead: false, 
        lastShot: 0,
        index: index,
        reactionTime: Math.max(200, 1000 - (level * 150)),
        pivots: { 
            lLeg: char.lLegPivot, 
            rLeg: char.rLegPivot, 
            lCanela: char.lCanelaPivot, 
            rCanela: char.rCanelaPivot, 
            rArm: char.rArmPivot, 
            lArm: char.lArmPivot 
        },
        state: 'PATROL',
        patrolPos: new THREE.Vector3(x, 0, z),
        nextPatrolTime: 0,
        searchTimer: 0
    }; 
    
    const wMat = new THREE.MeshStandardMaterial({ color: 0x111111 }); 
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.6), wMat); 
    gun.name = "gun"; 
    gun.position.set(0, -0.2, 0); 
    gun.rotation.x = -Math.PI / 2; 
    char.rElbow.add(gun);
    
    if (createHPBar) {
        const hpBar = createHPBar(); 
        group.add(hpBar.group); 
        group.userData.hpBar = hpBar;
    }

    const hitbox = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.0, 1.0), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); 
    hitbox.position.y = 1.0; 
    group.add(hitbox);

    return group; 
}

export function createRemotePlayerMesh(id, isCoopMode, skinHex = 0xffdbac) {
    const char = createHumanoidMesh({
        torsoColor: 0x222222,
        vestColor: isCoopMode ? 0x4b5320 : 0x550000,
        skinColor: skinHex,
        bootColor: 0x111111,
        helmetColor: isCoopMode ? 0x4b5320 : 0x550000
    });
    
    const group = char.group;
    group.userData = { 
        id: id, 
        pivots: { 
            head: char.headPivot, 
            rArm: char.rArmPivot, 
            lArm: char.lArmPivot, 
            lLeg: char.lLegPivot, 
            rLeg: char.rLegPivot, 
            lCanela: char.lCanelaPivot, 
            rCanela: char.rCanelaPivot 
        } 
    }; 
    
    const wMat = new THREE.MeshStandardMaterial({ color: 0x111111 }); 
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.6), wMat); 
    gun.name = "gun"; 
    gun.position.set(0, -0.2, 0); 
    gun.rotation.x = -Math.PI / 2; 
    char.rElbow.add(gun);
    
    if (createHPBar) {
        const hpBar = createHPBar(); 
        group.add(hpBar.group); 
        group.userData.hpBar = hpBar;
    }
    
    const hitbox = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.0, 1.0), new THREE.MeshBasicMaterial({ visible: false })); 
    hitbox.position.y = 1.0;
    group.add(hitbox);

    return group;
}

export function spawnEnemies(count, level, { scene, walls, playerGroup, remotePlayers, isMultiplayerMode, isCoopMode, isMasterClient, createHPBar, db, roomPath }) {
    let spawnedEnemies = [];
    const ehp = 100 + ((level - 1) * 25);
    const rng = mulberry32(level + 5000); 
    const enemyData = {};
    
    for (let i = 0; i < count; i++) {
        let px, pz; 
        const isPVP = isMultiplayerMode && !isCoopMode; 
        const isOpen = isPVP; 
        let valid = false; 
        let attempts = 0;
        
        while (!valid && attempts < 200) {
            attempts++; 
            let rx = Math.floor(rng() * mazeSize); 
            let rz = Math.floor(rng() * mazeSize); 
            px = rx * 5; 
            pz = rz * 5; 
            
            if (!isOpen && mazeMap[rz][rx] === 1) continue; 
            if (isOpen && (rx === 0 || rx === mazeSize-1 || rz === 0 || rz === mazeSize-1)) continue;
            
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
            
            let tooCloseToPlayer = false; 
            if (playerGroup && playerGroup.position.distanceTo(new THREE.Vector3(px, 0, pz)) < 25) tooCloseToPlayer = true; 
            for (const key in remotePlayers) {
                const rp = remotePlayers[key];
                if (rp && rp.mesh && rp.mesh.position.distanceTo(new THREE.Vector3(px, 0, pz)) < 25) tooCloseToPlayer = true;
            } 
            if (tooCloseToPlayer && attempts < 150) continue;
            
            if (!insideWall) valid = true;
        }
        const enemy = createEnemyMesh(px, pz, level, i); 
        spawnedEnemies.push(enemy); 
        scene.add(enemy); 
        enemyData[i] = { x: px, z: pz, rot: 0, hp: ehp, dead: false };
    }
    
    if (isMultiplayerMode && isMasterClient) { 
        update(ref(db, `${roomPath}/state/enemies`), enemyData); 
    }
    return spawnedEnemies;
}

export function killEnemyLocal(en, { isMultiplayerMode, isCoopMode, registerKill, registerTeamKill, dbUpdate = true, db, roomPath }) { 
    if (en.userData.dead) return; 
    en.userData.dead = true; 
    en.scale.y = 0.2; 
    en.position.y = 0.1; 
    const b = en.getObjectByName("body"); 
    if (b) b.material.color.setHex(0x333333); 
    
    if (dbUpdate) { 
        if (isMultiplayerMode) { 
            update(ref(db, `${roomPath}/state/enemies/${en.userData.index}`), { dead: true }).catch(() => {}); 
        } 
        if (isCoopMode) { 
            registerTeamKill(); 
        } else { 
            registerKill(); 
        } 
    } 
}

export function updateEnemies(dt, { 
    enemies, isMultiplayerMode, isCoopMode, isMasterClient, roomPath, db, 
    settings, playerGroup, remotePlayers, currentLevel, levelStartTime, 
    envNodes, checkWall, applyDamage, camera, scene, runTransaction
}) {
    const now = performance.now();
    let hasEnemyUpdates = false;
    const enemyUpdates = {};
    const isPVP = isMultiplayerMode && !isCoopMode;
    
    const availableTargets = [];
    if (playerGroup) availableTargets.push({ mesh: playerGroup, id: 'local' });
    for (const id in remotePlayers) {
        if (remotePlayers[id] && remotePlayers[id].mesh) {
            availableTargets.push({ mesh: remotePlayers[id].mesh, id: id });
        }
    }

    if (availableTargets.length > 0) {
        const targetAttackers = {};
        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i]; if (!e || e.userData.dead) continue;
            
            // PERFORMANCE LOD: Varying update frequency based on distance
            e.userData.logicFrame = (e.userData.logicFrame || 0) + 1;
            const cameraDist = camera ? camera.position.distanceToSquared(e.position) : 10000;
            const distSq = cameraDist;
            let skipFrame = 1;
            if (distSq > 10000) { e.visible = false; skipFrame = 15; } // > 100m
            else if (distSq > 3600) { e.visible = true; skipFrame = 5; } // > 60m
            else if (distSq > 1600) { e.visible = true; skipFrame = 2; } // > 40m
            else { e.visible = true; skipFrame = 1; } // Near

            if (e.userData.logicFrame % skipFrame !== 0) continue;

            let bestTarget = availableTargets[0].mesh;
            let bestTargetId = availableTargets[0].id;
            let minDistSq = Infinity;

            for (let j = 0; j < availableTargets.length; j++) {
                const t = availableTargets[j];
                const dSq = e.position.distanceToSquared(t.mesh.position);
                if (dSq < minDistSq) {
                    if (isPVP) {
                        const attackers = targetAttackers[t.id] || 0;
                        if (attackers < 3 || e.userData.lockedTargetId === t.id) {
                            minDistSq = dSq;
                            bestTarget = t.mesh;
                            bestTargetId = t.id;
                        }
                    } else {
                        minDistSq = dSq;
                        bestTarget = t.mesh;
                        bestTargetId = t.id;
                    }
                }
            }

            if (isPVP) {
                targetAttackers[bestTargetId] = (targetAttackers[bestTargetId] || 0) + 1;
                e.userData.lockedTargetId = bestTargetId;
            }

            const d = Math.sqrt(minDistSq);
            
            // PHYSICS: Gravity and Grounding
            e.userData.velocityY = (e.userData.velocityY || 0) - 0.015; e.position.y += e.userData.velocityY;
            e.userData.groundCheckFrame = (e.userData.groundCheckFrame || 0) + 1;
            if (e.userData.groundCheckFrame % 3 === 0) {
                let botGroundY = 0; 
                _botPos.set(e.position.x, e.position.y + 2, e.position.z);
                _botDownRay.set(_botPos, _downVec);
                _botDownRay.far = 10;
                const rampHits = _botDownRay.intersectObjects(envNodes, false); 
                if (rampHits.length > 0 && rampHits[0].point.y > botGroundY) { botGroundY = rampHits[0].point.y; }
                e.userData.lastKnownGroundY = botGroundY;
            }
            const botGroundY = e.userData.lastKnownGroundY || 0;
            if (e.position.y <= botGroundY + 0.05) { e.position.y = botGroundY + 0.05; e.userData.velocityY = 0; e.userData.isGrounded = true; } else { e.userData.isGrounded = false; }

            // AI STATE MACHINE LOGIC
            const canSeeTarget = e.userData.lastHasLOS && d < 40;
            if (canSeeTarget) {
                e.userData.state = 'CHASE';
                e.userData.searchTimer = 0;
            } else if (e.userData.state === 'CHASE') {
                e.userData.state = 'SEARCH';
                e.userData.searchTimer = now + 4000; 
                e.userData.lastKnownTargetPos = bestTarget.position.clone();
            }

            if (e.userData.state === 'SEARCH' && now > e.userData.searchTimer) {
                e.userData.state = 'PATROL';
            }

            if (e.userData.state === 'PATROL' && now > e.userData.nextPatrolTime) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 5 + Math.random() * 10;
                e.userData.patrolPos.set(
                    Math.max(2, Math.min(mazeSize * 5 - 2, e.position.x + Math.cos(angle) * dist)),
                    0,
                    Math.max(2, Math.min(mazeSize * 5 - 2, e.position.z + Math.sin(angle) * dist))
                );
                e.userData.nextPatrolTime = now + 5000 + Math.random() * 5000;
            }

            let moveTarget = e.userData.patrolPos;
            if (e.userData.state === 'CHASE') moveTarget = bestTarget.position;
            else if (e.userData.state === 'SEARCH') moveTarget = e.userData.lastKnownTargetPos;
            
            _enemyDir.subVectors(moveTarget, e.position); _enemyDir.y = 0; 
            const distToMoveTarget = _enemyDir.length();
            if (distToMoveTarget > 0.1) _enemyDir.normalize();

            if (d < 100) {
                
                const targetYaw = Math.atan2(_enemyDir.x, _enemyDir.z) + Math.PI; e.rotation.y = THREE.MathUtils.lerp(e.rotation.y, targetYaw, 0.15); 
                
                if (e.userData.pivots && e.userData.pivots.rArm) { 
                    let finalPitch = Math.atan2(bestTarget.position.y - (e.position.y + 1.5), d); 
                    if (d < 3.0) finalPitch = 0; 
                    e.userData.pivots.rArm.rotation.x = Math.max(1.0, Math.min(2.0, (Math.PI / 2) - finalPitch)); 
                    e.userData.pivots.lArm.rotation.x = Math.max(1.0, Math.min(2.0, (Math.PI / 2) - finalPitch)); 
                }

                if (d > 1.5) { 
                    let moveSpeed = 0.075; if (e.userData.hp <= 50) moveSpeed *= 1.5;
                    if (now - levelStartTime < 3000) { moveSpeed = 0; }
                    
                    const nx = e.position.x + _enemyDir.x * moveSpeed; const nz = e.position.z + _enemyDir.z * moveSpeed;
                    
                    if (!checkWall(nx, nz, e.position.x, e.position.z, e.position.y)) {
                        e.position.x = nx; e.position.z = nz;
                        if (moveSpeed > 0) { e.userData.walkCycle = (e.userData.walkCycle || 0) + 0.2; } 
                        else { e.userData.walkCycle = 0; }
                        const wc = e.userData.walkCycle; 
                        const baseCrouch = 0.3; const baseKnee = -0.6; const legSwing = Math.sin(wc) * 0.5;
                        if (e.userData.pivots) { 
                            e.userData.pivots.lLeg.rotation.x = baseCrouch + legSwing; 
                            e.userData.pivots.lCanela.rotation.x = baseKnee - Math.abs(Math.cos(wc)) * 0.5; 
                            e.userData.pivots.rLeg.rotation.x = baseCrouch - legSwing; 
                            e.userData.pivots.rCanela.rotation.x = baseKnee - Math.abs(Math.sin(wc)) * 0.5; 
                        }
                    } else {
                        if (e.userData.isGrounded && Math.random() < 0.05) e.userData.velocityY = 0.25;
                        if (e.userData.pivots) { 
                            e.userData.pivots.lLeg.rotation.x = THREE.MathUtils.lerp(e.userData.pivots.lLeg.rotation.x, 0.3, 0.1); 
                            e.userData.pivots.lCanela.rotation.x = THREE.MathUtils.lerp(e.userData.pivots.lCanela.rotation.x, -0.6, 0.1); 
                            e.userData.pivots.rLeg.rotation.x = THREE.MathUtils.lerp(e.userData.pivots.rLeg.rotation.x, 0.3, 0.1); 
                            e.userData.pivots.rCanela.rotation.x = THREE.MathUtils.lerp(e.userData.pivots.rCanela.rotation.x, -0.6, 0.1); 
                        }
                    }
                }

                // OPTIMIZATION: Throttled LOS Raycast (Every 10 frames)
                e.userData.losCheckFrame = (e.userData.losCheckFrame || 0) + 1;
                let hasLOS = e.userData.lastHasLOS || false;

                if (now - levelStartTime >= 20000 && now - e.userData.lastShot > e.userData.reactionTime && d < 40) {
                    if (e.userData.losCheckFrame % 10 === 0) {
                        _sp.copy(e.position); _sp.y += 1.5;
                        _targetPos.copy(bestTarget.position); _targetPos.y += 1.0;
                        const distToTarget = _sp.distanceTo(_targetPos); 
                        _enemyDir.subVectors(_targetPos, _sp).normalize();
                        _losRay.set(_sp, _enemyDir); 
                        _losRay.far = distToTarget;
                        const hits = _losRay.intersectObjects(envNodes, true); 
                        hasLOS = (hits.length === 0);
                        e.userData.lastHasLOS = hasLOS;
                    }
                    
                    if (hasLOS) {
                        e.userData.lastShot = now; 
                        playSound('shoot', settings);
                        if (bestTarget === playerGroup) { 
                            applyDamage(2); 
                        } else { 
                            const remoteId = bestTarget.userData.id; 
                            const remoteRef = ref(db, `${roomPath}/players/${remoteId}`); 
                            runTransaction(remoteRef, (p) => { if (p) p.hp = (p.hp || 100) - 2; return p; }).catch(() => {}); 
                        }
                        let visualOrigin = _sp; 
                        const gun = e.getObjectByName("gun"); 
                        if (gun) { gun.getWorldPosition(_v1); visualOrigin = _v1; }
                        
                        initSharedMaterials();
                        const lineGeo = new THREE.BufferGeometry().setFromPoints([visualOrigin, _targetPos]);
                        const t = new THREE.Line(lineGeo, sharedMats.laserMat); 
                        scene.add(t); 
                        setTimeout(() => {
                            scene.remove(t);
                            lineGeo.dispose();
                        }, 50);
                    }
                }
            }

            if (isMultiplayerMode && isMasterClient) { 
                if (now - (e.userData.lastSyncTime || 0) > BOT_SYNC_RATE + (e.userData.index * 10)) { 
                    e.userData.lastSyncTime = now;
                    enemyUpdates[`${e.userData.index}/x`] = parseFloat(e.position.x.toFixed(2));
                    enemyUpdates[`${e.userData.index}/z`] = parseFloat(e.position.z.toFixed(2));
                    enemyUpdates[`${e.userData.index}/rot`] = parseFloat(e.rotation.y.toFixed(2));
                    hasEnemyUpdates = true;
                } 
            }
        }

        if (hasEnemyUpdates && isMasterClient) {
            update(ref(db, `${roomPath}/state/enemies`), enemyUpdates).catch(() => {});
        }
    }

    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e.userData.dead && e.userData.hpBar) { 
            const hpBar = e.userData.hpBar; 
            hpBar.group.lookAt(camera.position); 
            const maxHp = e.userData.maxHp || 100; 
            let pct = Math.max(0, e.userData.hp / maxHp); 
            hpBar.fg.scale.x = pct; 
            if (pct > 0.5) hpBar.fgMat.color.setHex(0x00FF41); 
            else if (pct > 0.25) hpBar.fgMat.color.setHex(0xFFD700); 
            else hpBar.fgMat.color.setHex(0xFF0000); 
        } else if (e.userData.hpBar) { 
            e.userData.hpBar.group.visible = false; 
        }
    }
    
    for (const key in remotePlayers) {
        const rp = remotePlayers[key];
        if (rp.mesh && rp.mesh.userData.hpBar) { 
            const hpBar = rp.mesh.userData.hpBar; 
            hpBar.group.lookAt(camera.position); 
            let pct = Math.max(0, (rp.hp || 0) / 100); 
            hpBar.fg.scale.x = pct; 
            if (isCoopMode) { hpBar.fgMat.color.setHex(0x0088FF); } 
            else { hpBar.fgMat.color.setHex(0xFF0000); } 
        }
    }
}
