// frontend/js/client.js - Täydellinen client-side logiikka
// =============================================================================
//  Hoitaa UI:n, Socket.IO:n ja kaiken client-side-logiikan
// =============================================================================

import { io } from "https://cdn.socket.io/4.7.5/socket.io.esm.min.js";
import {
    initThreeIfNeeded,
    buildFromSnapshot,
    applyDiff,
    animate,
    selectStar,
    deselectStar
} from './scene.js';

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

// Infrastructure limits (should match backend)
const INFRA_LIMITS = {
    1: { maxPop: 10, maxMines: 10, maxDefense: 2, maxShipyard: 2 },
    2: { maxPop: 15, maxMines: 15, maxDefense: 4, maxShipyard: 3 },
    3: { maxPop: 20, maxMines: 20, maxDefense: 6, maxShipyard: 4 },
    4: { maxPop: 25, maxMines: 25, maxDefense: 8, maxShipyard: 4 },
    5: { maxPop: 30, maxMines: 30, maxDefense: 10, maxShipyard: 4 }
};

/* ========================================================================== */
/*  GLOBAL STATE                                                              */
/* ========================================================================== */

let gameState = null;
let myPlayerId = null;
let playerResources = { credits: 1000, minerals: 500 };
let gameInProgress = false;
let currentGameId = null;
let selectedStar = null;

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
    console.log("❌ Socket disconnected");
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
    console.log("📦 Received diff:", diff);
    
    // Debug SHIP_MOVING erikseen
    diff.forEach(action => {
        if (action.action === 'SHIP_MOVING') {
            console.log("🚢 SHIP_MOVING received:", action);
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
    startGameButton.addEventListener('click', handleStartGame);
    resumeGameButton.addEventListener('click', handleResumeGame);
    
    // AI settings
    numAiPlayersSelect.addEventListener('change', setupAIPlayerSettings);
    
    // Construction buttons
    upgradeInfrastructureButton.addEventListener('click', () => handleUpgradeInfrastructure());
    buildShipyardButton.addEventListener('click', () => handleBuildShipyard());
    upgradeShipyardButton.addEventListener('click', () => handleUpgradeShipyard());
    buildMineButton.addEventListener('click', () => handleBuildMine());
    buildDefenseButton.addEventListener('click', () => handleBuildDefense());
    buildFighterButton.addEventListener('click', (e) => handleBuildShip(e.target.dataset.type));
    buildDestroyerButton.addEventListener('click', (e) => handleBuildShip(e.target.dataset.type));
    buildCruiserButton.addEventListener('click', (e) => handleBuildShip(e.target.dataset.type));
    buildSlipstreamFrigateButton.addEventListener('click', (e) => handleBuildShip(e.target.dataset.type));
    
    // Star selection events from scene
    window.addEventListener('starSelected', (event) => {
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
        socket.emit('player_command', event.detail);
    });

    // Keyboard events
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (uiState === 'playing') {
                pauseGame();
            } else if (uiState === 'paused') {
                resumeGame();
            }
        }
    });
    
    // Button hover sounds (simplified)
    document.querySelectorAll('button').forEach(button => {
        button.addEventListener('mouseenter', () => {
            // Could add sound effects here
        });
    });
}

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

