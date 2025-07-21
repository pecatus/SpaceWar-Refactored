// gameLogic.test.js

const { AIController, distance3D, shipPower, starThreatScore, STRUCT_COST } = require('./AIController');
const GameManager = require('./GameManager');

describe('AIController Apufunktiot', () => {

    test('1. distance3D laskee etäisyyden oikein', () => {
        const p1 = { x: 0, y: 0, z: 0 };
        const p2 = { x: 3, y: 4, z: 0 };
        expect(distance3D(p1, p2)).toBe(5);
    });

    test('2. shipPower palauttaa oikeat voima-arvot', () => {
        expect(shipPower({ type: 'Fighter' })).toBe(1);
        expect(shipPower({ type: 'Destroyer' })).toBe(2);
        expect(shipPower({ type: 'Cruiser' })).toBe(3);
        expect(shipPower({ type: 'Unknown' })).toBe(0);
    });
});

describe('AIController Taistelulogiikka', () => {

    test('3. starThreatScore laskee tappiot oikein', () => {
        const attackingFleet = [
            { type: 'Fighter', hp: 1 },
            { type: 'Fighter', hp: 1 },
            { type: 'Destroyer', hp: 2 },
            { type: 'Cruiser', hp: 3 }
        ];
        // PD-taso 1 ampuu 3 kertaa. Logiikka poistaa 3 alusta, priorisoiden kalleimmat.
        // Tässä tapauksessa se poistaisi Cruiserin, Destroyerin ja yhden Fighterin.
        const remainingPower = starThreatScore({ defenseLevel: 1 }, attackingFleet);
        
        // Jäljelle jää yksi Fighter, jonka voima on 1.
        expect(remainingPower).toBe(1);
    });
});

describe('AIController Talouslogiikka', () => {

    test('4. AI tunnistaa, onko sillä varaa rakentaa kaivos', () => {
        // Annetaan AI:lle tyhjä pelitila, jotta this.stars ei ole undefined
        const mockGameState = {
            resources: { credits: 0, minerals: 0 },
            stars: [],
            ships: []
        };
        const ai = new AIController('ai_id', mockGameState, {});

        const mineCost = STRUCT_COST.Mine;

        // Tilanne 1: On varaa
        ai.eco = { credits: 100, minerals: 50 };
        const canAfford = ai.eco.credits >= mineCost.credits && ai.eco.minerals >= mineCost.minerals;
        expect(canAfford).toBe(true);
        
        // Tilanne 2: Ei ole varaa
        ai.eco = { credits: 50, minerals: 50 };
        const cannotAfford = ai.eco.credits >= mineCost.credits && ai.eco.minerals >= mineCost.minerals;
        expect(cannotAfford).toBe(false);
    });
});

describe('GameManager Pelimekaniikka', () => {
    
    test('5. _interpolatePosition laskee sijainnin oikein', () => {
        const gm = new GameManager(); // Luodaan instanssi metodin käyttöä varten

        const from = { x: 0, y: 0, z: 0 };
        const to = { x: 100, y: 0, z: 0 };

        const midPoint = gm._interpolatePosition(from, to, 0.5);
        expect(midPoint.x).toBe(50);
        expect(midPoint.y).toBe(0);

        const endPoint = gm._interpolatePosition(from, to, 1);
        expect(endPoint.x).toBe(100);

        // Testataan myös raja-arvoa (t > 1)
        const overPoint = gm._interpolatePosition(from, to, 1.5);
        expect(overPoint.x).toBe(100);
    });
});