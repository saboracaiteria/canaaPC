import * as THREE from 'three';
import { mazeSize, cellSize, mazeMap } from './constants.js';
import { createProTexture, initSky, mulberry32, clearSceneObject } from './utils.js';

export let scene, camera, renderer, skyMesh, skyUniforms;
export let walls = [], ramps = [], currentFloor = null, worldLights = [], envGroup = null;

export function initWorld(settings, onResize) {
    scene = new THREE.Scene();
    
    camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.1, 2500); 
    camera.rotation.order = 'YXZ'; 
    scene.add(camera);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); 
    renderer.setSize(window.innerWidth, window.innerHeight); 
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); 
    renderer.shadowMap.enabled = true; 
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
    renderer.outputColorSpace = THREE.SRGBColorSpace; 
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    document.body.appendChild(renderer.domElement); 

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5); 
    hemiLight.position.set(0, 100, 0); 
    scene.add(hemiLight);
    
    const sun = new THREE.DirectionalLight(0xffffff, 1.8); 
    sun.position.set(50, 100, 50); 
    sun.castShadow = true; 
    sun.shadow.mapSize.width = 2048; 
    sun.shadow.mapSize.height = 2048; 
    sun.shadow.camera.near = 0.5; 
    sun.shadow.camera.far = 500; 
    sun.shadow.camera.left = -100; 
    sun.shadow.camera.right = 100; 
    sun.shadow.camera.top = 100; 
    sun.shadow.camera.bottom = -100; 
    sun.shadow.bias = -0.0005; 
    scene.add(sun);
    worldLights.push(hemiLight, sun);

    initSky(scene);
    
    window.addEventListener('resize', onResize);

    return { scene, camera, renderer };
}

