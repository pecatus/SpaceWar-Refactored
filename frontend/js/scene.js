// frontend/js/scene.js – Täydellinen Three.js renderöinti
// =============================================================================
//  Sisältää kaiken visuaalisen logiikan monoliitista client-server-malliin
// =============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';


/* ========================================================================== */
/*  GLOBAALIT MUUTTUJAT                                                       */
/* ========================================================================== */
let scene, camera, renderer, controls, composer;
let backgroundStars, nebulaSprites = [];
let ready = false;
let animStarted = false;
const clock = new THREE.Clock();
let animationFrameId = null; // Lisätään viittaus animaatioloopin ID:hen

// Taulukko diffeille
const pendingDiffs = [];

// Indeksit nopeaan hakuun
const starsById = new Map();
const shipsById = new Map();
const starConnections = [];
const starGlows = [];

// Nopea haku aluksille tähden perusteella
const shipsByStarClient = new Map(); // starId -> Set<shipMesh>

// Valinta ja interaktio
let selectedStar = null;
let hoveredStar = null;
let selectedShips = [];
let selectionIndicatorMesh = null;
let isAreaSelecting = false;
let areaSelectionStartPoint = new THREE.Vector2();
let mouseDownPosition = null;
const CLICK_DRAG_THRESHOLD = 5;

// Visuaaliset konstantit
const PLAYER_COLOR = 0x68c5ff;
const NEUTRAL_COLOR = 0xffffff;
const SHIP_COLOR_PLAYER = 0x9ed6f9;
const SELECTED_SHIP_COLOR = 0x00ff00;

const STAR_GLOW_DEFAULT_OPACITY = 0.6;
const STAR_GLOW_HOVER_OPACITY = 0.9;
const STAR_GLOW_SELECTED_OPACITY = 1.0;
const STAR_GLOW_DEFAULT_SCALE = 6.0;
const STAR_GLOW_HOVER_SCALE_FACTOR = 1.25;
const STAR_GLOW_SELECTED_SCALE_FACTOR = 1.50;

const frustum = new THREE.Frustum();
const cameraMatrix = new THREE.Matrix4();

const INDICATOR_BASE_COLOR = 0x6495ED;
const INDICATOR_SPRITE_SCALE = 2.8;

// Luo yksi InstancedMesh per alustyyppi
const SHIP_INSTANCED_MESHES = {};
const MAX_SHIPS_PER_TYPE = 4000;

// Ship instance management
const shipInstanceData = {
    Fighter: { count: 0, matrices: [], colors: [], ids: new Map() },
    Destroyer: { count: 0, matrices: [], colors: [], ids: new Map() },
    Cruiser: { count: 0, matrices: [], colors: [], ids: new Map() },
    'Slipstream Frigate': { count: 0, matrices: [], colors: [], ids: new Map() }
};

// LISÄÄ TÄMÄ UUSI MUUTTUJA:
const freeInstanceSlots = {
    Fighter: new Set(),
    Destroyer: new Set(),
    Cruiser: new Set(),
    'Slipstream Frigate': new Set()
};

// Shipyard ring instances
const SHIPYARD_RING_INSTANCES = {
    level1: null,
    level2: null,
    level3: null,
    level4: null
};

const MAX_SHIPYARDS = 100; // Max per level

// Ring instance tracking
const shipyardRingData = {
    level1: { count: 0, rotations: [], speeds: [], starIds: [] },
    level2: { count: 0, rotations: [], speeds: [], starIds: [] },
    level3: { count: 0, rotations: [], speeds: [], starIds: [] },
    level4: { count: 0, rotations: [], speeds: [], starIds: [] }
};

// Defense ring instances
const DEFENSE_RING_INSTANCES = {
    level1: null,
    level2: null,
    level3: null,
    level4: null
};

const MAX_DEFENSE_RINGS = 200; // Max per level

// Defense ring instance tracking
const defenseRingData = {
    level1: { count: 0, starIds: [] },
    level2: { count: 0, starIds: [] },
    level3: { count: 0, starIds: [] },
    level4: { count: 0, starIds: [] }
};

// Combat ring instances
let COMBAT_RING_INSTANCE = null;
const MAX_COMBAT_RINGS = 50; // Voidaan nostaa!

const combatRingData = {
    count: 0,
    starIds: [],
    opacities: [],
    rotations: []
};

const freeCombatRingSlots = new Set();

// Raycasting ja mouse
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Efektit
const explosions = [];

// Lisää taisteluefektien hallinta
const combatEffects = new Map();
const activeCombatStars = new Set(); // Tähdet joissa on aktiivinen taistelu
const starsToCheck = new Set(); // Tähdet joita pitää tarkistaa
let lastCombatCheck = 0; // Tarkistetaan vain muutaman framen välein
const COMBAT_CHECK_INTERVAL = 500;
let globalLaserPool = null;

// Combat effect limits
const MAX_ACTIVE_COMBAT_EFFECTS = 100;

// FPS ja frame time laskuri
let fpsStats = {
    frameCount: 0,
    lastTime: performance.now(),
    fps: 0,
    frameTime: 0,
    lastFrameTime: performance.now()
};

let frameSkipCounter = 0; // LISÄÄ TÄMÄ RIVI

let performanceMonitor = {
    lastCleanup: Date.now(),
    cleanupInterval: 5000, // MUUTOS: 30s -> 5s
    shipCount: 0,
    effectCount: 0
};

/* ========================================================================== */
/*  TEKSTUURIT JA MATERIAALIT                                                 */
/* ========================================================================== */

// Glow-tekstuuri
function createGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 0,
        canvas.width / 2, canvas.height / 2, canvas.width / 2
    );
    gradient.addColorStop(0, 'rgba(255,215,255,0.8)');
    gradient.addColorStop(0.3, 'rgba(255,255,200,0.5)');
    gradient.addColorStop(1, 'rgba(255,255,150,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return new THREE.CanvasTexture(canvas);
}

// Soft star sprite
function createSoftStarTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0.00, 'rgba(255,255,255,1)');
    g.addColorStop(0.50, 'rgba(255,255,255,0.6)');
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

// Nebula-tekstuuri
function createNebulaTexture(size = 1024) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(
        size/2, size/2, 40,
        size/2, size/2, size/2
    );
    g.addColorStop(0.00, 'rgba(100, 80,255,0.85)');
    g.addColorStop(0.25, 'rgba( 40, 60,200,0.55)');
    g.addColorStop(0.55, 'rgba( 220, 30,120,0.25)');
    g.addColorStop(1.00, 'rgba(  0,  0,  0,0.00)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.needsUpdate = true;
    return tex;
}

// Indikaattori-tekstuurit
function createSquareTexture(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    context.fillStyle = new THREE.Color(color).getStyle();
    context.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(canvas);
}

function createCircleTexture(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    context.beginPath();
    context.arc(16, 16, 15, 0, 2 * Math.PI, false);
    context.fillStyle = new THREE.Color(color).getStyle();
    context.fill();
    return new THREE.CanvasTexture(canvas);
}

function createOctagonTexture(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const numberOfSides = 8;
    const size = 32;
    const Xcenter = 32;
    const Ycenter = 32;
    ctx.beginPath();
    ctx.moveTo(Xcenter + size * Math.cos(0), Ycenter + size * Math.sin(0));
    for (var i = 1; i <= numberOfSides; i += 1) {
        ctx.lineTo(Xcenter + size * Math.cos(i * 2 * Math.PI / numberOfSides), 
                   Ycenter + size * Math.sin(i * 2 * Math.PI / numberOfSides));
    }
    ctx.fillStyle = new THREE.Color(color).getStyle();
    ctx.fill();
    return new THREE.CanvasTexture(canvas);
}

// Spark-tekstuuri räjähdyksille
function createSparkTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,200,80,1)');
    g.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

// Globaalit tekstuurit ja materiaalit
const glowTexture = createGlowTexture();
const softStarTex = createSoftStarTexture();
const NEBULA_TEXTURE = createNebulaTexture(768);
const SPARK_TEX = createSparkTexture();

const SPARK_MAT = new THREE.PointsMaterial({
    map: SPARK_TEX,
    size: 3,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});

// Starlane const
const STARLANE_MAT = new THREE.LineBasicMaterial({
    color: 0x8888ff,
    transparent: true,
    opacity: 0.35,
    depthWrite: false
});

// Nebula-värit ja materiaalit
const NEBULA_TINTS = [0x4477ff, 0x7755dd, 0x8844bb, 0xaa3377, 0x9944cc, 0x0094cc];

function buildNebulaMaterials(opacity) {
    return NEBULA_TINTS.map(col =>
        new THREE.SpriteMaterial({
            map: NEBULA_TEXTURE,
            color: col,
            transparent: true,
            opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        })
    );
}

const MAT_SMALL = buildNebulaMaterials(0.06);
const MAT_BIG = buildNebulaMaterials(0.18);

// Indikaattori-materiaalit
let mineIndicatorTexture, popIndicatorTexture, shipyardIndicatorTexture;
let mineSpriteMaterial, popSpriteMaterial, shipyardSpriteMaterial;

// apufunktio rakenteiden debuggaamiseen:
function debugShipsByStarClient() {
    // console.log('[DEBUG] Ships by star:');
    shipsByStarClient.forEach((ships, starId) => {
        const star = starsById.get(starId);
        const starName = star?.userData?.starData?.name || 'Unknown';
        // console.log(`  ${starName}: ${ships.size} ships`);
    });
}

/* ========================================================================== */
/*  TAISTELUEFEKTIT PELAAJAN VIIHDYTTÄMISEKSI KUNNES RESULT TAISTELUSTA       */
/* ========================================================================== */

class ExplosionPool {
    constructor(scene, maxExplosions = 50) {
        this.scene = scene;
        this.available = [];
        this.active = [];
        
        // Luo spark-materiaali
        this.sparkMaterial = new THREE.PointsMaterial({
            map: SPARK_TEX, // Käytä olemassa olevaa tekstuuria
            size: 3,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true // Mahdollistaa eri väriset räjähdykset
        });
        
        // Esiluodaan räjähdysgeometriat
        for (let i = 0; i < maxExplosions; i++) {
            const particleCount = 12; // Vähemmän partikkeleita per räjähdys
            const geometry = new THREE.BufferGeometry();
            
            // Positions
            const positions = new Float32Array(particleCount * 3);
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            
            // Colors
            const colors = new Float32Array(particleCount * 3);
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            
            const points = new THREE.Points(geometry, this.sparkMaterial);
            points.visible = false;
            this.scene.add(points);
            
            this.available.push({
                points: points,
                velocities: new Array(particleCount),
                life: 0,
                ttl: 0.8,
                active: false
            });
            
            // Alusta velocity-array
            for (let j = 0; j < particleCount; j++) {
                this.available[i].velocities[j] = new THREE.Vector3();
            }
        }
    }
    
    spawn(position, type = 'small') {
        const explosion = this.available.pop();
        if (!explosion) return null; // Pool täynnä
        
        const { points, velocities } = explosion;
        const positions = points.geometry.attributes.position.array;
        const colors = points.geometry.attributes.color.array;
        const particleCount = velocities.length;
        
        // Aseta räjähdyksen parametrit tyypin mukaan
        let speed, color, size;
        switch(type) {
            case 'small':
                speed = 15;
                color = new THREE.Color(1, 0.8, 0.3); // Oranssi
                size = 2;
                break;
            case 'medium':
                speed = 25;
                color = new THREE.Color(1, 0.5, 0.2); // Punainen
                size = 3;
                break;
            case 'spark':
                speed = 10;
                color = new THREE.Color(1, 1, 0.8); // Valkoinen
                size = 1.5;
                break;
        }
        
        points.material.size = size;
        
        // Alusta partikkelit
        for (let i = 0; i < particleCount; i++) {
            // Kaikki alkavat samasta pisteestä
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;
            
            // Satunnainen suunta
            velocities[i].set(
                (Math.random() - 0.5),
                (Math.random() - 0.5),
                (Math.random() - 0.5)
            ).normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.5));
            
            // Väri (vähän vaihtelua)
            colors[i * 3] = color.r * (0.8 + Math.random() * 0.2);
            colors[i * 3 + 1] = color.g * (0.8 + Math.random() * 0.2);
            colors[i * 3 + 2] = color.b * (0.8 + Math.random() * 0.2);
        }
        
        points.geometry.attributes.position.needsUpdate = true;
        points.geometry.attributes.color.needsUpdate = true;
        
        points.position.copy(position);
        points.visible = true;
        
        explosion.life = 0;
        explosion.ttl = 0.6 + Math.random() * 0.2; // Vähän vaihtelua
        explosion.active = true;
        
        this.active.push(explosion);
        return explosion;
    }
    
    update(delta) {
        if (frameSkipCounter % 2 !== 0) return;
        for (let i = this.active.length - 1; i >= 0; i--) {
            const explosion = this.active[i];
            if (!explosion.active) continue;
            
            explosion.life += delta;
            const progress = explosion.life / explosion.ttl;
            
            if (progress >= 1) {
                // Palauta pooliin
                explosion.points.visible = false;
                explosion.active = false;
                this.available.push(explosion);
                this.active.splice(i, 1);
                continue;
            }
            
            // Päivitä opacity
            explosion.points.material.opacity = 1 - progress;
            
            // Päivitä positiot
            const positions = explosion.points.geometry.attributes.position.array;
            const velocities = explosion.velocities;
            
            for (let j = 0; j < velocities.length; j++) {
                positions[j * 3] += velocities[j].x * delta;
                positions[j * 3 + 1] += velocities[j].y * delta;
                positions[j * 3 + 2] += velocities[j].z * delta;
                
                // Gravity effect
                velocities[j].y -= 10 * delta;
            }
            
            explosion.points.geometry.attributes.position.needsUpdate = true;
        }
    }
    
    cleanup() {
        this.available.forEach(exp => {
            this.scene.remove(exp.points);
            exp.points.geometry.dispose();
        });
        this.active.forEach(exp => {
            this.scene.remove(exp.points);
        });
        this.sparkMaterial.dispose();
    }
}


// YKSINKERTAISTETTU CombatEffectGroup ilman lasereita
class CombatEffectGroup {
    constructor(star, scene) {
        this.star = star;
        this.scene = scene;
        this.active = true;
        this.explosionTimer = 0;
        this.instanceIndex = -1; 
        this.createEffects();
    }
    
    createEffects() {
        if (!COMBAT_RING_INSTANCE) return;
        
        const data = combatRingData;

        if (freeCombatRingSlots.size > 0) {
            this.instanceIndex = freeCombatRingSlots.values().next().value;
            freeCombatRingSlots.delete(this.instanceIndex);
            console.log(`Reusing combat ring slot ${this.instanceIndex}`);
        } else {
            this.instanceIndex = data.count;
            data.count++;
        }
        
        const dummy = new THREE.Object3D();
        dummy.position.copy(this.star.position);
        dummy.rotation.x = Math.PI / 2;
        dummy.updateMatrix();
        
        COMBAT_RING_INSTANCE.setMatrixAt(this.instanceIndex, dummy.matrix);
        
        // Tallenna metadata
        data.starIds[this.instanceIndex] = this.star.userData.starData._id;
        data.opacities[this.instanceIndex] = 0.1;
        data.rotations[this.instanceIndex] = 0;
        
        COMBAT_RING_INSTANCE.count = data.count;
        COMBAT_RING_INSTANCE.instanceMatrix.needsUpdate = true;
    }
    
    update(delta, ships) {
        if (!this.active || this.instanceIndex === -1) return;
        
        // Ei värianimaatiota - vain päivitä rotaatio
        combatRingData.rotations[this.instanceIndex] += delta * 0.2;
        
        // Räjähdykset alusten määrän mukaan
        this.explosionTimer += delta;
        
        if (ships.length > 0) {
            // Räjähdysten tiheys riippuu alusten määrästä
            const explosionRate = 0.2 - Math.min(0.15, ships.length * 0.02); // 0.05-0.2 sekuntia
            
            if (this.explosionTimer > explosionRate) {
                this.explosionTimer = 0;
                
                // 1-3 räjähdystä kerralla
                const explosionCount = Math.min(3, 1 + Math.floor(ships.length / 5));
                
                for (let i = 0; i < explosionCount; i++) {
                    this.spawnCombatExplosion(ships);
                }
            }
        }
    }
    
