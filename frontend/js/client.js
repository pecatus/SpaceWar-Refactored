// frontend/js/client.js - Täydellinen client-side logiikka
// =============================================================================
//  Hoitaa UI:n, Socket.IO:n ja kaiken client-side-logiikan
// =============================================================================

import { io } from "https://cdn.socket.io/4.7.5/socket.io.esm.min.js";
import {
    initThreeIfNeeded,
    buildFromSnapshot,
    applyDiff,
    startAnimateLoop,
    stopAnimateLoop,
    selectStar,
    deselectStar,
    cleanupScene,
    getSceneDebugInfo,
    getSelectedShips,
    selectShipsByIds, 
    focusOnGroup
} from './scene.js';


/* ========================================================================== */
/* AUDIO STATE & NODES                                                       */
/* ========================================================================== */
let audioContextStarted = false;
let masterVolume;
let ambientHum, ambientFilter, ambientPanner;
let synthButtonClick;             // <-- LISÄÄ TÄMÄ
let synthButtonHoverEffect;       // <-- LISÄÄ TÄMÄ
let lastButtonClickTime = 0;      // <-- LISÄÄ TÄMÄ
let lastButtonHoverTime = 0;      // <-- LISÄÄ TÄMÄ
const BUTTON_CLICK_COOLDOWN = 0.05; // <-- LISÄÄ TÄMÄ
const BUTTON_HOVER_COOLDOWN = 0.03; // <-- LISÄÄ TÄMÄ


/* ========================================================================== */
/*  CONSTANTS & CONFIGURATION                                                 */
/* ========================================================================== */

const BACKEND_URL = "http://localhost:3001";
const DEFAULT_AI_COLORS = [
    0xdc3545, // Red
    0x28a745, // Green  
    0xffc107, // Yellow
    0x6f42c1  // Purple
];

// Ship costs (should match backend)
const SHIP_COST = {
    Fighter: [50, 25, 10, 1],
    Destroyer: [100, 50, 25, 2],
    Cruiser: [150, 75, 45, 3],
    'Slipstream Frigate': [120, 180, 55, 4]
};

const UPKEEP_GALACTIC_HUB = 15;

// Infrastructure limits (should match backend)
const INFRA_LIMITS = {
    1: { maxPop: 5,  maxMines: 5,  maxDefense: 1, maxShipyard: 1 },
    2: { maxPop: 10, maxMines: 10, maxDefense: 2, maxShipyard: 2 },
    3: { maxPop: 15, maxMines: 15, maxDefense: 4, maxShipyard: 3 },
    4: { maxPop: 20, maxMines: 20, maxDefense: 6, maxShipyard: 4 },
    5: { maxPop: 25, maxMines: 25, maxDefense: 8, maxShipyard: 4 }
};

/* ========================================================================== */
/*  GLOBAL STATE                                                              */
/* ========================================================================== */

let gameState = null;
let controlGroups = {}; // <-- TÄMÄ
let lastGroupKey = null; // <-- TÄMÄ
let lastGroupKeyTime = 0; // <-- TÄMÄ
const DOUBLE_PRESS_THRESHOLD = 350; // ms
let myPlayerId = null;
let playerResources = { credits: 1000, minerals: 500 };
let gameInProgress = false;
let currentGameId = null;
let selectedStar = null;
let GAME_SPEED = 1;
window.GAME_SPEED = GAME_SPEED;
let isPaused = false;
window.isPaused = false;

// UI State
let uiState = 'startScreen'; // 'startScreen', 'playing', 'paused'

/* ========================================================================== */
/*  DOM ELEMENTS                                                              */
/* ========================================================================== */

// Start screen elements
const startScreen = document.getElementById('startScreen');
const startGameButton = document.getElementById('startGameButton');
const resumeGameButton = document.getElementById('resumeGameButton');
const starCountSelect = document.getElementById('starCount');
const numAiPlayersSelect = document.getElementById('numAiPlayers');
const aiPlayerSettingsContainer = document.getElementById('aiPlayerSettingsContainer');

// Game UI elements
const uiContainer = document.getElementById('uiContainer');
const resourcePanel = document.getElementById('resourcePanel');
const creditsDisplay = document.getElementById('creditsDisplay');
const mineralsDisplay = document.getElementById('mineralsDisplay');

// Planet menu elements
const planetMenu = document.getElementById('planetMenu');
const planetMenuTitle = document.getElementById('planetMenuTitle');
const planetOwnerDisplay = document.getElementById('planetOwner');
const planetInfraLevelDisplay = document.getElementById('planetInfraLevel');
const planetDefenseDisplay = document.getElementById('planetDefense');
const planetPopulationDisplay = document.getElementById('planetPopulation');
const planetMinesDisplay = document.getElementById('planetMines');
const planetShipyardLevelDisplay = document.getElementById('planetShipyardLevel');

// Construction buttons
const upgradeInfrastructureButton = document.getElementById('upgradeInfrastructureButton');
const buildShipyardButton = document.getElementById('buildShipyardButton');
const upgradeShipyardButton = document.getElementById('upgradeShipyardButton');
const buildMineButton = document.getElementById('buildMineButton');
const buildDefenseButton = document.getElementById('buildDefenseButton');
const buildFighterButton = document.getElementById('buildFighterButton');
const buildDestroyerButton = document.getElementById('buildDestroyerButton');
const buildCruiserButton = document.getElementById('buildCruiserButton');
const buildSlipstreamFrigateButton = document.getElementById('buildSlipstreamFrigateButton');
const buildGalacticHubButton = document.getElementById('buildGalacticHubButton'); 


// Progress displays
const planetaryQueueInfo = document.getElementById('planetaryQueueInfo');
const shipQueueInfo = document.getElementById('shipQueueInfo');
const planetaryQueueTotalProgressFill = document.getElementById('planetaryQueueTotalProgressFill');
const planetaryQueueTotalProgressText = document.getElementById('planetaryQueueTotalProgressText');
const shipQueueTotalProgressFill = document.getElementById('shipQueueTotalProgressFill');
const shipQueueTotalProgressText = document.getElementById('shipQueueTotalProgressText');

// Progress interpolation
let constructionProgressData = new Map(); // starId -> {planetary, ship, lastUpdate}
let progressInterpolationInterval = null;

/* ========================================================================== */
/*  SOCKET.IO CONNECTION                                                      */
/* ========================================================================== */

const socket = io(BACKEND_URL, {
    transports: ["websocket", "polling"],
    withCredentials: true
});

socket.on("connect", () => {
    console.log("✅ Socket connected", socket.id);
});

socket.on("disconnect", () => {
    console.log("❌ Disconnected from server");
    // Näytä UI että yhteys katkesi
    if (gameInProgress) {
        alert("Connection lost! The game has been paused. Refresh to reconnect.");
    }
});

socket.on("reconnect", () => {
    console.log("🔄 Reconnected to server");
    if (currentGameId) {
        socket.emit("join_game", { gameId: currentGameId });
    }
});

socket.on("connect_error", (error) => {
    console.error("❌ Socket connection error:", error);
});

// Receive initial game state
socket.on('initial_state', (snap) => {
    console.log("📥 Received initial_state:", snap);
    handleInitialState(snap);
});

// Receive game updates
socket.on("game_diff", (diff) => {
    //console.log("📦 Received diff:", diff);
    
    // Debug SHIP_MOVING erikseen
    diff.forEach(action => {
        if (action.action === 'SHIP_MOVING') {
            //console.log("🚢 SHIP_MOVING received:", action);
        }
    });
    
    applyDiff(diff);
    updateUIFromDiff(diff);
});

socket.on("joined", (response) => {
    if (response.success) {
        console.log("✅ Successfully joined game");
    } else {
        console.error("❌ Failed to join game:", response.error);
        alert("Failed to join game: " + response.error);
        showStartScreen();
    }
});

