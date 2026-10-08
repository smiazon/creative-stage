import * as THREE from 'three';

export function buildConcertStage() {
  const group = new THREE.Group();

  // --- Materials -------------------------------------------------------------
  const stageTopMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.8 });
  const stageSideMat = new THREE.MeshStandardMaterial({ color: 0x0f1011, roughness: 0.7 });
  // Highly polished, glossy white plastic/acrylic for the catwalk and B-stage tops
  const catwalkTopMat = new THREE.MeshPhysicalMaterial({
    color: 0xf3f5f8,
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.0,
  });
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.4, metalness: 0.85 });
  const steelLight = new THREE.MeshStandardMaterial({ color: 0x777c84, roughness: 0.35, metalness: 0.9 });
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.5, metalness: 0.8 });
  const consoleMat = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.5 });
  const screenMat = new THREE.MeshBasicMaterial({ color: 0x081c08 }); // faint glowing screen look

  // Helper: Create a stage section (box)
  function createBox(w, h, d, x, y, z, mat) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }

  // Helper: Create a cylinder
  function createCylinder(rt, rb, h, seg, x, y, z, mat) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, seg);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }

  const stageH = 1.5;
  const catwalkW = 1.2;

  // --- 1. Custom Main Stage (Extruded 6-Sided Shape) --------------------------
  // Outer bounds: X = [-26, -12], Z = [-13, 13]
  // Matches the curved West end of the stadium perfectly!
  const stageShape = new THREE.Shape();
  stageShape.moveTo(-22, -13); // NW Corner
  stageShape.lineTo(-12, -13); // NE Corner (front-left)
  stageShape.lineTo(-12, 13);  // SE Corner (front-right)
  stageShape.lineTo(-22, 13);  // SW Corner
  stageShape.lineTo(-26, 7);   // Back-SW corner of curved wall
  stageShape.lineTo(-26, -7);  // Back-NW corner of curved wall
  stageShape.closePath();

  // Extrude the shape upwards along Y
  const extrudeSettings = {
    depth: stageH,
    bevelEnabled: false,
  };
  const stageGeo = new THREE.ExtrudeGeometry(stageShape, extrudeSettings);
  // Center geometry vertically and rotate so flat face points up
  stageGeo.translate(0, 0, -stageH);
  stageGeo.rotateX(Math.PI / 2);

  const mainStage = new THREE.Mesh(stageGeo, stageSideMat);
  mainStage.position.y = stageH;
  mainStage.castShadow = true;
  mainStage.receiveShadow = true;
  group.add(mainStage);

  // Wooden dark grey stage top (slight lip raised by 0.02m)
  const mainStageTop = new THREE.Mesh(stageGeo, stageTopMat);
  mainStageTop.position.y = stageH + 0.02;
  mainStageTop.scale.set(1.002, 1.0, 1.002); // slight upscale to hide seams
  group.add(mainStageTop);

  // --- 2. Thin Catwalk --------------------------------------------------------
  // Extends from front of main stage (X = -12) to circular B-Stage edge (X = -2.4)
  // Width along Z = 1.2m
  const catwalkLen = 9.6;
  const catwalkX = -12 + catwalkLen / 2;
  createBox(catwalkLen, stageH, catwalkW, catwalkX, stageH / 2, 0, stageSideMat);
  // Glossy white catwalk top deck
  createBox(catwalkLen + 0.02, 0.05, catwalkW + 0.02, catwalkX, stageH + 0.025, 0, catwalkTopMat);

  // --- 3. Circular B-Stage ---------------------------------------------------
  // Centered at X = 0, Z = 0 (Center Circle). Radius = 2.4m, Height = 1.5m
  const bStageRadius = 2.4;
  createCylinder(bStageRadius, bStageRadius, stageH, 48, 0, stageH / 2, 0, stageSideMat);
  // Glossy white circular top deck
  createCylinder(bStageRadius + 0.02, bStageRadius + 0.02, 0.05, 48, 0, stageH + 0.025, 0, catwalkTopMat);

  // --- 4. Front of House (FOH) Sound Tech Area ---------------------------------
  // Raised platform 5m x 5m, 0.6m high (Y)
  // Centered at X = 16, Z = 0 (East end)
  const fohH = 0.6;
  createBox(5, fohH, 5, 16, fohH / 2, 0, stageSideMat);
  createBox(5.05, 0.05, 5.05, 16, fohH + 0.025, 0, stageTopMat);

  // FOH Railings (simple thin box railings around 3 sides)
  const railH = 1.0;
  // West side (front) has no railing. North, South, and East sides are railed.
  createBox(0.05, railH, 5, 16 + 2.5, fohH + railH / 2, 0, steelLight); // East rail
  createBox(5, railH, 0.05, 16, fohH + railH / 2, 2.5, steelLight); // North rail
  createBox(5, railH, 0.05, 16, fohH + railH / 2, -2.5, steelLight); // South rail

  // FOH Sound Consoles
  // Console base
  createBox(0.8, 0.9, 1.6, 16 - 1.0, fohH + 0.45, 0.8, consoleMat);
  createBox(0.8, 0.9, 1.6, 16 - 1.0, fohH + 0.45, -0.8, consoleMat);
  // Slanted top controls
  const consoleTopA = createBox(0.8, 0.1, 1.5, 16 - 1.0, fohH + 0.9, 0.8, steelDark);
  consoleTopA.rotation.z = 0.15;
  const consoleTopB = createBox(0.8, 0.1, 1.5, 16 - 1.0, fohH + 0.9, -0.8, steelDark);
  consoleTopB.rotation.z = 0.15;

  // Tiny screen details
  createBox(0.2, 0.01, 0.3, 16 - 1.1, fohH + 0.96, 0.8, screenMat);
  createBox(0.2, 0.01, 0.3, 16 - 1.1, fohH + 0.96, -0.8, screenMat);

  // FOH Canopy Truss (4 thin poles + flat roof frame)
  const trussH = 4.2;
  const poleR = 0.06;
  createCylinder(poleR, poleR, trussH, 8, 16 - 2.4, trussH / 2, 2.4, steelLight);
  createCylinder(poleR, poleR, trussH, 8, 16 + 2.4, trussH / 2, 2.4, steelLight);
  createCylinder(poleR, poleR, trussH, 8, 16 - 2.4, trussH / 2, -2.4, steelLight);
  createCylinder(poleR, poleR, trussH, 8, 16 + 2.4, trussH / 2, -2.4, steelLight);
  // Truss roof frame
  createBox(5.0, 0.15, 0.15, 16, trussH, 2.4, steelLight);
  createBox(5.0, 0.15, 0.15, 16, trussH, -2.4, steelLight);
  createBox(0.15, 0.15, 5.0, 16 - 2.4, trussH, 0, steelLight);
  createBox(0.15, 0.15, 5.0, 16 + 2.4, trussH, 0, steelLight);

  // --- 5. Crowd Barricades ---------------------------------------------------
  // Crowd control barriers wrapped perfectly around the massive stage layout.
  // Height: 1.1m. Thickness: 0.08m.
  const bH = 1.1;
  const bT = 0.08;

  // Helper: Create a single barrier segment
  function addBarrierSegment(w, x, z, rotY) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bT, bH, w), barrierMat);
    m.position.set(x, bH / 2, z);
    m.rotation.y = rotY;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);

    // Silver base plate
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, w), steelDark);
    base.position.set(x, 0.01, z);
    base.rotation.y = rotY;
    group.add(base);

    // Rounded top safety rail
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, w, 8), steelLight);
    rail.position.set(x, bH, z);
    rail.rotation.set(Math.PI / 2, 0, rotY);
    group.add(rail);
  }

  // --- Barricade layout (1.5m offset from stage geometry) ---
  // Main Stage Front is at X = -12. Width is Z = [-13, 13].
  // Front wings: X = -10.5.
  // North wing front: Z = [1.8, 14.5]
  addBarrierSegment(12.7, -10.5, 8.15, 0);
  // South wing front: Z = [-14.5, -1.8]
  addBarrierSegment(12.7, -10.5, -8.15, 0);

  // North Stage Side: Z = 14.5, from X = -22 to X = -10.5
  addBarrierSegment(11.5, -16.25, 14.5, Math.PI / 2);
  // South Stage Side: Z = -14.5, from X = -22 to X = -10.5
  addBarrierSegment(11.5, -16.25, -14.5, Math.PI / 2);

  // Catwalk Parallel North: Z = 1.8, from X = -10.5 to X = -2.4
  addBarrierSegment(8.1, -6.45, 1.8, Math.PI / 2);
  // Catwalk Parallel South: Z = -1.8, from X = -10.5 to X = -2.4
  addBarrierSegment(8.1, -6.45, -1.8, Math.PI / 2);

  // B-stage circular barricade loop (octagonal curve, radius = 3.9m centered at (0, 0, 0))
  const bCenter = new THREE.Vector2(0, 0);
  const bRadius = 3.9;
  const bSegs = 6;
  const startAng = -Math.PI / 3.2;
  const endAng = Math.PI / 3.2;

  for (let s = 0; s <= bSegs; s++) {
    const t = s / bSegs;
    const ang = startAng + t * (endAng - startAng);
    const bx = bCenter.x + Math.cos(ang) * bRadius;
    const bz = bCenter.y + Math.sin(ang) * bRadius;
    const rot = -ang;
    addBarrierSegment(1.8, bx, bz, rot);
  }

  // FOH barriers (U-shape around FOH to keep crowd back)
  addBarrierSegment(7.0, 12.5, 0, 0); // West front barrier
  addBarrierSegment(6.0, 15.5, 3.5, Math.PI / 2); // North side barrier
  addBarrierSegment(6.0, 15.5, -3.5, Math.PI / 2); // South side barrier

  return group;
}
