import * as THREE from 'three';

/* ============================================================
 * MagneticPhysics — Fisica Guidata (Approccio B, 3D Specs)
 *
 * Il risultato del dado è deciso A MONTE da GoblinDie.roll().
 * Il dado viene lanciato con forze reali; in fase di decelerazione
 * questo modulo applica una "coppia magnetica" invisibile che
 * guida dolcemente la faccia target verso l'alto (0, 1, 0).
 *
 * Trucco matematico: invece di scegliere un orientamento assoluto
 * (che forzerebbe anche lo yaw, con rotazioni brusche e innaturali),
 * calcoliamo ad ogni frame il QUATERNIONE DELTA più corto che porta
 * la normale-mondo della faccia target sull'asse up:
 *
 *   worldN  = q_current ⊗ localN
 *   q_delta = shortestArc(worldN → up)
 *   q_target = q_delta ⊗ q_current      (lo yaw resta libero!)
 *
 * Poi interpoliamo (Slerp) verso q_target: la correzione è sempre
 * la rotazione minima possibile → l'occhio la percepisce come un
 * naturale assestamento del dado, non come una calamita.
 * ============================================================ */

/** Normali locali delle 6 facce di una BoxGeometry Three.js,
 *  nell'ordine dei material index: +x, -x, +y, -y, +z, -z. */
export const FACE_NORMALS: readonly THREE.Vector3[] = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1)
];

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Calcola il quaternione target che porta la faccia `faceIndex`
 * verso l'alto con la rotazione minima rispetto a `current`.
 */
export function computeTargetQuaternion(
  current: THREE.Quaternion,
  faceIndex: number
): THREE.Quaternion {
  const localNormal = FACE_NORMALS[faceIndex];
  if (!localNormal) throw new Error(`faceIndex non valido: ${faceIndex}`);

  const worldNormal = localNormal.clone().applyQuaternion(current).normalize();
  const delta = new THREE.Quaternion().setFromUnitVectors(worldNormal, UP);
  return delta.multiply(current).normalize();
}

/** Coseno dell'angolo tra la normale-mondo della faccia target e up:
 *  1.0 = perfettamente allineata. */
export function faceAlignment(current: THREE.Quaternion, faceIndex: number): number {
  const localNormal = FACE_NORMALS[faceIndex];
  if (!localNormal) return -1;
  return localNormal.clone().applyQuaternion(current).dot(UP);
}

export interface MagneticConfig {
  /** Velocità (lineare+angolare) sotto cui parte la guida magnetica */
  activationSpeed: number;
  /** Fattore Slerp per frame (0-1): più alto = correzione più rapida */
  slerpFactor: number;
  /** Allineamento (dot) oltre il quale il dado è considerato fermo */
  settleThreshold: number;
  /** Smorzamento extra delle velocità durante la guida */
  brakeFactor: number;
}

export const DEFAULT_MAGNETIC: MagneticConfig = {
  activationSpeed: 4.0,
  slerpFactor: 0.12,
  settleThreshold: 0.9995,
  brakeFactor: 0.88
};

/**
 * Un passo di guida magnetica. Restituisce il nuovo quaternione
 * e se il dado può essere considerato assestato (snap finale).
 *
 * Il chiamante (DiceWorld) applica il risultato al body Cannon-es
 * e azzera le velocità quando `settled` diventa true.
 */
export function magneticStep(
  current: THREE.Quaternion,
  faceIndex: number,
  config: MagneticConfig = DEFAULT_MAGNETIC
): { rotation: THREE.Quaternion; settled: boolean } {
  const target = computeTargetQuaternion(current, faceIndex);
  const next = current.clone().slerp(target, config.slerpFactor).normalize();
  const settled = faceAlignment(next, faceIndex) >= config.settleThreshold;

  // Snap finale: elimina l'errore residuo (mai un dado in bilico)
  return { rotation: settled ? target : next, settled };
}