/* ========================================================================== */
/*  INITIALIZATION                                                            */
/* ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 Client initializing...");
    
    initializeUI();
    setupEventListeners();
    setupAIPlayerSettings();
    
    console.log("✅ Client initialized");
});

function initializeUI() {
    // Initialize Three.js but don't start the game yet
    initThreeIfNeeded();
    
    // Set initial UI state
    showStartScreen();
    
    // Sync ship button costs
    syncShipButtons();
    
    // Setup tooltips
    setupTooltips();
}

function setupEventListeners() {
    // Start game button
    startGameButton.addEventListener('click', () => {
        
        handleStartGame();
    });
    resumeGameButton.addEventListener('click', () => {
        
        handleResumeGame();
    });

    // Varmista että socket katkaistaan kun sivu suljetaan
    window.addEventListener('beforeunload', () => {
    if (window.socket && window.socket.connected) {
        console.log('Page closing - disconnecting socket');
        window.socket.disconnect();
    }
    });

    // Varmista että socket katkaistaan kun pelaaja poistuu sivulta
    window.addEventListener('unload', () => {
    if (window.socket && window.socket.connected) {
        window.socket.disconnect();
    }
    });
    
    // AI settings
    numAiPlayersSelect.addEventListener('change', setupAIPlayerSettings);
    
    // Construction buttons
    upgradeInfrastructureButton.addEventListener('click', () => {playButtonClickSound(); handleUpgradeInfrastructure()});
    buildShipyardButton.addEventListener('click', () => {playButtonClickSound();handleBuildShipyard()});
    upgradeShipyardButton.addEventListener('click', () => {playButtonClickSound();handleUpgradeShipyard()});
    buildMineButton.addEventListener('click', () => {playButtonClickSound();handleBuildMine()});
    buildDefenseButton.addEventListener('click', () => {playButtonClickSound();handleBuildDefense()});
    buildFighterButton.addEventListener('click', (e) => {playButtonClickSound();handleBuildShip(e.target.dataset.type)});
    buildDestroyerButton.addEventListener('click', (e) => {playButtonClickSound();handleBuildShip(e.target.dataset.type)});
    buildCruiserButton.addEventListener('click', (e) => {playButtonClickSound();handleBuildShip(e.target.dataset.type)});
    buildSlipstreamFrigateButton.addEventListener('click', (e) => {playButtonClickSound();handleBuildShip(e.target.dataset.type)});
    buildGalacticHubButton.addEventListener('click', () => {playButtonClickSound();handleBuildGalacticHub()}); // <-- LISÄÄ TÄMÄ

    
    // Star selection events from scene
    window.addEventListener('starSelected', (event) => {
        playButtonClickSound();
        handleStarSelection(event.detail);
    });
    
    window.addEventListener('starDeselected', () => {
        hidePlanetMenu();
    });
    
    // Ship selection events
    window.addEventListener('shipsSelected', (event) => {
        const selectedUnitsPanel = document.getElementById('selectedUnitsPanel');
        if (selectedUnitsPanel) {
            selectedUnitsPanel.textContent = `Selected Units: ${event.detail.count}`;
            selectedUnitsPanel.style.display = event.detail.count > 0 ? 'block' : 'none';
        }
    });
    
    // Ship command events
    window.addEventListener('shipCommand', (event) => {
        const command = {
            ...event.detail,
            gameId: currentGameId  
    };
        socket.emit('player_command', command);
    });

    // Ship arrival events
    window.addEventListener('shipArrived', (event) => {
        const command = {
            ...event.detail,
            gameId: currentGameId  // LISÄÄ TÄMÄ!
    };
        socket.emit('player_command', command);
    });

// Keyboard events
document.addEventListener('keydown', (event) => {
    // --- UUSI ESC-NÄPPÄIMEN LOGIIKKA ---
    if (event.key === 'Escape') {
        // Jos olemme pelitilassa, siirry paussivalikkoon (eli päävalikkoon)
        if (uiState === 'playing') {
            pauseGame();        // Kerro serverille, että peli on paussilla
            window.isPaused = true;
            uiState = 'paused'; // Muuta clientin tilaa
            updateUIState();    // Päivitä UI näyttämään päävalikko
        }
        // Jos olemme jo valikossa (pausella), palataan peliin
        else if (uiState === 'paused') {
            handleResumeGame(); // Tämä funktio hoitaa jo kaiken tarvittavan
        }
    }
    
    
    // --- F4 DEBUG KÄSITTELY ---
    else if (event.key === 'F4') {
        event.preventDefault();
        
        // Tarkista että debug-funktio on saatavilla
        if (window.getSceneDebugInfo) {
            const debug = window.getSceneDebugInfo();
            const shipDetails = debug.shipsByStarDetails();
            
            console.log('=== SHIP TRACKING DEBUG ===');
            console.log(`Total ships: ${debug.totalShips}`);
            console.log(`Tracked ships: ${debug.trackedShips}`);
            console.log(`Untracked ships: ${debug.untrackedShips}`);
            console.log(`Tracking accuracy: ${debug.trackingAccuracy}%`);
            console.log('');
            console.log(`Stars with ships: ${debug.starsWithShips}`);
            console.log(`Combat effects active: ${debug.combatEffects}`);
            console.log(`Explosions active: ${debug.explosions}`);
            console.log(`Stars to check: ${debug.starsToCheck}`);
            console.log('');
            
            // Performance issues
            if (debug.performanceIssues) {
                const issues = debug.performanceIssues;
                if (issues.tooManyCombatEffects || issues.tooManyStarsToCheck || issues.poorTrackingAccuracy) {
                    console.log('⚠️  PERFORMANCE ISSUES DETECTED:');
                    if (issues.tooManyCombatEffects) {
                        console.log(`   - Too many combat effects (${debug.combatEffects} > 10)`);
                    }
                    if (issues.tooManyStarsToCheck) {
                        console.log(`   - Too many stars being checked (${debug.starsToCheck} > 30)`);
                    }
                    if (issues.poorTrackingAccuracy) {
                        console.log(`   - Poor tracking accuracy (${debug.trackingAccuracy}% < 95%)`);
                    }
                    console.log('');
                }
            }
            
            //console.log('Ships by star (top 10):');
            shipDetails.details.slice(0, 10).forEach(star => {
                console.log(`  ${star.starName}: ${star.shipCount} ships`);
            });
            
            if (shipDetails.details.length > 10) {
                console.log(`  ... and ${shipDetails.details.length - 10} more stars`);
            }
            
            console.log('========================');
            
            // Jos on ongelmia, ehdota korjausta
            if (debug.untrackedShips > 0 || debug.starsToCheck > 30) {
                console.log('💡 TIP: Press F5 to run cleanup');
            }
        } else {
            console.warn('Scene debug info not available yet');
        }
    }

    // Lisää F5 näppäin manuaaliseen siivoukseen:
    else if (event.key === 'F5') {
        event.preventDefault();
        console.log('🧹 Running manual cleanup...');
        
        if (window.performMemoryCleanup) {
            window.performMemoryCleanup();
        }
        
        if (window.cleanupCombatChecks) {
            window.cleanupCombatChecks();
        }
        
        console.log('✅ Cleanup complete!');
    }
    
    // --- F3 PERFORMANCE MONITOR ---
    else if (event.key === 'F3') {
        event.preventDefault();
        const monitor = document.getElementById('performanceMonitor');
        if (monitor) {
            monitor.style.display = monitor.style.display === 'none' ? 'block' : 'none';
        } else {
            console.warn('Performance monitor element not found - add it to your HTML');
        }
    }

    // --- UUSI VÄLILYÖNNIN LOGIIKKA ---
    // Tauottaa pelin, mutta pitää pelinäkymän esillä
    else if (event.code === 'Space') {
        // Toimii vain, jos olemme aktiivisessa pelinäkymässä
        if (uiState === 'playing') {
            event.preventDefault(); // Estää sivun vierittymisen (tärkeää!)
            
            // Vaihda paussitilan ja normaalitilan välillä
            if (isPaused) {
                resumeGame();
                window.isPaused = false; 
            } else {
                pauseGame();
                window.isPaused = true; 
            }
        }
    }

    // Käsittele sitten vain pelitilassa toimivat numeronäppäimet
    const numKey = parseInt(event.key);
    if (!isNaN(numKey) && numKey >= 0 && numKey <= 9) {
        event.preventDefault();

        // CTRL + [0-9] = Luo/aseta ryhmä
        if (event.ctrlKey || event.metaKey) {
            const currentSelection = getSelectedShips();
            const selectedShipIds = currentSelection.map(ship => ship.userData.shipData._id);
            controlGroups[numKey] = selectedShipIds;
            updateGroupsPanel(); // Päivitä UI-napit
            return;
        }

        // Pelkkä [0-9] = Valitse / Tarkenna ryhmään
        const now = performance.now();
        const shipIds = controlGroups[numKey];

        if (shipIds && shipIds.length > 0) {
            if (lastGroupKey === numKey && now - lastGroupKeyTime < DOUBLE_PRESS_THRESHOLD) {
                // TUPLAKLIKKAUS -> Valitse ja Tarkenna
                focusOnGroup(shipIds);
            } else {
                // YKSITTÄINEN KLIKKAUS -> Valitse
                selectShipsByIds(shipIds);
            }
        }
        lastGroupKey = numKey;
        lastGroupKeyTime = now;
    }
});

    document.querySelectorAll('#speedPanel button').forEach(btn => {
        btn.addEventListener('click', () => {
            
            const val = btn.dataset.speed;
            
            // Poista active kaikilta
            document.querySelectorAll('#speedPanel button').forEach(b => b.classList.remove('active'));
            
            if (val === 'pause') {
                if (isPaused) {
                    resumeGame();
                    // Palauta edellinen nopeus aktiiviseksi
                    document.querySelector(`#speedPanel button[data-speed="${GAME_SPEED}"]`)?.classList.add('active');
                } else {
                    pauseGame();
                    btn.classList.add('active');
                }
            } else {
                GAME_SPEED = Number(val);
                window.GAME_SPEED = GAME_SPEED;
                btn.classList.add('active');
                
                if (isPaused) {
                    resumeGame();
                }
                
                // Lähetä nopeus serverille
                if (currentGameId) {
                    socket.emit('set_game_speed', { 
                        gameId: currentGameId, 
                        speed: GAME_SPEED 
                    });
                }
            }
        });
        // Button hover sounds (simplified)
        document.querySelectorAll('button').forEach(button => {
            button.addEventListener('mouseenter', async () => {
                await initAudio(); // Yritä alustaa äänet HETI kun hiiri menee napin päälle
                playButtonHoverSound(); // Soita ääni
            });
        });
    });
}

/* ========================================================================== */
/* AUDIO FUNCTIONS                                                           */
/* ========================================================================== */
// --- AUDIO FUNCTIONS ---
function initializeAudioNodes() { 
    if (!audioContextStarted) return; 
    console.log("Initializing Tone.js audio nodes...");

    masterVolume = new Tone.Volume(-10).toDestination(); 

    synthButtonClick = new Tone.NoiseSynth({
        noise: { type: 'white' },
        volume: -15, 
        envelope: { attack: 0.001, decay: 0.015, sustain: 0, release: 0.05 } 
    }).connect(masterVolume);

    synthButtonHoverEffect = new Tone.NoiseSynth({
        noise: { type: 'pink' }, 
        volume: -20, 
        envelope: { attack: 0.001, decay: 0.005, sustain: 0, release: 0.03 }
    }).connect(masterVolume);


    ambientPanner = new Tone.Panner(0).connect(masterVolume);
    ambientFilter = new Tone.AutoFilter({
        frequency: "8m", 
        type: "sine", depth: 0.7, baseFrequency: 60, octaves: 3,
        filter: { type: "lowpass", rolloff: -12, Q: 1 }
    }).connect(ambientPanner).start();

    ambientHum = new Tone.FatOscillator({
        frequency: 50, type: "sawtooth", detune: 0.6, spread: 15, volume: -10, 
    }).connect(ambientFilter);
    
    console.log("Tone.js audio nodes initialized.");
}

