import * as THREE from 'three';
import { addEyes } from './utils.js';

export function createHumanoidMesh(colorOptions = {}) {
    const {
        torsoColor = 0x222222,
        vestColor = 0x2F4F2F,
        skinColor = 0xffdbac,
        bootColor = 0x111111,
        helmetColor = 0x2F4F2F,
        isEnemy = false
    } = colorOptions;

    const group = new THREE.Group();
    
    const matTorso = new THREE.MeshStandardMaterial({ color: torsoColor });
    const matVest = new THREE.MeshLambertMaterial({ color: vestColor });
    const matSkin = new THREE.MeshLambertMaterial({ color: skinColor });
    const matBoot = new THREE.MeshStandardMaterial({ color: bootColor });
    const matHelmet = new THREE.MeshLambertMaterial({ color: helmetColor });

    // Pivot Principal (Pelve)
    const pelvePivot = new THREE.Object3D();
    pelvePivot.position.y = 1.0;
    group.add(pelvePivot);

    // Tronco (Cápsula - mais orgânico)
    const torsoGeo = new THREE.CapsuleGeometry(0.2, 0.6, 4, 8);
    const mTorso = new THREE.Mesh(torsoGeo, matTorso);
    mTorso.position.y = 0.3;
    pelvePivot.add(mTorso);

    // Colete
    const vestGeo = new THREE.CapsuleGeometry(0.22, 0.4, 4, 8);
    const mVest = new THREE.Mesh(vestGeo, matVest);
    mVest.position.y = 0.4;
    pelvePivot.add(mVest);

    // Pescoço e Cabeça
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.1), matSkin);
    neck.position.y = 0.65;
    pelvePivot.add(neck);

    const headPivot = new THREE.Object3D();
    headPivot.position.y = 0.15;
    neck.add(headPivot);

    const headGeo = new THREE.CapsuleGeometry(0.12, 0.15, 4, 8);
    const mHead = new THREE.Mesh(headGeo, matSkin);
    headPivot.add(mHead);
    addEyes(mHead);

    const helmetGeo = new THREE.CapsuleGeometry(0.13, 0.08, 4, 8);
    const mHelmet = new THREE.Mesh(helmetGeo, matHelmet);
    mHelmet.position.y = 0.08;
    headPivot.add(mHelmet);

    // Pernas
    const legGeo = new THREE.CapsuleGeometry(0.08, 0.4, 4, 8);
    
    // Perna Direita
    const rLegPivot = new THREE.Object3D();
    rLegPivot.position.set(0.12, 0, 0);
    pelvePivot.add(rLegPivot);
    const rCoxa = new THREE.Mesh(legGeo, matVest);
    rCoxa.position.y = -0.25;
    rLegPivot.add(rCoxa);
    
    const rCanelaPivot = new THREE.Object3D();
    rCanelaPivot.position.y = -0.25;
    rCoxa.add(rCanelaPivot);
    const rCanela = new THREE.Mesh(legGeo, matVest);
    rCanela.position.y = -0.25;
    rCanelaPivot.add(rCanela);
    
    const rBoot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.25), matBoot);
    rBoot.position.set(0, -0.25, -0.05);
    rCanela.add(rBoot);

    // Perna Esquerda
    const lLegPivot = new THREE.Object3D();
    lLegPivot.position.set(-0.12, 0, 0);
    pelvePivot.add(lLegPivot);
    const lCoxa = new THREE.Mesh(legGeo, matVest);
    lCoxa.position.y = -0.25;
    lLegPivot.add(lCoxa);
    
    const lCanelaPivot = new THREE.Object3D();
    lCanelaPivot.position.y = -0.25;
    lCoxa.add(lCanelaPivot);
    const lCanela = new THREE.Mesh(legGeo, matVest);
    lCanela.position.y = -0.25;
    lCanelaPivot.add(lCanela);
    
    const lBoot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.25), matBoot);
    lBoot.position.set(0, -0.25, -0.05);
    lCanela.add(lBoot);

    // Braços
    const armGeo = new THREE.CapsuleGeometry(0.06, 0.35, 4, 8);
    
    // Braço Direito
    const rArmPivot = new THREE.Object3D();
    rArmPivot.position.set(0.25, 0.7, 0);
    pelvePivot.add(rArmPivot);
    const rBiceps = new THREE.Mesh(armGeo, matSkin);
    rBiceps.position.y = -0.2;
    rArmPivot.add(rBiceps);
    
    const rElbow = new THREE.Object3D();
    rElbow.position.y = -0.2;
    rBiceps.add(rElbow);
    const rForearm = new THREE.Mesh(armGeo, matSkin);
    rForearm.position.y = -0.2;
    rElbow.add(rForearm);

    // Braço Esquerdo
    const lArmPivot = new THREE.Object3D();
    lArmPivot.position.set(-0.25, 0.7, 0);
    pelvePivot.add(lArmPivot);
    const lBiceps = new THREE.Mesh(armGeo, matSkin);
    lBiceps.position.y = -0.2;
    lArmPivot.add(lBiceps);
    
    const lElbow = new THREE.Object3D();
    lElbow.position.y = -0.2;
    lBiceps.add(lElbow);
    const lForearm = new THREE.Mesh(armGeo, matSkin);
    lForearm.position.y = -0.2;
    lElbow.add(lForearm);

    return {
        group,
        pelvePivot,
        headPivot,
        rLegPivot,
        lLegPivot,
        rArmPivot,
        lArmPivot,
        rElbow,
        lElbow,
        rCanelaPivot,
        lCanelaPivot,
        torso: mTorso,
        vest: mVest,
        head: mHead,
        rForearm,
        lForearm
    };
}

export function createHPBar() { 
    const group = new THREE.Group(); 
    const bgGeo = new THREE.PlaneGeometry(1.2, 0.15); 
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }); 
    const bg = new THREE.Mesh(bgGeo, bgMat); 
    
    const fgGeo = new THREE.PlaneGeometry(1.15, 0.1); 
    const fgMat = new THREE.MeshBasicMaterial({ color: 0x00FF41, side: THREE.DoubleSide }); 
    const fg = new THREE.Mesh(fgGeo, fgMat); 
    
    fg.position.z = 0.01; 
    fg.geometry.translate(0.575, 0, 0); 
    fg.position.x = -0.575; 
    
    group.add(bg); 
    group.add(fg); 
    group.position.y = 2.4; 
    
    return { group, fg, fgMat }; 
}

export function createDroneMesh(color = 0x0088ff) {
    const group = new THREE.Group();
    const bodyGeo = new THREE.SphereGeometry(0.3, 8, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: color, metalness: 0.8, roughness: 0.2 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    const ringGeo = new THREE.TorusGeometry(0.5, 0.05, 8, 24);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const eyeGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(0, 0, -0.25);
    group.add(eye);

    const glow = new THREE.PointLight(0xff0000, 1, 2);
    glow.position.copy(eye.position);
    group.add(glow);

    return { group, body, ring, eye };
}
