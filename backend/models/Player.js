const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

/* ------------------------------------------------------------------
 * Player – pienet, nopeasti luettavat tiedot
 *  – raskaampi reaaliaikainen data (ships & stars) talletetaan
 *    omiin kokoelmiinsa ja viittaa tänne/​Gameen.
 * ---------------------------------------------------------------- */
const playerSchema = new Schema(
  {
    /* ────────────────────────────────────────────────────────────
     *  RELATIONS
     * ────────────────────────────────────────────────────────── */
    gameId : {
      type    : Types.ObjectId,
      ref     : 'Game',
      required: true,
      index   : true          // nopea haku pelin sisällä
    },

    /* Jos käytät auth-järjestelmää (JWT / OAuth / tms.),
       pidä ref userId:hen – AI-pelaajilla tämä jää nulliksi.       */
    userId : {
      type : Types.ObjectId,
      ref  : 'User',
      default: null
    },

    /* ────────────────────────────────────────────────────────────
     *  BASIC PROFILE
     * ────────────────────────────────────────────────────────── */
    name  : { type: String, required: true, trim: true },
    color : { type: String, required: true },   // hex #RRGGBB

    isAI  : { type: Boolean, default: false },

    /* AI-konfiguraatio (taso, valmis strategiaprofiili jne.).
       Voidaan laajentaa vapaamuotoisesti – jätetään human-pelaajille tyhjäksi. */
    aiConfig: {
      difficulty : { type: String, enum: ['easy','normal','hard','insane'], default: 'normal' },
      seed       : { type: Number, default: () => Math.floor(Math.random()*1e9) }
    },

    /* ────────────────────────────────────────────────────────────
     *  ECONOMY (synkronoidaan jokaisella “resource tickillä”)
     *    –  nopea kurkistus lobby-näyttöön & API:in
     * ────────────────────────────────────────────────────────── */
    resources: {
      credits : { type: Number, default: 1000, min: 0 },
      minerals: { type: Number, default: 500,  min: 0 }
    },

    /* ────────────────────────────────────────────────────────────
     *  QUICK STATS  (lasketaan peli-silmukassa, ei kriittistä dataa)
     * ────────────────────────────────────────────────────────── */
    stats: {
      mineCount   : { type: Number, default: 0 },
      starCount   : { type: Number, default: 0 },
      shipCount   : { type: Number, default: 0 },
      lastKnownFleetPower: { type: Number, default: 0 } // tulituki-arvio
    },

    /* ────────────────────────────────────────────────────────────
     *  BACK-END HELPERS
     * ────────────────────────────────────────────────────────── */
    homeStarId : { type: Types.ObjectId, ref: 'Star', default: null },

    lastActive : { type: Date, default: Date.now }, // lobby “ping”
    disconnected: { type: Boolean, default: false }
  },
  {
    timestamps: true  // createdAt + updatedAt
  }
);

/* ------------------------------------------------------------------
 *  INDEXIT
 * ---------------------------------------------------------------- */
playerSchema.index({ gameId: 1, name: 1 }, { unique: true }); // uniikki nimi per peli

/* ------------------------------------------------------------------
 *  VIRTUALIT & HELPERIT
 * ---------------------------------------------------------------- */
// esimerkki: isHuman — voisi käyttää suoraan scheman kenttiäkin
playerSchema.virtual('isHuman').get(function () {
  return !this.isAI;
});

/* Kun dokumentti serialisoidaan JSONiksi (esim. REST-vastauksena),
   otetaan virtualit mukaan, muttei sisäisiä Mongo-kenttiä */
playerSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_, ret) => { delete ret._id; } // pidä id kauniina (jos haluat)
});

module.exports = mongoose.model('Player', playerSchema);