async function initAudio() { 
    if (audioContextStarted) return true;
    try {
        await Tone.start();
        audioContextStarted = true;
        console.log("AudioContext started by user interaction!");
        initializeAudioNodes();
        if (ambientHum && ambientHum.state !== "started") {
            ambientHum.start();
            console.log("AUDIO: Ambient hum started.");
        }
        return true;
    } catch (e) {
        console.error("Failed to start AudioContext:", e);
        return false;
    }
}

function playButtonClickSound() { 
    if (!audioContextStarted || !synthButtonClick) return;
    const now = Tone.now();
    if (now - lastButtonClickTime < BUTTON_CLICK_COOLDOWN) return;
    try {
        synthButtonClick.triggerAttackRelease("64n", now); 
        lastButtonClickTime = now;
    } catch (e) {
        console.error("Audio error playing button click sound:", e);
    }
}

function playButtonHoverSound() { 
    if (!audioContextStarted || !synthButtonHoverEffect) return;
    const now = Tone.now();
    if (now - lastButtonHoverTime < BUTTON_HOVER_COOLDOWN) return;
    try {
        synthButtonHoverEffect.triggerAttackRelease("128n", now); 
        lastButtonHoverTime = now;
    } catch (e) {
        console.error("Audio error playing button hover sound:", e);
    }
}
// --- END AUDIO FUNCTIONS ---


function setupTooltips() {
    const tooltipElement = document.getElementById('custom-tooltip');
    if (!tooltipElement) return;
    
    document.querySelectorAll('#planetMenu button').forEach(btn => {
        btn.addEventListener('mouseenter', (e) => {
            const tooltipText = btn.dataset.tooltipText;
            if (tooltipText) {
                tooltipElement.innerHTML = tooltipText;
                const rect = btn.getBoundingClientRect();
                tooltipElement.style.left = `${rect.left}px`;
                tooltipElement.style.top = `${rect.bottom + 5}px`;
                tooltipElement.style.display = 'block';
                tooltipElement.classList.add('visible');
            }
        });
        
        btn.addEventListener('mouseleave', () => {
            tooltipElement.classList.remove('visible');
        });
    });
}

function updateGroupsPanel() {
    const groupsButtonsContainer = document.getElementById('groupsButtonsContainer');
    const groupsPanel = document.getElementById('groupsPanel');
    if (!groupsButtonsContainer || !groupsPanel) return;

    groupsButtonsContainer.innerHTML = '';
    let hasVisibleGroups = false;

    if (!gameState || !gameState.ships) {
        groupsPanel.style.display = 'none';
        return;
    }
    
    const liveShipIds = new Set(gameState.ships.map(s => s._id.toString()));

    Object.keys(controlGroups).sort((a, b) => a - b).forEach(key => {
        controlGroups[key] = controlGroups[key].filter(id => liveShipIds.has(id));
        
        const liveShipsInGroup = controlGroups[key];
        if (liveShipsInGroup.length === 0) {
            delete controlGroups[key];
            return;
        }

        hasVisibleGroups = true;
        const counts = { Fighter: 0, Destroyer: 0, Cruiser: 0, 'Slipstream Frigate': 0 };
        
        liveShipsInGroup.forEach(shipId => {
            const shipData = gameState.ships.find(s => s._id.toString() === shipId);
            if (shipData && counts.hasOwnProperty(shipData.type)) {
                counts[shipData.type]++;
            }
        });

        const btn = document.createElement('button');
        btn.className = 'group-btn';
        btn.dataset.groupId = key;
        btn.innerHTML = `
            <div class="font-semibold text-sm">Group ${key}</div>
            <div class="text-xs">F:${counts.Fighter}, D:${counts.Destroyer}, C:${counts.Cruiser}</div>
            <div class="text-xs font-bold">Total: ${liveShipsInGroup.length}</div>
        `;

        btn.addEventListener('click', () => {
            const shipIds = controlGroups[key];
            if (shipIds && shipIds.length > 0) {
                focusOnGroup(shipIds); // Klikkaus tekee sekä valinnan että tarkennuksen
            }
        });
        groupsButtonsContainer.appendChild(btn);
    });

    groupsPanel.style.display = hasVisibleGroups ? 'flex' : 'none';
}

/* ========================================================================== */
/*  AI PLAYER SETTINGS                                                        */
/* ========================================================================== */

function setupAIPlayerSettings() {
    const numPlayers = parseInt(numAiPlayersSelect.value);
    aiPlayerSettingsContainer.innerHTML = '';
    
    for (let i = 0; i < numPlayers; i++) {
        const configDiv = document.createElement('div');
        configDiv.className = 'ai-player-config';
        configDiv.innerHTML = `
            <label>AI Player ${i + 1} Color:</label>
            <input type="color" class="ai-color-picker" data-ai-index="${i}" 
                   value="#${DEFAULT_AI_COLORS[i].toString(16).padStart(6, '0')}">
        `;
        aiPlayerSettingsContainer.appendChild(configDiv);
    }
}

/* ========================================================================== */
/*  GAME LIFECYCLE                                                            */
/* ========================================================================== */
function resetAllProgressBars() {
    // Nollaa kaikki planetary progress barit
    document.querySelectorAll('.button-progress-bar').forEach(bar => {
        bar.style.width = '0%';
    });
    
    // Nollaa ship progress barit
    ['Fighter', 'Destroyer', 'Cruiser', 'SlipstreamFrigate'].forEach(type => {
        const bar = document.getElementById(`progress-${type.replace(/ /g, '')}`);
        if (bar) bar.style.width = '0%';
    });
    
    // Nollaa total progress barit
    if (planetaryQueueTotalProgressFill) {
        planetaryQueueTotalProgressFill.style.width = '0%';
        planetaryQueueTotalProgressText.textContent = 'Idle';
    }
    
    if (shipQueueTotalProgressFill) {
        shipQueueTotalProgressFill.style.width = '0%';
        shipQueueTotalProgressText.textContent = 'Idle';
    }
}

function resetClientState() {
    console.log('[RESET] Nollataan clientin pelitila...');

    isPaused = false;
    window.isPaused = false;
    GAME_SPEED = 1;
    window.GAME_SPEED = 1;

    // Pysäytetään vanha interpolointiajastin
    if (progressInterpolationInterval) {
        clearInterval(progressInterpolationInterval);
        progressInterpolationInterval = null;
    }

    // 1. Kutsu scenen siivousfunktiota
    cleanupScene();

    // 2. Nollaa clientin looginen tila
    gameState = null;
    gameInProgress = false;
    currentGameId = null;
    myPlayerId = null;
    selectedStar = null;
    playerResources = { credits: 1000, minerals: 500 }; // Palauta alkuarvoihin

    // Tyhjennetään planetary menun construction progressbarit
    constructionProgressData.clear();
    resetAllProgressBars();  // Nollaa visuaaliset progress barit

    // 3. Piilota UI-elementit
    hidePlanetMenu();
    const selectedUnitsPanel = document.getElementById('selectedUnitsPanel');
    if (selectedUnitsPanel) selectedUnitsPanel.style.display = 'none';

    console.log('[RESET] Clientin tila nollattu.');
}

async function handleStartGame() {
    try {
        await initAudio();
        playButtonClickSound();
        // Varmista että peli ei ala pausella
        isPaused = false;
        window.isPaused = false;
        GAME_SPEED = 1;
        window.GAME_SPEED = 1;
        updatePauseUI(); // Päivitä pause UI pois
        
        // Reset speed buttons
        document.querySelectorAll('#speedPanel button').forEach(btn => btn.classList.remove('active'));
        document.querySelector('#speedPanel button[data-speed="1"]')?.classList.add('active');

        // 1. Siivoa aina vanha clientin tila pois.
        resetClientState();

        startGameButton.disabled = true;
        startGameButton.querySelector('span').textContent = 'Starting...';
        
        // 2. Kerää pelin asetukset (kuten ennenkin).
        const numAIPlayers = parseInt(numAiPlayersSelect.value);
        const colorPickers = document.querySelectorAll('.ai-color-picker');
        const aiColors = [];
        for (let i = 0; i < numAIPlayers; i++) {
            const colorHex = colorPickers[i] ? colorPickers[i].value : `#${DEFAULT_AI_COLORS[i].toString(16).padStart(6, '0')}`;
            aiColors.push(colorHex);
        }
        const gameConfig = {
            humanName: "Player",
            humanColor: "#68c5ff",
            numAiPlayers: numAIPlayers,
            aiColors: aiColors,
            starCount: parseInt(starCountSelect.value),
            lobbyHost: "client",
            speed: 1
        };
        
        // 3. Luo uusi peli JA SAA KOKO ALKUTILA SUORAAN HTTP-VASTAUKSENA.
        const result = await createNewGame(gameConfig);
        
        if (!result.success || !result.initialState) {
            throw new Error(result.message || "Failed to create game or receive initial state");
        }
        
        // 4. Käsittele saatu alkutila VÄLITTÖMÄSTI.
        // Tämä rakentaa 3D-maailman ja alustaa clientin datan.
        handleInitialState(result.initialState);
        
        // 5. VASTA NYT, kun client on valmis, liity socket-huoneeseen ja
        // kerro serverille, että se voi käynnistää pelin.
        socket.emit("join_game", { gameId: result.initialState.gameId });
        
    } catch (error) {
        console.error("❌ Failed to start game:", error);
        alert("Failed to start game: " + error.message);
        // Varmistetaan, että nappeja voi taas käyttää, jos käynnistys epäonnistui
        startGameButton.disabled = false;
        startGameButton.querySelector('span').textContent = 'Start Game';
    }
}