    spawnCombatExplosion(ships) {
        let position;
        
        // 70% räjähdyksistä alusten lähellä, 30% random
        if (Math.random() < 0.7 && ships.length > 0) {
            // Valitse satunnainen alus
            const ship = ships[Math.floor(Math.random() * ships.length)];
            
            // Räjähdys aluksen lähellä
            const offset = new THREE.Vector3(
                (Math.random() - 0.5) * 10,
                (Math.random() - 0.5) * 5,
                (Math.random() - 0.5) * 10
            );
            
            position = ship.position.clone().add(offset);
        } else {
            // Satunnainen paikka planeetan ympärillä
            const angle = Math.random() * Math.PI * 2;
            const radius = 20 + Math.random() * 15;
            const height = (Math.random() - 0.5) * 10;
            
            position = new THREE.Vector3(
                this.star.position.x + Math.cos(angle) * radius,
                this.star.position.y + height,
                this.star.position.z + Math.sin(angle) * radius
            );
        }
        
        // Käytä explosion poolia jos käytettävissä
        if (window.explosionPool) {
            // Vaihtele räjähdystyyppejä
            const types = ['small', 'small', 'medium', 'spark']; // Enemmän pieniä
            const type = types[Math.floor(Math.random() * types.length)];
            window.explosionPool.spawn(position, type);
        } else {
            // Fallback vanhaan systeemiin
            spawnExplosion(position, 8 + Math.floor(Math.random() * 6));
        }
    }
    
    cleanup() {
        this.active = false;
        
        if (this.instanceIndex !== -1 && COMBAT_RING_INSTANCE) {
            const data = combatRingData;
            
            // Piilota instanssi
            const dummy = new THREE.Object3D();
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            COMBAT_RING_INSTANCE.setMatrixAt(this.instanceIndex, dummy.matrix);
            
            // Siivoa metadata
            data.starIds[this.instanceIndex] = null;
            data.opacities[this.instanceIndex] = 0;
            data.rotations[this.instanceIndex] = 0;
            
            // Vapauta slotti uudelleenkäyttöön
            freeCombatRingSlots.add(this.instanceIndex);
            console.log(`Freed combat ring slot ${this.instanceIndex}, now ${freeCombatRingSlots.size} free slots`);
            
            COMBAT_RING_INSTANCE.instanceMatrix.needsUpdate = true;
        }
    }
}



/* ========================================================================== */
/*  INITTHREE - PÄÄFUNKTIO                                                    */
/* ========================================================================== */
export function initThreeIfNeeded(mountTo = document.body) {
    if (ready) return;
    ready = true;

    // console.log("Initializing Three.js scene...");

    // Scene setup
    scene = new THREE.Scene();
    
    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
    camera.position.set(0, 100, 220);

    // Renderer
    renderer = new THREE.WebGLRenderer({
        canvas: document.getElementById('gameCanvas') || document.createElement('canvas'),
        antialias: true,
        powerPreference: "high-performance"
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    
    // Jos canvas ei ole DOM:ssa, lisätään se
    if (!document.getElementById('gameCanvas')) {
        renderer.domElement.id = 'gameCanvas';
        renderer.domElement.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:1;cursor:default;';
        mountTo.appendChild(renderer.domElement);
    }

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x909090, 1);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
    directionalLight.position.set(70, 100, 60);
    scene.add(directionalLight);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.maxDistance = 2000;
    controls.minDistance = 10;

    // Post-processing
    setupPostProcessing();

    // Background elements
    createBackgroundStarfield();
    createNebulaSprites();
    
    // Alusta InstancedMesh systeemi
    initShipInstances(); 
    Object.values(SHIP_INSTANCED_MESHES).forEach(mesh => {
        mesh.frustumCulled = false;
        if (!scene.children.includes(mesh)) {
            //console.log('Adding mesh to scene in init');
            scene.add(mesh);
        }
    });

    initShipyardRingInstances();

    initDefenseRingInstances();

    initCombatRingInstances();

    // Indikaattori-materiaalit
    initIndicatorMaterials();
    
    // Selection indicator
    initializeSelectionIndicator();

    // Event listeners
    setupEventListeners();

    // Viihdytysräjähdykset
    window.explosionPool = new ExplosionPool(scene, 50);

    // Responsive
    window.addEventListener('resize', onWindowResize, false);

    // console.log("Three.js scene initialized successfully");
}

function setupPostProcessing() {
    composer = new EffectComposer(renderer);
    
    const starsPass = new RenderPass(scene, camera);
    starsPass.clear = true;
    composer.addPass(starsPass);
    
}


function updateVisibleNebulas() {
    cameraMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(cameraMatrix);
    
    nebulaSprites.forEach(sp => {
        if (frustum.intersectsObject(sp)) {
            sp.quaternion.copy(camera.quaternion);
        }
    });
}

function getShipGeometry(type) {
    let geometry;
    switch (type) {
        case 'Destroyer':
            geometry = new THREE.CylinderGeometry(0.7, 0.7, 4.5, 8);
            geometry.rotateX(Math.PI / 2);
            break;
        case 'Cruiser':
            geometry = new THREE.SphereGeometry(1.1, 18, 14);
            geometry.scale(2.5, 1.8, 3.8);
            break;
        case 'Slipstream Frigate':
            geometry = new THREE.ConeGeometry(1.2, 5, 4);
            geometry.rotateX(Math.PI / 2);
            geometry.scale(1, 0.7, 1.2);
            break;
        default: // Fighter
            geometry = new THREE.ConeGeometry(1, 3, 4);
            geometry.rotateX(Math.PI / 2);
    }
    return geometry;
}

function getShipMaterial(baseColor) {
    return new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: baseColor,
        emissiveIntensity: 0.3
    });
}

function initShipInstances() {
    // console.log('🎯 initShipInstances called, scene exists:', !!scene);
    
    ['Fighter', 'Destroyer', 'Cruiser', 'Slipstream Frigate'].forEach(type => {
        const geometry = getShipGeometry(type);
        
        const material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0x000000,
            emissiveIntensity: 0.3,
            metalness: 0.3,  // LISÄYS: Hieman metallisuutta
            roughness: 0.4
        });
        
        const instancedMesh = new THREE.InstancedMesh(geometry, material, MAX_SHIPS_PER_TYPE);
        instancedMesh.count = 0;
        
        const colors = new Float32Array(MAX_SHIPS_PER_TYPE * 3);
        for (let i = 0; i < colors.length; i++) {
            colors[i] = 1.0;
        }
        
        instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        
        // LISÄÄ TÄMÄ DEBUG
        // console.log(`Adding ${type} to scene...`);
        scene.add(instancedMesh);
        //console.log(`${type} added to scene:`, scene.children.includes(instancedMesh));
        
        SHIP_INSTANCED_MESHES[type] = instancedMesh;
        
        //console.log(`Created InstancedMesh for ${type}`);
    });
}

function initShipyardRingInstances() {
    Object.keys(shipyardRingData).forEach(level => {
        shipyardRingData[level] = { 
            count: 0, 
            rotations: [], 
            speeds: [], 
            starIds: [] 
        };
    });
    
    const tubeRadius = 0.25;
    const baseRadius = 10;
    
    const ringTilts = [
        new THREE.Euler(THREE.MathUtils.degToRad(45), 0, 0),   // Lvl 1
        new THREE.Euler(0, THREE.MathUtils.degToRad(-45), 0),  // Lvl 2
        new THREE.Euler(0, 0, THREE.MathUtils.degToRad(-45)),  // Lvl 3
        new THREE.Euler(THREE.MathUtils.degToRad(90), 0, 0)   // Lvl 4
    ];
    
    const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        toneMapped: false
    });
    
    ['level1', 'level2', 'level3', 'level4'].forEach((level, index) => {
        const geometry = new THREE.TorusGeometry(baseRadius, tubeRadius, 16, 64); // Vähemmän segmenttejä
        const instancedMesh = new THREE.InstancedMesh(geometry, material, MAX_SHIPYARDS);
        instancedMesh.count = 0;
        instancedMesh.frustumCulled = false;
        // --- renkaat piirtyvät glow-spritejen päälle ---
       instancedMesh.material.depthTest  = false; // älä hylkää pikseleitä syvyystestin takia
       instancedMesh.material.depthWrite = false; // ei kirjoiteta syvyys­puskuriin
       instancedMesh.renderOrder = 6;             // suurempi kuin glow-spritejen oletus (0)

        // Aseta perusrotaatio kaikille tämän tason instansseille
        const baseRotation = ringTilts[index];
        instancedMesh.userData.baseRotation = baseRotation;
        
        scene.add(instancedMesh);
        SHIPYARD_RING_INSTANCES[level] = instancedMesh;

        // ==== DEBUG: saat instanssit devtools-konsolissa näkyviin ====
        window.SHIPYARD_RING_INSTANCES = SHIPYARD_RING_INSTANCES; // poista kun et enää tarvitse
            if (typeof process !== 'undefined' &&
            process.env &&
            process.env.NODE_ENV !== 'production') {
            window.SHIPYARD_RING_INSTANCES = SHIPYARD_RING_INSTANCES;
        }
    });
}

function initDefenseRingInstances() {
    ['level1', 'level2', 'level3', 'level4'].forEach((level, index) => {
        const geometry = new THREE.RingGeometry(10 - 0.2, 10 + 0.2, 64);
        
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
            depthWrite: false
        });
        
        const instancedMesh = new THREE.InstancedMesh(geometry, material, MAX_DEFENSE_RINGS);
        instancedMesh.count = 0;
        instancedMesh.frustumCulled = false;
        // POISTA TÄMÄ RIVI:
        // instancedMesh.rotation.x = Math.PI / 2;
        
        const colors = new Float32Array(MAX_DEFENSE_RINGS * 3);
        for (let i = 0; i < colors.length; i++) {
            colors[i] = 1.0;
        }
        instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        
        scene.add(instancedMesh);
        DEFENSE_RING_INSTANCES[level] = instancedMesh;
    });
}

function initCombatRingInstances() {
    const geometry = new THREE.RingGeometry(5, 15, 24);
    
    const material = new THREE.MeshBasicMaterial({
        color: 0xff0000,  // Punainen
        transparent: true,
        opacity: 0.2,     // Staattinen 0.3 opacity
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    
    COMBAT_RING_INSTANCE = new THREE.InstancedMesh(geometry, material, MAX_COMBAT_RINGS);
    COMBAT_RING_INSTANCE.count = 0;
    COMBAT_RING_INSTANCE.frustumCulled = false;
    
    // Ei tarvita väripufferia koska käytetään vain punaista
    
    scene.add(COMBAT_RING_INSTANCE);
}

function initIndicatorMaterials() {
    mineIndicatorTexture = createSquareTexture(new THREE.Color(INDICATOR_BASE_COLOR));
    popIndicatorTexture = createCircleTexture(new THREE.Color(INDICATOR_BASE_COLOR));
    shipyardIndicatorTexture = createOctagonTexture(new THREE.Color(INDICATOR_BASE_COLOR));

    mineSpriteMaterial = new THREE.SpriteMaterial({
        map: mineIndicatorTexture,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9
    });
    
    popSpriteMaterial = new THREE.SpriteMaterial({
        map: popIndicatorTexture,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9
    });
    
    shipyardSpriteMaterial = new THREE.SpriteMaterial({
        map: shipyardIndicatorTexture,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9
    });
}

function createBackgroundStarfield() {
    const starGeometry = new THREE.BufferGeometry();
    const starMaterial = new THREE.PointsMaterial({
        map: softStarTex,
        color: 0xffffff,
        size: 1.0,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false
    });

    const starVertices = [];
    for (let i = 0; i < 5000; i++) {
        const x = THREE.MathUtils.randFloatSpread(4000);
        const y = THREE.MathUtils.randFloatSpread(4000);
        const z = THREE.MathUtils.randFloatSpread(4000);
        starVertices.push(x, y, z);
    }
    
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    backgroundStars = new THREE.Points(starGeometry, starMaterial);
    scene.add(backgroundStars);
}

function createNebulaSprites() {
    const radius = 2000;
    const height = radius * 1.2;

    const rndPos = () => {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius;
        const y = (Math.random() - 0.5) * height;
        return new THREE.Vector3(
            r * Math.cos(angle),
            y,
            r * Math.sin(angle)
        );
    };

    // Pienet sumut
    for (let i = 0; i < 200; i++) {
        const mat = MAT_SMALL[Math.floor(Math.random() * MAT_SMALL.length)].clone();
        mat.opacity *= 0.55;
        const spr = new THREE.Sprite(mat);
        const s = THREE.MathUtils.randFloat(150, 240);
        spr.scale.set(s, s, 1);
        spr.position.copy(rndPos());
        scene.add(spr);
        nebulaSprites.push(spr);
    }

    // Isot sumut
    for (let i = 0; i < 40; i++) {
        const mat = MAT_BIG[Math.floor(Math.random() * MAT_BIG.length)].clone();
        mat.opacity *= 0.45;
        const spr = new THREE.Sprite(mat);
        const s = THREE.MathUtils.randFloat(900, 1400);
        spr.scale.set(s, s, 1);
        spr.position.copy(rndPos());
        scene.add(spr);
        nebulaSprites.push(spr);
    }
}

function initializeSelectionIndicator() {
    selectionIndicatorMesh = new THREE.Group();
    selectionIndicatorMesh.visible = false;
    selectionIndicatorMesh.renderOrder = 5;

    const indicatorColor = 0xffffff;
    const baseRadius = 1.5;

    // Keskusrengas
    const ringGeometry = new THREE.TorusGeometry(baseRadius, baseRadius * 0.03, 8, 64);
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: indicatorColor,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        depthTest: false
    });
    const mainRing = new THREE.Mesh(ringGeometry, ringMaterial);
    mainRing.rotation.x = Math.PI / 2;
    selectionIndicatorMesh.add(mainRing);

    // Väkärät
    const bracketMaterial = new THREE.MeshBasicMaterial({
        color: indicatorColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: false
    });

    const positions = [
        { x: baseRadius, z: 0, rotY: Math.PI / 2 },
        { x: -baseRadius, z: 0, rotY: -Math.PI / 2 },
        { x: 0, z: baseRadius, rotY: 0 },
        { x: 0, z: -baseRadius, rotY: Math.PI }
    ];

    positions.forEach(pos => {
        const bracketPlaneGeom = new THREE.PlaneGeometry(baseRadius * 0.3 * 0.6, baseRadius * 0.15 * 2);
        const bracket = new THREE.Mesh(bracketPlaneGeom, bracketMaterial);
        
        const offsetFactor = 1.15;
        bracket.position.set(pos.x * offsetFactor, 0, pos.z * offsetFactor);
        bracket.rotation.x = Math.PI / 2;
        bracket.rotation.y = pos.rotY;
        selectionIndicatorMesh.add(bracket);
    });

    scene.add(selectionIndicatorMesh);
}

function setupEventListeners() {
    const canvas = renderer.domElement;
    canvas.addEventListener('mousemove', onCanvasMouseMove, false);
    canvas.addEventListener('mousedown', onCanvasMouseDown, false);  // Lisätty
    canvas.addEventListener('mouseup', onCanvasMouseUp, false);      // Lisätty
    canvas.addEventListener('dblclick', onCanvasDoubleClick, false);
    canvas.addEventListener('contextmenu', onCanvasRightClick, false); // RMB commands
    canvas.addEventListener('click', onCanvasClick, false);
    
}

/* ========================================================================== */
/*  EVENT HANDLERS                                                            */
/* ========================================================================== */

function onCanvasMouseMove(event) {
    // Selection box päivitys
    if (isAreaSelecting) {
        const selectionBox = document.getElementById('selectionBox');
        if (selectionBox) {
            const x = Math.min(event.clientX, areaSelectionStartPoint.x);
            const y = Math.min(event.clientY, areaSelectionStartPoint.y);
            const width = Math.abs(event.clientX - areaSelectionStartPoint.x);
            const height = Math.abs(event.clientY - areaSelectionStartPoint.y);
            
            selectionBox.style.left = `${x}px`;
            selectionBox.style.top = `${y}px`;
            selectionBox.style.width = `${width}px`;
            selectionBox.style.height = `${height}px`;
        }
        return; // Älä käsittele hoveria selection aikana
    }
    
    // Hover-logiikka tähdille
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const starMeshes = Array.from(starsById.values());
    const intersects = raycaster.intersectObjects(starMeshes, false);

    let currentlyHovered = null;
    if (intersects.length > 0) {
        const firstIntersected = intersects[0].object;
        currentlyHovered = firstIntersected.userData.starData;
    }
    hoveredStar = currentlyHovered;
}

