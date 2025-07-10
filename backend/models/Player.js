// models/Player.js - Pelaajadokumentin Mongoose-skeema
// =============================================================================
// TÄMÄ TIEDOSTO MÄÄRITTELEE `Player`-DOKUMENTIN RAKENTEEN MONGODB:SSÄ.
//
// ARKKITEHTUURINEN ROOLI:
// - **Pelaajan profiili:** Jokainen `Player`-dokumentti edustaa yhtä pelin
//   osallistujaa, olipa kyseessä sitten ihminen tai tekoäly.
// - **Kevyt ja nopea:** Skeema sisältää vain pelaajan perustiedot (nimi, väri),
//   suhteet (mihin peliin kuuluu) ja kevyttä tilastodataa.
// - **Ei raskasta dataa:** Raskaampi, jatkuvasti muuttuva data, kuten pelaajan
//   omistamien tähtien tai alusten tarkat tilat, ei sijaitse tässä. Sen sijaan
//   Star- ja Ship-kokoelmat viittaavat tähän Player-dokumenttiin `ownerId`-kentän
//   kautta. Tämä pitää pelaajadokumentin pienenä ja nopeasti haettavana.
// =============================================================================


const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

/* ------------------------------------------------------------------
 * Player - pienet, nopeasti luettavat tiedot
 *  - raskaampi reaaliaikainen data (ships & stars) talletetaan
 *    omiin kokoelmiinsa ja viittaa tänne/Gameen.
 * ---------------------------------------------------------------- */
const playerSchema = new Schema(
  {
    /* ────────────────────────────────────────────────────────────
     * SUHTEET (RELATIONS)
     * ────────────────────────────────────────────────────────── */

    /**
     * MITÄ: Viittaus `Game`-dokumenttiin, johon tämä pelaaja kuuluu.
     * MIKSI: Tämä on tärkein yksittäinen viittaus. Se sitoo pelaajan oikeaan
     * pelisessioon ja mahdollistaa kaikkien tiettyyn peliin kuuluvien
     * pelaajien tehokkaan hakemisen. `index: true` nopeuttaa näitä hakuja.
     */
    gameId : {
      type    : Types.ObjectId,
      ref     : 'Game',
      required: true,
      index   : true          // nopea haku pelin sisällä
    },


    /**
     * MITÄ: Viittaus yleiseen `User`-dokumenttiin (jos sellainen olisi olemassa).
     * MIKSI: (Tulevaisuuden laajennus) Jos peliin lisättäisiin pysyvä käyttäjien
     * tunnistautumisjärjestelmä (esim. rekisteröityminen ja kirjautuminen),
     * tämä kenttä linkittäisi pelin sisäisen pelaajan tähän käyttäjätiliin.
     * Tekoälypelaajilla tämä kenttä on `null`.
     */
    userId : {
      type : Types.ObjectId,
      ref  : 'User',
      default: null
    },

    /* ────────────────────────────────────────────────────────────
     * PERUSPROFIILI (BASIC PROFILE)
     * ────────────────────────────────────────────────────────── */
    name  : { type: String, required: true, trim: true },     // Pelaajan nimi, esim. "Player" tai "AI #1".
    color : { type: String, required: true },                 // Pelaajan väri heksadesimaalimuodossa, esim. "#007bff".
    isAI  : { type: Boolean, default: false },                // Lippu, joka kertoo, onko kyseessä tekoäly vai ihmispelaaja.


    /**
     * MITÄ: Tekoälyn käyttäytymistä ohjaavat asetukset.
     * MIKSI: Antaa mahdollisuuden säätää tekoälyn vaikeustasoa tai antaa sille
     * tietyn "persoonallisuuden" tai strategian siemenluvun avulla. Jätetään
     * ihmispelaajilta tyhjäksi.
     */
    aiConfig: {
      difficulty : { type: String, enum: ['easy','normal','hard','insane'], default: 'normal' },
      seed       : { type: Number, default: () => Math.floor(Math.random()*1e9) }
    },


    /* ────────────────────────────────────────────────────────────
     * TALOUS (ECONOMY)
     * ────────────────────────────────────────────────────────── */
    /**
     * MITÄ: Pelaajan resurssitilin reaaliaikainen tilanne.
     * MIKSI: Vaikka tämä data muuttuu usein, se pidetään tässä dokumentissa,
     * jotta GameManager voi helposti alustaa AIControllerin tai lähettää
     * koko resurssitilanteen clientille yhdellä kertaa. Tämä on kompromissi
     * puhtaan normalisoinnin ja käytännön suorituskyvyn välillä.
     */
    resources: {
      credits : { type: Number, default: 1000, min: 0 },
      minerals: { type: Number, default: 500,  min: 0 }
    },


    /* ────────────────────────────────────────────────────────────
     * PIKATILASTOT (QUICK STATS)
     * ────────────────────────────────────────────────────────── */
    /**
     * MITÄ: Yhteenvetotilastot pelaajan imperiumin koosta.
     * MIKSI: Nämä ovat denormalisoitua dataa. Sen sijaan, että laskettaisiin
     * joka kerta tietokannasta, kuinka monta tähteä pelaaja omistaa, GameManager
     * päivittää näitä arvoja säännöllisesti. Tämä mahdollistaa erittäin nopeat
     * haut esimerkiksi "top pelaajat" -listauksia varten ilman raskaita
     * aggregointikyselyitä.
     */
    stats: {
      mineCount   : { type: Number, default: 0 },       // Kaivosten kokonaismäärä.
      starCount   : { type: Number, default: 0 },       // Tähtien kokonaismäärä.
      shipCount   : { type: Number, default: 0 },       // Alusten kokonaismäärä.
      lastKnownFleetPower: { type: Number, default: 0 } // Arvioitu laivaston yhteenlaskettu voima.
    },


    /* ────────────────────────────────────────────────────────────
     * TAUSTAJÄRJESTELMÄN APUKENTÄT (BACK-END HELPERS)
     * ────────────────────────────────────────────────────────── */

    // Viittaus pelaajan kotiplaneettaan. Nopeuttaa tiettyjä pelin aloitukseen liittyviä toimintoja
    homeStarId : { type: Types.ObjectId, ref: 'Star', default: null },

    lastActive : { type: Date, default: Date.now }, // Viimeisin aktiivisuuden aikaleima, voidaan käyttää esim. "pelaaja paikalla" -indikaattorina.
    disconnected: { type: Boolean, default: false } // Lippu, joka kertoo, onko pelaajan yhteys katkennut.
  },
  {
    timestamps: true  // Lisää automaattisesti `createdAt` ja `updatedAt` -aikaleimat jokaiseen dokumenttiin.
  }
);