async function createNewGame(payload) {
    const response = await fetch(`${BACKEND_URL}/api/games/new`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
    }
    
    return response.json();
}

function handleInitialState(snap) {
    console.log("🎯 Handling initial state:", snap);
    currentGameId = snap.gameId;
    gameState = snap;
    gameInProgress = true;
    
    // Set the player ID
    myPlayerId = snap.humanPlayerId;
    console.log("👤 Player ID set to:", myPlayerId);
    
    // Update resources if provided
    if (snap.resources && myPlayerId) {
        playerResources = snap.resources[myPlayerId] || playerResources;
        console.log("💰 Player resources:", playerResources);
    }
    
    // Store player data for color mapping
    window.gameData = {
        players: snap.players || [],
        humanPlayerId: myPlayerId
    };
    
    // Build the game world
    buildFromSnapshot(snap);
    
    // Start the animation loop
    startAnimateLoop();
    
    // Switch to game UI
    showGameUI();
    
    console.log("✅ Game state loaded and UI updated");
}

function handleResumeGame() {
    playButtonClickSound();
    if (gameInProgress) {
        uiState = 'playing';
        updateUIState();
    }
}

function pauseGame() {
    if (currentGameId) {
        socket.emit('pause_game', { gameId: currentGameId });
        isPaused = true;
        window.isPaused = true;
        updatePauseUI();
    }
}

function updatePauseUI() {
    // 1. Lisää/poista yleinen 'paused'-luokka body-elementistä (sinun hyvä ideasi)
    if (isPaused) {
        document.body.classList.add('paused');
    } else {
        document.body.classList.remove('paused');
    }

    // 2. Päivitä nopeuspaneelin nappien korostus (ehdotukseni)
    document.querySelectorAll('#speedPanel button').forEach(btn => btn.classList.remove('active'));
    if (isPaused) {
        // Korosta pause-nappi
        document.querySelector('#speedPanel button[data-speed="pause"]')?.classList.add('active');
    } else {
        // Korosta nykyinen pelinopeusnappi
        document.querySelector(`#speedPanel button[data-speed="${GAME_SPEED}"]`)?.classList.add('active');
    }
    
    // 3. Näytä tai piilota suuri "PAUSED"-teksti (molemmissa sama)
    let pauseIndicator = document.getElementById('pauseIndicator');
    if (!pauseIndicator) {
        pauseIndicator = document.createElement('div');
        pauseIndicator.id = 'pauseIndicator';
        pauseIndicator.textContent = 'PAUSED';
        pauseIndicator.style.cssText = `
            position: fixed;
            top: 20px; /* MUUTOS: Siirretään 20px yläreunasta */
            left: 50%;
            transform: translateX(-50%); /* MUUTOS: Keskitetään vain sivusuunnassa */
            font-size: 64px; /* PIENENNYS: Pienennetään hieman fonttia */
            font-weight: bold;
            color: rgba(255, 255, 255, 0.6);
            pointer-events: none;
            z-index: 100;
            display: none;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
        `;
        document.body.appendChild(pauseIndicator);
    }
    
    pauseIndicator.style.display = isPaused ? 'block' : 'none';
}

function resumeGame() {
    if (currentGameId) {
        socket.emit('resume_game', { gameId: currentGameId });
        isPaused = false;
        window.isPaused = false;
        updatePauseUI();
    }
}

function showStartScreen() {
    uiState = 'startScreen';
    updateUIState();
    // Jos peli on käynnissä, pauseta se
    if (gameInProgress && currentGameId) {
        socket.emit('pause_game', { gameId: currentGameId });
    }
}

function showGameUI() {
    uiState = 'playing';
    updateUIState();
    startProgressInterpolation(); 
}

function updateUIState() {
    switch (uiState) {
        case 'startScreen':
        case 'paused':
            startScreen.style.display = 'flex';
            uiContainer.style.display = 'none';
            
            // Varmistetaan, että "Start/New Game" -nappi on AINA käytettävissä,
            // kun tämä valikko on näkyvissä.
            startGameButton.disabled = false;

            if (gameInProgress && uiState === 'paused') {
                startGameButton.querySelector('span').textContent = 'Start New Game';
                resumeGameButton.style.display = 'block';
            } else {
                startGameButton.querySelector('span').textContent = 'Start Game';
                resumeGameButton.style.display = 'none';
            }
            break;
            
        case 'playing':
            startScreen.style.display = 'none';
            uiContainer.style.display = 'flex';
            break;
    }
}

/* ========================================================================== */
/*  STAR SELECTION & PLANET MENU                                             */
/* ========================================================================== */

function handleStarSelection(starData) {
    //console.log("🌟 Star selected:", starData);
    
    if (!starData) {
        selectedStar = null;
        hidePlanetMenu();
        resetAllProgressBars();
        return;
    }

    resetAllProgressBars();
    selectedStar = starData; // Store the selected star globally
    showPlanetMenu(starData);
}

function showPlanetMenu(starData) {
    // Update basic info
    planetMenuTitle.textContent = `Star ${starData.name}${starData.isHomeworld ? ' (Homeworld)' : ''}`;
    planetOwnerDisplay.textContent = `Owner: ${getOwnerName(starData.ownerId)}`;
    planetInfraLevelDisplay.textContent = `Infrastructure Level: ${starData.infrastructureLevel}`;
    planetDefenseDisplay.textContent = `Defense: ${starData.defenseLevel}`;
    planetPopulationDisplay.textContent = `Population: ${starData.population}`;
    planetMinesDisplay.textContent = `Mines: ${starData.mines}`;
    planetShipyardLevelDisplay.textContent = `Shipyard Level: ${starData.shipyardLevel}`;
    
    // Update queues
    updateQueueDisplays(starData);

    // conquest UI päivitys (planeetan ympärille tuleva rinkula)
    updateConquestProgressUI(starData);
    
    // Show/hide buttons based on ownership
    if (isPlayerOwned(starData)) {
        showPlayerButtons(starData);
    } else {
        hidePlayerButtons();
    }
    
    // Show the menu
    planetMenu.style.display = 'block';
}

function hidePlanetMenu() {
    planetMenu.style.display = 'none';

    // Piilota myös conquest UI
    const conquestProgressContainer = document.getElementById('conquestProgressContainer');
    const conqueringStatusText = document.getElementById('conqueringStatusText');
    
    if (conquestProgressContainer) {
        conquestProgressContainer.style.display = 'none';
    }
    if (conqueringStatusText) {
        conqueringStatusText.style.display = 'none';
    }
}

function isPlayerOwned(starData) {
    if (!starData.ownerId || !myPlayerId) return false;
    
    // Convert both to strings for comparison
    const ownerIdStr = typeof starData.ownerId === 'object' ? starData.ownerId.toString() : starData.ownerId;
    const myIdStr = typeof myPlayerId === 'object' ? myPlayerId.toString() : myPlayerId;
    
    return ownerIdStr === myIdStr;
}

function getOwnerName(ownerId) {
    if (!ownerId) return 'Neutral';
    if (ownerId === myPlayerId) return 'Player';
    
    // Look up player name from game data
    const gameData = window.gameData;
    if (gameData && gameData.players) {
        const ownerPlayer = gameData.players.find(p => p._id === ownerId);
        if (ownerPlayer) {
            return ownerPlayer.name;
        }
    }
    
    return `Unknown (${ownerId})`;
}

function showPlayerButtons(starData) {
    // Näytä/piilota perusnapit (nämä säännöt pysyvät ennallaan)
    const hasShipyard = starData.shipyardLevel > 0;
    buildShipyardButton.style.display = !hasShipyard ? 'block' : 'none';
    upgradeShipyardButton.style.display = hasShipyard ? 'block' : 'none';
    
    // Infrastructure aina näkyvissä kunnes max
    upgradeInfrastructureButton.style.display = starData.infrastructureLevel < 5 ? 'block' : 'none';
    
    // Mine ja Defense aina näkyvissä
    buildMineButton.style.display = 'block';
    buildDefenseButton.style.display = 'block';
    
    // Ship buttons (näkyvyys riippuu shipyard-tasosta)
    const shipButtons = [
        { button: buildFighterButton, requiredLevel: 1 },
        { button: buildDestroyerButton, requiredLevel: 2 },
        { button: buildCruiserButton, requiredLevel: 3 },
        { button: buildSlipstreamFrigateButton, requiredLevel: 4 }
    ];
    
    shipButtons.forEach(({ button, requiredLevel }) => {
        if (button) {
            button.style.display = starData.shipyardLevel >= requiredLevel ? 'block' : 'none';
        }
    });
    
    // Päivitä nappien tilat (resurssit + rajat)
    updateButtonStates(starData);
}