function onCanvasMouseDown(event) {
    if (event.button !== 0) return; // Vain LMB
    
    mouseDownPosition = new THREE.Vector2(event.clientX, event.clientY);
    
    if (event.shiftKey) {
        isAreaSelecting = true;
        controls.enabled = false;
        areaSelectionStartPoint.set(event.clientX, event.clientY);
        
        // Luo selection box (tarvitsee HTML-elementin)
        const selectionBox = document.getElementById('selectionBox');
        if (selectionBox) {
            selectionBox.style.left = `${event.clientX}px`;
            selectionBox.style.top = `${event.clientY}px`;
            selectionBox.style.width = '0px';
            selectionBox.style.height = '0px';
            selectionBox.style.display = 'block';
        }
    }
}

function onCanvasMouseUp(event) {
    if (event.button !== 0) return;
    
    const mouseUpPosition = new THREE.Vector2(event.clientX, event.clientY);
    let isDrag = false;
    if (mouseDownPosition) {
        isDrag = mouseDownPosition.distanceTo(mouseUpPosition) > CLICK_DRAG_THRESHOLD;
    }
    mouseDownPosition = null;
    
    // Area selection lopetus
    if (isAreaSelecting) {
        isAreaSelecting = false;
        controls.enabled = true;
        
        const selectionBox = document.getElementById('selectionBox');
        if (selectionBox) {
            selectionBox.style.display = 'none';
        }
        
        const endPoint = new THREE.Vector2(event.clientX, event.clientY);
        selectShipsInArea(areaSelectionStartPoint, endPoint, event.shiftKey);
        return;
    }
    
    if (isDrag) {
        controls.enabled = true;
        return;
    }
    
    // NORMAALI KLIKKAUS
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    
    // Check stars first
    const starMeshes = Array.from(starsById.values());
    const starIntersects = raycaster.intersectObjects(starMeshes, false);
    
    if (starIntersects.length > 0) {
        const clicked = starIntersects[0].object;
        if (!event.shiftKey) {
            deselectAllShips();
        }
        
        const starData = clicked.userData.starData;
        if (starData) {
            selectStar(starData);
        }
        return;
    }
    
    // Check virtual ships via instanced meshes
    let closestShip = null;
    let closestDistance = Infinity;
    
    // Test each ship type's instanced mesh
    Object.entries(SHIP_INSTANCED_MESHES).forEach(([type, instancedMesh]) => {
        const intersects = raycaster.intersectObject(instancedMesh, false);
        
        if (intersects.length > 0) {
            const instanceId = intersects[0].instanceId;
            
            // Find which virtual ship this instance belongs to
            shipsById.forEach(virtualShip => {
                if (virtualShip.userData.shipType === type && 
                    virtualShip.userData.instanceIndex === instanceId) {
                    const dist = intersects[0].distance;
                    if (dist < closestDistance) {
                        closestDistance = dist;
                        closestShip = virtualShip;
                    }
                }
            });
        }
    });
    
    if (closestShip) {
        handleShipClick(closestShip, event.shiftKey);
    } else {
        // Empty click
        if (!event.shiftKey) {
            deselectAllShips();
            deselectStar();
            updateSelectedUnitsDisplay();
        }
    }
}

function onCanvasRightClick(event) {
    event.preventDefault();

    if (window.isPaused) return;
    if (selectedShips.length === 0) return;
    
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const starMeshes = Array.from(starsById.values());
    const intersects = raycaster.intersectObjects(starMeshes, false);
    
    if (intersects.length > 0) {
        const targetStar = intersects[0].object.userData.starData;
        if (targetStar) {
            orderSelectedShipsToStar(targetStar);
        }
    }
}

function handleShipOrStarClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    
    // Kerää kaikki meshit mukaan lukien click targetit
    const clickableObjects = [];
    
    // Lisää star meshit
    starsById.forEach(starMesh => clickableObjects.push(starMesh));
    
    // Lisää ship meshit JA niiden click targetit
    shipsById.forEach(shipMesh => {
        clickableObjects.push(shipMesh);
        if (shipMesh.userData.clickTarget) {
            clickableObjects.push(shipMesh.userData.clickTarget);
        }
    });
    
    const intersects = raycaster.intersectObjects(clickableObjects, false);
    
    if (intersects.length > 0) {
        const clicked = intersects[0].object;
        
        // Tarkista onko click target
        let actualShipMesh = clicked;
        if (clicked.userData.isClickTarget) {
            // Etsi varsinainen ship mesh
            actualShipMesh = Array.from(shipsById.values()).find(
                mesh => mesh.userData.clickTarget === clicked
            );
        }
        
        // Käsittele ship click
        if (actualShipMesh && shipsById.has(actualShipMesh.userData.entityId)) {
            handleShipClick(actualShipMesh, event.shiftKey);
        } 
        // Käsittele star click
        else if (starsById.has(clicked.userData?.entityId)) {
            const starData = clicked.userData.starData;
            if (starData) {
                selectStar(starData);
            }
        }
    } else {
        // Tyhjä klikkaus
        if (!event.shiftKey) {
            deselectAllShips();
            deselectStar();
        }
    }
}

function onCanvasClick(event) {
    if (event.detail === 2) return; // Skip if double-click
    
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const starMeshes = Array.from(starsById.values());
    const intersects = raycaster.intersectObjects(starMeshes, false);

    if (intersects.length > 0) {
        const clickedObject = intersects[0].object;
        const starData = clickedObject.userData.starData;
        if (starData) {
            selectStar(starData);
        }
    } else {
        deselectStar();
    }
}

function onCanvasDoubleClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const starMeshes = Array.from(starsById.values());
    const intersects = raycaster.intersectObjects(starMeshes, false);

    if (intersects.length > 0) {
        const clickedObject = intersects[0].object;
        const starData = clickedObject.userData.starData;
        if (starData) {
            focusOnStar(starData);
        }
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
}

/* ========================================================================== */
/*  SELECTION & FOCUS                                                         */
/* ========================================================================== */

function selectStar(starData) {
    selectedStar = starData;
    
    if (selectionIndicatorMesh && starData.mesh) {
        selectionIndicatorMesh.position.copy(starData.mesh.position);
        const starVisualRadius = starData.mesh.geometry.parameters.radius * (starData.mesh.scale.x || 1);
        const desiredIndicatorScale = starVisualRadius + 4.0;
        selectionIndicatorMesh.scale.setScalar(desiredIndicatorScale);
        selectionIndicatorMesh.visible = true;
        
        selectionIndicatorMesh.children.forEach(child => {
            if (child.material) {
                child.material.color.setHex(0xffffff);
            }
        });
    }
    
    
    // Emit event for UI
    window.dispatchEvent(new CustomEvent('starSelected', { detail: starData }));
}

function handleShipClick(virtualShip, additive = false) {
    const shipOwnerId = virtualShip.userData.owner;
    const humanIdStr = typeof window.gameData?.humanPlayerId === 'object' ? 
                      window.gameData.humanPlayerId.toString() : 
                      window.gameData.humanPlayerId;
    
    const isPlayerShip = shipOwnerId === humanIdStr;
    if (!isPlayerShip) return;
    
    if (!additive) {
        deselectAllShips();
    }
    
    const isCurrentlySelected = selectedShips.includes(virtualShip);
    if (isCurrentlySelected) {
        deselectShip(virtualShip);
    } else {
        selectShip(virtualShip);
    }
    
    updateSelectedUnitsDisplay();
}

function deselectShip(virtualShip) {
    const index = selectedShips.indexOf(virtualShip);
    if (index === -1) return;
    
    selectedShips.splice(index, 1);
    virtualShip.userData.isSelected = false;
    
    // Restore original color
    const shipData = virtualShip.userData.shipData;
    let originalColor = SHIP_COLOR_PLAYER;
    
    if (shipData.ownerId) {
        const gameData = window.gameData;
        if (gameData && gameData.players) {
            const ownerPlayer = gameData.players.find(p => p._id === shipData.ownerId);
            if (ownerPlayer) {
                if (typeof ownerPlayer.color === 'string') {
                    originalColor = parseInt(ownerPlayer.color.replace('#', ''), 16);
                } else {
                    originalColor = ownerPlayer.color;
                }
            }
        }
    }
    
    // Update visual via instanced color
    const type = virtualShip.userData.shipType;
    const instancedMesh = SHIP_INSTANCED_MESHES[type];
    const instanceIndex = virtualShip.userData.instanceIndex;
    
    if (instancedMesh && instanceIndex !== undefined) {
        instancedMesh.setColorAt(instanceIndex, new THREE.Color(originalColor));
        if (instancedMesh.instanceColor) {
            instancedMesh.instanceColor.needsUpdate = true;
        }
    }
}

function deselectAllShips() {
    selectedShips.forEach(shipMesh => {
        deselectShip(shipMesh);
    });
    selectedShips = [];
    updateSelectedUnitsDisplay();
}

function selectShipsInArea(startVec, endVec, additive = false) {
    if (!additive) deselectAllShips();
    
    const startX = Math.min(startVec.x, endVec.x);
    const startY = Math.min(startVec.y, endVec.y);
    const endX = Math.max(startVec.x, endVec.x);
    const endY = Math.max(startVec.y, endVec.y);
    
    shipsById.forEach(virtualShip => {
        const shipData = virtualShip.userData.shipData;
        
        // Only own ships
        if (shipData.ownerId !== window.gameData?.humanPlayerId) return;
        
        // Project to screen
        const screenPos = virtualShip.position.clone().project(camera);
        const sx = (screenPos.x + 1) / 2 * window.innerWidth;
        const sy = (-screenPos.y + 1) / 2 * window.innerHeight;
        
        if (sx >= startX && sx <= endX && sy >= startY && sy <= endY) {
            if (!selectedShips.includes(virtualShip)) {
                selectShip(virtualShip);
            }
        }
    });
    
    updateSelectedUnitsDisplay();
}

function updateSelectedUnitsDisplay() {
    // Emit event clientille
    window.dispatchEvent(new CustomEvent('shipsSelected', { 
        detail: { count: selectedShips.length, ships: selectedShips } 
    }));
}

function orderSelectedShipsToStar(targetStar) {
    if (selectedShips.length === 0) return;
    
    //console.log(`Ordering ${selectedShips.length} ships to star ${targetStar.name}`);
    
    selectedShips.forEach(virtualShip => {
        const shipData = virtualShip.userData.shipData;
        
        if (!shipData || !shipData._id) {
            console.error("Virtual ship without proper data:", virtualShip);
            return;
        }
        
        const command = {
            action: 'MOVE_SHIP',
            shipId: shipData._id,
            toStarId: targetStar._id,
            fromStarId: shipData.parentStarId
        };
        
        //console.log("Sending ship command:", command);
        window.dispatchEvent(new CustomEvent('shipCommand', { detail: command }));
    });
}

function selectShip(virtualShip) {
    if (selectedShips.includes(virtualShip)) return;
    
    const shipOwnerId = virtualShip.userData.owner;
    const humanIdStr = typeof window.gameData?.humanPlayerId === 'object' ? 
                      window.gameData.humanPlayerId.toString() : 
                      window.gameData.humanPlayerId;
    
    const isPlayerShip = shipOwnerId === humanIdStr;
    if (!isPlayerShip) {
        //console.log("Cannot select - not player ship. Owner:", shipOwnerId, "Human:", humanIdStr);
        return;
    }
    
    selectedShips.push(virtualShip);
    virtualShip.userData.isSelected = true;
    
    // Update visual via instanced color
    const type = virtualShip.userData.shipType;
    const instancedMesh = SHIP_INSTANCED_MESHES[type];
    const instanceIndex = virtualShip.userData.instanceIndex;
    
    if (instancedMesh && instanceIndex !== undefined) {
        instancedMesh.setColorAt(instanceIndex, new THREE.Color(SELECTED_SHIP_COLOR));
        if (instancedMesh.instanceColor) {
            instancedMesh.instanceColor.needsUpdate = true;
        }
    }
}

function deselectStar() {
    selectedStar = null;
    if (selectionIndicatorMesh) {
        selectionIndicatorMesh.visible = false;
    }
    
    // Emit event for UI
    window.dispatchEvent(new CustomEvent('starDeselected'));
}

function focusOnStar(starData) {
    if (!starData.mesh) return;
    
    const targetPosition = starData.mesh.position.clone();
    const currentCamPos = camera.position.clone();
    const currentTarget = controls.target.clone();
    
    const offset = currentCamPos.clone().sub(currentTarget);
    const newCamPos = targetPosition.clone().add(offset);
    
    // Smooth animation would require TWEEN.js here
    controls.target.copy(targetPosition);
    camera.position.copy(newCamPos);
    controls.update();
}

function focusOnPlayerHomeworld(starMesh) {
    // console.log("Focusing camera on player homeworld");
    
    const targetPosition = starMesh.position.clone();
    const offset = new THREE.Vector3(0, 100, 220); // Same as initial camera offset
    
    controls.target.copy(targetPosition);
    camera.position.copy(targetPosition).add(offset);
    controls.update();
    
    // console.log("Camera focused on homeworld at", targetPosition);
}

/* ========================================================================== */
/*  VISUAL UPDATES                                                            */
/* ========================================================================== */

function updateAllStarVisuals() {
    // Reset all highlights
    starsById.forEach(starMesh => {
        if (starMesh.userData.glowSprite) {
            const starData = starMesh.userData.starData;
            const baseGlowSize = starMesh.geometry.parameters.radius * STAR_GLOW_DEFAULT_SCALE * 
                               (starData.isHomeworld ? 1.6 : 1.0);
            starMesh.userData.glowSprite.material.opacity = STAR_GLOW_DEFAULT_OPACITY;
            starMesh.userData.glowSprite.scale.set(baseGlowSize, baseGlowSize, 1);
        }
    });

    // Apply hover highlights
    if (hoveredStar && hoveredStar !== selectedStar && hoveredStar.mesh) {
        const glowSprite = hoveredStar.mesh.userData.glowSprite;
        if (glowSprite) {
            glowSprite.material.opacity = STAR_GLOW_HOVER_OPACITY;
            const hoverGlowSize = hoveredStar.mesh.geometry.parameters.radius * 
                                STAR_GLOW_DEFAULT_SCALE * 
                                (hoveredStar.isHomeworld ? 1.6 : 1.0) * 
                                STAR_GLOW_HOVER_SCALE_FACTOR;
            glowSprite.scale.set(hoverGlowSize, hoverGlowSize, 1);
        }
    }

    // Apply selection highlights
    if (selectedStar && selectedStar.mesh) {
        const glowSprite = selectedStar.mesh.userData.glowSprite;
        if (glowSprite) {
            glowSprite.material.opacity = STAR_GLOW_SELECTED_OPACITY;
            const selectedGlowSize = selectedStar.mesh.geometry.parameters.radius * 
                                   STAR_GLOW_DEFAULT_SCALE * 
                                   (selectedStar.isHomeworld ? 1.6 : 1.0) * 
                                   STAR_GLOW_SELECTED_SCALE_FACTOR;
            glowSprite.scale.set(selectedGlowSize, selectedGlowSize, 1);
        }
    }
}

/* ========================================================================== */
/*  EXPLOSIONS                                                                */
/* ========================================================================== */

function spawnExplosion(pos, n = 18) {
    const positions = new Float32Array(n * 3);
    const velocities = [];
    
    for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3(
            (Math.random() - 0.5),
            (Math.random() - 0.5),
            (Math.random() - 0.5)
        ).normalize().multiplyScalar(20);
        
        velocities.push(v);
        positions.set([0, 0, 0], i * 3);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geom, SPARK_MAT.clone());
    points.position.copy(pos);
    scene.add(points);

    explosions.push({ points, velocities, life: 0, ttl: 0.8 });
}

function updateExplosions(delta) {
    explosions.forEach((ex, idx) => {
        ex.life += delta;
        const f = ex.life / ex.ttl;
        ex.points.material.opacity = 1 - f;
        
        const posAttr = ex.points.geometry.attributes.position;
        for (let i = 0; i < ex.velocities.length; i++) {
            const v = ex.velocities[i];
            posAttr.array[i * 3] += v.x * delta;
            posAttr.array[i * 3 + 1] += v.y * delta;
            posAttr.array[i * 3 + 2] += v.z * delta;
        }
        posAttr.needsUpdate = true;
        
        if (ex.life >= ex.ttl) {
            scene.remove(ex.points);
            explosions.splice(idx, 1);
        }
    });
}

/* ========================================================================== */
/*  SNAPSHOT & DIFF HANDLING                                                  */
/* ========================================================================== */

