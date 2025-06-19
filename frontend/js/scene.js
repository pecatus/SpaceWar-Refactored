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

function updateStarIndicators(starData, starMesh) {
    // This would add mine indicators, population indicators, etc.
    // Implementation similar to monoliith version
    if (starData.mines > 0) {
        // Add mine indicators
    }
    if (starData.population > 0) {
        // Add population indicators  
    }
    if (starData.shipyardLevel > 0) {
        // Add shipyard indicators
    }
}

export function applyDiff(diffArr = []) {
    console.log("Applying diff:", diffArr);
    
    diffArr.forEach(act => {
        switch (act.action) {
            case 'COMPLETE_PLANETARY': {
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;
                
                // Update visual indicators based on completion
                if (act.type === 'Mine') {
                    // Update mine indicators
                    console.log("Mine completed at star", act.starId);
                }
                break;
            }
            
            case 'SHIP_SPAWNED': {
                const parentStarMesh = starsById.get(act.starId);
                if (!parentStarMesh) break;
                
                // Käytä serverin antamaa ID:tä, ei luo omaa!
                const newShipData = {
                    _id: act.shipId,  // Käytä suoraan serverin ID:tä
                    type: act.type,
                    ownerId: act.ownerId,
                    parentStarId: act.starId,
                    state: 'orbiting'
                };
                
                spawnShips([newShipData]);
                break;
            }
            
            case 'SHIP_MOVING': {
                const shipMesh = shipsById.get(act.shipId);
                if (!shipMesh) break;
                
                // Päivitä ship data
                shipMesh.userData.shipData.state = 'moving';
                shipMesh.userData.shipData.targetStarId = act.toStarId;
                shipMesh.userData.shipData.parentStarId = act.fromStarId;
                
                console.log(`Ship ${act.shipId} moving from ${act.fromStarId} to ${act.toStarId}`);
                break;
            }
        }
    });
}

/* ========================================================================== */
/*  RENDER LOOP                                                               */
/* ========================================================================== */

let animStarted = false;
const clock = new THREE.Clock();

export function animate() {
    if (animStarted) return;
    animStarted = true;
    
    console.log("Starting animation loop");
    
    function loop() {
        requestAnimationFrame(loop);
        
        const delta = clock.getDelta();
        
        // Update explosions
        updateExplosions(delta);
        
        // Update orbitoivat alukset
        updateOrbitingShips(delta);
        
        // Update controls
        if (controls) controls.update();
        
        // Update bokeh focus
        updateBokehFocus();
        
        // Update selection indicator rotation
        if (selectionIndicatorMesh && selectionIndicatorMesh.visible) {
            selectionIndicatorMesh.rotation.y += 0.5 * delta;
        }
        
        // Update star visuals
        updateAllStarVisuals();
        
        // Billboard effect for nebulas
        nebulaSprites.forEach(sp => {
            sp.quaternion.copy(camera.quaternion);
        });
        
        // Render
        if (composer) {
            composer.render();
        } else {
            renderer.render(scene, camera);
        }
    }
    
    loop();
}

// Alusten orbitoinnin päivittäminen
function updateOrbitingShips(delta) {
    shipsById.forEach(shipMesh => {
        // shipData on tallennettu userData:n sisään spawnShips funktiossa
        const shipData = shipMesh.userData.shipData;
        
        // Tarkista että shipData on olemassa
        if (!shipData) {
            console.warn("Ship mesh without shipData:", shipMesh);
            return;
        }
        
        // Orbitointi vain jos alus on parentStarin ympärillä
        if (shipData.state === 'orbiting' && shipData.parentStarId) {
            const parentStar = starsById.get(shipData.parentStarId);
            if (!parentStar) return;
            
            // Päivitä orbitointi
            shipMesh.userData.orbitAngle += shipMesh.userData.orbitSpeed * delta;
            
            shipMesh.position.x = parentStar.position.x + 
                shipMesh.userData.orbitRadius * Math.cos(shipMesh.userData.orbitAngle);
            shipMesh.position.z = parentStar.position.z + 
                shipMesh.userData.orbitRadius * Math.sin(shipMesh.userData.orbitAngle);
            shipMesh.position.y = parentStar.position.y + 
                Math.sin(shipMesh.userData.orbitAngle * 0.5) * 2;
            
            // Katso parent staria
            shipMesh.lookAt(parentStar.position);
        }
        // LIIKKUVAT ALUKSET
        else if (shipData.state === 'moving' && shipData.targetStarId) {
            const targetStar = starsById.get(shipData.targetStarId);
            if (!targetStar) return;
            
            const targetPosition = targetStar.position;
            const direction = targetPosition.clone().sub(shipMesh.position).normalize();
            const distanceToTarget = shipMesh.position.distanceTo(targetPosition);
            
            // Määritä nopeus (monoliitista)
            const SHIP_SPEED_FAST = 60;
            const SHIP_SPEED_SLOW = 6;
            const speed = SHIP_SPEED_SLOW; // TODO: tarkista onko starlane
            
            const arrivalThreshold = 15; // Etäisyys jolla alus "saapuu"
            
            if (distanceToTarget > arrivalThreshold) {
                // Liiku kohti kohdetta
                shipMesh.position.add(direction.multiplyScalar(speed * delta));
                shipMesh.lookAt(targetPosition);
                
                // Päivitä click target sijainti
                if (shipMesh.userData.clickTarget) {
                    shipMesh.userData.clickTarget.position.copy(shipMesh.position);
                }
            } else {
                // Saavuttu perille - lähetä servulle tieto
                console.log(`Ship arrived at star ${shipData.targetStarId}`);
                
                // Päivitä paikallinen tila
                shipData.state = 'orbiting';
                shipData.parentStarId = shipData.targetStarId;
                shipData.targetStarId = null;
                
                // Alusta uusi orbitti
                shipMesh.userData.orbitAngle = Math.random() * Math.PI * 2;
                shipMesh.userData.orbitRadius = 15 + Math.random() * 6;
                
                // TODO: Lähetä servulle tieto saapumisesta
            }
        }
    });
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