function hidePlayerButtons() {
    [upgradeInfrastructureButton, buildShipyardButton, upgradeShipyardButton,
     buildMineButton, buildDefenseButton, buildFighterButton, buildDestroyerButton,
     buildCruiserButton, buildSlipstreamFrigateButton].forEach(button => {
        if (button) button.style.display = 'none';
    });
}

function updateButtonStates(starData) {
    const currentInfraLimits = INFRA_LIMITS[starData.infrastructureLevel] || INFRA_LIMITS[1];
    
    // Laske jonossa olevat
    const planetaryQueue = starData.planetaryQueue || [];
    const queuedMines = planetaryQueue.filter(item => item.type === 'Mine').length;
    const queuedDefense = planetaryQueue.filter(item => item.type === 'Defense Upgrade').length;
    const queuedShipyard = planetaryQueue.filter(item => 
        item.type === 'Shipyard' || item.type.startsWith('Shipyard Lvl')).length;
    const queuedInfra = planetaryQueue.filter(item => 
        item.type.startsWith('Infrastructure')).length;
    
    // --- Infrastructure & Galactic Hub Logic (Lopullinen, korjattu versio) ---
    const hasInfraInQueue = queuedInfra > 0;
    const hasHubInQueue = planetaryQueue.some(item => item.type === 'Galactic Hub');

    // Tapaus 1: Infrastruktuuria voi vielä päivittää (taso < 5)
    if (starData.infrastructureLevel < 5) {
        upgradeInfrastructureButton.style.display = 'block';
        buildGalacticHubButton.style.display = 'none';

        const cost = getInfrastructureCost(starData.infrastructureLevel);
        const canAffordIt = canAfford(cost);
        upgradeInfrastructureButton.disabled = !canAffordIt || hasInfraInQueue;
        // ... (title-tekstit kuten ennenkin)
        upgradeInfrastructureButton.querySelector('span').textContent = 'Upgrade Infrastructure';
    } 
    // Tapaus 2: Infra on täynnä. Tarkistetaan Hubin tila.
    else {
        // A) Hub on jo valmis. Näytetään pysyvä, harmaa nappi.
        if (starData.hasGalacticHub) {
            upgradeInfrastructureButton.style.display = 'block';
            buildGalacticHubButton.style.display = 'none';

            upgradeInfrastructureButton.disabled = true;
            upgradeInfrastructureButton.querySelector('span').textContent = 'GALACTIC HUB';
            upgradeInfrastructureButton.title = 'Galactic Hub already built on this star.';
        }
        // B) Hubia ei ole valmiina. Näytetään rakennusnappi.
        else {
            upgradeInfrastructureButton.style.display = 'none';
            buildGalacticHubButton.style.display = 'block';

            // Jos Hub on jonossa, disabloidaan nappi (mutta pidetään se näkyvissä progress baria varten).
            if (hasHubInQueue) {
                buildGalacticHubButton.disabled = true;
                buildGalacticHubButton.title = 'Galactic Hub is already in the construction queue.';
            } 
            // Jos Hubia ei ole jonossa, tarkistetaan resurssit.
            else {
                const cost = { credits: 1000, minerals: 1000 };
                const canAffordIt = canAfford(cost);
                buildGalacticHubButton.disabled = !canAffordIt;
                buildGalacticHubButton.title = canAffordIt ? 'Build a Galactic Hub' : 'Insufficient resources';
            }
        }
    }

    
    // Shipyard buttons
    if (buildShipyardButton && buildShipyardButton.style.display !== 'none') {
        const cost = { credits: 150, minerals: 100 };
        const canAffordIt = canAfford(cost);
        const totalShipyards = starData.shipyardLevel + queuedShipyard;
        const canBuildMore = totalShipyards < currentInfraLimits.maxShipyard;
        
        buildShipyardButton.disabled = !canAffordIt || !canBuildMore;
        
        if (!canBuildMore) {
            buildShipyardButton.title = `Shipyard limit reached (${totalShipyards}/${currentInfraLimits.maxShipyard}) - Upgrade infrastructure first`;
        } else if (!canAffordIt) {
            buildShipyardButton.title = 'Insufficient resources (need 150C, 100M)';
        } else {
            buildShipyardButton.title = 'Build a shipyard to construct ships';
        }
    }
    
    if (upgradeShipyardButton && upgradeShipyardButton.style.display !== 'none') {
        const cost = getShipyardCost(starData.shipyardLevel);
        const canAffordIt = canAfford(cost);
        const nextLevel = starData.shipyardLevel + 1;
        const totalShipyards = starData.shipyardLevel + queuedShipyard;
        const canUpgrade = nextLevel <= currentInfraLimits.maxShipyard && queuedShipyard === 0;
        
        upgradeShipyardButton.disabled = !canAffordIt || !canUpgrade;
        
        if (queuedShipyard > 0) {
            upgradeShipyardButton.title = 'Shipyard upgrade already in queue';
        } else if (nextLevel > currentInfraLimits.maxShipyard) {
            upgradeShipyardButton.title = `Requires higher infrastructure level (current max: ${currentInfraLimits.maxShipyard})`;
        } else if (!canAffordIt) {
            upgradeShipyardButton.title = `Insufficient resources (need ${cost.credits}C, ${cost.minerals}M)`;
        } else {
            upgradeShipyardButton.title = `Upgrade to Shipyard Level ${nextLevel}`;
        }
    }
    
    // Mine button
    if (buildMineButton) {
        const cost = { credits: 75, minerals: 25 };
        const canAffordIt = canAfford(cost);
        const totalMines = starData.mines + queuedMines;
        const canBuildMore = totalMines < currentInfraLimits.maxMines;
        
        buildMineButton.disabled = !canAffordIt || !canBuildMore;
        
        if (!canBuildMore) {
            buildMineButton.title = `Mine limit reached (${totalMines}/${currentInfraLimits.maxMines})`;
            if (queuedMines > 0) {
                buildMineButton.title += ` - ${queuedMines} in queue`;
            }
        } else if (!canAffordIt) {
            buildMineButton.title = 'Insufficient resources (need 75C, 25M)';
        } else {
            buildMineButton.title = `Build a mine (${totalMines}/${currentInfraLimits.maxMines})`;
            if (queuedMines > 0) {
                buildMineButton.title += ` - ${queuedMines} in queue`;
            }
        }
    }
    
    // Defense button
    if (buildDefenseButton) {
        const cost = { credits: 100, minerals: 50 };
        const canAffordIt = canAfford(cost);
        const totalDefense = starData.defenseLevel + queuedDefense;
        const canBuildMore = totalDefense < currentInfraLimits.maxDefense;
        
        buildDefenseButton.disabled = !canAffordIt || !canBuildMore;
        
        if (!canBuildMore) {
            buildDefenseButton.title = `Defense limit reached (${totalDefense}/${currentInfraLimits.maxDefense})`;
            if (queuedDefense > 0) {
                buildDefenseButton.title += ` - ${queuedDefense} in queue`;
            }
        } else if (!canAffordIt) {
            buildDefenseButton.title = 'Insufficient resources (need 100C, 50M)';
        } else {
            buildDefenseButton.title = `Upgrade planetary defense (${totalDefense}/${currentInfraLimits.maxDefense})`;
            if (queuedDefense > 0) {
                buildDefenseButton.title += ` - ${queuedDefense} in queue`;
            }
        }
    }
    
    // Ship buttons
    Object.entries(SHIP_COST).forEach(([shipType, [credits, minerals, buildTime]]) => {
        const button = document.getElementById(`build${shipType.replace(/ /g, '')}Button`);
        if (button && button.style.display !== 'none') {
            const canAffordIt = canAfford({ credits, minerals });
            button.disabled = !canAffordIt;
            
            if (!canAffordIt) {
                button.title = `${shipType} - Insufficient resources (need ${credits}C, ${minerals}M)`;
            } else {
                button.title = `Build ${shipType} (${credits}C, ${minerals}M) - ${buildTime}s`;
            }
        }
    });
}

function updateQueueDisplays(starData) {
    // Update planetary queue
    const planetaryQueue = starData.planetaryQueue || [];
    planetaryQueueInfo.textContent = `Queue: ${planetaryQueue.length}`;
    
    // Update ship queue
    const shipQueue = starData.shipQueue || [];
    shipQueueInfo.textContent = `Queue: ${shipQueue.length}`;
    
    // Update progress bars (simplified)
    // This would need more complex logic to show actual progress
}

