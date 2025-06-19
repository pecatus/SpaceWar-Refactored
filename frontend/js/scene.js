/* ========================================================================== */
/*  scene.js – koko Three-renderointi yhdessä tiedostossa                     */
/* ========================================================================== */

import * as THREE       from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* -------------------------------------------------------------------------- */
/*  YLEISET MATERIAALIT                                                       */
/* -------------------------------------------------------------------------- */
const MAT_STAR     = new THREE.MeshBasicMaterial({ color: 0xffe08a });
const MAT_HOME     = new THREE.MeshBasicMaterial({ color: 0x00ff82 });
const MAT_FIGHTER  = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
const MAT_OTHER    = new THREE.MeshBasicMaterial({ color: 0xbbbbbb });

/* -------------------------------------------------------------------------- */
/*  THREE–YDIN                                                                */
/* -------------------------------------------------------------------------- */
let scene, camera, renderer, controls;
let ready = false;                        // luotu jo?

export function initThreeIfNeeded (mountTo = document.body) {
  if (ready) return;                      // luo vain kerran
  ready = true;

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 6000);
  camera.position.set(0, 0, 900);

  renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  mountTo.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 1));

  /* responsive */
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/* -------------------------------------------------------------------------- */
/*  KARTTAA HELPOTTAVAT INDEX-MAPIT                                           */
/* -------------------------------------------------------------------------- */
const starsById = new Map();   // id → THREE.Mesh
const shipsById = new Map();   // id → THREE.Mesh

/* -------------------------------------------------------------------------- */
/*  SNAPSHOT → THREE-MAAILMA                                                  */
/* -------------------------------------------------------------------------- */
export function buildFromSnapshot (snap) {
  if (!snap) return;
  spawnStars(snap.stars ?? []);
  spawnShips(snap.ships ?? []);
}

/* -------------------------------------------------------------------------- */
/*  DIFFIEN KÄSITTELY                                                         */
/* -------------------------------------------------------------------------- */
export function applyDiff (diffArr = []) {
  diffArr.forEach(act => {
    switch (act.action) {

      /* ---------------- PLANETARY VALMIS ---------------- */
      case 'COMPLETE_PLANETARY': {
        const starMesh = starsById.get(act.starId);
        if (!starMesh) break;

        if (act.type === 'Mine') {
          // TODO: päivitä kaivos-UI
          starMesh.material.color.set(0xfff6c2);
        }

        if (act.type === 'Defense Upgrade') {
          // Demo-efekti: muuta väriä
          starMesh.material.color.set(0xff4444);
        }
        break;
      }

      /* ---------------- UUSI LAIVA ---------------------- */
      case 'SHIP_SPAWNED': {
        const st = starsById.get(act.starId);
        if (!st) break;
        spawnShips([{
          _id         : act.shipId,          // backend toimittaa
          type        : act.type,
          ownerId     : act.ownerId,
          parentStarId: act.starId,
          position    : st.position
        }]);
        break;
      }

      /* ---------------- LIIKUTA LAIVAA ------------------ */
      case 'MOVE_SHIP': {
        const sh = shipsById.get(act.shipId);
        if (!sh) break;
        sh.userData.targetStar = starsById.get(act.toStarId);
        sh.userData.state      = 'moving';
        updateShipSpeed(sh);                // toteuta oma logiikka
        break;
      }

      /* ------- lisää muita actioneita tarvittaessa ------ */
    }
  });
}

/* ========================================================================== */
/*  SISÄISET APUT:  spawnStars, spawnShips, …                                 */
/* ========================================================================== */

/* ----- tähdet ----- */
function spawnStars (starList) {
  const GEO_STAR = new THREE.SphereGeometry(5, 12, 12);
  const GEO_HOME = new THREE.SphereGeometry(9, 14, 14);

  starList.forEach(st => {
    if (starsById.has(st._id)) return;               // jo olemassa

    const geo = st.isHomeworld ? GEO_HOME : GEO_STAR;
    const mat = st.isHomeworld ? MAT_HOME.clone() : MAT_STAR.clone();

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(st.position.x, st.position.y, st.position.z);
    mesh.userData = { id: st._id, type: 'star' };

    scene.add(mesh);
    starsById.set(st._id, mesh);
  });
}

/* ----- laivat ----- */
function spawnShips (shipList) {
  const GEO_FIGHTER = new THREE.TetrahedronGeometry(4);
  const GEO_DEFAULT = new THREE.OctahedronGeometry(6);

  shipList.forEach(sh => {
    if (shipsById.has(sh._id)) return;

    const geo  = sh.type === 'Fighter' ? GEO_FIGHTER : GEO_DEFAULT;
    const mat  = MAT_FIGHTER.clone();
    const mesh = new THREE.Mesh(geo, mat);

    /* sijoitetaan pienen satunnaisen etäisyyden päähän emoplanetasta */
    const starMesh = starsById.get(sh.parentStarId);
    if (starMesh) {
      const jitter = THREE.MathUtils.randFloatSpread(20);
      mesh.position.copy(starMesh.position).addScalar(jitter);
    } else if (sh.position) {
      mesh.position.set(sh.position.x, sh.position.y, sh.position.z);
    }

    mesh.userData = { id: sh._id, type: 'ship', state: 'orbiting' };
    shipsById.set(sh._id, mesh);
    scene.add(mesh);
  });
}

/* ----- (placeholder) nopeuslogiikka ----- */
function updateShipSpeed (mesh) {
  // Toteuta sama logiikka kuin aiemmassa monoliittikoodissa
  // (starlanet → nopeampi speed jne.)
}

/* -------------------------------------------------------------------------- */
/*  RENDER-LOOP                                                               */
/* -------------------------------------------------------------------------- */
let animStarted = false;
export function animate () {
  if (animStarted) return;          // käynnistä kerran
  animStarted = true;

  function loop () {
    requestAnimationFrame(loop);
    if (controls) controls.update();
    renderer.render(scene, camera);
  }
  loop();
}