export function createWorld(level, activeTextures, isMultiplayerMode, isCoopMode) {
    if (envGroup) { scene.remove(envGroup); }
    envGroup = new THREE.Group();
    envGroup.name = "ENV_COLLIDER";
    scene.add(envGroup);

    walls.forEach(w => clearSceneObject(scene, w)); walls = []; 
    if (currentFloor) { clearSceneObject(scene, currentFloor); currentFloor = null; } 
    ramps.forEach(r => clearSceneObject(scene, r)); ramps = []; 
    
    let wb, fb, skyTop, skyBot;
    
    switch (level) { 
        case 1: wb = '#6c7a89'; fb = '#95a5a6'; skyTop = 0x3498db; skyBot = 0xb0c4de; break; // Urban
        case 2: wb = '#d35400'; fb = '#e67e22'; skyTop = 0xdb8334; skyBot = 0xf39c12; break; // Desert
        case 3: wb = '#1a1a1a'; fb = '#0a0a0a'; skyTop = 0x5b2c6f; skyBot = 0x0a0a0a; break; // Cyberpunk
        case 4: wb = '#143d14'; fb = '#0b2e0b'; skyTop = 0x1b4d3e; skyBot = 0x143d14; break; // Jungle
        case 5: wb = '#330033'; fb = '#110011'; skyTop = 0x000000; skyBot = 0xff00ff; break; // Alien Abyss
        default: wb = '#95a5a6'; fb = '#bdc3c7'; skyTop = 0x3498db; skyBot = 0xb0c4de; 
    }
    
    if (level === 3 || level === 5) {
        scene.fog = new THREE.FogExp2(skyBot, 0.06);
    } else {
        scene.fog = new THREE.FogExp2(skyBot, 0.04); 
    }
    
    const wallTexture = createProTexture('bricks', wb); 
    const floorTexture = createProTexture('tiles', fb); 
    activeTextures.push(wallTexture, floorTexture);

    const planeGeo = new THREE.PlaneGeometry(120, 120); 
    const planeMat = new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.8, metalness: 0.2, bumpScale: 0.5 }); 
    floorTexture.repeat.set(10, 10); 
    
    currentFloor = new THREE.Mesh(planeGeo, planeMat); 
    currentFloor.rotation.x = -Math.PI / 2; 
    currentFloor.position.set(47.5, 0, 47.5); 
    currentFloor.receiveShadow = true; 
    scene.add(currentFloor);
    if (envGroup) envGroup.add(currentFloor);
    
    const wallGeo = new THREE.BoxGeometry(cellSize, 6, cellSize); 
    const wallMat = new THREE.MeshStandardMaterial({ 
        map: wallTexture, 
        roughness: 0.7, 
        metalness: level >= 3 ? 0.8 : 0.1,
        emissive: level === 3 ? 0x00ff41 : (level === 5 ? 0xff00ff : 0x000000),
        emissiveIntensity: 0.05
    }); 
    const isPVP = isMultiplayerMode && !isCoopMode; 
    const isOpenLevel = isPVP; 
    const longWallGeo = new THREE.BoxGeometry(cellSize, 6, cellSize * 3); 
    
    const rampShape = new THREE.Shape(); 
    rampShape.moveTo(0, 0); 
    rampShape.lineTo(0, 6); 
    rampShape.lineTo(10, 0); 
    rampShape.lineTo(0, 0); 
    
    const rampExtrudeSettings = { steps: 1, depth: 5, bevelEnabled: false }; 
    const rampGeo = new THREE.ExtrudeGeometry(rampShape, rampExtrudeSettings); 
    rampGeo.center(); 
    rampGeo.translate(0, 3, 0); 
    
    const rampMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9, map: floorTexture, side: THREE.DoubleSide }); 
    const wallRNG = mulberry32(level * 777); 
    
    if (isOpenLevel) { 
        const centralPlat = new THREE.Mesh(new THREE.BoxGeometry(15, 4, 15), wallMat); 
        centralPlat.position.set(50, 2, 50); 
        centralPlat.receiveShadow = true; 
        centralPlat.castShadow = true; 
        scene.add(centralPlat); 
        walls.push(centralPlat); 
        
        const rN = new THREE.Mesh(rampGeo, rampMat); 
        rN.position.set(47.5, 0, 40); 
        rN.rotation.y = 0; 
        rN.castShadow = true; 
        rN.receiveShadow = true; 
        scene.add(rN); 
        ramps.push(rN); 
        
        const rS = new THREE.Mesh(rampGeo, rampMat); 
        rS.position.set(52.5, 0, 60); 
        rS.rotation.y = Math.PI; 
        rS.castShadow = true; 
        rS.receiveShadow = true; 
        scene.add(rS); 
        ramps.push(rS); 
        
        const lw1 = new THREE.Mesh(longWallGeo, wallMat); 
        lw1.position.set(20, 3, 50); 
        lw1.castShadow = true; 
        scene.add(lw1); 
        walls.push(lw1); 
        
        const lw2 = new THREE.Mesh(longWallGeo, wallMat); 
        lw2.position.set(80, 3, 50); 
        lw2.castShadow = true; 
        scene.add(lw2); 
        walls.push(lw2); 
        
        const r1 = new THREE.Mesh(rampGeo, rampMat); 
        r1.position.set(15, 0, 25); 
        r1.rotation.y = Math.PI / 2; 
        r1.castShadow = true; 
        r1.receiveShadow = true; 
        scene.add(r1); 
        ramps.push(r1); 
        
        const r2 = new THREE.Mesh(rampGeo, rampMat); 
        r2.position.set(85, 0, 75); 
        r2.rotation.y = -Math.PI / 2; 
        r2.castShadow = true; 
        r2.receiveShadow = true; 
        scene.add(r2); 
        ramps.push(r2); 
        if (envGroup) envGroup.add(r2);
        
        const r3 = new THREE.Mesh(rampGeo, rampMat); 
        r3.position.set(45, 0, 15); 
        r3.castShadow = true; 
        r3.receiveShadow = true; 
        scene.add(r3); 
        ramps.push(r3); 
        if (envGroup) envGroup.add(r3);
        
        const r4 = new THREE.Mesh(rampGeo, rampMat); 
        r4.position.set(55, 0, 85); 
        r4.rotation.y = Math.PI; 
        r4.castShadow = true; 
        r4.receiveShadow = true; 
        scene.add(r4); 
        ramps.push(r4); 
        if (envGroup) envGroup.add(r4);
        
        const r5 = new THREE.Mesh(rampGeo, rampMat); 
        r5.position.set(85, 0, 25); 
        r5.rotation.y = Math.PI; 
        r5.castShadow = true; 
        r5.receiveShadow = true; 
        scene.add(r5); 
        ramps.push(r5); 
        if (envGroup) envGroup.add(r5);
        
        const r6 = new THREE.Mesh(rampGeo, rampMat); 
        r6.position.set(15, 0, 75); 
        r6.rotation.y = 0; 
        r6.castShadow = true; 
        r6.receiveShadow = true; 
        scene.add(r6); 
        ramps.push(r6); 
        if (envGroup) envGroup.add(r6);
    }
    
    for (let i = 0; i < mazeSize; i++) { 
        for (let j = 0; j < mazeSize; j++) { 
            let shouldPlaceWall = false; 
            const rngVal = wallRNG(); 
            
            if (isOpenLevel) { 
                const isBorder = (i === 0 || i === mazeSize - 1 || j === 0 || j === mazeSize - 1); 
                if (isBorder) shouldPlaceWall = true; 
                
                const cx = j * 5; 
                const cz = i * 5; 
                const distCenter = Math.sqrt((cx-50)**2 + (cz-50)**2); 
                if (distCenter > 15 && distCenter < 40 && rngVal < 0.1) shouldPlaceWall = true; 
            } else { 
                shouldPlaceWall = (mazeMap[i][j] === 1); 
                if (level > 1 && !shouldPlaceWall && i > 2 && i < mazeSize - 3 && j > 2 && j < mazeSize - 3) { 
                    if (rngVal < (level * 0.04)) shouldPlaceWall = true; 
                } 
            } 
            
            if (shouldPlaceWall) { 
                const w = new THREE.Mesh(wallGeo, wallMat); 
                w.position.set(j * cellSize, 3, i * cellSize); 
                w.castShadow = true; 
                w.receiveShadow = true; 
                scene.add(w); 
                walls.push(w); 
                if (envGroup) envGroup.add(w);
            } 
        } 
    }
    
    const farolHeight = 8;
    const farolBaseGeo = new THREE.CylinderGeometry(cellSize * 0.6, cellSize * 0.7, farolHeight, 8);
    const farolMat = new THREE.MeshStandardMaterial({ color: 0x555555, map: wallTexture, roughness: 0.9 });

    const mapCorners = [
        { x: 0, z: 0, color: 0xff0000 },                                  // Canto Superior Esquerdo: Vermelho
        { x: mazeSize - 1, z: 0, color: 0x0088ff },                        // Canto Superior Direito: Azul
        { x: 0, z: mazeSize - 1, color: 0x00ff41 },                        // Canto Inferior Esquerdo: Verde
        { x: mazeSize - 1, z: mazeSize - 1, color: 0xffaa00 }              // Canto Inferior Direito: Amarelo
    ];

    mapCorners.forEach(corner => {
        const base = new THREE.Mesh(farolBaseGeo, farolMat);
        base.position.set(corner.x * cellSize, 6 + (farolHeight / 2), corner.z * cellSize);
        base.castShadow = true;
        base.receiveShadow = true;
        scene.add(base);
        walls.push(base); 
        if (envGroup) envGroup.add(base);

        const lampGeo = new THREE.CylinderGeometry(cellSize * 0.5, cellSize * 0.5, 2.5, 8);
        const lampMat = new THREE.MeshStandardMaterial({
            color: corner.color,
            emissive: corner.color,
            emissiveIntensity: 2,
            transparent: true,
            opacity: 0.9
        });
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        const lampY = 6 + farolHeight + 1.25;
        lamp.position.set(corner.x * cellSize, lampY, corner.z * cellSize);
        scene.add(lamp);

        const pLight = new THREE.PointLight(corner.color, 10, 35);
        pLight.position.set(corner.x * cellSize, lampY, corner.z * cellSize);
        scene.add(pLight);

        const roofGeo = new THREE.ConeGeometry(cellSize * 0.7, 3, 8);
        const roofMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.set(corner.x * cellSize, lampY + 1.25 + 1.5, corner.z * cellSize);
        scene.add(roof);
    });

    // FINAL COLLISION SYNC: Ensure ALL physical objects are in the envGroup for bullet collisions
    walls.forEach(w => { if (envGroup && !envGroup.children.includes(w)) envGroup.add(w); });
    ramps.forEach(r => { if (envGroup && !envGroup.children.includes(r)) envGroup.add(r); });
    if (currentFloor && envGroup && !envGroup.children.includes(currentFloor)) envGroup.add(currentFloor);
}