// päivittää planeetan ympärille muodostuvan leveähkön rinkulan, mikä kertoo valloituksen etenemisestä visuaalisesti
function updateConquestProgressUI(star) {
    // Etsi elementit
    const conquestProgressContainer = document.getElementById('conquestProgressContainer');
    const conquestProgressBarFill = document.getElementById('conquestProgressBarFill');
    const conquestProgressBarText = document.getElementById('conquestProgressBarText');
    const conqueringStatusText = document.getElementById('conqueringStatusText');
    
    if (!conquestProgressContainer || !conquestProgressBarFill || 
        !conquestProgressBarText || !conqueringStatusText) {
        return;
    }
    
    // Näytä vain jos tähti on valloituksen alla JA ei ole pelaajan
    if (star.isBeingConqueredBy && !isPlayerOwned(star)) {
        const progressPercent = Math.min(100, Math.floor(star.conquestProgress || 0));
        
        conquestProgressBarFill.style.width = `${progressPercent}%`;
        conquestProgressBarText.textContent = `${progressPercent}%`;
        
        // Määritä valloittajan nimi
        const conquerorName = getOwnerName(star.isBeingConqueredBy);
        conqueringStatusText.textContent = `Being conquered by ${conquerorName}...`;
        
        // Väri valloittajan mukaan
        if (star.isBeingConqueredBy === myPlayerId) {
            conquestProgressBarFill.style.backgroundColor = '#3b82f6'; // Blue
        } else {
            // Etsi AI:n väri
            const gameData = window.gameData;
            if (gameData && gameData.players) {
                const conqueror = gameData.players.find(p => p._id === star.isBeingConqueredBy);
                if (conqueror && conqueror.color) {
                    const color = conqueror.color.startsWith('#') ? 
                        conqueror.color : `#${parseInt(conqueror.color).toString(16).padStart(6, '0')}`;
                    conquestProgressBarFill.style.backgroundColor = color;
                }
            }
        }
        
        conquestProgressContainer.style.display = 'block';
        conqueringStatusText.style.display = 'block';
    } else {
        // Piilota jos ei valloitusta
        conquestProgressContainer.style.display = 'none';
        conqueringStatusText.style.display = 'none';
        conquestProgressBarFill.style.width = '0%';
        conquestProgressBarText.textContent = '0%';
    }
}

/* ========================================================================== */
/*  PROGRESS BAR FUNCTIONS                                                     */
/* ========================================================================== */
function updateConstructionProgress(action) {
    // Tallenna data interpolointia varten
    constructionProgressData.set(action.starId, {
        planetary: action.planetaryQueue || [],
        ship: action.shipQueue || [],
        lastUpdate: Date.now()
    });
    
    // Käynnistä interpolointi jos ei ole käynnissä
    startProgressInterpolation();
}

function updatePlanetaryConstructionProgressUI(queue) {
    if (!queue || queue.length === 0) {
        // Resetoi kaikki button progress barit
        document.querySelectorAll('.button-progress-bar').forEach(bar => {
            bar.style.width = '0%';
        });
        return;
    }
    
    const currentItem = queue[0];
    const progress = (currentItem.totalTime - currentItem.timeLeft) / currentItem.totalTime;
    const progressPercent = Math.floor(progress * 100);
    
    // Määritä mikä nappi
    let progressBarId = '';
    if (currentItem.type.startsWith('Infrastructure')) {
        progressBarId = 'progress-Infrastructure';
    } else if (currentItem.type === 'Shipyard' || currentItem.type.startsWith('Shipyard Lvl')) {
        progressBarId = currentItem.type === 'Shipyard' ? 'progress-Shipyard' : 'progress-UpgradeShipyard';
    } else if (currentItem.type === 'Mine') {
        progressBarId = 'progress-Mine';
    } else if (currentItem.type === 'Defense Upgrade') {
        progressBarId = 'progress-Defense';
    }
    
    const progressBar = document.getElementById(progressBarId);
    if (progressBar) {
        progressBar.style.width = `${progressPercent}%`;
    }
}

function updateShipConstructionProgressUI(queue) {
    if (!queue || queue.length === 0) {
        // Resetoi ship progress barit
        ['Fighter', 'Destroyer', 'Cruiser', 'SlipstreamFrigate'].forEach(type => {
            const bar = document.getElementById(`progress-${type.replace(/ /g, '')}`);
            if (bar) bar.style.width = '0%';
        });
        return;
    }
    
    const currentItem = queue[0];
    const progress = (currentItem.totalTime - currentItem.timeLeft) / currentItem.totalTime;
    const progressPercent = Math.floor(progress * 100);
    
    const progressBarId = `progress-${currentItem.type.replace(/ /g, '')}`;
    const progressBar = document.getElementById(progressBarId);
    if (progressBar) {
        progressBar.style.width = `${progressPercent}%`;
    }
}

function updateQueueTotalBars(planetaryQueue, shipQueue) {
    // Planetary total
    if (planetaryQueueTotalProgressFill && planetaryQueue?.length > 0) {
        const totalTime = planetaryQueue.reduce((sum, item) => sum + item.totalTime, 0);
        const totalLeft = planetaryQueue.reduce((sum, item) => sum + item.timeLeft, 0);
        const progress = ((totalTime - totalLeft) / totalTime) * 100;
        
        planetaryQueueTotalProgressFill.style.width = `${progress}%`;
        planetaryQueueTotalProgressText.textContent = `ETA: ${Math.ceil(totalLeft)}s`;
    }
    
    // Ship total
    if (shipQueueTotalProgressFill && shipQueue?.length > 0) {
        const totalTime = shipQueue.reduce((sum, item) => sum + item.totalTime, 0);
        const totalLeft = shipQueue.reduce((sum, item) => sum + item.timeLeft, 0);
        const progress = ((totalTime - totalLeft) / totalTime) * 100;
        
        shipQueueTotalProgressFill.style.width = `${progress}%`;
        shipQueueTotalProgressText.textContent = `ETA: ${Math.ceil(totalLeft)}s`;
    }
}

// Aloita interpolointi kun peli alkaa
function startProgressInterpolation() {
    if (progressInterpolationInterval) return;
    
    progressInterpolationInterval = setInterval(() => {
        constructionProgressData.forEach((data, starId) => {
            if (selectedStar && selectedStar._id === starId) {
                interpolateProgress(data);
            }
        });
    }, 100); // Päivitä 10 kertaa sekunnissa
}

function interpolateProgress(data) {
    const now = Date.now();
    const currentSpeed = isPaused ? 0 : GAME_SPEED;
    const elapsed = (now - data.lastUpdate) / 1000 * currentSpeed;

    // Planetary queue
    if (data.planetary && data.planetary.length > 0) {
        const item = data.planetary[0];
        const interpolatedTimeLeft = Math.max(0, item.timeLeft - elapsed);
        const progress = (item.totalTime - interpolatedTimeLeft) / item.totalTime;
        const progressPercent = Math.min(100, Math.floor(progress * 100));
        
        // Päivitä button progress bar
        updateButtonProgressBar(item.type, progressPercent);
        
        // Päivitä total queue bar
        if (planetaryQueueTotalProgressFill) {
            const totalTime = data.planetary.reduce((sum, it) => sum + it.totalTime, 0);
            const totalLeft = data.planetary.reduce((sum, it, idx) => {
                if (idx === 0) return sum + interpolatedTimeLeft;
                return sum + it.timeLeft;
            }, 0);
            const totalProgress = ((totalTime - totalLeft) / totalTime) * 100;
            planetaryQueueTotalProgressFill.style.width = `${Math.min(100, totalProgress)}%`;
            planetaryQueueTotalProgressText.textContent = `ETA: ${Math.ceil(totalLeft)}s`;
        }
        } else {
            // Reset planetary bars
            document.querySelectorAll('.button-progress-bar').forEach(bar => {
                if (!bar.id.includes('Fighter') && !bar.id.includes('Destroyer') && 
                    !bar.id.includes('Cruiser') && !bar.id.includes('Slipstream')) {
                    bar.style.width = '0%';
                }
            });
            // Nollaa total bar
            if (planetaryQueueTotalProgressFill) {
                planetaryQueueTotalProgressFill.style.width = '0%';
                planetaryQueueTotalProgressText.textContent = 'Idle';
                planetaryQueueTotalProgressText.setAttribute('idle', 'true');
            }
        }
    
    // Ship queue
    if (data.ship && data.ship.length > 0) {
        const item = data.ship[0];
        const interpolatedTimeLeft = Math.max(0, item.timeLeft - elapsed);
        const progress = (item.totalTime - interpolatedTimeLeft) / item.totalTime;
        const progressPercent = Math.min(100, Math.floor(progress * 100));
        
        // Päivitä ship button progress bar
        const progressBarId = `progress-${item.type.replace(/ /g, '')}`;
        const progressBar = document.getElementById(progressBarId);
        if (progressBar) {
            progressBar.style.width = `${progressPercent}%`;
        }
        
        // Päivitä total ship queue bar
        if (shipQueueTotalProgressFill) {
            const totalTime = data.ship.reduce((sum, it) => sum + it.totalTime, 0);
            const totalLeft = data.ship.reduce((sum, it, idx) => {
                if (idx === 0) return sum + interpolatedTimeLeft;
                return sum + it.timeLeft;
            }, 0);
            const totalProgress = ((totalTime - totalLeft) / totalTime) * 100;
            shipQueueTotalProgressFill.style.width = `${Math.min(100, totalProgress)}%`;
            shipQueueTotalProgressText.textContent = `ETA: ${Math.ceil(totalLeft)}s`;
        }
      } else {
          // Reset ship bars
          ['Fighter', 'Destroyer', 'Cruiser', 'SlipstreamFrigate'].forEach(type => {
              const bar = document.getElementById(`progress-${type.replace(/ /g, '')}`);
              if (bar) bar.style.width = '0%';
          });
          // Nollaa total bar
          if (shipQueueTotalProgressFill) {
              shipQueueTotalProgressFill.style.width = '0%';
              shipQueueTotalProgressText.textContent = 'Idle';
              shipQueueTotalProgressText.setAttribute('idle', 'true');
          }
      }
}