async function handleStartGame() {
    try {
        startGameButton.disabled = true;
        startGameButton.querySelector('span').textContent = 'Starting...';
        
        // Collect AI settings
        const numAIPlayers = parseInt(numAiPlayersSelect.value);
        const colorPickers = document.querySelectorAll('.ai-color-picker');
        const aiColors = [];
        
        for (let i = 0; i < numAIPlayers; i++) {
            const colorHex = colorPickers[i] ? colorPickers[i].value : `#${DEFAULT_AI_COLORS[i].toString(16).padStart(6, '0')}`;
            aiColors.push(colorHex);
        }
        
        // Create new game
        const gameConfig = {
            humanName: "Player",
            humanColor: "#68c5ff",
            numAiPlayers: numAIPlayers,
            aiColors: aiColors,
            starCount: parseInt(starCountSelect.value),
            lobbyHost: "client",
            speed: 1
        };
        
        console.log("🎮 Creating new game with config:", gameConfig);
        
        const result = await createNewGame(gameConfig);
        
        if (!result.success) {
            throw new Error(result.message || "Failed to create game");
        }
        
        currentGameId = result.gameId;
        myPlayerId = result.playerId; // If backend provides this
        
        console.log("✅ Game created successfully, ID:", currentGameId);
        
        // Join the game room
        socket.emit("join_game", { gameId: currentGameId });
        
    } catch (error) {
        console.error("❌ Failed to start game:", error);
        alert("Failed to start game: " + error.message);
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
    animate();
    
    // Switch to game UI
    showGameUI();
    
    console.log("✅ Game state loaded and UI updated");
}

function handleResumeGame() {
    if (gameInProgress) {
        uiState = 'playing';
        updateUIState();
    }
}

function pauseGame() {
    uiState = 'paused';
    updateUIState();
}

function resumeGame() {
    uiState = 'playing';
    updateUIState();
}

function showStartScreen() {
    uiState = 'startScreen';
    updateUIState();
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
    console.log("🌟 Star selected:", starData);
    
    if (!starData) {
        selectedStar = null;
        hidePlanetMenu();
        return;
    }
    
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
    const currentInfraLimits = INFRA_LIMITS[starData.infrastructureLevel] || INFRA_LIMITS[1];
    
    // Infrastructure button
    const canUpgradeInfra = starData.infrastructureLevel < 5;
    upgradeInfrastructureButton.style.display = canUpgradeInfra ? 'block' : 'none';
    
    // Shipyard buttons
    const hasShipyard = starData.shipyardLevel > 0;
    buildShipyardButton.style.display = !hasShipyard ? 'block' : 'none';
    upgradeShipyardButton.style.display = hasShipyard ? 'block' : 'none';
    
    // Mine button
    const canBuildMine = starData.mines < currentInfraLimits.maxMines;
    buildMineButton.style.display = canBuildMine ? 'block' : 'none';
    
    // Defense button
    const canUpgradeDefense = starData.defenseLevel < currentInfraLimits.maxDefense;
    buildDefenseButton.style.display = canUpgradeDefense ? 'block' : 'none';
    
    // Ship buttons
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
    
    // Update button states (enabled/disabled)
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
    // Update button enabled/disabled states based on resources and requirements
    const buttons = [
        { button: upgradeInfrastructureButton, cost: getInfrastructureCost(starData.infrastructureLevel) },
        { button: buildShipyardButton, cost: { credits: 150, minerals: 100 } },
        { button: upgradeShipyardButton, cost: getShipyardCost(starData.shipyardLevel) },
        { button: buildMineButton, cost: { credits: 75, minerals: 25 } },
        { button: buildDefenseButton, cost: { credits: 100, minerals: 50 } }
    ];
    
    buttons.forEach(({ button, cost }) => {
        if (button && cost) {
            const canAfford = playerResources.credits >= cost.credits && 
                            playerResources.minerals >= cost.minerals;
            button.disabled = !canAfford;
        }
    });
    
    // Ship buttons
    Object.entries(SHIP_COST).forEach(([shipType, [credits, minerals]]) => {
        const button = document.getElementById(`build${shipType.replace(/ /g, '')}Button`);
        if (button) {
            const canAfford = playerResources.credits >= credits && 
                            playerResources.minerals >= minerals;
            button.disabled = !canAfford;
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
    const elapsed = (now - data.lastUpdate) / 1000; // Sekunteina
    
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
    if (!selectedStar) return;
    
    const cost = getInfrastructureCost(selectedStar.infrastructureLevel);
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    
    // Send command to backend
    const buildType = `Infrastructure Lvl ${selectedStar.infrastructureLevel + 1}`;
    sendConstructionCommand(selectedStar._id, buildType, cost);
}

function handleBuildShipyard() {
    if (!selectedStar) return;
    
    const cost = { credits: 150, minerals: 100, time: 20 };
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    
    sendConstructionCommand(selectedStar._id, 'Shipyard', cost);
}

function handleUpgradeShipyard() {
    if (!selectedStar) return;
    
    const cost = getShipyardCost(selectedStar.shipyardLevel);
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    
    const buildType = `Shipyard Lvl ${selectedStar.shipyardLevel + 1}`;
    sendConstructionCommand(selectedStar._id, buildType, cost);
}

function handleBuildMine() {
    if (!selectedStar) return;
    
    const cost = { credits: 75, minerals: 25, time: 10 };
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    
    sendConstructionCommand(selectedStar._id, 'Mine', cost);
}

function handleBuildDefense() {
    if (!selectedStar) return;
    
    const cost = { credits: 100, minerals: 50, time: 15 };
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    
    sendConstructionCommand(selectedStar._id, 'Defense Upgrade', cost);
}

function handleBuildShip(shipType) {
    if (!selectedStar || !shipType) return;
    
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
    console.log(`🔨 Sending construction command: ${buildingType} at star ${starId}`);
    
    // Deduct resources locally for immediate feedback
    playerResources.credits -= cost.credits;
    playerResources.minerals -= cost.minerals;
    updateResourceDisplay();
    
    // Send command to backend
    const command = {
        action: 'QUEUE_PLANETARY',
        starId: starId,
        build: {
            type: buildingType,
            time: cost.time || 20 // Default build time
        }
    };
    
    socket.emit('player_command', command);
}

function sendShipConstructionCommand(starId, shipType, cost) {
    console.log(`🚀 Sending ship construction command: ${shipType} at star ${starId}`);
    
    // Deduct resources locally for immediate feedback
    playerResources.credits -= cost.credits;
    playerResources.minerals -= cost.minerals;
    updateResourceDisplay();
    
    // Send command to backend
    const command = {
        action: 'QUEUE_SHIP',
        starId: starId,
        build: {
            type: shipType,
            time: SHIP_COST[shipType][2] // Build time from SHIP_COST array
        }
    };
    
    socket.emit('player_command', command);
}

/* ========================================================================== */
/*  RESOURCE MANAGEMENT                                                        */
/* ========================================================================== */

function updateResourceDisplay() {
    if (creditsDisplay) {
        creditsDisplay.textContent = `Credits: ${Math.floor(playerResources.credits)}`;
    }
    if (mineralsDisplay) {
        mineralsDisplay.textContent = `Minerals: ${Math.floor(playerResources.minerals)}`;
    }
    
    // Update button states if planet menu is open
    if (selectedStar && planetMenu.style.display === 'block') {
        updateButtonStates(selectedStar);
    }
}

function canAfford(cost) {
    return playerResources.credits >= cost.credits && 
           playerResources.minerals >= cost.minerals;
}

function updateUIFromDiff(diff) {
    diff.forEach(action => {
        switch (action.action) {
            case 'CONSTRUCTION_PROGRESS':
                if (selectedStar && selectedStar._id === action.starId) {
                    updateConstructionProgress(action);
                }
                break;
                
            case 'COMPLETE_PLANETARY':
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
                console.log("🚀 Ship spawned");
                
                // Päivitä progress data
                const shipProgressData = constructionProgressData.get(action.starId);
                if (shipProgressData && action.starData) {
                    shipProgressData.ship = action.starData.shipQueue || [];
                    shipProgressData.lastUpdate = Date.now();
                }
                
                // Jos tämä tähti on valittuna, päivitä UI
                if (selectedStar && selectedStar._id === action.starId) {
                    if (action.starData) {
                        selectedStar.shipQueue = action.starData.shipQueue;
                        selectedStar.shipQueueTotalTime = action.starData.shipQueueTotalTime;
                    }
                    // Nollaa ship progress bars
                    ['Fighter', 'Destroyer', 'Cruiser', 'SlipstreamFrigate'].forEach(type => {
                        const bar = document.getElementById(`progress-${type.replace(/ /g, '')}`);
                        if (bar) bar.style.width = '0%';
                    });
                    // Päivitä total bars
                    updateQueueTotalBars(selectedStar.planetaryQueue, selectedStar.shipQueue);
                }
                break;
                
            case 'RESOURCE_UPDATE':
                if (action.playerId === myPlayerId) {
                    playerResources = action.resources;
                    updateResourceDisplay();
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