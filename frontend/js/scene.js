// frontend/js/scene.js – Täydellinen Three.js renderöinti
// =============================================================================
//  Sisältää kaiken visuaalisen logiikan monoliitista client-server-malliin
// =============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';

/* ========================================================================== */
/*  GLOBAALIT MUUTTUJAT                                                       */
/* ========================================================================== */
let scene, camera, renderer, controls, composer, bokeh;
let backgroundStars, nebulaSprites = [];
let ready = false;
let bokehFocusTarget = null;
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

const INDICATOR_BASE_COLOR = 0x6495ED;
const INDICATOR_SPRITE_SCALE = 2.8;

// Raycasting ja mouse
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Efektit
const explosions = [];

// Lisää taisteluefektien hallinta
const combatEffects = new Map();
const activeCombatStars = new Set(); // Tähdet joissa on aktiivinen taistelu
const starsToCheck = new Set(); // Tähdet joita pitää tarkistaa
let combatCheckTimer = 0; // Tarkistetaan vain muutaman framen välein



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

/* ========================================================================== */
/*  TAISTELUEFEKTIT PELAAJAN VIIHDYTTÄMISEKSI KUNNES RESULT TAISTELUSTA       */
/* ========================================================================== */
class CombatEffectGroup {
    constructor(star, scene) {
        this.star = star;
        this.scene = scene;
        this.lasers = [];
        this.active = true;
        this.createEffects();
    }
    
    createEffects() {
        // Punainen combat-rengas planeetan ympärille
        const ringGeometry = new THREE.RingGeometry(25, 30, 64);
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        this.combatRing = new THREE.Mesh(ringGeometry, ringMaterial);
        this.combatRing.position.copy(this.star.position);
        this.combatRing.rotation.x = Math.PI / 2;
        this.scene.add(this.combatRing);
        
        // Laser-viivat alusten välillä
        this.laserMaterial = new THREE.LineBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.8,
            linewidth: 2
        });
        
        // LISÄÄ: Varoitusteksti
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
        ctx.font = 'bold 32px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('COMBAT', 128, 32);
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.9
        });
        
        this.combatLabel = new THREE.Sprite(spriteMaterial);
        this.combatLabel.scale.set(30, 7.5, 1);
        this.combatLabel.position.copy(this.star.position);
        this.combatLabel.position.y += 20;
        this.scene.add(this.combatLabel);
    }
    
    update(delta, ships) {
        if (!this.active) return;
        
        // Pyöritä combat-rengasta
        this.combatRing.rotation.z += delta * 0.5;
        
        // Pulssaa opacity
        const pulse = Math.sin(Date.now() * 0.003) * 0.2 + 0.5;
        this.combatRing.material.opacity = pulse;
        
        // Animoi label
        if (this.combatLabel) {
            this.combatLabel.position.y = this.star.position.y + 20 + Math.sin(Date.now() * 0.002) * 2;
            this.combatLabel.material.opacity = 0.7 + Math.sin(Date.now() * 0.004) * 0.3;
        }
        
        // Päivitä laserit
        this.updateLasers(ships);
        
        // Satunnaiset pienet räjähdykset
        if (Math.random() < 0.05 && ships.length > 2) { // Vähemmän räjähdyksiä
            this.spawnSmallExplosion();
        }
    }
    
    updateLasers(ships) {
        // Poista vanhat laserit
        this.lasers.forEach(laser => this.scene.remove(laser));
        this.lasers = [];
        
        // Luo uudet satunnaiset laserit alusten välille
        const shipArray = Array.from(ships);
        const maxLasers = Math.min(5, Math.floor(shipArray.length / 2)); // Enemmän lasereita
        
        for (let i = 0; i < maxLasers; i++) {
            if (Math.random() < 0.4) continue; // 60% todennäköisyys ampua
            
            const from = shipArray[Math.floor(Math.random() * shipArray.length)];
            const to = shipArray[Math.floor(Math.random() * shipArray.length)];
            
            if (from !== to && from && to) {
                const geometry = new THREE.BufferGeometry().setFromPoints([
                    from.position,
                    to.position
                ]);
                
                // Vaihtele laser-väriä
                const laserColor = Math.random() > 0.5 ? 0xff0000 : 0xff6600;
                const laserMat = new THREE.LineBasicMaterial({
                    color: laserColor,
                    transparent: true,
                    opacity: 0.9,
                    linewidth: 2
                });
                
                const laser = new THREE.Line(geometry, laserMat);
                this.scene.add(laser);
                this.lasers.push(laser);
                
                // Poista laser 150ms kuluttua
                setTimeout(() => {
                    this.scene.remove(laser);
                    const idx = this.lasers.indexOf(laser);
                    if (idx > -1) this.lasers.splice(idx, 1);
                }, 150);
            }
        }
    }
    
    spawnSmallExplosion() {
        // Pieni räjähdys satunnaisessa kohdassa planeetan lähellä
        const angle = Math.random() * Math.PI * 2;
        const radius = 20 + Math.random() * 15;
        const height = (Math.random() - 0.5) * 10;
        const pos = new THREE.Vector3(
            this.star.position.x + Math.cos(angle) * radius,
            this.star.position.y + height,
            this.star.position.z + Math.sin(angle) * radius
        );
        
        // Käytä olemassa olevaa spawnExplosion funktiota
        spawnExplosion(pos, 6); // Pienempi räjähdys
    }
    
    cleanup() {
        this.active = false;
        this.scene.remove(this.combatRing);
        this.combatRing.geometry.dispose();
        this.combatRing.material.dispose();
        
        if (this.combatLabel) {
            this.scene.remove(this.combatLabel);
            this.combatLabel.material.map.dispose();
            this.combatLabel.material.dispose();
        }
        
        this.lasers.forEach(laser => {
            this.scene.remove(laser);
            laser.geometry.dispose();
            laser.material.dispose();
        });
    }
}


