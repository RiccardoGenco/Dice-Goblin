import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  FACE_NORMALS,
  computeTargetQuaternion,
  faceAlignment,
  magneticStep,
  DEFAULT_MAGNETIC
} from '../src/graphics/MagneticPhysics';

/** Quaternione casuale ma deterministico per i test */
function randomQuaternion(seed: number): THREE.Quaternion {
  const e = new THREE.Euler(seed * 1.3, seed * 2.7, seed * 0.9);
  return new THREE.Quaternion().setFromEuler(e).normalize();
}

describe('MagneticPhysics — determinismo del quaternione target', () => {
  it('il target porta OGNI faccia esattamente verso l\'alto, da qualsiasi rotazione', () => {
    for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
      for (let s = 0; s < 25; s++) {
        const current = randomQuaternion(s + faceIndex * 100);
        const target = computeTargetQuaternion(current, faceIndex);
        // La normale della faccia, ruotata dal target, deve coincidere con up
        expect(faceAlignment(target, faceIndex)).toBeCloseTo(1, 6);
      }
    }
  });

  it('lo yaw resta libero: il delta è la rotazione minima (mai capovolgimenti inutili)', () => {
    // Dado già quasi allineato sulla faccia 2 (+y): il target deve
    // essere vicinissimo alla rotazione corrente, non un orientamento assoluto
    const almostAligned = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 1.2, -0.03));
    const target = computeTargetQuaternion(almostAligned, 2);
    expect(almostAligned.angleTo(target)).toBeLessThan(0.1); // < ~6 gradi
  });

  it('magneticStep converge sempre entro un numero finito di frame', () => {
    for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
      let q = randomQuaternion(faceIndex * 7 + 1);
      let settled = false;
      let frames = 0;
      while (!settled && frames < 300) {
        const step = magneticStep(q, faceIndex, DEFAULT_MAGNETIC);
        q = step.rotation;
        settled = step.settled;
        frames++;
      }
      expect(settled).toBe(true);
      // Dopo lo snap l'allineamento è perfetto: dadi in bilico impossibili
      expect(faceAlignment(q, faceIndex)).toBeCloseTo(1, 6);
    }
  });

  it('le 6 normali di FACE_NORMALS sono unitarie e ortogonali a coppie', () => {
    for (const n of FACE_NORMALS) expect(n.length()).toBeCloseTo(1, 10);
    expect(FACE_NORMALS[0]!.dot(FACE_NORMALS[2]!)).toBe(0); // +x ⟂ +y
    expect(FACE_NORMALS[0]!.dot(FACE_NORMALS[1]!)).toBe(-1); // +x opposto a -x
  });
});