function updateButtonProgressBar(type, percent) {
    let progressBarId = '';
    
    // Määritä progress bar ID
    if (type.startsWith('Infrastructure')) {
        progressBarId = 'progress-Infrastructure';
    } else if (type === 'Shipyard') {
        progressBarId = 'progress-Shipyard';
    } else if (type.startsWith('Shipyard Lvl')) {
        progressBarId = 'progress-UpgradeShipyard';
    } else if (type === 'Mine') {
        progressBarId = 'progress-Mine';
    } else if (type === 'Defense Upgrade') {
        progressBarId = 'progress-Defense';
    } else if (type === 'Galactic Hub') {
        progressBarId = 'progress-GalacticHub';
    }
    
    const progressBar = document.getElementById(progressBarId);
    if (progressBar) {
        progressBar.style.width = `${percent}%`;
        
        // Jos 0%, varmista että transition on nopea
        if (percent === 0) {
            progressBar.style.transition = 'width 0.1s linear';
        }
    }
}

/* ========================================================================== */
/*  CONSTRUCTION COMMANDS                                                      */
/* ========================================================================== */

function handleUpgradeInfrastructure() {
    if (!selectedStar || isPaused) return;
    
    const cost = getInfrastructureCost(selectedStar.infrastructureLevel);
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    
    // Send command to backend
    const buildType = `Infrastructure Lvl ${selectedStar.infrastructureLevel + 1}`;
    sendConstructionCommand(selectedStar._id, buildType, cost);
}

function handleBuildGalacticHub() {
    if (!selectedStar || isPaused) return;
    
    // Määritä kovat kustannukset
    const cost = { credits: 1000, minerals: 1000, time: 180 };
    if (!canAfford(cost)) {
        alert("Insufficient resources for Galactic Hub!");
        return;
    }
    
    sendConstructionCommand(selectedStar._id, 'Galactic Hub', cost);
}

function handleBuildShipyard() {
    if (!selectedStar || isPaused) return; 
    
    const cost = { credits: 150, minerals: 100, time: 20 };
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    
    sendConstructionCommand(selectedStar._id, 'Shipyard', cost);
}

function handleUpgradeShipyard() {
    if (!selectedStar || isPaused) return; 
    
    const cost = getShipyardCost(selectedStar.shipyardLevel);
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    
    const buildType = `Shipyard Lvl ${selectedStar.shipyardLevel + 1}`;
    sendConstructionCommand(selectedStar._id, buildType, cost);
}

function handleBuildMine() {
    if (!selectedStar || isPaused) return; 
    
    const cost = { credits: 75, minerals: 25, time: 10 };
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    
    sendConstructionCommand(selectedStar._id, 'Mine', cost);
}

function handleBuildDefense() {
    if (!selectedStar || isPaused) return; 
    
    const cost = { credits: 100, minerals: 50, time: 15 };
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    
    sendConstructionCommand(selectedStar._id, 'Defense Upgrade', cost);
}

function handleBuildShip(shipType) {
    if (!selectedStar || !shipType || isPaused) return;
    
    const shipCost = SHIP_COST[shipType];
    if (!shipCost) return;
    
    const cost = { credits: shipCost[0], minerals: shipCost[1] };
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    
    sendShipConstructionCommand(selectedStar._id, shipType, cost);
}

function sendConstructionCommand(starId, buildingType, cost) {
    //console.log(`🔨 Sending construction command: ${buildingType} at star ${starId}`);
    
    // Deduct resources locally for immediate feedback
    playerResources.credits -= cost.credits;
    playerResources.minerals -= cost.minerals;
    updateResourceDisplay();
    
    // Send command to backend
    const command = {
        action: 'QUEUE_PLANETARY',
        playerId: myPlayerId,
        gameId: currentGameId,
        starId: starId,
        build: {
            type: buildingType,
            time: cost.time || 20 // Default build time
        },
        cost: cost
    };
    
    socket.emit('player_command', command);

    // Optimistinen UI-päivitys planetary menun total queue:lle
    // Tarkistetaan, että valittu tähti on se, jota muokattiin
    if (selectedStar && selectedStar._id === starId) {
        // 1. Varmistetaan, että jono-taulukko on olemassa
        if (!selectedStar.planetaryQueue) {
            selectedStar.planetaryQueue = [];
        }
        
        // 2. Lisätään uusi rakennuskohde paikalliseen jonoon
        selectedStar.planetaryQueue.push({
            type: buildingType,
            timeLeft: cost.time,
            totalTime: cost.time
        });

        // 3. Kutsutaan menun päivitystä, joka lukee muokatun selectedStar-olion
        showPlanetMenu(selectedStar);
        //console.log('[UI-UPDATE] Päivitetty planeettajono optimistisesti.');
    }
}

function sendShipConstructionCommand(starId, shipType, cost) {
    //console.log(`🚀 Sending ship construction command: ${shipType} at star ${starId}`);
    
    // Deduct resources locally for immediate feedback
    playerResources.credits -= cost.credits;
    playerResources.minerals -= cost.minerals;
    updateResourceDisplay();
    
    // Send command to backend
    const command = {
        action: 'QUEUE_SHIP',
        playerId: myPlayerId,
        gameId: currentGameId,
        starId: starId,
        build: {
            type: shipType,
            time: SHIP_COST[shipType][2] // Build time from SHIP_COST array
        },
        cost: cost
    };
    
    socket.emit('player_command', command);

    // Optimistinen UI-päivitys planetary menun total queue:lle
    if (selectedStar && selectedStar._id === starId) {
        if (!selectedStar.shipQueue) {
            selectedStar.shipQueue = [];
        }

        selectedStar.shipQueue.push({
            type: shipType,
            timeLeft: SHIP_COST[shipType][2],
            totalTime: SHIP_COST[shipType][2]
        });

        showPlanetMenu(selectedStar);
        //console.log('[UI-UPDATE] Päivitetty alusjono optimistisesti.');
    }
}

/* ========================================================================== */
/*  RESOURCE MANAGEMENT                                                        */
/* ========================================================================== */

function updateResourceDisplay() {
    // Laske tulot ja kulut
    let creditIncome = 0;
    let mineralIncome = 0;
    let creditUpkeep = 0;
    
    // Tulot omilta planeetoilta
    if (gameState && gameState.stars) {
        gameState.stars
            .filter(star => star.ownerId === myPlayerId)
            .forEach(star => {
                creditIncome += star.population || 0;
                mineralIncome += star.mines || 0;
                
                // Planetary upkeep
                creditUpkeep += (star.defenseLevel || 0) * 2;  // PD upkeep
                creditUpkeep += (star.shipyardLevel || 0) * 3; // Shipyard upkeep
                if (star.hasGalacticHub) {
                    creditUpkeep += UPKEEP_GALACTIC_HUB;
                }
           
            });
    }
    
    // Ship upkeep
    const SHIP_UPKEEP = { Fighter: 1, Destroyer: 2, Cruiser: 3, 'Slipstream Frigate': 4 };
    if (gameState && gameState.ships) {
        gameState.ships
            .filter(ship => ship.ownerId === myPlayerId)
            .forEach(ship => {
                creditUpkeep += SHIP_UPKEEP[ship.type] || 0;
            });
    }
    
    const netCredits = creditIncome - creditUpkeep;
    
    // Päivitä näyttö
    if (creditsDisplay) {
        const netColor = netCredits >= 0 ? '#10b981' : '#ef4444'; // vihreä tai punainen
        creditsDisplay.innerHTML = `
            Credits: ${Math.floor(playerResources.credits)}
            <span style="color: ${netColor}; font-size: 0.85em;">
                (${netCredits >= 0 ? '+' : ''}${netCredits}/10s)
            </span>
        `;
    }
    
    if (mineralsDisplay) {
        mineralsDisplay.innerHTML = `
            Minerals: ${Math.floor(playerResources.minerals)}
            <span style="color: #10b981; font-size: 0.85em;">
                (+${mineralIncome}/10s)
            </span>
        `;
    }
    
    // Päivitä nappien tilat
    if (selectedStar && planetMenu.style.display === 'block') {
        updateButtonStates(selectedStar);
    }
}



// Performance monitoring - vain UI-päivitys, ei FPS-laskentaa
function updatePerformanceMonitor() {
    const fpsCounter = document.getElementById('fpsCounter');
    const shipCounter = document.getElementById('shipCounter');
    const effectCounter = document.getElementById('effectCounter');
    const memoryCounter = document.getElementById('memoryCounter');
    
    if (window.getSceneDebugInfo) {
        const debug = window.getSceneDebugInfo();
        
        if (fpsCounter) {
            fpsCounter.textContent = debug.fps || 0;
            
            // Värikoodaus FPS:lle
            if (debug.fps >= 50) {
                fpsCounter.style.color = '#00ff00'; // Vihreä
            } else if (debug.fps >= 30) {
                fpsCounter.style.color = '#ffff00'; // Keltainen  
            } else {
                fpsCounter.style.color = '#ff0000'; // Punainen
            }
        }
        
        if (shipCounter) shipCounter.textContent = debug.totalShips;
        if (effectCounter) effectCounter.textContent = debug.combatEffects + debug.explosions;
    }
    
    if (memoryCounter && performance.memory) {
        const mb = Math.round(performance.memory.usedJSHeapSize / 1048576);
        memoryCounter.textContent = mb;
    }
}

// Päivitä UI 4 kertaa sekunnissa
setInterval(updatePerformanceMonitor, 250);

function canAfford(cost) {
    return playerResources.credits >= cost.credits && 
           playerResources.minerals >= cost.minerals;
}

