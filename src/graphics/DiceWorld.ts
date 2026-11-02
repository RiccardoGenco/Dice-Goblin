import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GoblinDie } from '@core/GoblinDie';
import { DieFace, RNG, defaultRNG } from '@core/types';
import { DieTextureSet } from './TextureGenerator';
import { magneticStep, DEFAULT_MAGNETIC, MagneticConfig } from './MagneticPhysics';

/* ============================================================
 * DiceWorld — Arena di lancio 3D (GDD §6.3, Piano Fase 4)
 *
 * Scena Three.js + mondo Cannon-es (pavimento + 4 pareti di
 * contenimento invisibili). I dadi vengono lanciati con forze
 * reali; il risultato è però già deciso dal BattleEngine: la
 * faccia estratta viene "recitata" tramite MagneticPhysics.
 *
 * PACING: gravità aumentata (~3g) e damping alto per chiudere
 * ogni lancio entro ~1.2s, come da specifica 3D.
 * ============================================================ */

const DIE_SIZE = 1;
const ARENA_HALF = 3.2; // semi-larghezza dell'arena: stretta, i dadi restano tra i due combattenti
/** Tempo massimo di un lancio prima del settle forzato (anti-softlock) */
const ROLL_TIMEOUT_MS = 4000;
/** Altezza del punto mirato dalla camera: più alto = arena più in basso */
const CAMERA_TARGET_Y = 2.6;

interface ActiveDie {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  textures: DieTextureSet;
  /** Indice (0-5) della faccia BoxGeometry che deve finire in alto */
  targetFaceIndex: number;
  settled: boolean;
  /** posizione del dado nel lancio (stesso indice di faces/sources) */
  index: number;
}

export class DiceWorld {
  public readonly scene = new THREE.Scene();
  public readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly world: CANNON.World;
  private active: ActiveDie[] = [];
  private resolveRoll: (() => void) | null = null;
  private rafId: number | null = null;
  private readonly clock = new THREE.Clock();