export function buildFromSnapshot(snap) {
    //console.log("Building from snapshot:", snap);
    
    if (!ready) {
        console.warn("Scene not ready, initializing first");
        initThreeIfNeeded();
    }
    // ALUKSET
    // 1. Varmista, että alusten instanced‐meshit ovat scenessä
    Object.entries(SHIP_INSTANCED_MESHES).forEach(([type, mesh]) => {
        if (!scene.children.includes(mesh)) {
            //console.log(`Re-adding ${type} InstancedMesh to scene`);
            scene.add(mesh);
        }
    });

    // PLANETARY DEFENSE RINGIT
    // Jos cleanupScene on nollannut defense rinkit, luo ne takaisin
    if (Object.values(DEFENSE_RING_INSTANCES).some(m => m === null)) {
        initDefenseRingInstances();
    }

    // Lisää joka tason instanced-mesh takaisin sceneen tarvittaessa
    Object.entries(DEFENSE_RING_INSTANCES).forEach(([level, mesh]) => {
        if (mesh && !scene.children.includes(mesh)) scene.add(mesh);
    });

    // SHIPYARD
    // Jos cleanupScene on nollannut renkaiden meshet, luo ne takaisin
    if (Object.values(SHIPYARD_RING_INSTANCES).some(m => m === null)) {
        initShipyardRingInstances();               // :contentReference[oaicite:0]{index=0}
    }

    // Lisää joka tason instanced-mesh takaisin sceneen tarvittaessa
    Object.entries(SHIPYARD_RING_INSTANCES).forEach(([level, mesh]) => {
        if (mesh && !scene.children.includes(mesh)) scene.add(mesh);
    });

    // COMBAT RING INSTANCES
    if (!COMBAT_RING_INSTANCE) {
        initCombatRingInstances();
    }

    // Varmista että combat ring instance on scenessä
    if (COMBAT_RING_INSTANCE && !scene.children.includes(COMBAT_RING_INSTANCE)) {
        scene.add(COMBAT_RING_INSTANCE);
    }

    // NEBULAT
    if (nebulaSprites.length === 0) {
        //console.log("Recreating nebula sprites...");
        createNebulaSprites();
    }

    // --- UUSI: TYHJENNÄ HAKURAKENNE ---
    shipsByStarClient.clear();
    //console.log("[TRACKING] Cleared ship tracking structure");
    // --- PÄIVITYS PÄÄTTYY ---

    if (snap.stars) {
        spawnStars(snap.stars);
        createStarlanes(snap.stars);
    }
    
    if (snap.ships) {
        spawnShips(snap.ships);

        // --- UUSI: VARMISTA ETTÄ KAIKKI ALUKSET ON HAKURAKENTEESSA ---
        //console.log(`[TRACKING] Initialized tracking for ${shipsById.size} ships`);
        let trackedCount = 0;
        shipsByStarClient.forEach((ships, starId) => {
            trackedCount += ships.size;
        });
        //console.log(`[TRACKING] Total tracked ships: ${trackedCount}`);
        // --- PÄIVITYS PÄÄTTYY ---
    
    }
    
    //console.log("Scene built from snapshot");
}