function updateUIFromDiff(diff) {
    diff.forEach(action => {
        switch (action.action) {
            case 'TICK_INFO':
                // Synkronoi serverin nopeus
                if (action.speed !== window.SERVER_SPEED) {
                    window.SERVER_SPEED = action.speed;
                    console.log(`[SYNC] Server speed: ${action.speed}x`);
                }
                break;
            case 'CONSTRUCTION_PROGRESS':
                if (selectedStar && selectedStar._id === action.starId) {
                    updateConstructionProgress(action);
                }
                break;
                
            case 'COMPLETE_PLANETARY':
                // Päivitä gameState
                if (gameState && action.starData) {
                    const starIndex = gameState.stars.findIndex(s => s._id === action.starId);
                    if (starIndex !== -1) {
                        Object.assign(gameState.stars[starIndex], action.starData);
                    }
                }
                // Päivitä progress data
                
                const progressData = constructionProgressData.get(action.starId);
                if (progressData) {
                    progressData.planetary = action.starData?.planetaryQueue || [];
                    progressData.lastUpdate = Date.now();
                }
                
                // Päivitä selectedStar jos on valittuna
                if (selectedStar && selectedStar._id === action.starId && action.starData) {
                    // Päivitä selectedStar objekti
                    Object.assign(selectedStar, action.starData);
                    // Päivitä UI
                    showPlanetMenu(selectedStar);
                }
                
                // Nollaa progress bar heti
                updateButtonProgressBar(action.type, 0);
                
                // Päivitä queue total bars
                if (selectedStar && selectedStar._id === action.starId) {
                    updateQueueTotalBars(action.starData.planetaryQueue, action.starData.shipQueue);
                }
                break;
                
            case 'SHIP_SPAWNED':
                // Tämä tulee serveriltä kun alus valmistuu.
                // Lisätään uusi alus clientin paikalliseen tilaan,
                // jotta UI-funktiot (kuten updateResourceDisplay) näkevät sen.
                if (gameState && gameState.ships) {
                    const newShipData = {
                        _id: action.shipId,
                        type: action.type,
                        ownerId: action.ownerId,
                        parentStarId: action.starId, // Tallenna tähti, josta se syntyi
                        state: 'orbiting'
                        // Voit lisätä muita ominaisuuksia tarpeen mukaan
                    };
                    gameState.ships.push(newShipData);
                    //console.log(`[CLIENT-STATE] Lisätty uusi alus ${action.shipId} paikalliseen gameStateen. Aluksia yhteensä: ${gameState.ships.length}`);
                }

                // Tämä alla oleva logiikka päivittää planeetan rakennusjonon,
                // se voi jäädä ennalleen.
                if (gameState && action.starData) {
                    const starIndex = gameState.stars.findIndex(s => s._id === action.starId);
                    if (starIndex !== -1) {
                        Object.assign(gameState.stars[starIndex], action.starData);
                    }
                }
                
                const shipProgressData = constructionProgressData.get(action.starId);
                if (shipProgressData && action.starData) {
                    shipProgressData.ship = action.starData.shipQueue || [];
                    shipProgressData.lastUpdate = Date.now();
                }
                
                if (selectedStar && selectedStar._id === action.starId) {
                    if (action.starData) {
                        selectedStar.shipQueue = action.starData.shipQueue;
                        selectedStar.shipQueueTotalTime = action.starData.shipQueueTotalTime;
                    }
                    ['Fighter', 'Destroyer', 'Cruiser', 'SlipstreamFrigate'].forEach(type => {
                        const bar = document.getElementById(`progress-${type.replace(/ /g, '')}`);
                        if (bar) bar.style.width = '0%';
                    });
                    updateQueueTotalBars(selectedStar.planetaryQueue, selectedStar.shipQueue);
                }
                break; 

            case 'SHIP_ARRIVED': {
                const ship = gameState?.ships?.find(s => s._id === action.shipId);
                if (ship) {
                    ship.state        = 'orbiting';
                    ship.parentStarId = action.atStarId;
                    ship.targetStarId = null;
                }
                break;
            }

            case 'DEFENSE_DAMAGED':
                //console.log(`⚔️ Defense damaged at star ${action.starId}, new level: ${action.newLevel}`);
                // Päivitä UI jos valittu tähti
                if (selectedStar && selectedStar._id === action.starId) {
                    selectedStar.defenseLevel = action.newLevel;
                    showPlanetMenu(selectedStar);
                }
            break;

            case 'SHIP_DESTROYED':
                //console.log(`💥 Ship destroyed: ${action.shipId}`);
                // Scene.js hoitaa visuaalisen päivityksen ja selectedShips-käsittelyn
                
                if (gameState && gameState.ships) {
                    const initialCount = gameState.ships.length;
                    gameState.ships = gameState.ships.filter(ship => 
                        ship._id.toString() !== action.shipId.toString()
                    );
                    const finalCount = gameState.ships.length;
                    if (initialCount > finalCount) {
                        //console.log(`[CLIENT-STATE] Poistettu alus ${action.shipId}. Aluksia jäljellä: ${finalCount}`);
                    }
                }
                updateGroupsPanel(); // Päivitä ryhmäpaneeli, koska aluksia on voinut tuhoutua
                updateResourceDisplay(); // Päivitä upkeep
                break;
                
            case 'STAR_UPDATED':
                if (gameState && gameState.stars) {
                    // Etsi oikea tähti paikallisesta tilasta
                    const starToUpdate = gameState.stars.find(s => s._id.toString() === action.starId.toString());
                    
                    if (starToUpdate) {
                        // Päivitä kentät (tässä tapauksessa populaatio)
                        Object.assign(starToUpdate, action.updatedFields);
                        //console.log(`[CLIENT-STATE] Päivitetty tähden ${action.starId} populaatio arvoon ${action.updatedFields.population}`);

                        // JOS PÄIVITETTY TÄHTI ON VALITTUNA, PÄIVITÄ MYÖS PLANET MENU
                        if (selectedStar && selectedStar._id.toString() === action.starId.toString()) {
                            // Kopioi päivitetyt tiedot myös `selectedStar`-olioon
                            Object.assign(selectedStar, action.updatedFields);
                            // Kutsu menun päivitysfunktiota
                            showPlanetMenu(selectedStar);
                        }
                    }
                }
                break;
                            
            case 'RESOURCE_UPDATE':
                //console.log('📊 RESOURCE_UPDATE received:', action);
                if (action.playerId === myPlayerId) {
                    const oldCredits = playerResources.credits;
                    const oldMinerals = playerResources.minerals;
                    playerResources = action.resources;
                    console.log(`💰 Resources updated: Credits ${oldCredits} -> ${playerResources.credits}, Minerals ${oldMinerals} -> ${playerResources.minerals}`);
                    updateResourceDisplay();
                }
                break;

            case 'SHIP_IN_SLIPSTREAM':
                // Tämä on puhtaasti visuaalinen efekti, joten emme päivitä
                // client.js:n UI-elementtejä. applyDiff(diff) hoitaa tämän
                // välittämisen scene.js:lle, jossa efekti piirretään.
                break;

            case 'CONQUEST_STARTED':
                //console.log("⚔️ Conquest started at star", action.starId);
                // Scene.js hoitaa visuaalisen päivityksen
                break;
                
            case 'CONQUEST_PROGRESS':
                if (selectedStar && selectedStar._id === action.starId) {
                    selectedStar.conquestProgress = action.progress;
                    selectedStar.isBeingConqueredBy = action.conquerorId;
                    // Päivitä UI jos tarvetta
                    updateConquestProgressUI(selectedStar);
                }
                break;
                
            case 'CONQUEST_COMPLETE':
                //console.log("🏴 Conquest complete at star", action.starId);
                if (selectedStar && selectedStar._id === action.starId) {
                    Object.assign(selectedStar, action.starData);
                    showPlanetMenu(selectedStar);
                }
                break;
                
            case 'CONQUEST_HALTED':
                //console.log("🛑 Conquest halted at star", action.starId);
                if (selectedStar && selectedStar._id === action.starId) {
                    selectedStar.conquestProgress = 0;
                    selectedStar.isBeingConqueredBy = null;
                    updateConquestProgressUI(selectedStar);
                }
                break;
        }
    });
}

/* ========================================================================== */
/*  UTILITY FUNCTIONS                                                         */
/* ========================================================================== */

function getInfrastructureCost(currentLevel) {
    // Simplified cost calculation matching backend logic
    const baseCost = 150;
    const factor = 1 + 0.3 * currentLevel;
    return {
        credits: Math.round(baseCost * factor),
        minerals: Math.round(baseCost * 0.67 * factor),
        time: Math.round(40 * factor)
    };
}

function getShipyardCost(currentLevel) {
    // Simplified cost calculation matching backend logic
    if (currentLevel === 0) {
        return { credits: 150, minerals: 100, time: 20 };
    }
    const baseCost = 150;
    const factor = 1 + 0.3 * currentLevel;
    return {
        credits: Math.round(baseCost * factor),
        minerals: Math.round(baseCost * 0.67 * factor),
        time: Math.round(40 * factor)
    };
}

function syncShipButtons() {
    Object.entries(SHIP_COST).forEach(([shipType, [credits, minerals, time, minLevel]]) => {
        const button = document.getElementById(`build${shipType.replace(/ /g, '')}Button`);
        if (button) {
            const span = button.querySelector('span');
            if (span) {
                span.textContent = `Build ${shipType} (${credits}C, ${minerals}M)`;
            }
            button.dataset.costCredits = credits;
            button.dataset.costMinerals = minerals;
            button.dataset.buildTime = time;
        }
    });
}



/* ========================================================================== */
/*  EXPORTS & FINAL SETUP                                                     */
/* ========================================================================== */

// Start the resource display update loop
setInterval(updateResourceDisplay, 1000);

console.log("📁 Client.js loaded successfully");

export {
    playerResources,
    gameState,
    myPlayerId,
    currentGameId
};