/* ------------------------------------------------------------------
 * INDEKSIT
 * ---------------------------------------------------------------- */
// MITÄ: Luo uniikin yhdistelmäindeksin.
// MIKSI: Varmistaa, että yhden pelin (`gameId`) sisällä ei voi olla kahta
// pelaajaa, joilla on sama `name`. Tämä estää duplikaatit ja ylläpitää
// datan eheyttä.
playerSchema.index({ gameId: 1, name: 1 }, { unique: true }); 


/* ------------------------------------------------------------------
 * VIRTUAALIKENTÄT & APUFUNKTIOT (VIRTUALS & HELPERS)
 * ---------------------------------------------------------------- */

/**
 * MITÄ: Luo virtuaalisen `isHuman`-kentän, jota ei tallenneta tietokantaan.
 * MIKSI: Tarjoaa kätevän ja luettavan tavan tarkistaa koodissa, onko pelaaja
 * ihminen. `player.isHuman` on selkeämpi kuin `!player.isAI`.
 */
playerSchema.virtual('isHuman').get(function () {
  return !this.isAI;
});


/**
 * MITÄ: Määrittelee, miten dokumentti muunnetaan JSON-muotoon.
 * MIKSI: Tämä siistii API-vastauksia. Se ottaa virtuaalikentät (kuten `isHuman`)
 * mukaan, mutta poistaa Mongoose-spesifiset kentät kuten `__v` (versionKey).
 * `transform`-funktiolla voidaan vielä hienosäätää lopputulosta.
 */
playerSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_, ret) => { delete ret._id; } // Esimerkki: poistaa `_id`-kentän ja jättää vain `id`:n.
});

module.exports = mongoose.model('Player', playerSchema);