function spawnStars(starList) {
    const starGeometry = new THREE.SphereGeometry(5, 16, 16);
    
    starList.forEach(starData => {
        if (starsById.has(starData._id)) return;
        
        // Determine color based on owner
        let starColor = NEUTRAL_COLOR;
        if (starData.ownerId) {
            // Get player data from global game data
            const gameData = window.gameData;
            if (gameData && gameData.players) {
                const ownerPlayer = gameData.players.find(p => p._id === starData.ownerId);
                if (ownerPlayer) {
                    // Convert color string to hex number
                    if (typeof ownerPlayer.color === 'string') {
                        starColor = parseInt(ownerPlayer.color.replace('#', ''), 16);
                    } else {
                        starColor = ownerPlayer.color;
                    }
                } else {
                    starColor = NEUTRAL_COLOR;
                }
            } else {
                // Fallback to player color if no game data
                starColor = starData.ownerId === window.gameData?.humanPlayerId ? PLAYER_COLOR : 0xdc3545;
            }
        }
        
        // Create star mesh
        const material = new THREE.MeshStandardMaterial({
            color: starColor,
            emissive: starColor,
            emissiveIntensity: starData.ownerId === null ? 0.45 : 0.3
        });
        
        const starMesh = new THREE.Mesh(starGeometry, material);
        starMesh.position.set(starData.position.x, starData.position.y, starData.position.z);
        
        // Create glow sprite
        const glowMaterial = new THREE.SpriteMaterial({
            map: glowTexture,
            color: starColor,
            transparent: true,
            opacity: STAR_GLOW_DEFAULT_OPACITY,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        
        const glowSprite = new THREE.Sprite(glowMaterial);
        const glowSize = starGeometry.parameters.radius * STAR_GLOW_DEFAULT_SCALE;
        glowSprite.scale.set(glowSize, glowSize, 1);
        glowSprite.position.copy(starMesh.position);
        
        // Scale for homeworld
        if (starData.isHomeworld) {
            starMesh.scale.set(1.5, 1.5, 1.5);
            glowSprite.scale.set(glowSize * 1.6, glowSize * 1.6, 1);
            starMesh.material.emissiveIntensity = 0.7;
        }
        
        // Store references
        starMesh.userData = {
            starData: starData,
            glowSprite: glowSprite
        };
        
        scene.add(starMesh);
        scene.add(glowSprite);
        starsById.set(starData._id, starMesh);
        starGlows.push(glowSprite);
        
        // Add visual indicators
        updateStarIndicators(starData, starMesh);
        
        // Focus camera on player homeworld
        if (starData.isHomeworld && starData.ownerId === window.gameData?.humanPlayerId) {
            setTimeout(() => {
                focusOnPlayerHomeworld(starMesh);
            }, 100);
        }
    });
}

function createStarlanes(starList) {
    const drawn = new Set();           // estää duplikaatit "A-B"

    starList.forEach(star => {
        if (!star.connections) return;

        star.connections.forEach(connId => {
            // varmista että kohdetähti on ladattu
            const fromMesh = starsById.get(star._id);
            const toMesh   = starsById.get(connId);
            if (!fromMesh || !toMesh) return;

            // Duplikaattien suodatus (A-B == B-A)
            const key = [star._id, connId].sort().join('-');
            if (drawn.has(key)) return;
            drawn.add(key);

            // Luo viivageometria
            const geom = new THREE.BufferGeometry().setFromPoints([
                fromMesh.position,
                toMesh.position
            ]);

            const line = new THREE.Line(geom, STARLANE_MAT.clone());
            line.renderOrder = 2;           // piirretään tähtien alle
            scene.add(line);
            starConnections.push(line);
        });
    });
}


// 2. KORJAA spawnShips - count pitää päivittää oikein
function spawnShips(shipList) {
    //console.log('🚀 spawnShips called with', shipList.length, 'ships');
    // Debug: tarkista että meshit ovat olemassa
    Object.entries(SHIP_INSTANCED_MESHES).forEach(([type, mesh]) => {
        if (!mesh) {
            console.error(`InstancedMesh for ${type} is missing!`);
        }
    });
    // Batch-käsittely tyypin mukaan
    const shipsByType = {};
    
    shipList.forEach(shipData => {
        if (shipsById.has(shipData._id)) return;
        
        const type = shipData.type || 'Fighter';
        if (!shipsByType[type]) shipsByType[type] = [];
        shipsByType[type].push(shipData);
    });
    
    // Käsittele jokainen tyyppi kerralla
    Object.entries(shipsByType).forEach(([type, ships]) => {
        const instancedMesh = SHIP_INSTANCED_MESHES[type];
        if (!instancedMesh) {
            console.error(`No InstancedMesh found for type: ${type}`);
            return;
        }
        
        const data = shipInstanceData[type];
        const dummy = new THREE.Object3D();
        
        ships.forEach(shipData => {
            // Määritä väri
            let shipColor = new THREE.Color(NEUTRAL_COLOR);
            if (shipData.ownerId && window.gameData) {
                const ownerIdStr = typeof shipData.ownerId === 'object' ? 
                                  shipData.ownerId.toString() : shipData.ownerId;
                const humanIdStr = typeof window.gameData.humanPlayerId === 'object' ? 
                                  window.gameData.humanPlayerId.toString() : 
                                  window.gameData.humanPlayerId;
                
                if (ownerIdStr === humanIdStr) {
                    shipColor.setHex(SHIP_COLOR_PLAYER);
                } else {
                    const ownerPlayer = window.gameData.players.find(p => {
                        const pIdStr = typeof p._id === 'object' ? p._id.toString() : p._id;
                        return pIdStr === ownerIdStr;
                    });
                    
                    if (ownerPlayer && ownerPlayer.color) {
                        shipColor.setHex(parseInt(ownerPlayer.color.replace('#', ''), 16));
                    }
                }
            }
            
            // Aseta positio
            const offsetRadius = 15 + Math.random() * 6;
            const randomAngle = Math.random() * Math.PI * 2;
            
            if (shipData.parentStarId) {
                const parentStar = starsById.get(shipData.parentStarId);
                if (parentStar) {
                    dummy.position.copy(parentStar.position);
                    dummy.position.x += offsetRadius * Math.cos(randomAngle);
                    dummy.position.z += offsetRadius * Math.sin(randomAngle);
                    dummy.position.y += (Math.random() - 0.5) * 2;
                    dummy.lookAt(parentStar.position);
                }
            } else if (shipData.position) {
                dummy.position.set(shipData.position.x, shipData.position.y, shipData.position.z);
            }
            
            // KRIITTINEN: Varmista että skaalaus on oikein
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            
            // Tallenna instance dataan

            let instanceIndex;
            if (freeInstanceSlots[type].size > 0) {
                instanceIndex = freeInstanceSlots[type].values().next().value;
                freeInstanceSlots[type].delete(instanceIndex);
                console.log(`Reusing slot ${instanceIndex} for ${type}`);
            } else {
                instanceIndex = data.count;
            }
            
            // Päivitä instanced mesh matriisi ja väri
            instancedMesh.setMatrixAt(instanceIndex, dummy.matrix);
            instancedMesh.setColorAt(instanceIndex, shipColor);
            
           
            // Luo virtuaalinen ship objekti
            const virtualShip = {
                position: dummy.position.clone(),
                rotation: dummy.rotation.clone(),
                scale: dummy.scale.clone(),
                matrix: dummy.matrix.clone(),
                userData: {
                    entityId: shipData._id,
                    type: 'ship',
                    owner: shipData.ownerId,
                    shipType: type,
                    instanceIndex: instanceIndex,
                    shipData: {
                        _id: shipData._id,
                        type: shipData.type,
                        ownerId: shipData.ownerId,
                        parentStarId: shipData.parentStarId,
                        state: shipData.state || 'orbiting',
                        targetStarId: shipData.targetStarId || null,
                        position: shipData.position
                    },
                    orbitAngle: randomAngle,
                    orbitRadius: offsetRadius,
                    orbitSpeed: 0.15 + Math.random() * 0.15,
                    isSelected: false
                },
                // Lisää tarvittavat metodit
                lookAt: function(target) {
                    dummy.position.copy(this.position);
                    dummy.lookAt(target);
                    dummy.updateMatrix();
                    
                    const inst = SHIP_INSTANCED_MESHES[this.userData.shipType];
                    if (inst) {
                        inst.setMatrixAt(this.userData.instanceIndex, dummy.matrix);
                        inst.instanceMatrix.needsUpdate = true;
                    }
                }
            };
            
            shipsById.set(shipData._id, virtualShip);
            
            // Päivitä tracking
            if (shipData.parentStarId) {
                const starId = shipData.parentStarId;
                if (!shipsByStarClient.has(starId)) {
                    shipsByStarClient.set(starId, new Set());
                }
                shipsByStarClient.get(starId).add(virtualShip);
            }
            
            data.count++;
        });
        
        // KRIITTINEN: Päivitä instance count ja bufferit
        instancedMesh.count = data.count;
        instancedMesh.instanceMatrix.needsUpdate = true;
        instancedMesh.instanceColor.needsUpdate = true; // OIKEA LIPPU


        
        //console.log(`Updated ${type} InstancedMesh: ${data.count} instances`);
    });
}


function updateDefenseRings(starData, starMesh) {
    // Poista vanhat instance-viittaukset
    if (starData.defenseRingInstances) {
        starData.defenseRingInstances.forEach(ringRef => {
            const data = defenseRingData[ringRef.level];
            const instancedMesh = DEFENSE_RING_INSTANCES[ringRef.level];
            
            // Poista/piilota instanssi
            const dummy = new THREE.Object3D();
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(ringRef.index, dummy.matrix);
            
            // Poista metadata
            data.starIds[ringRef.index] = null;
            
            // Jos viimeinen, pudota count
            if (ringRef.index === data.count - 1) {
                data.count--;
                instancedMesh.count = data.count;
            }
            
            instancedMesh.instanceMatrix.needsUpdate = true;
        });
        starData.defenseRingInstances = [];
    }

    // Lisää uudet instanssit jos on defense level
    if (starData.ownerId && starData.defenseLevel > 0) {
        starData.defenseRingInstances = [];
        
        // Määritä väri
        let ownerColor;
        if (starData.ownerId === window.gameData?.humanPlayerId) {
            ownerColor = PLAYER_COLOR;
        } else {
            const ownerPlayer = window.gameData.players.find(p => p._id === starData.ownerId);
            ownerColor = ownerPlayer ? parseInt(ownerPlayer.color.replace('#', ''), 16) : 0xdc3545;
        }
        
        const ringColor = new THREE.Color(ownerColor).lerp(new THREE.Color(0xffffff), 0.30);
        const starRadius = starMesh.geometry.parameters.radius * (starMesh.scale.x || 1);
        
        const dummy = new THREE.Object3D();
        
        for (let i = 0; i < starData.defenseLevel && i < 4; i++) {
            const levelKey = `level${i + 1}`;
            const instancedMesh = DEFENSE_RING_INSTANCES[levelKey];
            const data = defenseRingData[levelKey];
            
            const instanceIndex = data.count;
            const ringRadius = starRadius + 3 + i * 1.5;
            const scaleRatio = ringRadius / 10; // 10 on base radius geometriassa
            
            // Aseta positio ja skaalaus
            // Aseta positio, rotaatio ja skaalaus
            dummy.position.copy(starMesh.position);
            dummy.rotation.x = Math.PI / 2; // LISÄÄ TÄMÄ - käännä jokainen ringas erikseen
            dummy.scale.set(scaleRatio, scaleRatio, scaleRatio);
            dummy.updateMatrix();
            
            // Tallenna instanssiin
            instancedMesh.setMatrixAt(instanceIndex, dummy.matrix);
            instancedMesh.setColorAt(instanceIndex, ringColor);
            
            // Tallenna metadata
            data.starIds[instanceIndex] = starData._id;
            starData.defenseRingInstances.push({ level: levelKey, index: instanceIndex });
            
            data.count++;
            instancedMesh.count = data.count;
            instancedMesh.instanceMatrix.needsUpdate = true;
            instancedMesh.instanceColor.needsUpdate = true;
        }
    }
}

function updateStarIndicators(starData, starMesh) {
    // Poista vanhat indikaattorit PAITSI defense ringit
    removeOldIndicators(starData, true)
    
    // Lisää uudet vain jos ei neutraali
    if (starData.ownerId) {
        updateMineIndicators(starData, starMesh);
        updatePopulationIndicators(starData, starMesh);
        updateShipyardIndicator(starData, starMesh);
    }
}

function removeOldIndicators(starData, preserveDefenseRings = false, preserveShipyardRings = false) {

    // Mine indicators
    if (starData.mineIndicatorMeshes) {
        starData.mineIndicatorMeshes.forEach(m => {
            scene.remove(m);
            if (m.material) m.material.dispose(); // LISÄÄ
            if (m.geometry) m.geometry.dispose(); // LISÄÄ
        });
        starData.mineIndicatorMeshes = [];
    }
    
    // Population indicators  
    if (starData.populationIndicatorMeshes) {
        starData.populationIndicatorMeshes.forEach(p => {
            scene.remove(p);
            if (p.material) p.material.dispose(); // LISÄÄ
            if (p.geometry) p.geometry.dispose(); // LISÄÄ
        });
        starData.populationIndicatorMeshes = [];
    }
    
    // Defense rings - poista vain jos EI säilytetä
    if (!preserveDefenseRings && starData.defenseRingInstances) {
        starData.defenseRingInstances.forEach(ringRef => {
            const data = defenseRingData[ringRef.level];
            const instancedMesh = DEFENSE_RING_INSTANCES[ringRef.level];
            
            const dummy = new THREE.Object3D();
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(ringRef.index, dummy.matrix);
            
            data.starIds[ringRef.index] = null;
            
            if (ringRef.index === data.count - 1) {
                data.count--;
                instancedMesh.count = data.count;
            }
            
            instancedMesh.instanceMatrix.needsUpdate = true;
        });
        starData.defenseRingInstances = [];
    }

    // Shipyard indicator
    if (starData.shipyardIndicatorSprite) {
        scene.remove(starData.shipyardIndicatorSprite);
        if (starData.shipyardIndicatorSprite.material) {
            starData.shipyardIndicatorSprite.material.dispose();
        }
        starData.shipyardIndicatorSprite = null;
    }

    // Shipyard rings - poista instanssit
    if (!preserveShipyardRings && starData.shipyardRingInstances) {
        starData.shipyardRingInstances.forEach(ringRef => {
            const data = shipyardRingData[ringRef.level];
            const instancedMesh = SHIPYARD_RING_INSTANCES[ringRef.level];
            
            if (!data || !instancedMesh) return;
            
            // Piilota instanssi
            const dummy = new THREE.Object3D();
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(ringRef.index, dummy.matrix);
            
            // TÄRKEÄ: Nollaa metadata OIKEIN
            data.rotations[ringRef.index] = null;
            data.speeds[ringRef.index] = null;
            data.starIds[ringRef.index] = null;  // TÄMÄ ON KRIITTINEN
            
            // Älä muuta count-arvoa tässä
            instancedMesh.instanceMatrix.needsUpdate = true;
        });
        starData.shipyardRingInstances = [];
    }
    
    // Shipyard rings
    if (starData.shipyardRings) {
        starData.shipyardRings.forEach(r => {
            scene.remove(r);
            r.geometry.dispose();
            r.material.dispose();
        });
        starData.shipyardRings = [];
    }
}

function updateMineIndicators(starData, starMesh) {
    if (!starData.mines || starData.mines === 0) return;
    
    starData.mineIndicatorMeshes = [];
    
    const starRadiusScaled = starMesh.geometry.parameters.radius * (starMesh.scale.x || 1);
    const itemsPerRow = 4;
    const spacing = INDICATOR_SPRITE_SCALE * 0.9;
    
    // KORJAUS: Poista defenseLevel vaikutus
    const yOffset = starRadiusScaled + INDICATOR_SPRITE_SCALE * 1.2;
    
    const xBaseOffset = starRadiusScaled * 0.6 + INDICATOR_SPRITE_SCALE * 0.4;
    
    let indicatorColor = getIndicatorColor(starData.ownerId);
    
    for (let i = 0; i < starData.mines; i++) {
        const sprite = new THREE.Sprite(mineSpriteMaterial.clone());
        sprite.material.color.copy(indicatorColor).lerp(new THREE.Color(0xffffff), 0.5);
        sprite.scale.set(INDICATOR_SPRITE_SCALE, INDICATOR_SPRITE_SCALE, 1);
        
        const row = Math.floor(i / itemsPerRow);
        const col = i % itemsPerRow;
        
        sprite.position.set(
            starMesh.position.x + xBaseOffset + (col * spacing),
            starMesh.position.y + yOffset,
            starMesh.position.z + (row * spacing * 0.9) - 
            ((Math.floor(starData.mines / itemsPerRow) * spacing * 0.9) / 2)
        );
        
        scene.add(sprite);
        starData.mineIndicatorMeshes.push(sprite);
    }
}

function updatePopulationIndicators(starData, starMesh) {
    if (starData.populationIndicatorMeshes && starData.populationIndicatorMeshes.length > 0) {
        starData.populationIndicatorMeshes.forEach(p => {
            scene.remove(p);
            if (p.material) p.material.dispose();
        });
    }
    
    starData.populationIndicatorMeshes = [];
    
    if (!starData.population || starData.population === 0) return;
    
    const starRadiusScaled = starMesh.geometry.parameters.radius * (starMesh.scale.x || 1);
    const itemsPerRow = 4;
    const spacing = INDICATOR_SPRITE_SCALE * 0.9;
    
    // KORJAUS: Poista defenseLevel vaikutus
    const yOffset = starRadiusScaled + INDICATOR_SPRITE_SCALE * 1.2;
    
    const xBaseOffset = -(starRadiusScaled * 0.6 + INDICATOR_SPRITE_SCALE * 0.4);
    
    let indicatorColor = getIndicatorColor(starData.ownerId);
    
    for (let i = 0; i < starData.population; i++) {
        const sprite = new THREE.Sprite(popSpriteMaterial.clone());
        sprite.material.color.copy(indicatorColor).lerp(new THREE.Color(0xffffff), 0.5);
        sprite.scale.set(INDICATOR_SPRITE_SCALE, INDICATOR_SPRITE_SCALE, 1);
        
        const row = Math.floor(i / itemsPerRow);
        const col = i % itemsPerRow;
        
        sprite.position.set(
            starMesh.position.x + xBaseOffset - (col * spacing),
            starMesh.position.y + yOffset,
            starMesh.position.z + (row * spacing * 0.9) - 
            ((Math.floor(starData.population / itemsPerRow) * spacing * 0.9) / 2)
        );
        
        scene.add(sprite);
        starData.populationIndicatorMeshes.push(sprite);
    }
}

function updateShipyardIndicator(starData, starMesh) {
    if (!starData.shipyardLevel || starData.shipyardLevel === 0) return;
    
    // Tarkista onko rengas jo olemassa tälle tähdelle
    if (starData.shipyardRingInstances && starData.shipyardRingInstances.length > 0) {
        // Jos renkaiden määrä EI vastaa tasoa, päivitys tarvitaan
        if (starData.shipyardRingInstances.length !== starData.shipyardLevel) {
            console.log(`[SHIPYARD] Ring count mismatch: ${starData.shipyardRingInstances.length} rings but level ${starData.shipyardLevel}`);
            // Jatka normaalisti siivous-osioon
        } else {
            // Tarkista että renkaat ovat valideja
            let allValid = true;
            for (const ringRef of starData.shipyardRingInstances) {
                const data = shipyardRingData[ringRef.level];
                if (!data || data.starIds[ringRef.index] !== starData._id) {
                    allValid = false;
                    break;
                }
            }
            
            if (allValid) {
                console.log(`[SHIPYARD] ${starData.name} already has correct rings`);
                return;
            }
        }
    }

    // DEBUG: Tarkista lähtötilanne
    console.log(`[SHIPYARD] Creating rings for ${starData.name} (${starData._id}), level: ${starData.shipyardLevel}`);
    
    // SIIVOA vanhat instanssit ensin JOS level on muuttunut
    if (starData.shipyardRingInstances && starData.shipyardRingInstances.length > 0) {
        // Tarkista onko level muuttunut
        if (starData.shipyardRingInstances.length !== starData.shipyardLevel) {
            console.log(`[SHIPYARD] Level changed for ${starData.name}: ${starData.shipyardRingInstances.length} -> ${starData.shipyardLevel}`);
            
            // Poista KAIKKI vanhat renkaat
            starData.shipyardRingInstances.forEach(ringRef => {
                const data = shipyardRingData[ringRef.level];
                const instancedMesh = SHIPYARD_RING_INSTANCES[ringRef.level];
                
                if (!data || !instancedMesh) return;
                
                // Piilota instanssi
                const dummy = new THREE.Object3D();
                dummy.scale.set(0, 0, 0);
                dummy.updateMatrix();
                instancedMesh.setMatrixAt(ringRef.index, dummy.matrix);
                
                // Nollaa metadata
                data.rotations[ringRef.index] = null;
                data.speeds[ringRef.index] = null;
                data.starIds[ringRef.index] = null;
                
                instancedMesh.instanceMatrix.needsUpdate = true;
            });
            
            starData.shipyardRingInstances = [];
        } else {
            // Level ei muuttunut, älä tee mitään
            return;
        }
    }
    
    const starRadius = starMesh.geometry.parameters.radius * (starMesh.scale.x || 1);
    const yOffset = starRadius + INDICATOR_SPRITE_SCALE * 1.5 +
                   (starData.defenseLevel ? starData.defenseLevel * 1.5 + 1.0 : 0);
    
    // Shipyard sprite
    if (starData.shipyardIndicatorSprite) {
        scene.remove(starData.shipyardIndicatorSprite);
        if (starData.shipyardIndicatorSprite.material) {
            starData.shipyardIndicatorSprite.material.dispose();
        }
    }
    
    const sprite = new THREE.Sprite(shipyardSpriteMaterial.clone());
    let baseColor = getIndicatorColor(starData.ownerId);
    sprite.material.color.copy(baseColor).lerp(new THREE.Color(0xffffff), 0.3);
    sprite.scale.setScalar(INDICATOR_SPRITE_SCALE * 1.8);
    sprite.position.set(
        starMesh.position.x,
        starMesh.position.y + yOffset,
        starMesh.position.z - starRadius * 0.8 - INDICATOR_SPRITE_SCALE * 1.8
    );
    
    scene.add(sprite);
    starData.shipyardIndicatorSprite = sprite;
    
    // Shipyard rings - käytä instansseja
    starData.shipyardRingInstances = [];
    const baseRingRadius = starRadius + INDICATOR_SPRITE_SCALE * 3;
    
    const dummy = new THREE.Object3D();
    
    // TÄRKEÄ: Luo VAIN shipyardLevel määrä renkaita
    for (let lvl = 1; lvl <= starData.shipyardLevel && lvl <= 4; lvl++) {
        const levelKey = `level${lvl}`;
        const instancedMesh = SHIPYARD_RING_INSTANCES[levelKey];
        const data = shipyardRingData[levelKey];
        
        // TARKISTA että instanced mesh on olemassa
        if (!instancedMesh) {
            console.error(`[SHIPYARD] No instanced mesh for ${levelKey}!`);
            continue;
        }
        
        // ETSI tyhjä slotti TAI käytä count:ia jos kaikki slotit ovat tyhjiä
        let instanceIndex = -1;

        // Ensin tarkista onko tyhjää slottia olemassa olevien joukossa
        for (let i = 0; i < data.count; i++) {
            if (!data.starIds[i] || data.starIds[i] === starData._id) {
                instanceIndex = i;
                break;
            }
        }

        // Jos ei löytynyt, käytä seuraavaa tyhjää
        if (instanceIndex === -1) {
            if (data.count < MAX_SHIPYARDS) {
                instanceIndex = data.count;
            } else {
                console.error(`[SHIPYARD] No free slots for ${levelKey}!`);
                continue;
            }
        }
        
        console.log(`[SHIPYARD]   Creating ring ${lvl}/${starData.shipyardLevel} at index ${instanceIndex}`);
        
        // Aseta positio ja skaalaus
        dummy.position.copy(starMesh.position);
        const scaleRatio = baseRingRadius / 10;
        dummy.scale.set(scaleRatio, scaleRatio, scaleRatio);
        
        // Aseta perusrotaatio
        if (instancedMesh.userData.baseRotation) {
            dummy.rotation.copy(instancedMesh.userData.baseRotation);
        }
        dummy.updateMatrix();
        
        // Tallenna instanssiin
        instancedMesh.setMatrixAt(instanceIndex, dummy.matrix);
        
        // Tallenna metadata
        const speed = 0.35;
        const speedMultipliers = {
            level1: { x: 0, y: speed, z: 0 },
            level2: { x: speed, y: 0, z: 0 },
            level3: { x: 0, y: speed, z: 0 },
            level4: { x: 0, y: -speed, z: 0 }
        };
        
        data.rotations[instanceIndex] = { x: 0, y: 0, z: 0 };
        data.speeds[instanceIndex] = speedMultipliers[levelKey];
        data.starIds[instanceIndex] = starData._id;
        
        starData.shipyardRingInstances.push({ level: levelKey, index: instanceIndex });
        
        // Päivitä count vain jos tarvitaan
        if (instanceIndex >= data.count) {
            data.count = instanceIndex + 1;
        }
        
        instancedMesh.count = Math.max(instancedMesh.count, data.count);
        instancedMesh.instanceMatrix.needsUpdate = true;
    }
    
    console.log(`[SHIPYARD] Created ${starData.shipyardRingInstances.length} rings for ${starData.name}`);
}

function getIndicatorColor(ownerId) {
    // Palauttaa THREE.Color objektin
    const hexColor = getPlayerColor(ownerId);
    return new THREE.Color(hexColor);
}

// Lisää animate looppiin shipyard-renkaiden pyöritys
// (updateOrbitingShips funktion jälkeen):
function updateShipyardRings(delta) {
    const dummy = new THREE.Object3D();
    
    ['level1', 'level2', 'level3', 'level4'].forEach(level => {
        const instancedMesh = SHIPYARD_RING_INSTANCES[level];
        const data = shipyardRingData[level];
        
        if (data.count === 0) return;
        
        for (let i = 0; i < data.count; i++) {
            
            if (!data.rotations[i]) continue; 
            // Hae nykyinen matriisi
            instancedMesh.getMatrixAt(i, dummy.matrix);
            dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
            
            // Päivitä rotaatio
            const rotation = data.rotations[i];
            const speed = data.speeds[i];
            
            rotation.x += speed.x * delta;
            rotation.y += speed.y * delta;
            rotation.z += speed.z * delta;
            
            // Yhdistä perusrotaatio ja animaatiorotaatio
            dummy.rotation.copy(instancedMesh.userData.baseRotation);
            dummy.rotateX(rotation.x);
            dummy.rotateY(rotation.y);
            dummy.rotateZ(rotation.z);
            
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(i, dummy.matrix);
        }
        
        instancedMesh.instanceMatrix.needsUpdate = true;
    });
}

function updateCombatRings(delta) {
    if (!COMBAT_RING_INSTANCE || combatRingData.count === 0) return;
    
    const dummy = new THREE.Object3D();
    
    for (let i = 0; i < combatRingData.count; i++) {
        if (combatRingData.starIds[i] === null) continue;
        
        const starMesh = starsById.get(combatRingData.starIds[i]);
        if (!starMesh) continue;
        
        // Päivitä positio ja rotaatio
        dummy.position.copy(starMesh.position);
        dummy.rotation.x = Math.PI / 2;
        dummy.rotation.z = combatRingData.rotations[i];
        dummy.updateMatrix();
        
        COMBAT_RING_INSTANCE.setMatrixAt(i, dummy.matrix);
    }
    
    COMBAT_RING_INSTANCE.instanceMatrix.needsUpdate = true;
}

export function applyDiff(diffArr = []) {
    //console.log("Applying diff:", diffArr);
    
    diffArr.forEach(act => {
        switch (act.action) {
            case 'COMPLETE_PLANETARY': {
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;
                
                const star = starMesh.userData.starData;
                const oldShipyardLevel = star.shipyardLevel;
                
                // Päivitä star data
                if (act.starData) {
                    Object.assign(star, act.starData);
                }
                
                // Jos defense level muuttui, päivitä renkaat
                if (act.type === 'Defense Upgrade') {
                    updateDefenseRings(star, starMesh);
                }
                
                // KORJATTU: Tarkista startsWith sen sijaan että vertailee tarkkoja stringejä
                if (act.type === 'Shipyard' || act.type.startsWith('Shipyard')) {
                    //console.log(`[COMPLETE_PLANETARY] Shipyard update for ${star.name}`);
                    //console.log(`  Type: ${act.type}`);
                    //console.log(`  Old level: ${oldShipyardLevel}, New level: ${star.shipyardLevel}`);
                    
                    // Poista vanhat renkaat ensin
                    removeOldIndicators(star, true, false);
                    // Luo uudet renkaat
                    updateShipyardIndicator(star, starMesh);
                }
                
                // Päivitä KAIKKI indikaattorit jos mine tai infra muuttui
                if (act.type === 'Mine' || act.type.startsWith('Infrastructure')) {
                    updateStarIndicators(star, starMesh);
                }
                
                break;
            }

            case 'STAR_UPDATED': {
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;
                
                const star = starMesh.userData.starData;
                const oldShipyardLevel = star.shipyardLevel;
                
                // Päivitä kaikki kentät
                Object.assign(star, act.updatedFields);
                
                // Jos populaatio muuttui, päivitä indikaattorit
                if (act.updatedFields.population !== undefined) {
                    updatePopulationIndicators(star, starMesh);
                }
                
                // TÄRKEÄ: Jos shipyard level muuttui, päivitä renkaat HETI
                if (act.updatedFields.shipyardLevel !== undefined && 
                    act.updatedFields.shipyardLevel !== oldShipyardLevel) {
                    console.log(`[STAR_UPDATED] Shipyard level changed: ${oldShipyardLevel} -> ${act.updatedFields.shipyardLevel}`);
                    updateShipyardIndicator(star, starMesh);
                    
                }
                
                // Jos mines muuttui, päivitä kaikki indikaattorit
                if (act.updatedFields.mines !== undefined) {
                    updateStarIndicators(star, starMesh);
                }
                
                break;
            }

            case 'DEFENSE_DAMAGED': {
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;
                
                const star = starMesh.userData.starData;
                star.defenseLevel = act.newLevel;
                updateDefenseRings(star, starMesh);
                
                //console.log(`Defense damaged at star ${act.starId}, new level: ${act.newLevel}`);
                break;
            }
            
            case 'SHIP_SPAWNED': {
                const parentStarMesh = starsById.get(act.starId);
                if (!parentStarMesh) break;
                
                // Käytä serverin antamaa ID:tä
                const newShipData = {
                    _id: act.shipId,
                    type: act.type,
                    ownerId: act.ownerId,
                    parentStarId: act.starId,
                    state: 'orbiting'
                };
                
                // Spawnaa alus HETI
                spawnShips([newShipData]);

                const shipMesh = shipsById.get(act.shipId);
                if (shipMesh) {
                    const starId = act.starId;
                    if (!shipsByStarClient.has(starId)) {
                        shipsByStarClient.set(starId, new Set());
                    }
                    shipsByStarClient.get(starId).add(shipMesh);
                    //console.log(`[SHIP-TRACKING] Added ship ${act.shipId} to star ${starId}`);
                }
                
                // LISÄÄ TÄMÄ: Merkitse tähti tarkistettavaksi combatille
                markStarForCombatCheck(act.starId);
                
                //console.log(`[SHIP_SPAWNED] Ship ${act.shipId} spawned at star ${act.starId}`);
                break;
            }
            
            case 'MOVE_SHIP':
            case 'SHIP_MOVING': {
                const mesh = shipsById.get(act.shipId);
                if (!mesh) break;

                const sd = mesh.userData.shipData;

                const departureStarId = sd.parentStarId || act.fromStarId;
                if (departureStarId && shipsByStarClient.has(departureStarId)) {
                    shipsByStarClient.get(departureStarId).delete(mesh);
                    //console.log(`[SHIP-TRACKING] Removed ship ${act.shipId} from star ${departureStarId}`);
                }

                // TALLENNA LÄHTÖTÄHTI ENNEN NOLLAUSTA
                sd.departureStarId = sd.parentStarId || act.fromStarId;

                sd.state = 'moving';
                sd.targetStarId = act.toStarId;
                sd.parentStarId = null;
                sd.speed = act.speed;

                // Ennakoitu kiertorata
                sd.plannedOrbitRadius = 15 + Math.random() * 6;
                sd.plannedOrbitAngle = Math.random() * Math.PI * 2;

                // LISÄÄ TÄMÄ: Nollaa validDeparture aina kun alus alkaa liikkua
                mesh.userData.validDeparture = false;

                // LISÄÄ TÄMÄ: Jos alus on jo kiertoradalla, aseta lähtöpositio heti
                const depStar = starsById.get(sd.departureStarId);
                if (depStar && mesh.userData.orbitRadius) {
                    // Alus on kiertoradalla, käytä nykyistä orbitointipositiota
                    const currentAngle = mesh.userData.orbitAngle || 0;
                    const currentRadius = mesh.userData.orbitRadius || 15;
                    
                    mesh.position.set(
                        depStar.position.x + currentRadius * Math.cos(currentAngle),
                        depStar.position.y + Math.sin(currentAngle * 0.5) * 2,
                        depStar.position.z + currentRadius * Math.sin(currentAngle)
                    );
                    
                    // Merkitse että lähtöpositio on asetettu
                    mesh.userData.validDeparture = true;
                    
                    if (mesh.userData.clickTarget) {
                        mesh.userData.clickTarget.position.copy(mesh.position);
                    }
                }

                //console.log(`Ship ${act.shipId} moving ${act.fromStarId || sd.departureStarId} → ${act.toStarId} @v=${act.speed}`);
                
                // Merkitse lähtötähti tarkistettavaksi (combat check)
                markStarForCombatCheck(sd.departureStarId);
                break;
            }

            case 'SHIP_ARRIVED': {
                // Jos alus ei ole vielä spawnattu, luo se nyt
                if (!shipsById.has(act.shipId)) {
                    //console.log(`[SHIP_ARRIVED] Ship not found: ${act.shipId}, creating it now...`);
                    
                    // Luo alus minimal datalla
                    const recoveryShipData = {
                        _id: act.shipId,
                        type: act.shipType || 'Fighter', // Default Fighter jos tyyppi puuttuu
                        ownerId: act.ownerId,
                        parentStarId: act.atStarId,
                        state: 'orbiting'
                    };
                    
                    // Spawn alus
                    spawnShips([recoveryShipData]);
                    
                    // Odota hetki että mesh luodaan
                    setTimeout(() => {
                        const shipMesh = shipsById.get(act.shipId);
                        if (shipMesh) {
                            // Päivitä tracking
                            if (!shipsByStarClient.has(act.atStarId)) {
                                shipsByStarClient.set(act.atStarId, new Set());
                            }
                            shipsByStarClient.get(act.atStarId).add(shipMesh);
                            //console.log(`[RECOVERY] Ship ${act.shipId} recovered and added to tracking`);
                        }
                    }, 10);
                    
                    break; // Lopeta käsittely tässä
                }
                
                const shipMesh = shipsById.get(act.shipId);
                if (!shipMesh) {
                    console.error(`[SHIP_ARRIVED] Ship mesh not found: ${act.shipId}`);
                    break;
                }

                // Päivitä datamalli
                const sd = shipMesh.userData.shipData;
                sd.state = 'orbiting';
                sd.parentStarId = act.atStarId;
                sd.targetStarId = null;
                sd.predictedArrival = false;
                
                // KRIITTINEN: Etsi kohdetähti
                const starMesh = starsById.get(act.atStarId);
                if (!starMesh) {
                    console.error(`[SHIP_ARRIVED] Target star not found: ${act.atStarId}`);
                    break;
                }
                
                // PAKOTA alus heti kiertoradalle
                const orbitRadius = shipMesh.userData.orbitRadius || (15 + Math.random() * 6);
                const orbitAngle = shipMesh.userData.orbitAngle || (Math.random() * Math.PI * 2);
                
                shipMesh.position.set(
                    starMesh.position.x + orbitRadius * Math.cos(orbitAngle),
                    starMesh.position.y + Math.sin(orbitAngle * 0.5) * 2,
                    starMesh.position.z + orbitRadius * Math.sin(orbitAngle)
                );
                
                // Päivitä myös click target
                if (shipMesh.userData.clickTarget) {
                    shipMesh.userData.clickTarget.position.copy(shipMesh.position);
                }
                
                shipMesh.lookAt(starMesh.position);

                // Merkitse että alus juuri saapui
                shipMesh.userData.justArrived = true;

                // VARMISTA tracking päivitys
                const atStarId = act.atStarId;
                if (!shipsByStarClient.has(atStarId)) {
                    shipsByStarClient.set(atStarId, new Set());
                }
                shipsByStarClient.get(atStarId).add(shipMesh);
                //console.log(`[SHIP-TRACKING] Added ship ${act.shipId} to star ${atStarId} (arrival)`);

                // Merkitse tähti tarkistettavaksi
                markStarForCombatCheck(act.atStarId);
                
                //console.log(`[VISUAL] Ship ${act.shipId} placed in orbit around ${starMesh.userData.starData.name}`);
                break;
            }

            case 'COMBAT_STARTED': {
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;
                
                // Aloita combat-efektit HETI
                const effect = new CombatEffectGroup(starMesh, scene);
                combatEffects.set(act.starId, effect);
                
                //console.log("⚔️ Combat effects started at star", act.starId);
                break;
            }

            case 'COMBAT_ENDED':
            case 'CONQUEST_HALTED': {
                // Lopeta combat-efektit
                const effect = combatEffects.get(act.starId);
                if (effect) {
                    effect.cleanup();
                    combatEffects.delete(act.starId);
                    starsToCheck.delete(act.starId);
                }
                if (act.action === 'CONQUEST_HALTED') {
                    const starMesh = starsById.get(act.starId);
                    if (starMesh && starMesh.userData.conquestRing) {
                        const ring = starMesh.userData.conquestRing;
                        
                        // Poista glow ring ensin
                        if (ring.userData.glowRing) {
                            scene.remove(ring.userData.glowRing);
                            ring.userData.glowRing.geometry.dispose();
                            ring.userData.glowRing.material.dispose();
                        }
                        
                        // Poista päärengas
                        scene.remove(ring);
                        ring.geometry.dispose();
                        ring.material.dispose();
                        delete starMesh.userData.conquestRing;
                        starMesh.userData.conquestRing = null;
                        
                        //console.log("🛑 Conquest halted, ring removed");
                    }
                }
                break;
            }
                        
            case 'SHIP_DESTROYED': {
                const virtualShip = shipsById.get(act.shipId);
                if (!virtualShip) break;
                
                const parentStarId = virtualShip.userData.shipData?.parentStarId;
                if (parentStarId && shipsByStarClient.has(parentStarId)) {
                    shipsByStarClient.get(parentStarId).delete(virtualShip);
                }
                
                // Spawn explosion at ship position
                spawnExplosion(virtualShip.position);
                
                // Remove from selection
                const selectedIndex = selectedShips.indexOf(virtualShip);
                if (selectedIndex > -1) {
                    selectedShips.splice(selectedIndex, 1);
                    updateSelectedUnitsDisplay();
                }
                
                // "Piilota" alus instanced meshista
                const type = virtualShip.userData.shipType;
                const instanceIndex = virtualShip.userData.instanceIndex;
                const instancedMesh = SHIP_INSTANCED_MESHES[type];
                
                if (instancedMesh && instanceIndex !== undefined) {
                    // Skaalaa 0:ksi piilottaaksesi
                    const dummy = new THREE.Object3D();
                    dummy.position.copy(virtualShip.position);
                    dummy.scale.set(0, 0, 0);
                    dummy.updateMatrix();
                    
                    instancedMesh.setMatrixAt(instanceIndex, dummy.matrix);
                    instancedMesh.instanceMatrix.needsUpdate = true;
                    
                    // LISÄÄ TÄMÄ: Vapauta slotti uudelleenkäyttöön
                    freeInstanceSlots[type].add(instanceIndex);
                    console.log(`Freed slot ${instanceIndex} for ${type}, now ${freeInstanceSlots[type].size} free slots`);
                }
                
                // Remove from tracking
                shipsById.delete(act.shipId);
                
                const starId = virtualShip.userData.shipData?.parentStarId;
                markStarForCombatCheck(starId);
                
                break;
            }

            case 'CONQUEST_STARTED': {
                const starMesh = starsById.get(act.starId);
                if (!starMesh || starMesh.userData.conquestRing) break;
                
                // Luo conquest ring
                const conquerorColor = getPlayerColor(act.conquerorId);
                const ring = createConquestRing(starMesh, conquerorColor);
                starMesh.userData.conquestRing = ring;
                
                //console.log("⚔️ Conquest ring created for star", act.starId);
                break;
            }

            case 'CONQUEST_PROGRESS': {
                const starMesh = starsById.get(act.starId);
                if (!starMesh || !starMesh.userData.conquestRing) break;
                
                const ring = starMesh.userData.conquestRing;
                const progress = act.progress / 100;
                
                // Päivitä vain shader uniform
                if (ring.material.uniforms) {
                    ring.material.uniforms.progress.value = progress;
                }
                break;
            }

            case 'CONQUEST_COMPLETE': {
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;
                
                // Poista conquest ring JA sen glow
                if (starMesh.userData.conquestRing) {
                    const ring = starMesh.userData.conquestRing;
                    
                    // Poista glow ring ensin
                    if (ring.userData.glowRing) {
                        scene.remove(ring.userData.glowRing);
                        ring.userData.glowRing.geometry.dispose();
                        ring.userData.glowRing.material.dispose();
                    }
                    
                    // Poista päärengas
                    scene.remove(ring);
                    ring.geometry.dispose();
                    ring.material.dispose();
                    delete starMesh.userData.conquestRing;
                    starMesh.userData.conquestRing = null;
                }
                
                // Päivitä tähden väri
                const newColor = getPlayerColor(act.newOwnerId);
                starMesh.material.color.setHex(newColor);
                starMesh.material.emissive.setHex(newColor);
                
                // Päivitä glow sprite väri
                if (starMesh.userData.glowSprite) {
                    starMesh.userData.glowSprite.material.color.setHex(newColor);
                }
                
                // Päivitä starData
                starMesh.userData.starData.ownerId = act.newOwnerId;

                updateStarIndicators(starMesh.userData.starData, starMesh);
                
                //console.log("🏴 Conquest complete, star color updated");
                break;
            }

        }
    });
}

/* ========================================================================== */
/*  RENDER LOOP                                                               */
/* ========================================================================== */

export function startAnimateLoop() {
    if (animStarted) return; // Estä useat loopit
    animStarted = true;
    clock.start();
    // console.log("Starting animation loop...");

    function loop() {
        if (fpsStats.frameTime > 20) { // Yli 20ms = alle 50fps
            frameSkipCounter++;
            if (frameSkipCounter % 2 !== 0) {
                requestAnimationFrame(loop);
                return; // Skippaa joka toinen frame
            }
        }
        
        if (!animStarted) return; // Pysäytetään looppi, jos lippu on false
        
        animationFrameId = requestAnimationFrame(loop);

        // FPS JA FRAME TIME LASKENTA
        const currentTime = performance.now();
        
        // Frame time (ms per frame)
        fpsStats.frameTime = currentTime - fpsStats.lastFrameTime;
        fpsStats.lastFrameTime = currentTime;
        
        // FPS (frames per second)
        fpsStats.frameCount++;
        if (currentTime >= fpsStats.lastTime + 1000) {
            fpsStats.fps = Math.round((fpsStats.frameCount * 1000) / (currentTime - fpsStats.lastTime));
            fpsStats.frameCount = 0;
            fpsStats.lastTime = currentTime;
        }

        if (window.isPaused) {
        // Älä päivitä mitään fysiikkaa pausella
        if (controls) controls.update();
        
        // Renderöi vain staattinen kuva
        if (composer) {
            composer.render();
        } else if (renderer && scene && camera) {
            renderer.render(scene, camera);
        }
        
        return; // Lopeta tämän framen käsittely tähän
    }

        const rawDelta = clock.getDelta();
        const speed    = window.GAME_SPEED || 1;   // luetaan clientin asettama globaali
        let delta    = rawDelta * speed;
        if (window.isPaused) delta = 0;
        if (window.TWEEN) window.TWEEN.update();
        

        updateCombatRings(delta)

        // Update explosions
        updateExplosions(delta);

        // Update explosion pool
        if (window.explosionPool) {
            window.explosionPool.update(delta);
        }
        
        // Update orbitoivat alukset
        updateOrbitingShips(delta);

        // Update shipyard -ringsit
        updateShipyardRings(delta)

        // Update conquest rings
        updateConquestRings(delta);



        if (controls) controls.update();
        if (selectionIndicatorMesh && selectionIndicatorMesh.visible) {
            selectionIndicatorMesh.rotation.y += 0.5 * delta;
        }


        
        updateAllStarVisuals();
        updateVisibleNebulas()
        
        if (composer) {
            composer.render();
        } else if (renderer && scene && camera) {
            renderer.render(scene, camera);
        }
    }

    loop();
}

// Lopetetaan animaatio uutta peliä varten
export function stopAnimateLoop() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    animStarted = false;
    clock.stop();
    // console.log("Animation loop stopped.");
}


function checkForCombatSituations(delta) {
    const now = performance.now();
    if (now - lastCombatCheck < COMBAT_CHECK_INTERVAL) return;   // aja 4× sekunnissa
    lastCombatCheck = now;

    // --- LISÄÄ SUORITUSKYVYN MITTAUS ---
    const startTime = performance.now();
    let starsChecked = 0;
    let totalShipsProcessed = 0;
    // --- MITTAUS PÄÄTTYY ---

    for (const starId of starsToCheck) {
        const starMesh = starsById.get(starId);
        if (!starMesh) {
            starsToCheck.delete(starId);
            continue;
        }

        // --- OPTIMOINNIN YDIN: O(1) haku O(N×M) sijaan ---
        const shipsAtStarSet = shipsByStarClient.get(starId);

        // Jos tähdellä ei ole aluksia, ei voi olla taistelua
        if (!shipsAtStarSet || shipsAtStarSet.size === 0) {
            // Jos täällä oli taistelu, lopeta se
            if (combatEffects.has(starId)) {
                //console.log("✅ [CLIENT] Combat ended at star", starId, "- no ships");
                const effect = combatEffects.get(starId);
                effect.cleanup();
                combatEffects.delete(starId);
            }
            starsToCheck.delete(starId); 
            continue;
        }

        // Kerää faktiot tehokkaasti Set-rakenteesta
        const factions = new Set();
        const shipArray = Array.from(shipsAtStarSet);
        
        for (const shipMesh of shipsAtStarSet) {
            if (shipMesh.userData.owner) {
                factions.add(shipMesh.userData.owner);
            }
        }

        const starOwnerId = starMesh.userData.starData.ownerId;
        const starHasDefense = starMesh.userData.starData.defenseLevel > 0;

        // Tarkista tarvitaanko taistelua
        const needsCombat = 
            factions.size > 1 || 
            (factions.size === 1 && starOwnerId && !factions.has(starOwnerId)) ||
            (shipsAtStarSet.size > 0 && starHasDefense && starOwnerId && !factions.has(starOwnerId));

        if (needsCombat) {
            if (!combatEffects.has(starId)) {
                //console.log("⚔️ [CLIENT] Combat situation detected at star", starId);
                //console.log(`   - Ships: ${shipsAtStarSet.size}, Factions: ${Array.from(factions).map(f => f.slice(-4)).join(', ')}`);
                //console.log(`   - Star owner: ${starOwnerId?.slice(-4) || 'neutral'}, Defense: ${starMesh.userData.starData.defenseLevel}`);
                
                // Rajoita aktiivisten efektien määrä
                if (combatEffects.size >= MAX_ACTIVE_COMBAT_EFFECTS) {
                    const firstKey = combatEffects.keys().next().value;
                    const oldEffect = combatEffects.get(firstKey);
                    if (oldEffect) {
                        oldEffect.cleanup();
                        combatEffects.delete(firstKey);
                    }
                }
                
                const effect = new CombatEffectGroup(starMesh, scene);
                combatEffects.set(starId, effect);
            }
        } else {
            if (combatEffects.has(starId)) {
                //console.log("✅ [CLIENT] Combat ended at star", starId);
                const effect = combatEffects.get(starId);
                effect.cleanup();
                combatEffects.delete(starId);
                // Poista myös tarkistuslistalta
                starsToCheck.delete(starId);
            }
        }
    }
    
    // Päivitä aktiiviset efektit - käytä suoraan Set-rakennetta
    combatEffects.forEach((effect, starId) => {
        if (frameSkipCounter % 2 === 0) { // Frame skip
            const ships = Array.from(shipsByStarClient.get(starId) || []);
            effect.update(delta, ships);
        }
    });

    // --- LISÄÄ LOPPUUN MITTAUSRAPORTTI ---
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    if (duration > 10) { // Varoitus jos yli 10ms
        console.warn(`[PERFORMANCE] Combat check took ${duration.toFixed(2)}ms for ${starsChecked} stars, ${totalShipsProcessed} ships`);
    }
}

function markStarForCombatCheck(starId) {
    if (starId) {
        starsToCheck.add(starId);
    }
}

function triggerCombatCheck() {
    // pakota seuraava tarkistus heti seuraavassa framessa
    lastCombatCheck = 0;
}

// Alusten orbitoinnin päivittäminen
function updateOrbitingShips(delta) {
    if (window.isPaused) return; // STOP everything if paused!
    
    const SIM_DELTA = Math.min(delta, 0.12); // Max ~7 framea kerralla
    frameSkipCounter++;

    // 1. AUTO-FIX TRACKING (säilytetty alkuperäisestä)
    if (frameSkipCounter % 60 === 0) {
        let fixed = 0;
        
        shipsById.forEach(virtualShip => {
            const shipData = virtualShip.userData.shipData;
            if (!shipData || !shipData.parentStarId) return;
            
            const isOrbiting = shipData.state === 'orbiting' || shipData.predictedArrival;
            const starId = shipData.predictedArrival ? shipData.targetStarId : shipData.parentStarId;
            
            if (isOrbiting && starId) {
                // Varmista että alus on tracking rakenteessa
                if (!shipsByStarClient.has(starId)) {
                    shipsByStarClient.set(starId, new Set());
                }
                
                const starShips = shipsByStarClient.get(starId);
                if (!starShips.has(virtualShip)) {
                    starShips.add(virtualShip);
                    fixed++;
                }
            }
        });
        
        if (fixed > 0) {
            // console.log(`[AUTO-FIX] Re-tracked ${fixed} ships`);
        }
    }
    
    // 2. COMBAT SITUATIONS CHECK (säilytetty alkuperäisestä)
    checkForCombatSituations(delta);
    
    // 3. PREPARE BATCH UPDATES PER TYPE
    const updatesByType = {
        Fighter: [],
        Destroyer: [],
        Cruiser: [],
        'Slipstream Frigate': []
    };
    
    // 4. PROCESS ALL SHIPS
    shipsById.forEach(virtualShip => {
        const shipData = virtualShip.userData.shipData;
        
        // Tarkista että shipData on olemassa
        if (!shipData) {
            console.warn("Virtual ship without shipData:", virtualShip);
            return;
        }
        
        const type = virtualShip.userData.shipType || 'Fighter';
        
        // ORBITING SHIPS
        const isOrbitVisually = shipData.state === 'orbiting' || shipData.predictedArrival;
        const centerStarId = shipData.predictedArrival ? shipData.targetStarId : shipData.parentStarId;

        if (isOrbitVisually && centerStarId) {
            const centerStar = starsById.get(centerStarId);
            if (!centerStar) return;
            
            // Päivitä orbitointi
            virtualShip.userData.orbitAngle += virtualShip.userData.orbitSpeed * SIM_DELTA;

            virtualShip.position.x = centerStar.position.x +
                virtualShip.userData.orbitRadius * Math.cos(virtualShip.userData.orbitAngle);
            virtualShip.position.z = centerStar.position.z +
                virtualShip.userData.orbitRadius * Math.sin(virtualShip.userData.orbitAngle);
            virtualShip.position.y = centerStar.position.y +
                Math.sin(virtualShip.userData.orbitAngle * 0.5) * 2;

            // Tallenna päivitys batch-listaan
            updatesByType[type].push({
                index: virtualShip.userData.instanceIndex,
                position: virtualShip.position.clone(),
                lookAt: centerStar.position
            });
        }
        // MOVING SHIPS (säilytetty kaikki alkuperäinen logiikka)
        else if (shipData.state === 'moving' && shipData.targetStarId) {
            // Departure position fix
            if (!virtualShip.userData.validDeparture) {
                const depStarId = shipData.departureStarId;
                const depStar = starsById.get(depStarId);
                
                if (depStar) {
                    const rad = 15 + Math.random() * 6;
                    const ang = Math.random() * Math.PI * 2;

                    virtualShip.position.set(
                        depStar.position.x + rad * Math.cos(ang),
                        depStar.position.y + Math.sin(ang * 0.5) * 2,
                        depStar.position.z + rad * Math.sin(ang)
                    );
                    
                    //console.log(`[DEPARTURE-FIX] Set ship position at ${depStar.userData.starData.name}`);
                } else {
                    console.warn(`[DEPARTURE-FIX] Could not find departure star ${depStarId}`);
                }
                
                virtualShip.userData.validDeparture = true;
            }
            
            const targetStar = starsById.get(shipData.targetStarId);
            if (!targetStar) return;
            
            const targetPosition = targetStar.position;
            const direction = targetPosition.clone().sub(virtualShip.position).normalize();
            const distanceToTarget = virtualShip.position.distanceTo(targetPosition);
            
            // Tarkista onko starlane olemassa
            let speed = shipData.speed;
            if (!speed) {
                const SHIP_SPEED_FAST = 60;
                const SHIP_SPEED_SLOW = 6;
                const FIGHTER_SPEED_SLOW = 12;
                
                speed = SHIP_SPEED_SLOW; // Default
                
                // Tarkista starlane
                const fromStar = starsById.get(shipData.departureStarId);
                if (fromStar && fromStar.userData.starData.connections?.includes(shipData.targetStarId)) {
                    speed = SHIP_SPEED_FAST;
                } else if (shipData.type === 'Fighter') {
                    speed = FIGHTER_SPEED_SLOW;
                }
            }
            
            // Orbit zone logic
            const orbitR = shipData.plannedOrbitRadius ?? 18;
            const rawStep = speed * SIM_DELTA;
            const maxStep = Math.max(0, distanceToTarget - orbitR * 0.9);
            const step = Math.min(rawStep, maxStep);
            
            if (distanceToTarget > orbitR) {
                // Normaali liike
                virtualShip.position.add(direction.multiplyScalar(step));
                
                // Tallenna päivitys
                updatesByType[type].push({
                    index: virtualShip.userData.instanceIndex,
                    position: virtualShip.position.clone(),
                    lookAt: targetPosition
                });
            }
            else {
                // Saavutaan orbit-vyöhykkeelle
                if (!shipData.predictedArrival) {
                    shipData.predictedArrival = true;
                    
                    const ang = shipData.plannedOrbitAngle ?? Math.random() * Math.PI * 2;
                    const rad = shipData.plannedOrbitRadius ?? orbitR;

                    virtualShip.userData.orbitAngle = ang;
                    virtualShip.userData.orbitRadius = rad;

                    virtualShip.position.set(
                        targetPosition.x + rad * Math.cos(ang),
                        targetPosition.y + Math.sin(ang * 0.5) * 2,
                        targetPosition.z + rad * Math.sin(ang)
                    );
                    
                    // Päivitä tracking
                    const targetStarId = shipData.targetStarId;
                    if (targetStarId) {
                        if (!shipsByStarClient.has(targetStarId)) {
                            shipsByStarClient.set(targetStarId, new Set());
                        }
                        shipsByStarClient.get(targetStarId).add(virtualShip);
                        //console.log(`[PREDICTED-ARRIVAL] Added ship to star ${targetStarId} for combat check`);
                    }
                    
                    // Pakota välitön taistelutarkistus
                    markStarForCombatCheck(shipData.targetStarId);
                    triggerCombatCheck();
                    
                    //console.log(`[ORBIT-ARRIVAL] Ship arrived at star ${shipData.targetStarId}, marking for immediate combat check`);
                    
                    // Tallenna päivitys
                    updatesByType[type].push({
                        index: virtualShip.userData.instanceIndex,
                        position: virtualShip.position.clone(),
                        lookAt: targetPosition
                    });
                }
            }
        }
    });
    
    Object.entries(updatesByType).forEach(([type, updates]) => {
        if (updates.length === 0) return;
        
        const instancedMesh = SHIP_INSTANCED_MESHES[type];
        if (!instancedMesh) {
            console.warn(`No InstancedMesh found for type ${type}`);
            return;
        }
        
        const dummy = new THREE.Object3D();
        
        updates.forEach(update => {
            if (update.index === undefined || update.index < 0) {
                console.warn('Invalid instance index:', update);
                return;
            }
            
            dummy.position.copy(update.position);
            dummy.lookAt(update.lookAt);
            dummy.scale.set(1, 1, 1); // Varmista että scale on 1
            dummy.updateMatrix();
            
            try {
                instancedMesh.setMatrixAt(update.index, dummy.matrix);
            } catch (e) {
                console.error(`Failed to update instance ${update.index}:`, e);
            }
        });
        
        instancedMesh.instanceMatrix.needsUpdate = true;
        
        // Debug log
        if (frameSkipCounter % 60 === 0) {
            // console.log(`Updated ${updates.length} ${type} instances`);
        }
    });
}

// Animoi conquest-renkaita
function updateConquestRings(delta) {
    starsById.forEach(starMesh => {
        if (starMesh.userData.conquestRing) {
            const ring = starMesh.userData.conquestRing;
            
            // Pyöritä rengasta hitaasti
            ring.rotation.z += delta * 0.1;
            
            // Pulssaa väriä
            const pulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.002);
            ring.material.opacity = pulse;
            
            // Jos on glow ring, animoi sitäkin
            if (ring.userData.glowRing) {
                ring.userData.glowRing.rotation.z -= delta * 0.05; // Vastakkaiseen suuntaan
            }
        }
    });
}

