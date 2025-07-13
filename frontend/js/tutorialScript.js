// frontend/tutorialScript.js
export const tutorialSteps = {
  'START': {
    speaker: 'Elara',
    text: "Systems online!\n\nWelcome, Commander. I am Elara, your advisor for economic and scientific matters.\n\nFirst, a strategic overview from General Valerius.",
    highlightSelector: null,
    trigger: { event: 'GAME_START' },
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
    text: "Now, with the temporal controls calibrated, it's time to establish a primary command link.\n\nFocus on our homeworld. Select it to bring its status onto your command display.",
    highlightSelector: null,
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: 'homeworldSelected'
  },
  'homeworldSelected': {
        speaker: 'Elara',
        text: "Excellent. This panel shows our current resources. As you can see, our economy is fragile.\n\nThe key to unlocking this world's full potential is its core Infrastructure. Each time we reinforce these planetary systems, we increase the capacity for both population and industrial complexes.\n\nI recommend we begin developing our homeworld immediately.",
        // Korostetaan nyt molempia: resurssipaneelia ja infra-nappia.
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
      next: 'elaraUpkeepWarning' // MUUTETTU
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
    next: 'firstActionComplete' // Jatkaa alkuperäiseen seuraavaan vaiheeseen
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
    // Korostus on poistettu, koska emme voi taata valikon olevan auki.
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
  // UUSI VAIHE TELAKAN YLLÄPIDOLLE
  'firstShipyardBuilt': {
      speaker: 'Elara',
      text: "Our first Shipyard is online. This is essential for our fleet, but note that it also has an upkeep of 3 Credits per cycle. More advanced shipyards will be even more costly.",
      highlightSelector: null,
      trigger: { event: 'COMPLETE_PLANETARY', payload: { type: 'Shipyard', isPlayerAction: true } },
      next: null
  },
  'shipyardLevel2Unlocked': {
    speaker: 'Valerius',
    text: "Excellent, Commander. Our new shipyard allows for the construction of Destroyer-class ships!\n\nThey're designed to wreak havoc against enemy fighter squadrons.",
    highlightSelector: '#buildDestroyerButton',
    trigger: { event: 'COMPLETE_PLANETARY', payload: { type: 'Shipyard Lvl 2', isPlayerAction: true } },
    next: 'elaraShipyard2Upkeep' // MUUTETTU
  },
  // UUSI VAIHE TELAKAN YLLÄPIDOLLE
  'elaraShipyard2Upkeep': {
    speaker: 'Elara',
    text: "As the General noted, this allows for more powerful ships, but the larger facility also increases the maintenance cost. The upkeep for this shipyard is now 6 Credits per cycle.",
    highlightSelector: null,
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: null
  },
  // UUSI VAIHE TELAKAN YLLÄPIDOLLE
  'shipyardLevel3Completed': {
    speaker: 'Elara',
    text: "The final shipyard upgrade is complete. Our construction capabilities are maxed out on this world, but so is the upkeep, now at 9 Credits per cycle. Use this capacity wisely.",
    highlightSelector: null,
    trigger: { event: 'COMPLETE_PLANETARY', payload: { type: 'Shipyard Lvl 3', isPlayerAction: true } },
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
    next: 'elaraFighterUpkeep' // MUUTETTU
  },
  // UUSI VAIHE ALUSTEN YLLÄPIDOLLE
  'elaraFighterUpkeep': {
    speaker: 'Elara',
    text: "A fine addition. Remember that every ship in our fleet has an upkeep cost. That Fighter will consume 1 Credit each payment cycle.",
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: 'valeriusMovementCommands'
  },
  'valeriusMovementCommands': {
    speaker: 'Valerius',
    text: "To command your forces, select them by **holding the SHIFT key and dragging a selection box** with the left mouse button.\n\nThen, **issue a move order with a right-click** on a target star.\n\nOur ships can utilize established starlanes for rapid transit.\n\nThey can also traverse the void between unconnected stars, but be warned – such travel is significantly slower.\n\nAnd remember, Commander: we lack faster-than-light communication. Once an order is given, it cannot be recalled.\n\nMake your commands with conviction.",
    highlightSelector: null,
    trigger: { event: 'TUTORIAL_CONTINUE' },
    next: null
  },
  'firstDestroyerBuilt': {
    speaker: 'Valerius',
    text: "A Destroyer! Now we're talking.\n\nThese warships pack serious firepower and can engage multiple fighters. The backbone of any fleet.\n\nSadly, the heavy firepower comes with a cost: destroyers move slower through the void.\n\nCoordinate your fleet's movements carefully, commander.",
    highlightSelector: null,
    trigger: { event: 'SHIP_SPAWNED', payload: { type: 'Destroyer', isPlayerAction: true, firstOfType: true } },
    next: 'elaraDestroyerUpkeep' // MUUTETTU
  },
  // UUSI VAIHE ALUSTEN YLLÄPIDOLLE
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
    next: 'elaraCruiserUpkeep' // MUUTETTU
  },
  // UUSI VAIHE ALUSTEN YLLÄPIDOLLE
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
  }
};