/* ========================================================================== */
/*  INITTHREE - PÄÄFUNKTIO                                                    */
/* ========================================================================== */
export function initThreeIfNeeded(mountTo = document.body) {
    if (ready) return;
    ready = true;

    console.log("Initializing Three.js scene...");

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
    
    // Indikaattori-materiaalit
    initIndicatorMaterials();
    
    // Selection indicator
    initializeSelectionIndicator();

    // Event listeners
    setupEventListeners();

    // Responsive
    window.addEventListener('resize', onWindowResize, false);

    console.log("Three.js scene initialized successfully");
}

function setupPostProcessing() {
    composer = new EffectComposer(renderer);
    
    const starsPass = new RenderPass(scene, camera);
    starsPass.clear = true;
    composer.addPass(starsPass);
    
    bokeh = new BokehPass(scene, camera, {
        focus: 5000,
        aperture: 0.15,     // Increased from 0.00015 for subtler effect
        maxblur: 0.001        // Reduced from 0.01 for less blur
    });
    composer.addPass(bokeh);
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
    for (let i = 0; i < 10000; i++) {
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
    for (let i = 0; i < 350; i++) {
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
    for (let i = 0; i < 60; i++) {
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
    if (event.button !== 0) return; // Vain LMB
    
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
    
    // Jos oli drag, älä käsittele valintoja
    if (isDrag) {
        controls.enabled = true;
        return;
    }
    
    // NORMAALI KLIKKAUS - raycast kaikille objekteille
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    
    // Kerää kaikki mahdolliset kohteet
    const clickableObjects = [];
    
    // Star meshit
    starsById.forEach(starMesh => clickableObjects.push(starMesh));
    
    // Ship meshit JA click targetit
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
        let actualObject = clicked;
        if (clicked.userData && clicked.userData.isClickTarget) {
            // Etsi varsinainen ship mesh
            actualObject = Array.from(shipsById.values()).find(
                mesh => mesh.userData.clickTarget === clicked
            );
        }
        
        // SHIP CLICK
        if (actualObject && actualObject.userData && actualObject.userData.type === 'ship') {
            handleShipClick(actualObject, event.shiftKey);
        }
        // STAR CLICK
        else if (clicked.userData && clicked.userData.type === 'star') {
            // Deselect ships kun klikataan tähteä (paitsi jos shift pohjassa)
            if (!event.shiftKey) {
                deselectAllShips();
            }
            
            const starData = clicked.userData.starData;
            if (starData) {
                selectStar(starData);
            }
        }
    } else {
        // TYHJÄ KLIKKAUS - deselect kaikki
        if (!event.shiftKey) {
            deselectAllShips();
            deselectStar();
            updateSelectedUnitsDisplay();
        }
    }
}

function onCanvasRightClick(event) {
    event.preventDefault();

    // Tarkista onko pausella
    if (window.isPaused) return;

    if (selectedShips.length === 0) return;
    
    // RMB command - liikuta valittuja aluksia
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
    
    bokehFocusTarget = starData.mesh ? starData.mesh.position : null;
    
    // Emit event for UI
    window.dispatchEvent(new CustomEvent('starSelected', { detail: starData }));
}

function handleShipClick(shipMesh, additive = false) {
    const shipOwnerId = shipMesh.userData.owner;
    const humanIdStr = typeof window.gameData?.humanPlayerId === 'object' ? 
                      window.gameData.humanPlayerId.toString() : 
                      window.gameData.humanPlayerId;
    
    const isPlayerShip = shipOwnerId === humanIdStr;
    if (!isPlayerShip) return;
    
    // Jos ei shift pohjassa, tyhjennä valinnat ensin
    if (!additive) {
        deselectAllShips();
    }
    
    // Toggle valinta
    const isCurrentlySelected = selectedShips.includes(shipMesh);
    if (isCurrentlySelected) {
        deselectShip(shipMesh);
    } else {
        selectShip(shipMesh);
    }
    
    updateSelectedUnitsDisplay();
}

function deselectShip(shipMesh) {
    const index = selectedShips.indexOf(shipMesh);
    if (index === -1) return;
    
    selectedShips.splice(index, 1);
    shipMesh.userData.isSelected = false;
    
    // Palauta alkuperäinen väri
    const shipData = shipMesh.userData.shipData;
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
    
    shipMesh.material.color.setHex(originalColor);
    shipMesh.material.emissive.setHex(originalColor);
    shipMesh.material.emissiveIntensity = 0.3;
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
    
    shipsById.forEach(shipMesh => {
        const shipData = shipMesh.userData.shipData;
        
        // Vain omat alukset
        if (shipData.ownerId !== window.gameData?.humanPlayerId) return;
        
        // Projektoi ruudulle
        const screenPos = shipMesh.position.clone().project(camera);
        const sx = (screenPos.x + 1) / 2 * window.innerWidth;
        const sy = (-screenPos.y + 1) / 2 * window.innerHeight;
        
        if (sx >= startX && sx <= endX && sy >= startY && sy <= endY) {
            if (!selectedShips.includes(shipMesh)) {
                selectShip(shipMesh);
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
    
    console.log(`Ordering ${selectedShips.length} ships to star ${targetStar.name}`);
    
    selectedShips.forEach(shipMesh => {
        const shipData = shipMesh.userData.shipData;
        
        // Varmista että shipData ja sen _id on olemassa
        if (!shipData || !shipData._id) {
            console.error("Ship without proper data:", shipMesh);
            return;
        }
        
        // Lähetä move-komento serverille
        const command = {
            action: 'MOVE_SHIP',
            shipId: shipData._id,  // Tämä puuttui!
            toStarId: targetStar._id,
            fromStarId: shipData.parentStarId  // Lisää myös tämä helpottamaan
        };
        
        console.log("Sending ship command:", command);
        
        // Lähetä komento
        window.dispatchEvent(new CustomEvent('shipCommand', { detail: command }));
    });
}

function selectShip(shipMesh) {
    if (selectedShips.includes(shipMesh)) return;
    
    // Tarkista että on oma alus - käytä userData.owner, ei shipData.ownerId!
    const shipOwnerId = shipMesh.userData.owner;
    const humanIdStr = typeof window.gameData?.humanPlayerId === 'object' ? 
                      window.gameData.humanPlayerId.toString() : 
                      window.gameData.humanPlayerId;
    
    const isPlayerShip = shipOwnerId === humanIdStr;
    if (!isPlayerShip) {
        console.log("Cannot select - not player ship. Owner:", shipOwnerId, "Human:", humanIdStr);
        return;
    }
    
    selectedShips.push(shipMesh);
    shipMesh.userData.isSelected = true;
    
    // Päivitä visuaalista
    shipMesh.material.color.setHex(SELECTED_SHIP_COLOR);
    shipMesh.material.emissive.setHex(SELECTED_SHIP_COLOR);
    shipMesh.material.emissiveIntensity = 0.8;
}

function deselectStar() {
    selectedStar = null;
    if (selectionIndicatorMesh) {
        selectionIndicatorMesh.visible = false;
    }
    bokehFocusTarget = null;
    
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
    console.log("Focusing camera on player homeworld");
    
    const targetPosition = starMesh.position.clone();
    const offset = new THREE.Vector3(0, 100, 220); // Same as initial camera offset
    
    controls.target.copy(targetPosition);
    camera.position.copy(targetPosition).add(offset);
    controls.update();
    
    console.log("Camera focused on homeworld at", targetPosition);
}

/* ========================================================================== */
/*  VISUAL UPDATES                                                            */
/* ========================================================================== */

function updateBokehFocus() {
    if (!bokeh || !bokeh.materialBokeh) return;
    
    const wanted = bokehFocusTarget
        ? camera.position.distanceTo(bokehFocusTarget)
        : 1500;
    
    const cur = bokeh.materialBokeh.uniforms.focus.value;
    bokeh.materialBokeh.uniforms.focus.value += (wanted - cur) * 0.1;
}

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
    console.log("Building from snapshot:", snap);
    
    if (!ready) {
        console.warn("Scene not ready, initializing first");
        initThreeIfNeeded();
    }
    
    if (snap.stars) {
        spawnStars(snap.stars);
        createStarlanes(snap.stars);
    }
    
    if (snap.ships) {
        spawnShips(snap.ships);
    }
    
    console.log("Scene built from snapshot");
}

function spawnStars(starList) {
    const starGeometry = new THREE.SphereGeometry(5, 32, 32);
    
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

function spawnShips(shipList) {
    shipList.forEach(shipData => {
        if (shipsById.has(shipData._id)) return;
        
        // Create ship geometry based on type
        let shipGeometry;
        if (shipData.type === 'Destroyer') {
            shipGeometry = new THREE.CylinderGeometry(0.7, 0.7, 4.5, 8);
            shipGeometry.rotateX(Math.PI / 2);
        } else if (shipData.type === 'Cruiser') {
            shipGeometry = new THREE.SphereGeometry(1.1, 18, 14);
            shipGeometry.scale(2.5, 1.8, 3.8);
        } else if (shipData.type === 'Slipstream Frigate') {
            shipGeometry = new THREE.ConeGeometry(1.2, 5, 4);
            shipGeometry.rotateX(Math.PI / 2);
            shipGeometry.scale(1, 0.7, 1.2);
        } else { // Fighter
            shipGeometry = new THREE.ConeGeometry(1, 3, 4);
            shipGeometry.rotateX(Math.PI / 2);
        }
        
        // Värin määritys - varmista että gameData on käytettävissä
        let shipColor = NEUTRAL_COLOR;
        
        if (shipData.ownerId && window.gameData) {
            // Vertailu string-muodossa varmuuden vuoksi
            const ownerIdStr = typeof shipData.ownerId === 'object' ? 
                              shipData.ownerId.toString() : shipData.ownerId;
            const humanIdStr = typeof window.gameData.humanPlayerId === 'object' ? 
                              window.gameData.humanPlayerId.toString() : 
                              window.gameData.humanPlayerId;
            
            if (ownerIdStr === humanIdStr) {
                shipColor = SHIP_COLOR_PLAYER;
            } else {
                // Etsi AI-pelaajan väri
                const ownerPlayer = window.gameData.players.find(p => {
                    const pIdStr = typeof p._id === 'object' ? p._id.toString() : p._id;
                    return pIdStr === ownerIdStr;
                });
                
                if (ownerPlayer && ownerPlayer.color) {
                    shipColor = parseInt(ownerPlayer.color.replace('#', ''), 16);
                }
            }
        }
        
        const shipMaterial = new THREE.MeshStandardMaterial({
            color: shipColor,
            emissive: shipColor,
            emissiveIntensity: 0.3
        });
        
        const shipMesh = new THREE.Mesh(shipGeometry, shipMaterial);
        
        // LISÄÄ SUUREMPI COLLISION-ALUE valittavuuteen
        const clickTargetGeometry = new THREE.SphereGeometry(3, 8, 6);
        const clickTargetMaterial = new THREE.MeshBasicMaterial({ 
            visible: false,
            transparent: true,
            opacity: 0
        });
        const clickTarget = new THREE.Mesh(clickTargetGeometry, clickTargetMaterial);
        clickTarget.userData = {
            shipData: shipData,
            isClickTarget: true
        };
        
        // Orbitointidatan alustus
        const offsetRadius = 15 + Math.random() * 6;
        const randomAngle = Math.random() * Math.PI * 2;
        const orbitSpeed = 0.15 + Math.random() * 0.15;
        
        // Position ship orbitoimaan parent staria
        if (shipData.parentStarId) {
            const parentStar = starsById.get(shipData.parentStarId);
            if (parentStar) {
                shipMesh.position.copy(parentStar.position);
                shipMesh.position.x += offsetRadius * Math.cos(randomAngle);
                shipMesh.position.z += offsetRadius * Math.sin(randomAngle);
                shipMesh.position.y += (Math.random() - 0.5) * 2;
                
                // Click target seuraa meshin sijaintia
                clickTarget.position.copy(shipMesh.position);
            }
        } else if (shipData.position) {
            shipMesh.position.set(shipData.position.x, shipData.position.y, shipData.position.z);
            clickTarget.position.copy(shipMesh.position);
        }
        
        // ASETA KAIKKI USERDATA KERRALLA TÄSSÄ
        shipMesh.userData = {
            // Entity tunnisteet
            entityId: shipData._id,
            type: 'ship',
            owner: shipData.ownerId,
            
            // Ship data kokonaisuudessaan
            shipData: {
                _id: shipData._id,
                type: shipData.type,
                ownerId: shipData.ownerId,
                parentStarId: shipData.parentStarId,
                state: shipData.state || 'orbiting',
                targetStarId: shipData.targetStarId || null,
                position: shipData.position
            },
            
            // Orbitointi data
            orbitAngle: randomAngle,
            orbitRadius: offsetRadius,
            orbitSpeed: orbitSpeed,
            isSelected: false,
            clickTarget: clickTarget
        };
        
        scene.add(shipMesh);
        scene.add(clickTarget);
        shipsById.set(shipData._id, shipMesh);
    });
}

function updateDefenseRings(starData, starMesh) {
    // Poista vanhat renkaat
    if (starData.defenseRings) {
        starData.defenseRings.forEach(ring => scene.remove(ring));
    }
    starData.defenseRings = [];

    if (starData.ownerId && starData.defenseLevel > 0) {
        // Määritä väri omistajan mukaan
        let ownerColor;
        if (starData.ownerId === window.gameData?.humanPlayerId) {
            ownerColor = PLAYER_COLOR;
        } else {
            const ownerPlayer = window.gameData.players.find(p => p._id === starData.ownerId);
            ownerColor = ownerPlayer ? parseInt(ownerPlayer.color.replace('#', ''), 16) : 0xdc3545;
        }

        // Sekoita valkoista mukaan
        const ringColor = new THREE.Color(ownerColor).lerp(new THREE.Color(0xffffff), 0.30);

        const ringMaterial = new THREE.MeshBasicMaterial({
            color: ringColor,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
            depthWrite: false
        });

        const starRadius = starMesh.geometry.parameters.radius * (starMesh.scale.x || 1);

        for (let i = 0; i < starData.defenseLevel; i++) {
            const ringRadius = starRadius + 3 + i * 1.5;
            const ringGeometry = new THREE.RingGeometry(ringRadius - 0.2, ringRadius + 0.2, 64);
            const ring = new THREE.Mesh(ringGeometry, ringMaterial);
            ring.position.copy(starMesh.position);
            ring.rotation.x = Math.PI / 2;
            scene.add(ring);
            starData.defenseRings.push(ring);
        }
    }
}

function updateStarIndicators(starData, starMesh) {
    // Poista vanhat indikaattorit
    removeOldIndicators(starData);
    
    // Lisää uudet vain jos ei neutraali
    if (starData.ownerId) {
        updateMineIndicators(starData, starMesh);
        updatePopulationIndicators(starData, starMesh);
        updateShipyardIndicator(starData, starMesh);
    }
}

function removeOldIndicators(starData) {

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
    
    // Shipyard indicator
    if (starData.shipyardIndicatorSprite) {
        scene.remove(starData.shipyardIndicatorSprite);
        starData.shipyardIndicatorSprite = null;
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
    const yOffset = starRadiusScaled + INDICATOR_SPRITE_SCALE * 1.2 + 
                   (starData.defenseLevel ? (starData.defenseLevel * 1.5 + 1.2) : 0);
    const xBaseOffset = starRadiusScaled * 0.6 + INDICATOR_SPRITE_SCALE * 0.4;
    
    // Määritä väri omistajan mukaan
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
    if (!starData.population || starData.population === 0) return;
    
    starData.populationIndicatorMeshes = [];
    
    const starRadiusScaled = starMesh.geometry.parameters.radius * (starMesh.scale.x || 1);
    const itemsPerRow = 4;
    const spacing = INDICATOR_SPRITE_SCALE * 0.9;
    const yOffset = starRadiusScaled + INDICATOR_SPRITE_SCALE * 1.2 + 
                   (starData.defenseLevel ? (starData.defenseLevel * 1.5 + 1.2) : 0);
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
    
    const starRadius = starMesh.geometry.parameters.radius * (starMesh.scale.x || 1);
    const yOffset = starRadius + INDICATOR_SPRITE_SCALE * 1.5 +
                   (starData.defenseLevel ? starData.defenseLevel * 1.5 + 1.0 : 0);
    
    // Shipyard sprite
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
    
    // Shipyard level rings (kiertorata-renkaat)
    starData.shipyardRings = [];
    const tubeRadius = 0.25;
    const baseRadius = starRadius + INDICATOR_SPRITE_SCALE * 3;
    
    const ringTilts = [
        new THREE.Euler(THREE.MathUtils.degToRad(45), 0, 0),   // Lvl 1
        new THREE.Euler(0, THREE.MathUtils.degToRad(-45), 0),  // Lvl 2
        new THREE.Euler(0, 0, THREE.MathUtils.degToRad(-45)),  // Lvl 3
        new THREE.Euler(THREE.MathUtils.degToRad(90), 0, 0)   // Lvl 4
    ];
    
    for (let lvl = 1; lvl <= starData.shipyardLevel && lvl <= 4; lvl++) {
        const ringGeom = new THREE.TorusGeometry(
            baseRadius, tubeRadius, 32, 256
        );
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.9,
            toneMapped: false
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        
        if (ringTilts[lvl - 1]) {
            ring.rotation.copy(ringTilts[lvl - 1]);
        }
        
        // Pyörimisdata animaatiota varten
        const speed = 0.35;
        ring.userData.spin = {
            x: lvl === 2 ? speed : 0,
            y: (lvl === 1 || lvl === 3) ? speed : (lvl === 4 ? -speed : 0),
            z: 0
        };
        
        ring.position.copy(starMesh.position);
        scene.add(ring);
        starData.shipyardRings.push(ring);
    }
}

function getIndicatorColor(ownerId) {
    // Palauttaa THREE.Color objektin
    const hexColor = getPlayerColor(ownerId);
    return new THREE.Color(hexColor);
}

// Lisää animate looppiin shipyard-renkaiden pyöritys
// (updateOrbitingShips funktion jälkeen):
function updateShipyardRings(delta) {
    starsById.forEach(starMesh => {
        const starData = starMesh.userData.starData;
        if (starData && starData.shipyardRings) {
            starData.shipyardRings.forEach(ring => {
                const spin = ring.userData.spin;
                if (spin) {
                    ring.rotation.x += spin.x * delta;
                    ring.rotation.y += spin.y * delta;
                    ring.rotation.z += spin.z * delta;
                }
            });
        }
    });
}

export function applyDiff(diffArr = []) {
    console.log("Applying diff:", diffArr);
    
    diffArr.forEach(act => {
        switch (act.action) {
            case 'COMPLETE_PLANETARY': {
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;
                
                // Päivitä star data
                if (act.starData) {
                    const star = starMesh.userData.starData;
                    Object.assign(star, act.starData);
                    
                    // Jos defense level muuttui, päivitä renkaat
                    if (act.type === 'Defense Upgrade') {
                        updateDefenseRings(star, starMesh);
                    }
                    
                    // Päivitä KAIKKI indikaattorit jos mine tai infra muuttui
                    if (act.type === 'Mine' || act.type.startsWith('Infrastructure')) {
                        updateStarIndicators(star, starMesh);
                    }
                }
                
                console.log(`${act.type} completed at star ${act.starId}`);
                break;
            }

            case 'STAR_UPDATED': {
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;
                
                const star = starMesh.userData.starData;
                Object.assign(star, act.updatedFields);
                
                // Jos populaatio muuttui, päivitä indikaattorit
                if (act.updatedFields.population !== undefined) {
                    updatePopulationIndicators(star, starMesh);
                }
                break;
            }

            case 'DEFENSE_DAMAGED': {
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;
                
                const star = starMesh.userData.starData;
                star.defenseLevel = act.newLevel;
                updateDefenseRings(star, starMesh);
                
                console.log(`Defense damaged at star ${act.starId}, new level: ${act.newLevel}`);
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
                
                // LISÄÄ TÄMÄ: Merkitse tähti tarkistettavaksi combatille
                markStarForCombatCheck(act.starId);
                
                console.log(`[SHIP_SPAWNED] Ship ${act.shipId} spawned at star ${act.starId}`);
                break;
            }
            
            case 'MOVE_SHIP':
            case 'SHIP_MOVING': {
                const mesh = shipsById.get(act.shipId);
                if (!mesh) break;

                const sd = mesh.userData.shipData;

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

                console.log(`Ship ${act.shipId} moving ${act.fromStarId || sd.departureStarId} → ${act.toStarId} @v=${act.speed}`);
                
                // Merkitse lähtötähti tarkistettavaksi (combat check)
                markStarForCombatCheck(sd.departureStarId);
                break;
            }

            case 'SHIP_ARRIVED': {
                // TÄRKEÄ: Jos alus ei ole vielä spawnattu, odota hetki
                if (!shipsById.has(act.shipId)) {
                    console.log(`[SHIP_ARRIVED] Ship not yet spawned: ${act.shipId}, retrying...`);
                    
                    // Yritä uudelleen 100ms kuluttua
                    setTimeout(() => {
                        if (shipsById.has(act.shipId)) {
                            applyDiff([act]); // Käsittele viesti uudelleen
                        } else {
                            console.warn(`[SHIP_ARRIVED] Ship still not found after retry: ${act.shipId}`);
                        }
                    }, 100);
                    break;
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

                // Merkitse tähti tarkistettavaksi
                 markStarForCombatCheck(act.atStarId);
                
                console.log(`[VISUAL] Ship ${act.shipId} placed in orbit around ${starMesh.userData.starData.name}`);
                break;
            }

            case 'COMBAT_STARTED': {
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;
                
                // Aloita combat-efektit HETI
                const effect = new CombatEffectGroup(starMesh, scene);
                combatEffects.set(act.starId, effect);
                
                console.log("⚔️ Combat effects started at star", act.starId);
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
                break;
            }

            case 'SHIP_DESTROYED': {
                const shipMesh = shipsById.get(act.shipId);
                if (shipMesh) {
                    // Visuaalinen räjähdysefekti
                    spawnExplosion(shipMesh.position);

                    // LISÄÄ TÄMÄ: Poista valittujen listalta jos oli valittuna
                    const selectedIndex = selectedShips.indexOf(shipMesh);
                    if (selectedIndex > -1) {
                        selectedShips.splice(selectedIndex, 1);
                        updateSelectedUnitsDisplay();
                    }

                    // Poista 3D-malli ja sen klikkauskohde
                    scene.remove(shipMesh);
                    if (shipMesh.userData.clickTarget) {
                        scene.remove(shipMesh.userData.clickTarget);
                    }

                    // Siivoa kartta muistista
                    shipsById.delete(act.shipId);
                    const starId = shipMesh.userData.shipData?.parentStarId;
                     markStarForCombatCheck(starId);
                }
                break;
            }

            case 'CONQUEST_STARTED': {
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;
                
                // Luo conquest ring
                const conquerorColor = getPlayerColor(act.conquerorId);
                const ring = createConquestRing(starMesh, conquerorColor);
                starMesh.userData.conquestRing = ring;
                
                console.log("⚔️ Conquest ring created for star", act.starId);
                break;
            }

            case 'CONQUEST_PROGRESS': {
                const starMesh = starsById.get(act.starId);
                if (!starMesh || !starMesh.userData.conquestRing) break;
                
                // Päivitä conquest ringin koko
                const progress = act.progress / 100; // 0-1
                const angle = Math.max(0.01, progress * Math.PI * 2); // Vähintään pieni kaari
                
                // Luo uusi geometria päivitetyllä kaarella
                const ring = starMesh.userData.conquestRing;
                const oldGeom = ring.geometry;
                const starRadius = starMesh.geometry.parameters.radius * (starMesh.scale.x || 1);
                const ringInnerRadius = starRadius + 8;
                const ringOuterRadius = starRadius + 12;
                
                ring.geometry = new THREE.RingGeometry(
                    ringInnerRadius,
                    ringOuterRadius,
                    64,
                    1,
                    0,
                    angle
                );
                
                oldGeom.dispose();
                
                // Päivitä myös glow ring
                if (ring.userData.glowRing) {
                    const glowOldGeom = ring.userData.glowRing.geometry;
                    ring.userData.glowRing.geometry = new THREE.RingGeometry(
                        ringInnerRadius - 1,
                        ringOuterRadius + 1,
                        64,
                        1,
                        0,
                        angle
                    );
                    glowOldGeom.dispose();
                    
                    // Animoi glow opacity
                    ring.userData.glowRing.material.opacity = 0.2 + 0.1 * Math.sin(Date.now() * 0.003);
                }
                
                // Debug log
                console.log(`[CONQUEST] Progress: ${act.progress}% at star ${act.starId}`);
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
                
                console.log("🏴 Conquest complete, star color updated");
                break;
            }

            case 'CONQUEST_HALTED': {
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
                
                console.log("🛑 Conquest halted, ring removed");
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
    console.log("Starting animation loop...");

    function loop() {
        if (!animStarted) return; // Pysäytetään looppi, jos lippu on false
        animationFrameId = requestAnimationFrame(loop);

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
        
        // Update explosions
        updateExplosions(delta);
        
        // Update orbitoivat alukset
        updateOrbitingShips(delta);

        // Update shipyard -ringsit
        updateShipyardRings(delta)

        // Update conquest rings
        updateConquestRings(delta);

        if (controls) controls.update();
        updateBokehFocus();
        if (selectionIndicatorMesh && selectionIndicatorMesh.visible) {
            selectionIndicatorMesh.rotation.y += 0.5 * delta;
        }


        
        updateAllStarVisuals();
        nebulaSprites.forEach(sp => sp.quaternion.copy(camera.quaternion));
        
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
    console.log("Animation loop stopped.");
}

function checkForCombatSituations(delta) {
    // Tarkista vain 10 kertaa sekunnissa, ei joka frame
    combatCheckTimer += delta;
    if (combatCheckTimer < 0.1) return; // 100ms välein
    combatCheckTimer = 0;
    
    // Käy läpi VAIN merkityt tähdet
    for (const starId of starsToCheck) {
        const starMesh = starsById.get(starId);
        if (!starMesh) {
            starsToCheck.delete(starId);
            continue;
        }
        
        // Kerää alukset vain tästä tähdestä
        const shipsAtStar = [];
        const factions = new Set();
        
        shipsById.forEach(shipMesh => {
            const shipData = shipMesh.userData.shipData;
            if (!shipData) return;
            
            // MUUTOS: Hyväksy myös predictedArrival-tilassa olevat alukset
            const isAtStar = (
                (shipData.parentStarId === starId && shipData.state === 'orbiting') ||
                (shipData.targetStarId === starId && shipData.predictedArrival)
            );
            
            if (isAtStar) {
                shipsAtStar.push(shipMesh);
                if (shipMesh.userData.owner) {
                    factions.add(shipMesh.userData.owner);
                }
            }
        });
        
        // Tarkista planetary defense
        const starOwnerId = starMesh.userData.starData.ownerId;
        const starHasDefense = starMesh.userData.starData.defenseLevel > 0;
        
        // Taistelu tarvitaan jos:
        // 1. Useampi faktio TAI
        // 2. Yksi faktio hyökkää toisen omistamaa tähteä vastaan TAI
        // 3. Joku hyökkää planeettapuolustusta vastaan
        const needsCombat = shipsAtStar.length >= 2 && (
            factions.size > 1 || 
            (factions.size === 1 && starOwnerId && !factions.has(starOwnerId)) ||
            (factions.size === 1 && starHasDefense && !factions.has(starOwnerId))
        );
        
        if (needsCombat) {
            if (!combatEffects.has(starId)) {
                console.log("⚔️ [CLIENT] Combat situation detected at star", starId);
                console.log(`   - Ships: ${shipsAtStar.length}, Factions: ${Array.from(factions).map(f => f.slice(-4)).join(', ')}`);
                console.log(`   - Star owner: ${starOwnerId?.slice(-4) || 'neutral'}, Defense: ${starMesh.userData.starData.defenseLevel}`);
                
                const effect = new CombatEffectGroup(starMesh, scene);
                combatEffects.set(starId, effect);
            }
        } else {
            const effect = combatEffects.get(starId);
            if (effect) {
                console.log("✅ [CLIENT] Combat ended at star", starId);
                effect.cleanup();
                combatEffects.delete(starId);
                // Älä poista tähdestä vielä, koska tilanne voi muuttua
            }
        }
    }
    
    // Päivitä kaikki aktiiviset efektit
    combatEffects.forEach((effect, starId) => {
        const ships = [];
        shipsById.forEach(shipMesh => {
            const shipData = shipMesh.userData.shipData;
            if (!shipData) return;
            
            // MUUTOS: Sisällytä myös predictedArrival alukset
            const isAtStar = (
                (shipData.parentStarId === starId && shipData.state === 'orbiting') ||
                (shipData.targetStarId === starId && shipData.predictedArrival)
            );
            
            if (isAtStar) {
                ships.push(shipMesh);
            }
        });
        effect.update(delta, ships);
    });
}

function markStarForCombatCheck(starId) {
    if (starId) {
        starsToCheck.add(starId);
    }
}
// Alusten orbitoinnin päivittäminen
function updateOrbitingShips(delta) {
    const SIM_DELTA = Math.min(delta, 0.12); // Max ~7 framea kerralla
    checkForCombatSituations(delta); // Visuaalinen taisteluindikaattori siksi aikaa, kun serveri käy combatin
    shipsById.forEach(shipMesh => {
        // shipData on tallennettu userData:n sisään spawnShips funktiossa
        const shipData = shipMesh.userData.shipData;
        
        // Tarkista että shipData on olemassa
        if (!shipData) {
            console.warn("Ship mesh without shipData:", shipMesh);
            return;
        }
        
        // Orbitointi vain jos alus on parentStarin ympärillä
        const isOrbitVisually =
            shipData.state === 'orbiting' || shipData.predictedArrival;

        const centerStarId =
            shipData.predictedArrival        // ← ennustevaihe
                ? shipData.targetStarId      //    käytä määränpäätä
                : shipData.parentStarId;     // ← normaali orbit

        if (isOrbitVisually && centerStarId) {
            const centerStar = starsById.get(centerStarId);
            if (!centerStar) return;
            
            // Päivitä orbitointi
            shipMesh.userData.orbitAngle += shipMesh.userData.orbitSpeed * SIM_DELTA;

            shipMesh.position.x = centerStar.position.x +
                shipMesh.userData.orbitRadius * Math.cos(shipMesh.userData.orbitAngle);
            shipMesh.position.z = centerStar.position.z +
                shipMesh.userData.orbitRadius * Math.sin(shipMesh.userData.orbitAngle);
            shipMesh.position.y = centerStar.position.y +
                Math.sin(shipMesh.userData.orbitAngle * 0.5) * 2;

            shipMesh.lookAt(centerStar.position);
        }
        // LIIKKUVAT ALUKSET
        else if (shipData.state === 'moving' && shipData.targetStarId) {
            /* 0️⃣  Jos mesh on vielä (0,0,0) tai tähden keskipisteessä,
           nosta se nopeasti lähtötähden kiertoradalle. Tällä korjataan teleportaatio, jossa 
           alus vaikuttaa teleporttaavan syntyplaneetalta ensimmäiselle tähdelleen.            */
            if (!shipMesh.userData.validDeparture) {
                // Käytä departureStarId prioriteettina, koska parentStarId on null moving-tilassa
                const depStarId = shipData.departureStarId; // KORJATTU RIVI
                const depStar = starsById.get(depStarId);
                
                if (depStar) {
                    const rad = 15 + Math.random() * 6;
                    const ang = Math.random() * Math.PI * 2;

                    shipMesh.position.set(
                        depStar.position.x + rad * Math.cos(ang),
                        depStar.position.y + Math.sin(ang * 0.5) * 2,
                        depStar.position.z + rad * Math.sin(ang)
                    );
                    shipMesh.lookAt(depStar.position);
                    shipMesh.userData.clickTarget?.position.copy(shipMesh.position);
                    
                    console.log(`[DEPARTURE-FIX] Set ship position at ${depStar.userData.starData.name}`);
                } else {
                    console.warn(`[DEPARTURE-FIX] Could not find departure star ${depStarId}`);
                }
                
                shipMesh.userData.validDeparture = true;
            }
            const targetStar = starsById.get(shipData.targetStarId);
            if (!targetStar) return;
            
            const targetPosition = targetStar.position;
            const direction = targetPosition.clone().sub(shipMesh.position).normalize();
            const distanceToTarget = shipMesh.position.distanceTo(targetPosition);
            
            
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
            // UUSI LOGIIKKA: Rajoita step niin ettei ylitä orbit-vyöhykettä
            const orbitR = shipData.plannedOrbitRadius ?? 18;
            const rawStep = speed * SIM_DELTA;
            
            // Varmista ettei yhdellä askeleella pääse orbit-vyöhykkeen sisään
            const maxStep = Math.max(0, distanceToTarget - orbitR * 0.9); // 90% varmuusmarginaali
            const step = Math.min(rawStep, maxStep);
            
            // MUUTETTU EHTO: Tarkista vain etäisyys, ei step-laskelmaa
            if (distanceToTarget > orbitR) {
                // Normaali liike
                shipMesh.position.add(direction.multiplyScalar(step));
                shipMesh.lookAt(targetPosition);
                if (shipMesh.userData.clickTarget) {
                    shipMesh.userData.clickTarget.position.copy(shipMesh.position);
                }
            }
            else {
                // Saavutaan orbit-vyöhykkeelle
                if (!shipData.predictedArrival) {
                    shipData.predictedArrival = true;
                    
                    const ang = shipData.plannedOrbitAngle ?? Math.random() * Math.PI * 2;
                    const rad = shipData.plannedOrbitRadius ?? orbitR;

                    shipMesh.userData.orbitAngle = ang;
                    shipMesh.userData.orbitRadius = rad;

                    shipMesh.position.set(
                        targetPosition.x + rad * Math.cos(ang),
                        targetPosition.y + Math.sin(ang * 0.5) * 2,
                        targetPosition.z + rad * Math.sin(ang)
                    );
                    shipMesh.lookAt(targetPosition);
                    if (shipMesh.userData.clickTarget) {
                        shipMesh.userData.clickTarget.position.copy(shipMesh.position);
                    }
                    
                    // LISÄÄ TÄMÄ: Pakota välitön taistelutarkistus
                    markStarForCombatCheck(shipData.targetStarId);
                    combatCheckTimer = 0.1; // Nollaa ajastin jotta seuraava tarkistus tapahtuu heti
                    
                    console.log(`[ORBIT-ARRIVAL] Ship arrived at star ${shipData.targetStarId}, marking for immediate combat check`);
                }
            }

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
    
    // MUUTOS: Isompi etäisyys ja paksumpi rengas
    const ringInnerRadius = starRadius + 8;  // Kauemmaksi tähdestä
    const ringOuterRadius = starRadius + 12; // Paksumpi rengas (4 yksikköä)
    
    const geometry = new THREE.RingGeometry(
        ringInnerRadius, 
        ringOuterRadius, 
        64, 
        1, 
        0, 
        0 // Hieman isompi alku näkyvyyden vuoksi
    );
    
    const material = new THREE.MeshBasicMaterial({
        color: color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,  // Hieman läpinäkyvämpi
        depthWrite: false,
        depthTest: false  // LISÄÄ: Renderöi aina päällimmäisenä
    });
    
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(starMesh.position);
    ring.renderOrder = 15;  // Korkea renderOrder
    
    // LISÄÄ: Ulompi "glow" rengas
    const glowGeometry = new THREE.RingGeometry(
        ringInnerRadius - 1,
        ringOuterRadius + 1,
        64,
        1,
        0,
        0.01
    );
    
    const glowMaterial = new THREE.MeshBasicMaterial({
        color: color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
    });
    
    const glowRing = new THREE.Mesh(glowGeometry, glowMaterial);
    glowRing.rotation.x = Math.PI / 2;
    glowRing.position.copy(starMesh.position);
    glowRing.renderOrder = 14;
    
    // Tallenna molemmat renkaat
    ring.userData.glowRing = glowRing;
    
    scene.add(glowRing);
    scene.add(ring);
    return ring;
}

/**
 * Siivoaa koko scenen vanhan pelin objekteista.
 * Poistaa meshit, vapauttaa geometriat & materiaalit ja tyhjentää tilataulukot.
 */
export function cleanupScene() {
    stopAnimateLoop(); // <<-- KUTSUTAAN UUTTA PYSÄYTYSFUNKTIOTA
    console.log('[CLEANUP] Siivotaan vanhan pelin 3D-objektit...');
    
    // ... (animStarted ja clock nollaus pysyy ennallaan) ...
    animStarted = false;
    if (clock) clock.stop();

    // Poista tähdet ja KAIKKI niihin liittyvät objektit
    starsById.forEach((starMesh) => {
        // Poista itse tähti
        scene.remove(starMesh);
        
        // -----------------------------------------------------------------------------
        //  Poista tähteen liitetyt apu­objektit (glow, renkaat, indikaattorit …)
        // -----------------------------------------------------------------------------
        if (starMesh.userData.glowSprite) {
            scene.remove(starMesh.userData.glowSprite);
            starMesh.userData.glowSprite.material.dispose();
        }

        /* Käytetään samaa apufunktiota renkaiden & spritejen listojen siivoamiseen */
        const disposeList = list => {
            list.forEach(obj => {
                scene.remove(obj);
                if (obj.geometry)  obj.geometry.dispose();
                if (obj.material)  obj.material.dispose();
            });
        };

        /* Tähden data löytyy kahdesta paikasta:  userData  JA  userData.starData  */
        const sd  = starMesh.userData;
        const sds = sd.starData ?? {};

        /* --------------------  Planetary Defense rings  -------------------- */
        disposeList(sds.defenseRings  ?? sd.defenseRings  ?? []);

        /* --------------------  Mine-indikaattorit  ------------------------- */
        disposeList(sds.mineIndicatorMeshes        ?? sd.mineIndicatorMeshes        ?? []);

        /* --------------------  Population-indikaattorit  ------------------- */
        disposeList(sds.populationIndicatorMeshes  ?? sd.populationIndicatorMeshes  ?? []);

        /* --------------------  Shipyard sprite + renkaat  ------------------ */
        if (sds.shipyardIndicatorSprite ?? sd.shipyardIndicatorSprite) {
            const spr = sds.shipyardIndicatorSprite ?? sd.shipyardIndicatorSprite;
            scene.remove(spr);
            spr.material.dispose();
        }
        disposeList(sds.shipyardRings ?? sd.shipyardRings ?? []);

        /* --------------------  Conquest-rengas  ---------------------------- */
        if (sd.conquestRing || sds.conquestRing) {
            const ring = sd.conquestRing || sds.conquestRing;
            
            // LISÄÄ: Poista glow ring ensin
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
        
        /* --------------------  Combat-effects  ---------------------------- */
        combatEffects.forEach(effect => effect.cleanup());
        combatEffects.clear();
        starsToCheck.clear();
        combatCheckTimer = 0;
        // Vapauta muisti
        starMesh.geometry.dispose();
        starMesh.material.dispose();
    });
    starsById.clear();

    // ... (laivojen ja muiden objektien siivous pysyy ennallaan) ...
    shipsById.forEach((shipMesh) => {
        scene.remove(shipMesh);
        if (shipMesh.userData.clickTarget) {
            scene.remove(shipMesh.userData.clickTarget);
        }
        shipMesh.geometry.dispose();
        shipMesh.material.dispose();
    });
    shipsById.clear();

    starConnections.forEach(line => scene.remove(line));
    starConnections.length = 0;
    starGlows.forEach(glow => {
        scene.remove(glow);
        if (glow.material) glow.material.dispose();
        if (glow.geometry) glow.geometry.dispose();
        });
    starGlows.length = 0;

    explosions.forEach(ex => scene.remove(ex.points));
    explosions.length = 0;
    
    // Varmistetaan, että myös TWEEN-animaatiot poistetaan
    if (window.TWEEN) {
        window.TWEEN.removeAll();
    }

    selectedStar = null;
    hoveredStar = null;
    selectedShips.length = 0;
    if (selectionIndicatorMesh) {
        selectionIndicatorMesh.visible = false;
    }

    const objectsToRemove = [];
    scene.traverse((child) => {
        // Kerää kaikki spritet
        if (child instanceof THREE.Sprite) {
            objectsToRemove.push(child);
        }
        // Kerää kaikki ring geometriat
        else if (child.geometry instanceof THREE.RingGeometry) {
            objectsToRemove.push(child);
        }
        // Kerää kaikki viivat (starlanes)
        else if (child instanceof THREE.Line) {
            objectsToRemove.push(child);
        }
    });

    // Poista kerätyt objektit
    objectsToRemove.forEach(obj => {
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (obj.material.map) obj.material.map.dispose();
            obj.material.dispose();
        }
    });

    // Siivoa myös nebulaSprites
    nebulaSprites.forEach(sprite => {
        scene.remove(sprite);
        if (sprite.material) sprite.material.dispose();
    });
    nebulaSprites.length = 0;

    console.log('[CLEANUP] 3D-maailma siivottu perusteellisesti.');
}

/* ========================================================================== */
/*  EXPORTS                                                                   */
/* ========================================================================== */

export {
    selectStar,
    deselectStar,
    focusOnStar,
    spawnExplosion,
    selectedStar,
    hoveredStar
};