  constructor(
    canvas: HTMLCanvasElement,
    private readonly magneticConfig: MagneticConfig = DEFAULT_MAGNETIC,
    private readonly rng: RNG = defaultRNG
  ) {
    // --- Rendering
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    // Ombre morbide: i dadi "poggiano" sul pavimento del palco 2D sotto
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(
      45,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 9, 7);
    // Il punto mirato sta sopra l'arena: i dadi cadono nella parte bassa
    // dell'inquadratura, sul pavimento del palco
    this.camera.lookAt(0, CAMERA_TARGET_Y, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(4, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
    this.scene.add(key);

    // Pavimento visivo
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
      // Pavimento trasparente: si vede solo l'ombra dei dadi sul palco
      new THREE.ShadowMaterial({ opacity: 0.45 })
    );
    floor.receiveShadow = true;
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // --- Fisica: gravità triplicata per un pacing rapido (~1.2s)
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -29.4, 0) });

    const groundMat = new CANNON.Material('ground');
    const ground = new CANNON.Body({ type: CANNON.Body.STATIC, material: groundMat });
    ground.addShape(new CANNON.Plane());
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(ground);

    // 4 pareti invisibili: nessun dado può uscire dall'area visiva
    const wallDefs: Array<[number, number, number, number]> = [
      [ARENA_HALF, 0, 0, -Math.PI / 2], // +x, normale verso -x
      [-ARENA_HALF, 0, 0, Math.PI / 2],
      [0, 0, ARENA_HALF, Math.PI],      // +z, normale verso -z
      [0, 0, -ARENA_HALF, 0]
    ];
    for (const [x, y, z, yRot] of wallDefs) {
      const wall = new CANNON.Body({ type: CANNON.Body.STATIC });
      wall.addShape(new CANNON.Plane());
      wall.position.set(x, y, z);
      wall.quaternion.setFromEuler(0, yRot, 0);
      this.world.addBody(wall);
    }

    this.animate();
  }

  /**
   * Lancia i dadi con i risultati GIÀ estratti dal BattleEngine.
   * Restituisce una Promise risolta quando tutti i dadi sono
   * assestati: è il resolver perfetto per il Visual Blocking
   * Callback di `onDicesRolled` (GDD §5.2).
   */
  /** `keep`: indici dei dadi da lasciare fermi dov'erano (rilancio parziale) */
  public throwDice(dice: GoblinDie[], results: DieFace[], keep?: ReadonlySet<number>): Promise<void> {
    if (keep) this.clearDice(d => !keep.has(d.index));
    else this.clearDice();

    dice.forEach((die, i) => {
      const face = results[i];
      if (!face) return;
      if (keep?.has(i) && this.active.some(a => a.index === i)) return;

      // La faccia target è l'indice della faccia estratta nel dado logico
      const targetFaceIndex = Math.max(0, die.faces.indexOf(face)) % 6;

      const textures = new DieTextureSet(die);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE),
        textures.materials
      );
      mesh.castShadow = true;
      this.scene.add(mesh);

      // Corpo rigido con spawn sfalsato: niente sovrapposizioni
      const body = new CANNON.Body({
        mass: 1,
        shape: new CANNON.Box(new CANNON.Vec3(DIE_SIZE / 2, DIE_SIZE / 2, DIE_SIZE / 2)),
        position: new CANNON.Vec3(
          -2.6 + (i % 5) * 1.3 + this.rng.next() * 0.4,
          4 + Math.floor(i / 5) * 1.5,
          -1.8 + this.rng.next() * 1.4
        ),
        // Damping alto: i dadi si fermano rapidamente (pacing)
        linearDamping: 0.25,
        angularDamping: 0.25
      });
      body.velocity.set(2 + this.rng.next() * 3, -2, 2 + this.rng.next() * 2);
      body.angularVelocity.set(
        (this.rng.next() - 0.5) * 20,
        (this.rng.next() - 0.5) * 20,
        (this.rng.next() - 0.5) * 20
      );
      this.world.addBody(body);

      this.active.push({ mesh, body, textures, targetFaceIndex, settled: false, index: i });
    });

    // Rete di sicurezza anti-softlock: se la fisica non si assesta entro il
    // tempo massimo, i dadi vengono forzati nella posa finale e il
    // Visual Blocking Callback si sblocca comunque.
    return new Promise(resolve => {
      const timer = setTimeout(() => this.forceSettle(), ROLL_TIMEOUT_MS);
      this.resolveRoll = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private forceSettle(): void {
    for (const die of this.active) {
      if (die.settled) continue;
      const { rotation } = magneticStep(
        new THREE.Quaternion(
          die.body.quaternion.x, die.body.quaternion.y,
          die.body.quaternion.z, die.body.quaternion.w
        ),
        die.targetFaceIndex,
        { ...this.magneticConfig, slerpFactor: 1, settleThreshold: 0 }
      );
      die.body.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      die.body.velocity.setZero();
      die.body.angularVelocity.setZero();
      die.body.type = CANNON.Body.STATIC;
      die.settled = true;
    }
    const resolve = this.resolveRoll;
    this.resolveRoll = null;
    resolve?.();
  }

  /** Ferma il loop di rendering e libera le risorse GPU. */
  public dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.clearDice();
    this.renderer.dispose();
  }

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    this.world.step(1 / 60, dt, 3);

    let allSettled = this.active.length > 0;

    for (const die of this.active) {
      if (!die.settled) {
        const speed =
          die.body.velocity.length() + die.body.angularVelocity.length();

        // Fase di decelerazione: si attiva la guida magnetica
        if (speed < this.magneticConfig.activationSpeed) {
          const current = new THREE.Quaternion(
            die.body.quaternion.x,
            die.body.quaternion.y,
            die.body.quaternion.z,
            die.body.quaternion.w
          );
          const { rotation, settled } = magneticStep(
            current,
            die.targetFaceIndex,
            this.magneticConfig
          );
          die.body.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

          // Freno artificiale: smorziamo le velocità residue
          die.body.velocity.scale(this.magneticConfig.brakeFactor, die.body.velocity);
          die.body.angularVelocity.scale(
            this.magneticConfig.brakeFactor,
            die.body.angularVelocity
          );

          if (settled) {
            die.settled = true;
            die.body.angularVelocity.setZero();
            die.body.velocity.setZero();
            die.body.type = CANNON.Body.STATIC; // inchiodato: mai in bilico
          }
        }
      }

      die.mesh.position.copy(die.body.position as unknown as THREE.Vector3);
      die.mesh.quaternion.copy(die.body.quaternion as unknown as THREE.Quaternion);
      if (!die.settled) allSettled = false;
    }

    if (allSettled && this.resolveRoll) {
      const resolve = this.resolveRoll;
      this.resolveRoll = null;
      resolve(); // sblocca la Promise di throwDice -> il BattleEngine avanza
    }

    this.renderer.render(this.scene, this.camera);
  };

  private clearDice(shouldRemove: (d: ActiveDie) => boolean = () => true): void {
    const kept: ActiveDie[] = [];
    for (const die of this.active) {
      if (!shouldRemove(die)) { kept.push(die); continue; }
      this.scene.remove(die.mesh);
      die.mesh.geometry.dispose();
      die.textures.dispose(); // rilascio GPU esplicito
      this.world.removeBody(die.body);
    }
    this.active = kept;
  }

  public resize(width: number, height: number): void {
    const aspect = width / height;
    this.camera.aspect = aspect;
    // Palco stretto (telefono): la camera si allontana, i dadi restano piccoli
    // e non coprono i personaggi
    const k = Math.max(1, 1.6 / aspect);
    this.camera.position.set(0, 9 * k, 7 * k);
    this.camera.lookAt(0, CAMERA_TARGET_Y, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