/* ========================================================================== */
/*  Planeetan valloituksen visuaalisten indikaattorien apufunktiot            */
/* ========================================================================== */
function getPlayerColor(playerId) {
    // Neutraali
    if (!playerId) return NEUTRAL_COLOR;
    
    // Tarkista game data
    const gameData = window.gameData;
    if (gameData && gameData.players) {
        const player = gameData.players.find(p => {
            const pIdStr = typeof p._id === 'object' ? p._id.toString() : p._id;
            const searchIdStr = typeof playerId === 'object' ? playerId.toString() : playerId;
            return pIdStr === searchIdStr;
        });
        
        if (player && player.color) {
            // Muunna hex-stringistä numeroksi
            if (typeof player.color === 'string') {
                return parseInt(player.color.replace('#', ''), 16);
            }
            return player.color;
        }
    }
    
    // Default värit
    const humanIdStr = typeof gameData?.humanPlayerId === 'object' ? 
                      gameData.humanPlayerId.toString() : 
                      gameData.humanPlayerId;
    const playerIdStr = typeof playerId === 'object' ? playerId.toString() : playerId;
    
    if (playerIdStr === humanIdStr) {
        return PLAYER_COLOR;
    }
    
    return 0xdc3545; // Default AI color (red)
}

function createConquestRing(starMesh, color = 0xffa500) {
    const starRadius = starMesh.geometry.parameters.radius * (starMesh.scale.x || 1);
    const ringInnerRadius = starRadius + 8;
    const ringOuterRadius = starRadius + 12;
    
    // Käytä yksinkertaisempaa geometriaa
    const geometry = new THREE.RingGeometry(
        ringInnerRadius, 
        ringOuterRadius, 
        32,  // Vähennetty 64 -> 32
        1
    );
    
    // Käytä shaderia animointiin
    const material = new THREE.ShaderMaterial({
        uniforms: {
            color: { value: new THREE.Color(color) },
            progress: { value: 0.0 },
            opacity: { value: 0.85 }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 color;
            uniform float progress;
            uniform float opacity;
            varying vec2 vUv;
            
            void main() {
                float angle = atan(vUv.y - 0.5, vUv.x - 0.5);
                float normalizedAngle = (angle + 3.14159) / (2.0 * 3.14159);
                
                if (normalizedAngle > progress) {
                    discard;
                }
                
                gl_FragColor = vec4(color, opacity);
            }
        `,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        depthTest: false
    });
    
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(starMesh.position);
    ring.renderOrder = 15;
    
    scene.add(ring);
    return ring;
}

/**
 * Siivoaa koko scenen vanhan pelin objekteista.
 * Poistaa meshit, vapauttaa geometriat & materiaalit ja tyhjentää tilataulukot.
 */



export function cleanupScene() {
    stopAnimateLoop();
    // console.log('[CLEANUP] Siivotaan vanhan pelin 3D-objektit...');
    
    animStarted = false;
    if (clock) clock.stop();

    // Cleanup ship instances FIRST
    Object.values(SHIP_INSTANCED_MESHES).forEach(mesh => {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        // Tyhjennä instance bufferit
        if (mesh.instanceMatrix) mesh.instanceMatrix.array.fill(0);
        if (mesh.instanceColor) mesh.instanceColor.array.fill(0);
        mesh.count = 0;
    });
    
    // Reset instance data
    Object.keys(shipInstanceData).forEach(type => {
        shipInstanceData[type] = { 
            count: 0, 
            matrices: [], 
            colors: [], 
            ids: new Map() 
        };
    });
    
    //Tyhjennä myös vapaat slotit
    Object.keys(freeInstanceSlots).forEach(type => {
        freeInstanceSlots[type].clear();
    });

    // Clear ship tracking
    shipsById.clear();
    shipsByStarClient.clear();
    
    // Cleanup defense ring instances
    Object.values(DEFENSE_RING_INSTANCES).forEach(mesh => {
        if (mesh) {
            scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
            mesh.count = 0;
        }
    });

    // Reset defense ring data
    Object.keys(defenseRingData).forEach(level => {
        defenseRingData[level] = { 
            count: 0, 
            starIds: [] 
        };
    });

    // Poista tähdet ja niiden objektit (alkuperäinen koodi)
    starsById.forEach((starMesh) => {
        scene.remove(starMesh);
        
        if (starMesh.userData.glowSprite) {
            scene.remove(starMesh.userData.glowSprite);
            starMesh.userData.glowSprite.material.dispose();
        }

        const disposeList = list => {
            list.forEach(obj => {
                scene.remove(obj);
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) obj.material.dispose();
            });
        };

        const sd = starMesh.userData;
        const sds = sd.starData ?? {};

        disposeList(sds.defenseRings ?? sd.defenseRings ?? []);
        disposeList(sds.mineIndicatorMeshes ?? sd.mineIndicatorMeshes ?? []);
        disposeList(sds.populationIndicatorMeshes ?? sd.populationIndicatorMeshes ?? []);
        
        if (sds.shipyardIndicatorSprite ?? sd.shipyardIndicatorSprite) {
            const spr = sds.shipyardIndicatorSprite ?? sd.shipyardIndicatorSprite;
            scene.remove(spr);
            spr.material.dispose();
        }
        disposeList(sds.shipyardRings ?? sd.shipyardRings ?? []);

        if (sd.conquestRing || sds.conquestRing) {
            const ring = sd.conquestRing || sds.conquestRing;
            if (ring.userData && ring.userData.glowRing) {
                scene.remove(ring.userData.glowRing);
                ring.userData.glowRing.geometry.dispose();
                ring.userData.glowRing.material.dispose();
            }
            scene.remove(ring);
            ring.geometry.dispose();
            ring.material.dispose();
            sd.conquestRing = null;
            sds.conquestRing = null;
        }
        
        starMesh.geometry.dispose();
        starMesh.material.dispose();
    });
    starsById.clear();



    // Clear connections and effects
    starConnections.forEach(line => {
        scene.remove(line);
        line.geometry.dispose();
        line.material.dispose();
    });
    starConnections.length = 0;
    
    starGlows.forEach(glow => {
        scene.remove(glow);
        if (glow.material) glow.material.dispose();
    });
    starGlows.length = 0;

    explosions.forEach(ex => {
        scene.remove(ex.points);
        ex.points.geometry.dispose();
    });
    explosions.length = 0;
    
    // Cleanup explosion pool
    if (window.explosionPool) {
        window.explosionPool.cleanup();
        window.explosionPool = null;
    }

    // Cleanup combat effects
    combatEffects.forEach(effect => effect.cleanup());
    combatEffects.clear();
    starsToCheck.clear();
    
    // Cleanup combat ring instance
    if (COMBAT_RING_INSTANCE) {
        scene.remove(COMBAT_RING_INSTANCE);
        COMBAT_RING_INSTANCE.geometry.dispose();
        COMBAT_RING_INSTANCE.material.dispose();
        COMBAT_RING_INSTANCE = null;
    }

    combatRingData.count = 0;
    combatRingData.starIds = [];
    combatRingData.opacities = [];
    combatRingData.rotations = [];

    freeCombatRingSlots.clear();

    // Clear tweens
    if (window.TWEEN) {
        window.TWEEN.removeAll();
    }

    // Reset selection
    selectedStar = null;
    hoveredStar = null;
    selectedShips.length = 0;
    if (selectionIndicatorMesh) {
        selectionIndicatorMesh.visible = false;
    }

    // Clean up any remaining objects
    const objectsToRemove = [];
    scene.traverse((child) => {
        if (child instanceof THREE.Sprite || 
            child.geometry instanceof THREE.RingGeometry || 
            child instanceof THREE.Line) {
            objectsToRemove.push(child);
        }
    });

    objectsToRemove.forEach(obj => {
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (obj.material.map) obj.material.map.dispose();
            obj.material.dispose();
        }
    });

    // Cleanup shipyard ring instances
    Object.values(SHIPYARD_RING_INSTANCES).forEach(mesh => {
        if (mesh) {
            scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
            mesh.count = 0;
            
            // LISÄÄ TÄMÄ - nollaa kaikki instanssit
            const dummy = new THREE.Object3D();
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            for (let i = 0; i < MAX_SHIPYARDS; i++) {
                mesh.setMatrixAt(i, dummy.matrix);
            }
            mesh.instanceMatrix.needsUpdate = true;
        }
    });

    // Reset shipyard ring data
    Object.keys(shipyardRingData).forEach(level => {
        shipyardRingData[level] = { 
            count: 0, 
            rotations: [], 
            speeds: [], 
            starIds: [] 
        };
    });

    // Clear nebula sprites
    nebulaSprites.forEach(sprite => {
        scene.remove(sprite);
        if (sprite.material) sprite.material.dispose();
    });
    nebulaSprites.length = 0;

    // Force garbage collection hint
    if (window.gc) {
        window.gc();
    }

    // console.log('[CLEANUP] 3D-maailma siivottu perusteellisesti.');
}

// Manuaalinen siivous
function performMemoryCleanup() {
    // console.log('🧹 [MEMORY-CLEANUP] Starting manual memory cleanup...');
    
    let cleaned = 0;
    
    // 1. Siivoa poistetut alukset tracking-rakenteesta
    shipsByStarClient.forEach((ships, starId) => {
        const validShips = new Set();
        ships.forEach(shipMesh => {
            // Tarkista että alus on vielä olemassa
            if (shipsById.has(shipMesh.userData.entityId)) {
                validShips.add(shipMesh);
            } else {
                cleaned++;
            }
        });
        
        if (validShips.size === 0) {
            shipsByStarClient.delete(starId);
        } else {
            shipsByStarClient.set(starId, validShips);
        }
    });
    
    // 2. Siivoa vanhat combat effectit
    combatEffects.forEach((effect, starId) => {
        const star = starsById.get(starId);
        if (!star) {
            effect.cleanup();
            combatEffects.delete(starId);
            cleaned++;
        }
    });
    
    // 3. Siivoa turhat tarkistukset
    const validStarsToCheck = new Set();
    starsToCheck.forEach(starId => {
        if (starsById.has(starId)) {
            validStarsToCheck.add(starId);
        } else {
            cleaned++;
        }
    });
    starsToCheck.clear();
    validStarsToCheck.forEach(id => starsToCheck.add(id));
    
    // console.log(`✅ [MEMORY-CLEANUP] Cleaned ${cleaned} obsolete references`);
}

function cleanupCombatChecks() {
    // console.log('🔧 [COMBAT-CLEANUP] Fixing ship tracking...');
    
    let fixed = 0;
    let removed = 0;
    
    // 1. Käy läpi kaikki alukset ja varmista tracking
    shipsById.forEach(shipMesh => {
        const shipData = shipMesh.userData.shipData;
        if (!shipData) return;
        
        // Jos alus on orbiting tai conquering, varmista että se on tracked
        if ((shipData.state === 'orbiting' || shipData.state === 'conquering') && shipData.parentStarId) {
            const starId = shipData.parentStarId;
            
            if (!shipsByStarClient.has(starId)) {
                shipsByStarClient.set(starId, new Set());
            }
            
            const starShips = shipsByStarClient.get(starId);
            if (!starShips.has(shipMesh)) {
                starShips.add(shipMesh);
                fixed++;
            }
        }
    });
    
    // 2. Poista turhat merkinnät
    shipsByStarClient.forEach((ships, starId) => {
        const validShips = new Set();
        
        ships.forEach(shipMesh => {
            // Varmista että alus on olemassa ja oikeassa tilassa
            if (shipsById.has(shipMesh.userData.entityId)) {
                const shipData = shipMesh.userData.shipData;
                if (shipData && shipData.parentStarId?.toString() === starId) {
                    validShips.add(shipMesh);
                } else {
                    removed++;
                }
            } else {
                removed++;
            }
        });
        
        if (validShips.size === 0) {
            shipsByStarClient.delete(starId);
        } else {
            shipsByStarClient.set(starId, validShips);
        }
    });
    
    // 3. Nollaa combat tarkistukset
    triggerCombatCheck();
    
    // console.log(`✅ [COMBAT-CLEANUP] Fixed ${fixed} ships, removed ${removed} invalid entries`);
}

window.debugShipyardAllocation = function() {
    console.group('🏭 Shipyard Allocation Debug');
    
    ['level1', 'level2', 'level3', 'level4'].forEach(level => {
        const data = shipyardRingData[level];
        console.group(`${level}:`);
        console.log('Count:', data.count);
        console.log('Allocations:');
        
        for (let i = 0; i < Math.max(5, data.count); i++) {
            const starId = data.starIds[i];
            if (starId) {
                const star = starsById.get(starId);
                const starName = star?.userData?.starData?.name || 'Unknown';
                console.log(`  [${i}]: ${starName} (${starId})`);
            } else {
                console.log(`  [${i}]: <empty>`);
            }
        }
        console.groupEnd();
    });
    
    console.groupEnd();
};

// Debug funktio alusten tarkistamiseen
window.debugShips = function() {
    console.group('🚢 Ship Debug Info');
    
    // 1. Tarkista InstancedMeshit
    Object.entries(SHIP_INSTANCED_MESHES).forEach(([type, mesh]) => {
        console.group(`${type} InstancedMesh:`);
         console.log('Count:', mesh.count);
         console.log('Visible:', mesh.visible);
         console.log('In scene:', scene.children.includes(mesh));
         console.log('Position:', mesh.position);
         console.log('Material visible:', mesh.material.visible);
         console.log('Material opacity:', mesh.material.opacity);
        
        // Tarkista ensimmäinen matriisi
        if (mesh.instanceMatrix && mesh.count > 0) {
            const mat = new THREE.Matrix4();
            mesh.getMatrixAt(0, mat);
            const pos = new THREE.Vector3();
            const quat = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            mat.decompose(pos, quat, scale);
             console.log('First instance position:', pos);
             console.log('First instance scale:', scale);
        }
        
        // Tarkista ensimmäinen väri
        if (mesh.instanceColor && mesh.count > 0) {
            const color = new THREE.Color();
            mesh.getColorAt(0, color);
            // console.log('First instance color:', color);
        }
        
        console.groupEnd();
    });
    
     //2. Tarkista virtuaaliset alukset
     console.log('Virtual ships total:', shipsById.size);
    
    // 3. Tarkista instanceData
    Object.entries(shipInstanceData).forEach(([type, data]) => {
         console.log(`${type} instance data:`, {
            count: data.count,
            matrices: data.matrices.length,
            colors: data.colors.length,
            ids: data.ids.size
        });
    });

    // 4. Testaa luomalla yksi alus manuaalisesti
    console.group('Manual ship test:');
    const testMesh = SHIP_INSTANCED_MESHES['Fighter'];
    if (testMesh) {
        const dummy = new THREE.Object3D();
        dummy.position.set(0, 20, 0); // Kameran edessä
        dummy.scale.set(5, 5, 5); // Iso että näkyy varmasti
        dummy.updateMatrix();
        
        const testIndex = testMesh.count;
        testMesh.setMatrixAt(testIndex, dummy.matrix);
        testMesh.setColorAt(testIndex, new THREE.Color(0xff0000)); // Punainen
        testMesh.count = testIndex + 1;
        testMesh.instanceMatrix.needsUpdate = true;
        testMesh.instanceColor.needsUpdate = true;
        
         console.log('Created test ship at index:', testIndex);
         console.log('New count:', testMesh.count);
    }
    console.groupEnd();
    
    console.groupEnd();
};


// Debug shipyard rings
window.debugShipyardRings = function() {
    console.group('💍 Shipyard Rings Debug');
    
    Object.entries(SHIPYARD_RING_INSTANCES).forEach(([level, mesh]) => {
        console.group(`${level}:`);
        console.log('Count:', mesh.count);
        console.log('Visible:', mesh.visible);
        console.log('In scene:', scene.children.includes(mesh));
        console.log('Material:', mesh.material);
        console.log('Material visible:', mesh.material.visible);
        console.log('Material opacity:', mesh.material.opacity);
        console.log('Render order:', mesh.renderOrder);
        
        if (mesh.count > 0) {
            // Tarkista ensimmäinen instanssi
            const mat = new THREE.Matrix4();
            mesh.getMatrixAt(0, mat);
            const pos = new THREE.Vector3();
            const quat = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            mat.decompose(pos, quat, scale);
            console.log('First instance position:', pos);
            console.log('First instance scale:', scale);
        }
        console.groupEnd();
    });
    
    console.log('\nShipyard ring data:');
    Object.entries(shipyardRingData).forEach(([level, data]) => {
        console.log(`${level}: count=${data.count}`);
    });
    
    console.groupEnd();
};

// Test function to manually create a ring
window.testShipyardRing = function() {
    console.log('🧪 Creating test ring...');
    
    const mesh = SHIPYARD_RING_INSTANCES.level1;
    if (!mesh) {
        console.error('No level1 mesh found!');
        return;
    }
    
    const dummy = new THREE.Object3D();
    dummy.position.set(0, 20, 0); // Kameran edessä
    dummy.scale.set(5, 5, 5); // Iso
    dummy.updateMatrix();
    
    const testIndex = mesh.count;
    mesh.setMatrixAt(testIndex, dummy.matrix);
    mesh.setColorAt(testIndex, new THREE.Color(0xff0000)); // Punainen
    mesh.count = testIndex + 1;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    
    console.log('✅ Created test ring at index:', testIndex);
    console.log('New count:', mesh.count);
    console.log('Mesh visible:', mesh.visible);
    
    // Force render
    if (renderer) renderer.render(scene, camera);
};


// Debug-funktio joka on käytettävissä globaalisti
export function getSceneDebugInfo() {
    let totalTracked = 0;
    shipsByStarClient.forEach(ships => {
        totalTracked += ships.size;
    });
    
    let untrackedShips = 0;
    shipsById.forEach(virtualShip => {
        const shipData = virtualShip.userData.shipData;
        if (shipData && shipData.state === 'orbiting' && shipData.parentStarId) {
            let found = false;
            shipsByStarClient.forEach(ships => {
                if (ships.has(virtualShip)) found = true;
            });
            if (!found) untrackedShips++;
        }
    });
    
    // Instance info
    const instancingInfo = {};
    Object.entries(SHIP_INSTANCED_MESHES).forEach(([type, mesh]) => {
        instancingInfo[type] = {
            activeInstances: shipInstanceData[type].count,
            maxInstances: MAX_SHIPS_PER_TYPE,
            meshCount: mesh.count,
            visible: mesh.visible
        };
    });
    
    // Count real meshes
    let actualMeshCount = 0;
    scene.traverse((child) => {
        if (child.type === 'Mesh' && !child.isInstancedMesh && 
            child.userData.type === 'ship') {
            actualMeshCount++;
        }
    });
    
    return {
        fps: fpsStats.fps,
        frameTime: fpsStats.frameTime ? fpsStats.frameTime.toFixed(1) : '0',
        totalShips: shipsById.size,
        actualMeshes: actualMeshCount,
        instancing: instancingInfo,
        renderer: {
            drawCalls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            geometries: renderer.info.memory.geometries
        },
        starsWithShips: shipsByStarClient.size,
        trackedShips: totalTracked,
        untrackedShips: untrackedShips,
        trackingAccuracy: shipsById.size > 0 ? ((totalTracked / shipsById.size) * 100).toFixed(1) : '100',
        combatEffects: combatEffects.size,
        explosions: explosions.length + (window.explosionPool?.active?.length || 0),
        starsToCheck: starsToCheck.size,
        performanceIssues: {
            tooManyCombatEffects: combatEffects.size > 10,
            tooManyStarsToCheck: starsToCheck.size > 30,
            poorTrackingAccuracy: totalTracked < shipsById.size * 0.95,
            nonInstancedShips: actualMeshCount > 0
        }
    };
}

// Tee funktio saatavaksi window-objektissa
window.getSceneDebugInfo = getSceneDebugInfo;
window.performMemoryCleanup = performMemoryCleanup;
window.cleanupCombatChecks = cleanupCombatChecks;

// Lisää myös automaattinen cleanup 10 sekunnin välein
setInterval(() => {
    // Tarkista onko tracking accuracy huono
    let totalTracked = 0;
    shipsByStarClient.forEach(ships => {
        totalTracked += ships.size;
    });
    
    const accuracy = shipsById.size > 0 ? (totalTracked / shipsById.size) : 1;
    
    // Jos accuracy alle 90%, korjaa automaattisesti
    if (accuracy < 0.9) {
        //console.log(`[AUTO-CLEANUP] Tracking accuracy low (${(accuracy * 100).toFixed(1)}%), running cleanup...`);
        cleanupCombatChecks();
    }
    
    // Jos liian monta efektiä, siivoa
    if (combatEffects.size > 10 || starsToCheck.size > 50) {
        //console.log(`[AUTO-CLEANUP] Too many effects/checks, running cleanup...`);
        cleanupCombatChecks();
    }
}, 10000); // 10 sekuntia


/* ========================================================================== */
/*  EXPORTS                                                                   */
/* ========================================================================== */

export {
    selectStar,
    deselectStar,
    focusOnStar,
    spawnExplosion,
    selectedStar,
    hoveredStar,
 };