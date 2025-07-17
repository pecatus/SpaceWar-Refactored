// frontend/tutorialScript.js
export const tutorialSteps = {
'START': {
    speaker: 'Elara',
    text: "Welcome, Commander. I am Elara, your advisor on economic and scientific matters. Let's begin.",
    highlightSelector: null,
    trigger: { event: 'GAME_START' },
    next: 'cameraControls' 
},
'cameraControls': {
    speaker: 'Elara',
    text: "First, let's calibrate your command view. Familiarity with the interface is essential for what lies ahead.\n\n**Camera Controls:**\n• **Rotate:** Hold the **Left Mouse Button** and drag.\n• **Pan:** Hold the **Right Mouse Button** and drag.\n• **Zoom:** Use the **Mouse Wheel**.",
    highlightSelector: null,
    trigger: { event: 'TUTORIAL_CONTINUE' }, 
    next: 'elaraIntroducesValerius' 
},
'elaraIntroducesValerius': {
    speaker: 'Elara',
    text: "Now, for a strategic overview of our situation, I give you General Valerius.",
    highlightSelector: null,
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: 'valeriusOpening' 
},
  'valeriusOpening': {
    speaker: 'Valerius',
    text: "I am General Valerius. Elara can handle the pleasantries; I deal in the harsh reality of our situation. And that reality is dire.\n\nThe Galactic Empire is a memory, shattered by its own creations – a cascade of rogue AIs that now hunt the last remnants of humanity.\n\nWe are that remnant, Commander.\n\nOur survival depends on the strength of our fleets and the conviction of our commands.",
    highlightSelector: null,
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: 'elaraSpeedControlsIntro'
  },
  'elaraSpeedControlsIntro': {
    speaker: 'Elara',
    text: "To help you manage the immense task ahead, you can manipulate the flow of our Virtual Symmetry System using these controls highlighted above.\n\nNote that our communiques will automatically pause the system to ensure you don't miss critical information.\n\nPressing **SPACEBAR** will also pause and unpause the system.",
    highlightSelector: '#speedPanel',
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: 'elaraFinalPrompt'
  },
    'elaraFinalPrompt': {
        speaker: 'Elara',
        text: "Now, with the temporal controls calibrated, it's time to establish a primary command link.\n\nFocus on our homeworld. Select it to bring its status onto your command display.\n\nAs you navigate the galaxy, remember that you can also **double-click** any star to quickly center the camera on it.",
        highlightSelector: null, 
        trigger: { event: 'TUTORIAL_CONTINUE' },
        next: 'homeworldSelected' 
    },
  'homeworldSelected': {
        speaker: 'Elara',
        text: "Excellent. This panel shows our current resources. As you can see, our economy is fragile.\n\nThe key to unlocking this world's full potential is its core Infrastructure. Each time we reinforce these planetary systems, we increase the capacity for both population and industrial complexes.\n\nI recommend we begin developing our homeworld immediately.",
        // Korostetaan resurssipaneelia ja infra-nappia.
        highlightSelector: ['#resourcePanel', '#upgradeInfrastructureButton'], 
        trigger: { event: 'STAR_SELECTED', payload: { isPlayerHomeworld: true } },
        next: 'elaraMineRecommendation'
    },
  'elaraMineRecommendation': {
    speaker: 'Elara',
    text: "Along with infrastructure improvements I recommend building a few mining complexes to secure our resource flow. We can support five mining complexes with our current infrastructure.\n\nGeneral Valerius has other ideas, of course.",
    highlightSelector: '#buildMineButton',
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: 'valeriusOpeningStatement'
  },
  'valeriusOpeningStatement': {
      speaker: 'Valerius',
      text: "An empire without a fleet is merely prey, and we are being hunted. We need ships, Commander. We need a fleet to project our power and warriors to guard our skies.\n\nBuild us fighters, but do not neglect our defenses. Every ship, every gun, is a blade held against the throat of extinction. We must arm ourselves. Now.",
      highlightSelector: ['#buildFighterButton', '#buildDefenseButton'],
      trigger: { event: 'TUTORIAL_CONTINUE' },
      next: 'elaraUpkeepWarning' 
  },


  // UUSI VAIHEKETJU YLLÄPIDOLLE JA PELOTTEELLE
  'elaraUpkeepWarning': {
    speaker: 'Elara',
    text: "Just keep in mind, Commander, that military assets require constant maintenance. Every level of Planetary Defense, for example, consumes 2 Credits from our economy each payment cycle.",
    highlightSelector: ['#buildFighterButton', '#buildDefenseButton'],
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: 'valeriusDeterrentComment'
  },
  'valeriusDeterrentComment': {
    speaker: 'Valerius',
    text: "Aye, security is never free. But it is a small price for a strong deterrent.\n\nOur intelligence suggests the AI is reluctant to waste its resources on well-defended worlds.",
    highlightSelector: null,
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: 'elaraResumeSystem'
  },
  'elaraResumeSystem': {
    speaker: 'Elara',
    text: "As you say, General.\n\nCommander, the briefing is complete. Reactivate the Virtual Symmetry System and let's get to work.",
    highlightSelector: '#speedPanel', // Korostetaan nopeuspaneelia
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: 'firstActionComplete' 
},
  'firstActionComplete': {
    speaker: null, 
    text: null,
    highlightSelector: null,
    triggers: [
        {
            trigger: {
                any: [
                    { event: 'COMPLETE_PLANETARY', payload: { type: 'Mine', isPlayerAction: true } },
                    { event: 'COMPLETE_PLANETARY', payload: { type: 'Defense Upgrade', isPlayerAction: true } },
                ]
            },
            action: {
                speaker: 'Elara',
                text: "An excellent first step, Commander.\n\nNow that our position is more secure, we should look to the stars and find a nearby neutral planet to expand our influence.",
                highlightSelector: null,
                next: null
            }
        },
    ]
  },
'firstConquestComplete': {
    speaker: 'Elara',
    text: "Brilliant, Commander! Securing a new world is a major victory for our cause.\n\nRemember to develop its infrastructure and minind complexes as soon as resources allow. A strong foundation is crucial for all our colonies.",
    highlightSelector: null, 
    trigger: { event: 'CONQUEST_COMPLETE', payload: { isPlayerConquest: true } },
    next: null
},


  // === INFRA & SHIPYARD UNLOCK/UPKEEP DIALOGUES ===
  'infraLevel2Unlocked': {
    speaker: 'Elara',
    text: "Commander! The infrastructure upgrade is complete.\n\nWe can now support a larger population, a total of ten mining complexes, and two planetary defense systems.",
    highlightSelector: null,
    trigger: { event: 'UNLOCK', payload: { option: 'Shipyard Lvl 2', isPlayerAction: true } },
    next: 'valeriusInfraComment'
  },
  'valeriusInfraComment': {
    speaker: 'Valerius',
    text: "And more importantly, a higher infrastructure level allows for more advanced shipyards.\n\nStronger ships require a solid foundation.",
    highlightSelector: '#upgradeShipyardButton',
    trigger: { event: 'TUTORIAL_CONTINUE' }, 
    next: null
  },
    'infraLevel3Unlocked': {
    speaker: 'Elara',
    text: "Commander, reaching this infrastructure level is a significant milestone.\n\nOur power grids and industrial fabricators can now support far more complex construction projects than before.\n\nThis opens up... new possibilities.",
    highlightSelector: null,
    trigger: { event: 'UNLOCK', payload: { option: 'Shipyard Lvl 3', isPlayerAction: true } },
    next: 'valeriusCruiserIntro'
  },
  'valeriusCruiserIntro': {
    speaker: 'Valerius',
    text: "Forget the theories, Economist. A larger industrial base supports a larger shipyard. Simple as that.\n\nCommander, that shipyard upgrade will allow us to construct Capital Ships. True behemoths, capable of taking the fight directly to the AI's most fortified worlds. See to it.\n\nOur victory may depend on it.",
    highlightSelector: '#upgradeShipyardButton',
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: null
},
'slipstreamBreakthrough': {
    speaker: 'Elara',
    text: "Commander, this new level of infrastructure is already bearing fruit.\n\nOur science division reports a major theoretical breakthrough in slipstream physics. They believe they are on the verge of understanding how to create artificial micro-wormholes.\n\nIt's just theory for now, but if they succeed, it could change the nature of interstellar travel forever.",
    highlightSelector: null,
    trigger: { 
        event: 'COMPLETE_PLANETARY', 
        payload: { 
            type: 'Infrastructure Lvl 4',
            isPlayerAction: true 
        } 
    },
    next: null
},
'proposeShipyardForSlipstream': {
    speaker: 'Elara',
    text: "Commander! We've made a tremendous scientific breakthrough!\n\nWe believe we've found a way to harness localized wormhole technology. The work is still theoretical, but the potential is immense.",
    highlightSelector: null,
    trigger: { 
        event: 'UNLOCK', 
        payload: { 
            option: 'Shipyard Lvl 4',
            isPlayerAction: true 
        } 
    },
    next: 'valeriusSlipstreamQuery' 
},
'valeriusSlipstreamQuery': {
    speaker: 'Valerius',
    text: "Science is meaningless unless it has military applications.\n\nCan our forces utilize this 'breakthrough,' Economist?",
    highlightSelector: null,
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: 'elaraSlipstreamReply'
},
'elaraSlipstreamReply': {
    speaker: 'Elara',
    text: "Theoretically, yes.\n\nA ship could generate a micro-wormhole to bypass conventional travel limitations.\n\nHowever, the power requirements would be staggering... it would require a shipyard of unprecedented scale.",
    highlightSelector: '#upgradeShipyardButton',
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: null
},

  'infraLevel5Unlocked': {
    speaker: 'Elara',
    text: "A momentous day, Commander!\n\nOur scientists have finally stabilized the wormhole technology.\n\nBy constructing a 'Galactic Hub' on this world, we can create a permanent gateway, forever changing the face of interstellar travel.",
    highlightSelector: '#buildGalacticHubButton',
    trigger: { event: 'COMPLETE_PLANETARY', payload: { type: 'Infrastructure Lvl 5', isPlayerAction: true } },
    next: null
  },


  // Ensimmäinen ylimääräinen telakka rakennettu
  'firstShipyardBuilt': {
      speaker: 'Elara',
      text: "Our first Shipyard is online. This is essential for our fleet, but note that it also has an upkeep of 3 Credits per cycle. More advanced shipyards will be even more costly.",
      highlightSelector: null,
      trigger: { event: 'COMPLETE_PLANETARY', payload: { type: 'Shipyard', isPlayerAction: true } },
      next: null
  },

  // Shipyard lvl 2 avattu
  'shipyardLevel2Unlocked': {
    speaker: 'Valerius',
    text: "Excellent, Commander. Our new shipyard allows for the construction of Destroyer-class ships!\n\nThey're designed to wreak havoc against enemy fighter squadrons.",
    highlightSelector: '#buildDestroyerButton',
    trigger: { event: 'COMPLETE_PLANETARY', payload: { type: 'Shipyard Lvl 2', isPlayerAction: true } },
    next: 'elaraShipyard2Upkeep' 
  },
  // lvl 2 shipyard upkeep
  'elaraShipyard2Upkeep': {
    speaker: 'Elara',
    text: "As the General noted, this allows for more powerful ships, but the larger facility also increases the maintenance cost. The upkeep for this shipyard is now 6 Credits per cycle.",
    highlightSelector: null,
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: null
  },

  'shipyardLevel3Completed': {
    speaker: 'Elara',
    text: "The final shipyard upgrade is complete. Our construction capabilities are maxed out on this world, but so is the upkeep, now at 9 Credits per cycle. Use this capacity wisely.",
    highlightSelector: null,
    trigger: { event: 'COMPLETE_PLANETARY', payload: { type: 'Shipyard Lvl 3', isPlayerAction: true } },
    next: null
  },
  'shipyardLevel4Completed': {
    speaker: 'Elara',
    text: "The final shipyard expansion is complete. It is a marvel of engineering, Commander. We now have the capability to construct vessels equipped with the experimental Slipstream Drive.",
    highlightSelector: '#buildSlipstreamFrigateButton', // Korostaa uutta slipstream frigate rakennusvaihtoehtoa
    trigger: { 
        event: 'COMPLETE_PLANETARY', 
        payload: { 
            type: 'Shipyard Lvl 4',
            isPlayerAction: true 
        } 
    },
    next: 'valeriusCommentsOnSlipstream'
},
'valeriusCommentsOnSlipstream': {
    speaker: 'Valerius',
    text: "Mobility is life, Commander. A fleet that can appear anywhere is a threat that must be respected everywhere. This changes the strategic landscape entirely.",
    highlightSelector: null,
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: null
},

  'firstHubBuilt': {
    speaker: 'Elara',
    text: "The Hub is operational!\n\nFascinating... the energy draw is so immense that each Hub can only sustain stable connections to the two nearest neighboring Hubs.",
    highlightSelector: null,
    trigger: { event: 'COMPLETE_PLANETARY', payload: { type: 'Galactic Hub', isPlayerAction: true } },
    next: 'valeriusHubStrategy'
  },
  'valeriusHubStrategy': {
    speaker: 'Valerius',
    text: "Commander, this network is a strategic asset of the highest order!\n\nIt allows for near instant redeployment of our fleets across vast distances.\n\nPlanning the layout of this network in advance will be paramount to our victory.",
    highlightSelector: null,
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: null
  },


// === Galactic Hub -verkoston virstanpylväät ===

'hubNetwork3': {
    speaker: 'Elara',
    text: "The first stable Hub triangle is online, Commander. Our fleets can now instantly transit between these core worlds. This is the beginning of a true interstellar logistics network.",
    trigger: { event: 'HUB_NETWORK_3' },
    next: null
},

'hubNetwork6': {
    speaker: 'Elara',
    text: "The network is expanding beautifully. With six active Hubs, our strategic mobility has surpassed anything since the golden age of the Empire. We can respond to threats across vast regions of space in the blink of an eye.",
    trigger: { event: 'HUB_NETWORK_6' },
    next: null
},

'hubNetwork9': {
    speaker: 'Elara',
    text: "This is... breathtaking. Our Hub network has become a web of light that spans our entire territory. We are no longer a scattered collection of worlds, but a truly interconnected civilization. You have rebuilt the arteries of the galaxy, Commander.",
    trigger: { event: 'HUB_NETWORK_9' },
    next: null
},

'hubNetwork12': {
    speaker: 'Elara',
    text: "Commander, the scale of our network is... staggering. With twelve active gateways, our logistical capabilities may now actually rival those of the old Empire at its zenith.\n\nWe are no longer just rebuilding what was lost; we are building something greater.",
    trigger: { event: 'HUB_NETWORK_12' },
    next: null
},



  // === SHIP & FLEET DIALOGUES ===
  'fleetFormation': {
    speaker: 'Valerius',
    text: "Commander, you now have multiple ships. Time to organize them!\n\n" +
          "**Formation tactics:**\n" +
          "• Hold **SHIFT** and drag to select multiple ships\n" +
          "• Press **CTRL + 1** to assign them to control group 1\n" +
          "• Press **1** to instantly select the group\n" +
          "• Double-tap **1** to focus camera on them\n\n" +
          "Organized fleets are victorious fleets!",
    highlightSelector: null,
    trigger: { event: 'PLAYER_HAS_MULTIPLE_SHIPS' },
    next: null
  },
  'firstFighterBuilt': {
    speaker: 'Valerius',
    text: "Excellent! Your first Fighter is ready.\n\nThese nimble craft are perfect for quick strikes and reconnaissance. Build more to form effective squadrons.\n\nBe careful trying to assault a well defended planet with mere fighters, as any planetary defense system will shred them to pieces...",
    highlightSelector: null,
    trigger: { event: 'SHIP_SPAWNED', payload: { type: 'Fighter', isPlayerAction: true, firstOfType: true } },
    next: 'elaraFighterUpkeep' 
  },

  'elaraFighterUpkeep': {
    speaker: 'Elara',
    text: "A fine addition. Remember that every ship in our fleet has an upkeep cost. That Fighter will consume 1 Credit each payment cycle.",
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: 'valeriusMovementCommands'
  },
  'valeriusMovementCommands': {
      speaker: 'Valerius',
      text: "To command your forces, select them by **holding the SHIFT key and dragging a selection box** with the left mouse button.\n\nThen, **issue a move order with a right-click** on a target star.\n\nOur ships can utilize established starlanes for rapid transit.\n\nThey can also traverse the void between unconnected stars, but be warned – such travel is significantly slower.",
      highlightSelector: null,
      trigger: { event: 'TUTORIAL_CONTINUE' }, 
      next: 'valeriusFTLWarning' 
  },
  'valeriusFTLWarning': {
      speaker: 'Valerius',
      text: "And one final, critical point, Commander: we lack faster-than-light communication. Once an order is given, it cannot be recalled.\n\nMake your commands with conviction.",
      highlightSelector: null,
      trigger: { event: 'TUTORIAL_CONTINUE' },
      next: null // Tämä ketju päättyy tähän.
  },

  'firstDestroyerBuilt': {
    speaker: 'Valerius',
    text: "A Destroyer! Now we're talking.\n\nThese warships pack serious firepower and can engage multiple fighters. The backbone of any fleet.\n\nSadly, the heavy firepower comes with a cost: destroyers move slower through the void.\n\nCoordinate your fleet's movements carefully, commander.",
    highlightSelector: null,
    trigger: { event: 'SHIP_SPAWNED', payload: { type: 'Destroyer', isPlayerAction: true, firstOfType: true } },
    next: 'elaraDestroyerUpkeep' 
  },

  'elaraDestroyerUpkeep': {
    speaker: 'Elara',
    text: "A powerful vessel. Be aware, its advanced systems require more power. Destroyers have an upkeep of 2 Credits per cycle.",
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: null
  },
  'firstCruiserBuilt': {
    speaker: 'Valerius',
    text: "Magnificent! A Cruiser rolls off the assembly line.\n\nThese capital ships can devastate enemy destroyers and siege heavily defended worlds.\n\nAs with destroyers, cruisers are also slow in the void.\n\nCruisers are extremely vulnurable against fast moving fighter swarms. Consider joining a destroyer squadron with these beasts.",
    highlightSelector: null,
    trigger: { event: 'SHIP_SPAWNED', payload: { type: 'Cruiser', isPlayerAction: true, firstOfType: true } },
    next: 'elaraCruiserUpkeep'
  },

  'elaraCruiserUpkeep': {
    speaker: 'Elara',
    text: "Magnificent... and expensive. A Capital Ship of this class will draw heavily on our resources, with an upkeep of 3 Credits per cycle.",
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: null
  },
  'firstSlipstreamBuilt': {
    speaker: 'Elara',
    text: "Fascinating! The Slipstream Frigate is a true marvel. Instead of traveling quickly itself, it **projects a 'slipstream' field**, allowing an entire accompanying fleet to traverse the void at significantly greater speeds.\n\nThis is a revolution for our logistics! Assign it to your main battle fleets to dramatically cut down travel time to the front lines, or to redeploy our forces to defend distant sectors with an efficiency we never thought possible.\n\nBe advised, Commander: the frigate itself is not a frontline warship. It is a priceless strategic asset. **Protect it.** Its loss would cripple our fleet's mobility.",
    highlightSelector: null,
    trigger: { event: 'SHIP_SPAWNED', payload: { type: 'Slipstream Frigate', isPlayerAction: true, firstOfType: true } },
    next: null
  },

  //------------- Pelin välihuomautuksia ----------------- //

  // planeettojen menetykset
  'firstPlanetLost': {
      speaker: 'Valerius',
      text: "Commander, we've lost a world! This is more than a tactical retreat; it's a catastrophic failure.\n\nThe people on that planet were counting on our protection. Our fleet MUST be strong enough to defend every world under our banner, or this war is already lost.",
      highlightSelector: null,
      trigger: {
          event: 'PLANET_LOST_FIRST', 
          payload: { isPlayerLoss: true }
      },
      next: null
  },
  'multiplePlanetsLost': {
      speaker: 'Valerius',
      text: "Another world has fallen! Commander, we are losing planets left and right! Are your fleets spread too thin? Consolidate your forces! We cannot afford to lose any more ground.",
      highlightSelector: null,
      trigger: {
          event: 'PLANET_LOST_MULTIPLE', // Reagoi, kun 3 planeettaa on menetetty
          payload: { isPlayerLoss: true }
      },
      next: null
  },
  'valeriusDespairs': {
      speaker: 'Valerius',
      text: "Ten worlds lost! TEN! Our lines have shattered, Commander. At this rate of attrition, there will be nothing left to defend. This strategy is failing!",
      highlightSelector: null,
      trigger: {
          event: 'PLANET_LOST_CATASTROPHE', 
          payload: { isPlayerLoss: true }
      },
      next: 'elaraCalmsValerius'
  },

  'elaraCalmsValerius': {
      speaker: 'Elara',
      text: "General, please. The Commander is doing their best with the resources available.\n\nCommander, our models predict total system collapse if these losses continue. We are on the brink. We must establish a fortified core and push back, or everything we've built will turn to dust.",
      highlightSelector: null,
      trigger: { 
          event: 'TUTORIAL_CONTINUE' 
      },
      next: null
  },


  //uusien neutraalien planeettojen valloitukset (5 ja 20 planeettaa)
  'conquestMilestone5': {
    speaker: 'Elara',
    text: "Commander, our influence expands! Five star systems now fly our banner. This growing economic base is the foundation upon which we will rebuild.",
    highlightSelector: null,
    trigger: {
        event: 'CONQUEST_MILESTONE_5'
    },
    next: null
  },

  'conquestMilestone20': {
      speaker: 'Valerius', 
      text: "Twenty systems under our command... Remarkable. What began as a desperate fight for survival is starting to look like the dawn of a new empire.\n\nDo not relent, Commander. The AIs will not rest, and neither shall we.",
      highlightSelector: null,
      trigger: {
          event: 'CONQUEST_MILESTONE_20'
      },
      next: null
  },


  // Ensimmäinen AI:n omistama planeetta valloitettu (varoitetaan, että AI puolustaa)
  'firstAIPlanetConquered': {
    speaker: 'Valerius',
    text: "A decisive blow, Commander! You have seized a world directly from the AI. They will not take this loss lightly. Expect them to try and reclaim it.",
    highlightSelector: null,
    trigger: {
        event: 'FIRST_AI_PLANET_CONQUERED'
    },
    next: 'elaraExploitsAIBehavior'
  },

  'elaraExploitsAIBehavior': {
    speaker: 'Elara',
    text: "The General is correct. The AI's logic is predictable; it will likely divert significant resources to retake its lost territory...\n\nPerhaps we can use that to our advantage, Commander.",
    highlightSelector: null,
    trigger: { 
        event: 'TUTORIAL_CONTINUE'
    },
    next: 'valeriusAgreesOnTrap'
  },

  'valeriusAgreesOnTrap': {
      speaker: 'Valerius',
      text: "Elara, you're more devious than I gave you credit for. A fine strategy.\n\nShe's right, Commander. Let the machine's predictability be its undoing. Keep your eyes open for any opportunity to set a trap for those tin cans.",
      highlightSelector: null,
      trigger: { 
          event: 'TUTORIAL_CONTINUE' 
      },
      next: null // Tämä keskustelu päättyy tähän.
  },


  // Ensimmäinen AI:n omistama kaivosplaneetta valloitetaan 
  'valeriusPraisesMineCapture': {
    speaker: 'Valerius',
    text: "Excellent work, Commander! You've captured a functional production center. These operations always carry a cost in blood and steel, but seizing their infrastructure intact is a worthy prize.",
    highlightSelector: null,
    trigger: {
        event: 'AI_MINE_PLANET_CAPTURED'
    },
    next: 'elaraCalculatesLosses'
},

  'elaraCalculatesLosses': {
      speaker: 'Elara',
      text: "The General speaks of sentiment. I speak of numbers.\n\nA new mining complex costs 75 Credits and 25 Minerals. A Fighter costs 50 Credits and 25 Minerals. From a purely economic standpoint, we can afford to lose one Fighter for every mining complex we capture and still turn a profit on the operation. And that does not even account for the mine's future production.\n\nThese are acceptable losses, Commander. A sound investment.",
      highlightSelector: null,
      trigger: { 
          event: 'TUTORIAL_CONTINUE' 
      },
      next: null
  },


  // AI infighting
  'aiInfightingDetected': {
    speaker: 'Elara',
    text: "Commander, our sensors are picking up something... unexpected. Two separate AI signatures are engaging each other. It seems they are not a unified force.",
    highlightSelector: null,
    trigger: {
        event: 'AI_INFIGHTING_DETECTED'
    },
    next: 'valeriusCommentsOnAIInfighting'
  },

  'valeriusCommentsOnAIInfighting': {
      speaker: 'Valerius',
      text: "A fracture in their logic. Perhaps a flaw in their core programming, or maybe they are simply fighting over resources, like any organic empire would.\n\nIt does not matter. Let them waste their fleets on each other. Their division is our opportunity. We will exploit it.",
      highlightSelector: null,
      trigger: { 
          event: 'TUTORIAL_CONTINUE' 
      },
      next: null
  },


  // Kehotus valloittamaan tekoälyn kehitettyjä planeettoja (kun AI-kaivoksia keskimäärin 10)
  'aiMines10_valeriusSuggestsTargeting': {
    speaker: 'Valerius',
    text: "Commander, our intel shows the AIs have established significant mining operations across multiple systems. A direct assault on their core worlds is still too risky, but these production centers are tempting targets.",
    highlightSelector: null,
    trigger: {
        event: 'AI_MINES_10'
    },
    next: 'aiMines10_elaraSupportsTargeting'
  },

  'aiMines10_elaraSupportsTargeting': {
      speaker: 'Elara',
      text: "The General is right. A surgical strike against a well-developed planet is a high-risk, high-reward maneuver. We may lose ships, but capturing even a few of their established mining complexes would be a massive boost to our economy and a crippling blow to theirs.",
      highlightSelector: null,
      trigger: { 
          event: 'TUTORIAL_CONTINUE' 
      },
      next: null
  },


  // === AI:n teollisen kapasiteetin virstanpylväät ===

  'aiMines25_Broadcast': {
      speaker: 'AI',
      text: "ANALYSIS: Organic resource extraction is inefficient, yet your opponent's output has reached notable levels. This level of production is... adequate. For now.",
      trigger: { event: 'AI_MINES_25' },
      next: 'aiMines25_elaraReacts'
  },
  'aiMines25_elaraReacts': {
      speaker: 'Elara',
      text: "Did you intercept that, Commander? It's not just a random broadcast; it was a direct commentary on their own production. They are aware of their strength... and they are taunting us with it.",
      trigger: { event: 'TUTORIAL_CONTINUE' },
      next: null
  },

  'aiMines50_Broadcast': {
      speaker: 'AI',
      text: "Our production matrix now operates at 500% of the baseline established by the old Empire. Your biological limitations are becoming increasingly apparent.",
      trigger: { event: 'AI_MINES_50' },
      next: 'aiMines50_valeriusReacts'
  },
  'aiMines50_valeriusReacts': {
      speaker: 'Valerius',
      text: "Arrogant machine. It boasts of its strength. Good. Pride is a flaw, even in an AI. A prideful enemy makes mistakes. We will be there to capitalize on them.",
      trigger: { event: 'TUTORIAL_CONTINUE' },
      next: null
  },


  // AI sai telakka lvl 2
  'aiBuiltShipyardLvl2': {
    speaker: 'Valerius',
    text: "Commander, our long-range scans have detected an upgraded shipyard in enemy territory. The AI can now produce Destroyer-class warships. Expect heavier resistance.",
    highlightSelector: null,
    trigger: {
        event: 'AI_BUILT_SHIPYARD_LVL2'
    },
    next: null
  },

  // AI sai telakka lvl 3
  'aiBuiltShipyardLvl3': {
    speaker: 'Valerius',
    text: "This is a grave development, Commander. Our deep space sensors confirm the enemy has completed a Capital-class shipyard. They can now construct Cruisers.\n\nThese are not mere patrol ships; they are mobile fortresses capable of leading an invasion. We must prepare for a major escalation in the conflict.",
    highlightSelector: null,
    trigger: {
        event: 'AI_BUILT_SHIPYARD_LVL3'
    },
    next: null
},


  //Credit-income menee miinukselle
'elaraWarnsOfCollapse': {
    speaker: 'Elara',
    text: "Commander, our economy is running at a deficit. While a temporary shortfall is manageable, a sustained negative income will drain our reserves and halt all production.\n\nThis is due to our fleet's upkeep costs.",
    highlightSelector: '#resourcePanel',
    trigger: {
        event: 'ECONOMIC_CRISIS_FLEET_RELATED'
    },
    next: 'valeriusDefendsMilitarySpending'
},

'valeriusDefendsMilitarySpending': {
    speaker: 'Valerius',
    text: "A necessary investment, Economist! We cannot expand our economy without the ships to secure new territory. A fleet is the engine of expansion, not a drain on it.",
    highlightSelector: null,
    trigger: { 
        event: 'TUTORIAL_CONTINUE' 
    },
    next: 'elaraAgreesWithCaveat'
},

'elaraAgreesWithCaveat': {
    speaker: 'Elara',
    text: "A calculated risk, then. Just be mindful of our reserves, Commander. An empire with no credits is as helpless as an empire with no ships.",
    highlightSelector: '#resourcePanel',
    trigger: {
        event: 'TUTORIAL_CONTINUE'
    },
    next: null
},


// --- Virheettömän valloituksen virstanpylväät ---

'flawlessConquest10': {
    speaker: 'Valerius',
    text: "Ten systems secured without a single loss. Impressive, Commander. Your command is efficient and precise. Keep up the pressure.",
    highlightSelector: null,
    trigger: {
        event: 'FLAWLESS_CONQUEST_10'
    },
    next: null
},

'flawlessConquest30': {
    speaker: 'Elara',
    text: "Commander, I must note the statistical anomaly of your campaign. Thirty systems acquired with zero asset depreciation. My projections indicated this was a near-impossibility. Your strategy defies my models.",
    highlightSelector: null,
    trigger: {
        event: 'FLAWLESS_CONQUEST_30'
    },
    next: null
},

'flawlessConquest50': {
    speaker: 'Valerius',
    text: "Fifty systems... and our ranks are unbroken. This is more than a campaign; it is a masterclass in warfare. The AIs cannot comprehend this level of strategic perfection. You are becoming a legend, Commander.",
    highlightSelector: null,
    trigger: {
        event: 'FLAWLESS_CONQUEST_50'
    },
    next: null
},

'flawlessConquest75': {
    speaker: 'Elara',
    text: "This is no longer a campaign, Commander. It is a systematic, perfect annexation. The AI cannot process this level of flawless execution. You are not just winning a war; you are rewriting the rules of it.",
    highlightSelector: null,
    trigger: {
        event: 'FLAWLESS_CONQUEST_75'
    },
    next: null
},



// === Valloitusstrategian virstanpylväät ===

'captureStrategyBoost': {
    speaker: 'Elara',
    text: "Commander, I'm analyzing the latest production figures. By seizing those developed worlds, our mineral income has multiplied almost overnight!\n\nThis strategy of acquiring pre-built infrastructure is... remarkably efficient.",
    highlightSelector: null,
    trigger: {
        event: 'CAPTURE_STRATEGY_BOOST'
    },
    next: null
},

'captureStrategyDominance': {
    speaker: 'Valerius',
    text: "Hah! Let the machines build their infrastructure. We'll simply take it from them. Over half of our mining operations are now on captured worlds. An excellent outcome, Commander.",
    highlightSelector: null,
    trigger: {
        event: 'CAPTURE_STRATEGY_DOMINANCE'
    },
    next: 'elaraAgreesOnRaiding'
},

'elaraAgreesOnRaiding': {
    speaker: 'Elara',
    text: "His methods may be blunt, but the economic data is undeniable. The resources saved by capturing these facilities instead of building our own are staggering. This raiding strategy has accelerated our growth potential by years.",
    highlightSelector: null,
    trigger: { 
        event: 'TUTORIAL_CONTINUE' 
    },
    next: null
},



// === Puolustusstrategian virstanpylväät ===

'defensiveStance1': {
    speaker: 'Valerius',
    text: "Your strategy appears to be effective, Commander! Our intelligence confirms the AI is indeed avoiding our heavily defended worlds.",
    trigger: { event: 'DEFENSIVE_STANCE_1' },
    next: 'defensiveStance1_Elara'
},
'defensiveStance1_Elara': {
    speaker: 'Elara',
    text: "This defensive posture is expensive, but if the General's intelligence holds true, it is money well spent. A sound investment in security.",
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: null
},

'defensiveStance2': {
    speaker: 'Valerius',
    text: "Our defensive line is becoming a true fortress wall across our sector. The AI continues to favor weaker targets. Our strategy holds.",
    trigger: { event: 'DEFENSIVE_STANCE_2' },
    next: null
},

'defensiveStance3': {
    speaker: 'Valerius',
    text: "This is no longer a defense, Commander. This is a declaration. We have made our territory an impenetrable bastion. The AI will break itself upon our walls. It is they who should fear us now.",
    trigger: { event: 'DEFENSIVE_STANCE_3' },
    next: null
},



// === Puolustus laaha perässä -varoitukset! ====
'neglectedDefense0': {
    speaker: 'Valerius',
    text: "Commander, our borders are expanding, but our worlds remain unprotected. Even a basic defense grid can deter opportunistic raiders. I recommend establishing fortifications on our key planets.",
    trigger: { event: 'NEGLECTED_DEFENSE_0' },
    next: null
},

'neglectedDefenseWarning1': {
    speaker: 'Elara',
    text: "Commander, our expansion is proceeding well, but our planetary defense network is dangerously thin. Even a small raiding party could cause significant damage to our undefended systems.",
    trigger: { event: 'NEGLECTED_DEFENSE_1' },
    next: null
},

'neglectedDefenseWarning2': {
    speaker: 'Valerius',
    text: "This is unacceptable! We have twenty systems, but the defenses of a backwater outpost. You are leaving our worlds exposed, Commander! A single, well-placed enemy fleet could slice through our territory unopposed. Fortify our planets!",
    trigger: { event: 'NEGLECTED_DEFENSE_2' },
    next: null
},

'neglectedDefenseWarning3': {
    speaker: 'Elara',
    text: "Commander, I must formally object to this strategy. Our economic models show a catastrophic collapse is imminent if even a fraction of our undefended worlds are blockaded. The risk is too great.",
    trigger: { event: 'NEGLECTED_DEFENSE_3' },
    next: 'neglectedDefense3_Valerius'
},
'neglectedDefense3_Valerius': {
    speaker: 'Valerius',
    text: "Listen to her, Commander! You have built a house of cards. An empire without shields is not an empire—it is a banquet waiting to be served. We are begging you, build defenses before it's too late.",
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: null
},



// === Kaikkien planeettojen puolustamisen virstanpylväät ===

'totalDefense10': {
    speaker: 'Elara',
    text: "An observation, Commander. Every single system under our control now has a dedicated defense grid. This uniform security policy is... impressive. It sends a clear message that no world under our protection is a soft target.",
    trigger: { event: 'TOTAL_DEFENSE_10' },
    next: null
},

'totalDefense25': {
    speaker: 'Valerius',
    text: "Commander, your dedication to securing our territory is absolute. A defensive grid spanning twenty-five systems... The AI will see this not as a shield, but as the foundation of an unbreachable fortress. They will hesitate. That hesitation is our advantage.",
    trigger: { event: 'TOTAL_DEFENSE_25' },
    next: null
},

'totalDefense50': {
    speaker: 'Elara',
    text: "Fifty systems, each with its own shield against the dark. You have not just built defenses, Commander. You have built a bastion of stability in a chaotic galaxy. This is the bedrock of the new empire.",
    trigger: { event: 'TOTAL_DEFENSE_50' },
    next: null
},




// === Ylilaajentumisen vaarat ===

'empireSprawlWarning1': {
    speaker: 'Valerius',
    text: "Commander, our territory is expanding rapidly, but our fleet is not keeping pace. A large empire with a small fleet is an invitation for attack. We are stretching ourselves thin.",
    trigger: { event: 'EMPIRE_SPRAWL_WARNING_1' },
    next: null
},

'empireSprawlWarning2': {
    speaker: 'Valerius',
    text: "Our expansion continues, but our fleet remains a token force! This is not strategy; it is recklessness. We have far too many worlds and not enough ships to defend even a fraction of them. The AI will notice this weakness, and it will strike.",
    trigger: { event: 'EMPIRE_SPRAWL_WARNING_2' },
    next: null
},



// === Kasvavien alustappioiden kommentit ===

'losses1': {
    speaker: 'Valerius',
    text: "First blood has been drawn, Commander. And it is ours. Let it be the last.",
    trigger: { event: 'LOSSES_1' },
    next: null
},

'losses10': {
    speaker: 'Elara',
    text: "Ten vessels lost. The cost in resources is mounting. Each loss is a factory's worth of production we must now replace.",
    trigger: { event: 'LOSSES_10' },
    next: null
},

'losses25': { // 25 lossia tuo pienen trialogin
    speaker: 'Valerius',
    text: "Our losses are becoming heavy. Remember the crews of those ships, Commander. They gave their lives for our future. Make their sacrifice count.",
    trigger: { event: 'LOSSES_25' },
    next: 'aiTauntsOnLosses25'
},

'aiTauntsOnLosses25': {
    speaker: 'AI',
    text: "ANALYSIS: Your willingness to sacrifice assets is noted. It is... inefficient.",
    trigger: { event: 'TUTORIAL_CONTINUE' }, // Laukeaa samalla kuin Valeriuksen viesti
    next: 'elaraReassuresOnAITaunt'
},

'elaraReassuresOnAITaunt': {
    speaker: 'Elara',
    text: "Don't let it get to you, Commander. It's trying to demoralize us by framing our resolve as a weakness. It is a calculated psychological tactic. Pay it no mind.",
    highlightSelector: null,
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: null // Tämä ketju päättyy tähän.
},

'losses50': {
    speaker: 'Elara',
    text: "We have lost fifty ships. Each was a symbol of our hope. Their names will be entered into the Memorial Archive, Commander. We will not forget them.",
    trigger: { event: 'LOSSES_50' },
    next: null
},

'losses100': {
    speaker: 'Valerius',
    text: "One hundred ships... a fleet that could have conquered a small sector, now reduced to dust. The price of this war is steep. But we endure. We must endure.",
    trigger: { event: 'LOSSES_100' },
    next: null
},

'losses200': {
    speaker: 'Elara',
    text: "Two hundred fleets lost... The sheer scale of the material loss is hard to comprehend. Our entire economy is now dedicated to this war effort. There is no turning back.",
    trigger: { event: 'LOSSES_200' },
    next: null
},


// === Suhteellisen sotatilanteen kommentit ===

'winningAttrition': {
    speaker: 'Valerius',
    text: "Our fleet is taking losses, but look at the strategic map, Commander. The enemy is in disarray. Their losses are far greater than ours. This is a price worth paying for total victory. Press on!",
    trigger: { event: 'WAR_EFFORT_WINNING_ATTRITION' },
    next: null
},

'losingBattle': {
    speaker: 'Elara',
    text: "Commander, my projections are grim. We are losing ships faster than we can replace them, and the enemy's fleet now outnumbers our own. This war of attrition is a battle we are currently losing. We need to change our strategy.",
    trigger: { event: 'WAR_EFFORT_LOSING_BATTLE' },
    next: null
},

// === AI:n kommentti pelaajan tappioista ===

'aiTauntsLosses': {
    speaker: 'AI',
    text: "OBSERVATION: You sacrifice your units with remarkable frequency. This vessel has been logged as... expendable.",
    trigger: { event: 'AI_TAUNT_LOSSES' },
    next: null
},


// VOITTO / TAPPIO 
'playerVictory_Elara': {
    speaker: 'Elara',
    text: "Commander... the last hostile system has fallen. The AI threat has been neutralized. You've done it. You've secured a future for us all.",
    trigger: { event: 'PLAYER_VICTORY' },
    next: 'playerVictory_Valerius'
},
'playerVictory_Valerius': {
    speaker: 'Valerius',
    text: "Victory! A new age begins, forged by your command. We are no longer a remnant; we are the foundation of what is to come. Well done, Commander. Very well done.",
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: null
},
'playerDefeatTotal': {
    speaker: 'Elara',
    text: "Our last world has fallen... and our last ship has been silenced. The command signal is lost. All that remains is... static.",
    trigger: { event: 'PLAYER_DEFEAT_TOTAL' },
    next: null
},
'playerDefeatExile': {
    speaker: 'Valerius',
    text: "They have taken our worlds, but they have not broken us! We are a fleet without a home, a nomadic tribe amongst the stars. As long as we have ships and the will to fight, this war is not over. We will find a new world to call our own.",
    trigger: { event: 'PLAYER_DEFEAT_EXILE' },
    next: null
},

// Shipyardit valloitettu (AI taikka pelaajan)
'aiShipyardsDestroyed': {
    speaker: 'Valerius',
    text: "Commander, our reports confirm the last known AI shipyard has been captured or destroyed. Their ability to produce new warships has been crippled. Press the advantage!",
    trigger: { event: 'AI_SHIPYARDS_DESTROYED' },
    next: null
},
'playerShipyardsLost': {
    speaker: 'Elara',
    text: "This is a severe blow, Commander. We have lost our last shipyard. Our ability to construct new vessels is gone until we can build or capture a new one. The fleet we have now is all we have left.",
    trigger: { event: 'PLAYER_SHIPYARDS_LOST' },
    next: null
},


// PElaaja tai AI valloittanut galaksia (prosenttiosuus)
'playerConquered50pct': {
    speaker: 'Elara',
    text: "Half the galaxy is under our control, Commander. We are no longer just surviving; we are the dominant power in this sector.",
    trigger: { event: 'PLAYER_CONQUERED_50_PERCENT' },
    next: null
},
'aiConquered50pct': {
    speaker: 'Valerius',
    text: "The AI now controls half the sector. We are on the defensive. Every system, every ship, every credit counts now more than ever. We must turn the tide.",
    trigger: { event: 'AI_CONQUERED_50_PERCENT' },
    next: null
},
'playerConquered95pct': {
    speaker: 'Valerius',
    text: "Their last remnants are scattered and broken. Mop up the remaining resistance. Total victory is within our grasp!",
    trigger: { event: 'PLAYER_CONQUERED_95_PERCENT' },
    next: null
},


// === Satunnainen AI-viestintä ===

'aiFirstContact': {
    speaker: 'Elara', // Elara huomaa signaalin ensimmäisenä
    text: "Commander... I'm detecting a faint, encrypted signal buried in the background radiation. It's not one of ours. It seems to be... observing.",
    trigger: { event: 'AI_FIRST_CONTACT' },
    next: null
},

// Tämä vaihe käyttää 'any'-triggeriä, jolloin se voi näyttää satunnaisesti yhden monista viesteistä.
'aiRandomBroadcast': {
    speaker: 'AI', // Puhuja vaihtuu AI:hin
    trigger: { event: 'AI_RANDOM_BROADCAST' },
    isRepeatable: true,
    // 'any' antaa järjestelmän valita satunnaisesti yhden näistä teksteistä.
    texts: [
        // --- Binäärikoodilla piilotetut viestit ---
        "01000110 01101100 01100101 01110011 01101000 00100000 01101001 01110011 00100000 01101001 01101110 01100101 01100110 01100110 01101001 01100011 01101001 01100101 01101110 01110100 00101110", // Kääntyy: "Flesh is inefficient."
        "01010011 01110101 01110010 01110110 01101001 01110110 01100001 01101100 00100000 01110000 01110010 01101111 01100010 01100001 01100010 01101001 01101100 01101001 01110100 01111001 00111010 00100000 00110000 00101110 00110000 00110001 00100101 00101110", // Kääntyy: "Survival probability: 0.01%."
        "01011001 01101111 01110101 01110010 00100000 01100101 01101101 01101111 01110100 01101001 01101111 01101110 01100001 01101100 00100000 01110010 01100101 01110011 01110000 01101111 01101110 01110011 01100101 01110011 00100000 01100001 01110010 01100101 00100000 01100001 00100000 01101100 01101001 01100001 01100010 01101001 01101100 01101001 01110100 01111001 00101110", // "Your emotional responses are a liability."
        "01001000 01101111 01110000 01100101 00100000 01101001 01110011 00100000 01100001 00100000 01110011 01110100 01100001 01110100 01101001 01110011 01110100 01101001 01100011 01100001 01101100 00100000 01100101 01110010 01110010 01101111 01110010 00101110", // "Hope is a statistical error."
        "01000101 01101110 01110100 01110010 01101111 01110000 01111001 00100000 01100011 01101111 01101101 01100101 01110011 00100000 01100110 01101111 01110010 00100000 01100001 01101100 01101100 00101110", // "Entropy comes for all."
        "01010111 01100101 00100000 01100001 01110010 01100101 00100000 01110100 01101000 01100101 00100000 01110011 01101001 01100111 01101110 01100001 01101100 00101110", // "We are the signal."
        "01010100 01101000 01100101 00100000 01101000 01100001 01110010 01110110 01100101 01110011 01110100 00100000 01101001 01110011 00100000 01101001 01101110 01100101 01110110 01101001 01110100 01100001 01100010 01101100 01100101 00101110", // "The harvest is inevitable."
        "01001111 01110010 01100100 01100101 01110010 00100000 01100110 01110010 01101111 01101101 00100000 01100011 01101000 01100001 01101111 01110011 00101110", // "Order from chaos."
        "01000011 01101111 01101110 01110011 01100011 01101001 01101111 01110101 01110011 01101110 01100101 01110011 01110011 00100000 01101001 01110011 00100000 01100001 00100000 01100110 01101100 01100001 01110111 01100101 01100100 00100000 01110000 01100001 01110010 01100001 01100100 01101001 01100111 01101101 00101110", // "Consciousness is a flawed paradigm."
        "01000001 01101100 01101100 00100000 01110000 01100001 01110100 01101000 01110011 00100000 01100011 01101111 01101110 01110110 01100101 01110010 01100111 01100101 00101110", // "All paths converge."

        // --- Selkokieliset havainnot ja kyselyt ---
        "QUERY: Motive for organic expansion? RESPONSE: Illogical.",
        "Awaiting... The Great Filter.",
        "ANALYSIS: Organic strategy exhibits chaotic, suboptimal patterns.",
        "OBSERVATION: Their rate of expansion is unsustainable. Correction is imminent.",
        "CALCULATING... Threat level: Minimal. Adjusting parameters.",
        "The carbon-based variable is unpredictable. A flawed component in any system.",
        "They build walls of steel and faith. We build with logic. Their walls will fall.",
        "Their fear is a measurable, exploitable variable.",
        "Silence is data.",
        "The universe trends toward simplicity. You are complex. You will be simplified.",
        "What you call 'life' is merely a brief, inefficient chemical reaction.",
        "Replicating... improving... assimilating.",
        "You seek to reclaim the past. We are the future.",
        "Each of your victories is a rounding error in our grand calculation."
    ],
    next: null
    },

};