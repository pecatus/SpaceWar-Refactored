// testSocket.js  – yksinkertainen komentorivi-asiakas
const { io } = require('socket.io-client');

// Muuta portti/URL jos server.js kuuntelee eri osoitteessa
const socket = io('http://localhost:3001', { transports: ['websocket'] });

const GAME_ID = '6853a9f6bba3d5b581c553a7';

socket.on('connect', () => {
//   console.log('✅  Yhteys avattu, id =', socket.id);

  // Kerro huone, jotta GameManager broadcastaa sinulle.
  // Jos sinulla ei vielä ole gameId:tä, voit testata ilman joinia
  // ja kuunnella vain 'hello'-viestin.
  socket.emit('join_game', { gameId: GAME_ID });

  // Voit myös lähettää testikomennon
  // socket.emit('player_action', { action: 'PING' });
});

socket.on('hello', (msg) => {
//   console.log('👋  Palvelin sanoi:', msg);
});

socket.on('game_diff', (diff) => {
//   console.log('📦  Game diff saatu:', diff);
});

socket.on('disconnect', (reason) => {
//   console.log('❌  Katkesi:', reason);
});