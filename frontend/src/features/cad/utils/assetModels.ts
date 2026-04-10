import * as THREE from 'three';

// ── Color Palette ─────────────────────────────────────────────────────────────
const Colors = {
  woodBrown:    0x8B6914,
  woodDark:     0x5C4410,
  brassHardware:0xB5A642,
  doorPanel:    0x9B7928,
  hingeGray:    0x6B6B6B,

  windowFrame:  0xf0f0f0,
  windowGlass:  0x87CEEB,
  windowSill:   0xd0d0d0,
  mullion:      0xe0e0e0,

  sheetMetal:   0xa0a0a0,
  sheetMetalDk: 0x808080,
  copperCoil:   0xb87333,
  filterTan:    0xc8b078,
  fanBlade:     0x505050,
  servicePanelGreen: 0x2d6b3f,

  condenserGray:  0x909090,
  condenserFin:   0x787878,
  condenserGuard: 0x606060,

  thermostatBody: 0xe8e8e8,
  thermostatScreen: 0x1a3a5c,
  thermostatBezel: 0xc0c0c0,

  ductSilver:   0xb0b0b0,
  ductFlange:   0x888888,
  ductInsulation: 0xdcdcdc,

  swingArc:     0xffa500,

  registerSlat: 0xc8c8c8,
  grilleBar:    0xa8a8a8,
  
  doorThreshold: 0xa0a0a0,
  refrigerantCopper: 0xc47e5a,
  refrigerantInsulation: 0x111111,
  pvcWhite: 0xdddddd,
} as const;

// ── Shared helper ─────────────────────────────────────────────────────────────
function makeMat(
  color: number,
  opts?: Partial<{
    wireframe: boolean;
    opacity: number;
    transparent: boolean;
    metalness: number;
    roughness: number;
    side: THREE.Side;
    emissive: number;
    emissiveIntensity: number;
  }>,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts?.roughness ?? 0.6,
    metalness: opts?.metalness ?? 0.1,
    wireframe: opts?.wireframe ?? false,
    transparent: opts?.transparent ?? false,
    opacity: opts?.opacity ?? 1.0,
    side: opts?.side ?? THREE.FrontSide,
    emissive: opts?.emissive ?? 0x000000,
    emissiveIntensity: opts?.emissiveIntensity ?? 1.0,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Door Model
// ═══════════════════════════════════════════════════════════════════════════════
export function createDoorModel(
  widthFt: number = 3,
  heightFt: number = 6.8,
  swingDirection: 'left' | 'right' | 'none' = 'left',
  showWireframe: boolean = false,
): THREE.Group {
  const group = new THREE.Group();
  const wf = showWireframe;

  const frameThick = 0.15;  // ft
  const frameDepth = 0.4;   // ft
  const panelThick = 0.12;  // ft
  const panelInset = 0.08;

  // ── Door frame (top + two sides) ────────────────────────────────────────
  const frameMat = makeMat(Colors.woodDark, { wireframe: wf, roughness: 0.8 });

  // Left jamb
  const leftJamb = new THREE.Mesh(
    new THREE.BoxGeometry(frameThick, heightFt, frameDepth),
    frameMat,
  );
  leftJamb.position.set(-widthFt / 2 - frameThick / 2, heightFt / 2, 0);
  group.add(leftJamb);

  // Right jamb
  const rightJamb = new THREE.Mesh(
    new THREE.BoxGeometry(frameThick, heightFt, frameDepth),
    frameMat,
  );
  rightJamb.position.set(widthFt / 2 + frameThick / 2, heightFt / 2, 0);
  group.add(rightJamb);

  // Header
  const header = new THREE.Mesh(
    new THREE.BoxGeometry(widthFt + frameThick * 2, frameThick, frameDepth),
    frameMat,
  );
  header.position.set(0, heightFt + frameThick / 2, 0);
  group.add(header);

  // ── Door slab ───────────────────────────────────────────────────────────
  const slabMat = makeMat(Colors.woodBrown, { wireframe: wf, roughness: 0.65 });
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(widthFt, heightFt, panelThick),
    slabMat,
  );
  slab.position.set(0, heightFt / 2, 0);
  group.add(slab);

  // ── 6 panels (2 columns x 3 rows) ──────────────────────────────────────
  const panelMat = makeMat(Colors.doorPanel, { wireframe: wf, roughness: 0.55 });
  const cols = 2;
  const rows = 3;
  const panelW = (widthFt - panelInset * (cols + 1)) / cols;
  const panelH = (heightFt - panelInset * (rows + 1)) / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = -widthFt / 2 + panelInset + (panelInset + panelW) * c + panelW / 2;
      const py = panelInset + (panelInset + panelH) * r + panelH / 2;
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(panelW * 0.85, panelH * 0.85, panelThick + 0.02),
        panelMat,
      );
      panel.position.set(px, py, 0.01);
      group.add(panel);
    }
  }

  // ── Handle / knob ───────────────────────────────────────────────────────
  const brassMat = makeMat(Colors.brassHardware, { wireframe: wf, metalness: 0.6, roughness: 0.3 });
  const knobX = swingDirection === 'left' ? widthFt / 2 - 0.25 : -widthFt / 2 + 0.25;

  // Lever-style handle (rectangular bar)
  const lever = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.35, 0.12),
    brassMat,
  );
  lever.position.set(knobX, heightFt * 0.42, panelThick / 2 + 0.06);
  group.add(lever);

  // Round plate behind handle
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.02, 12),
    brassMat,
  );
  plate.rotation.x = Math.PI / 2;
  plate.position.set(knobX, heightFt * 0.42, panelThick / 2 + 0.01);
  group.add(plate);

  // ── Hinges (3) ──────────────────────────────────────────────────────────
  const hingeMat = makeMat(Colors.hingeGray, { wireframe: wf, metalness: 0.5, roughness: 0.4 });
  const hingeX = swingDirection === 'left' ? -widthFt / 2 + 0.05 : widthFt / 2 - 0.05;
  const hingePositions = [heightFt * 0.1, heightFt * 0.5, heightFt * 0.88];

  for (const hy of hingePositions) {
    const hinge = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.2, 0.04),
      hingeMat,
    );
    hinge.position.set(hingeX, hy, panelThick / 2 + 0.02);
    group.add(hinge);
  }

  // ── Swing arc indicator ─────────────────────────────────────────────────
  if (swingDirection !== 'none') {
    const arcMat = makeMat(Colors.swingArc, {
      wireframe: wf,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    });
    const arcAngle = Math.PI / 2;
    const startAngle = swingDirection === 'left' ? 0 : Math.PI / 2;
    const arcGeo = new THREE.RingGeometry(widthFt * 0.3, widthFt, 24, 1, startAngle, arcAngle);
    const arc = new THREE.Mesh(arcGeo, arcMat);
    arc.rotation.x = -Math.PI / 2;
    const arcX = swingDirection === 'left' ? -widthFt / 2 : widthFt / 2;
    arc.position.set(arcX, 0.02, frameDepth / 2 + 0.1);
    group.add(arc);
  }

  // ── Optional Threshold ──────────────────────────────────────────────────
  const thresholdMat = makeMat(Colors.doorThreshold, { wireframe: wf, metalness: 0.5, roughness: 0.6 });
  const threshold = new THREE.Mesh(
    new THREE.BoxGeometry(widthFt + frameThick * 2, 0.04, frameDepth + 0.1),
    thresholdMat,
  );
  threshold.position.set(0, 0.02, 0);
  group.add(threshold);

  return group;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Window Model
// ═══════════════════════════════════════════════════════════════════════════════
export function createWindowModel(
  widthFt: number = 3,
  heightFt: number = 4,
  thicknessFt: number = 0.35,
  showWireframe: boolean = false,
): THREE.Group {
  const group = new THREE.Group();
  const wf = showWireframe;

  const frameW = 0.12;  // frame member width
  const mullionW = 0.06;

  const frameMat = makeMat(Colors.windowFrame, { wireframe: wf, roughness: 0.5 });
  const mullionMat = makeMat(Colors.mullion, { wireframe: wf, roughness: 0.4 });
  const glassMat = makeMat(Colors.windowGlass, {
    wireframe: wf,
    transparent: true,
    opacity: 0.35,
    roughness: 0.0,
    metalness: 0.9,
    side: THREE.DoubleSide,
  });
  const sillMat = makeMat(Colors.windowSill, { wireframe: wf, roughness: 0.7 });

  // ── Outer frame (4 members) ─────────────────────────────────────────────
  // Top
  const topFrame = new THREE.Mesh(new THREE.BoxGeometry(widthFt, frameW, thicknessFt), frameMat);
  topFrame.position.set(0, heightFt / 2 - frameW / 2, 0);
  group.add(topFrame);

  // Bottom
  const bottomFrame = new THREE.Mesh(new THREE.BoxGeometry(widthFt, frameW, thicknessFt), frameMat);
  bottomFrame.position.set(0, -heightFt / 2 + frameW / 2, 0);
  group.add(bottomFrame);

  // Left
  const leftFrame = new THREE.Mesh(new THREE.BoxGeometry(frameW, heightFt, thicknessFt), frameMat);
  leftFrame.position.set(-widthFt / 2 + frameW / 2, 0, 0);
  group.add(leftFrame);

  // Right
  const rightFrame = new THREE.Mesh(new THREE.BoxGeometry(frameW, heightFt, thicknessFt), frameMat);
  rightFrame.position.set(widthFt / 2 - frameW / 2, 0, 0);
  group.add(rightFrame);

  // ── Double-hung meeting rail (horizontal center) ────────────────────────
  const meetingRail = new THREE.Mesh(new THREE.BoxGeometry(widthFt - frameW * 2, mullionW * 1.5, thicknessFt), frameMat);
  meetingRail.position.set(0, 0, 0);
  group.add(meetingRail);

  // ── Mullions (2x2 grid: 1 vertical + 1 horizontal in each sash) ────────
  const innerW = widthFt - frameW * 2;
  const halfH = (heightFt - frameW * 2) / 2;

  // Vertical mullion (full height inside frame)
  const vertMullion = new THREE.Mesh(new THREE.BoxGeometry(mullionW, heightFt - frameW * 2, thicknessFt * 0.8), mullionMat);
  vertMullion.position.set(0, 0, 0);
  group.add(vertMullion);

  // Horizontal mullion — upper sash
  const upperMullion = new THREE.Mesh(new THREE.BoxGeometry(innerW, mullionW, thicknessFt * 0.8), mullionMat);
  upperMullion.position.set(0, halfH / 2, 0);
  group.add(upperMullion);

  // Horizontal mullion — lower sash
  const lowerMullion = new THREE.Mesh(new THREE.BoxGeometry(innerW, mullionW, thicknessFt * 0.8), mullionMat);
  lowerMullion.position.set(0, -halfH / 2, 0);
  group.add(lowerMullion);

  // ── Glass panes (4 quadrants) ───────────────────────────────────────────
  const paneW = (innerW - mullionW) / 2 - 0.02;
  const paneH = (halfH - mullionW) / 2 - 0.02;

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const pane = new THREE.Mesh(
        new THREE.PlaneGeometry(paneW, paneH),
        glassMat,
      );
      pane.position.set(
        sx * (paneW / 2 + mullionW / 2 + 0.01),
        sy * (paneH / 2 + mullionW / 2 + 0.01) + (sy > 0 ? halfH / 2 : -halfH / 2),
        0,
      );
      group.add(pane);
    }
  }

  // ── Sill ────────────────────────────────────────────────────────────────
  const sill = new THREE.Mesh(
    new THREE.BoxGeometry(widthFt + 0.3, 0.08, thicknessFt + 0.25),
    sillMat,
  );
  sill.position.set(0, -heightFt / 2 - 0.04, 0.06);
  group.add(sill);

  return group;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Supply Register Model
// ═══════════════════════════════════════════════════════════════════════════════
export function createSupplyRegisterModel(
  showWireframe: boolean = false,
): THREE.Group {
  const group = new THREE.Group();
  const wf = showWireframe;

  const regW = 1.0;   // ft
  const regD = 0.67;  // ft
  const regH = 0.08;  // ft

  // ── Outer frame / bezel ─────────────────────────────────────────────────
  const frameMat = makeMat(Colors.sheetMetal, { wireframe: wf, metalness: 0.35, roughness: 0.4 });
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(regW, regH, regD),
    frameMat,
  );
  frame.position.set(0, regH / 2, 0);
  group.add(frame);

  // ── Duct neck (stub) ───────────────────────────────────────────────────
  const neckMat = makeMat(Colors.sheetMetalDk, { wireframe: wf, metalness: 0.5, roughness: 0.5 });
  const neck = new THREE.Mesh(
    new THREE.BoxGeometry(regW * 0.85, 0.4, regD * 0.85),
    neckMat,
  );
  neck.position.set(0, -0.2, 0);
  group.add(neck);

  // ── Louver slats ────────────────────────────────────────────────────────
  const slatMat = makeMat(Colors.registerSlat, { wireframe: wf, metalness: 0.4, roughness: 0.3 });
  const slatCount = 8;
  const slatW = regW * 0.88;
  const slatSpacing = regD * 0.88 / slatCount;

  for (let i = 0; i < slatCount; i++) {
    const slat = new THREE.Mesh(
      new THREE.BoxGeometry(slatW, 0.015, slatSpacing * 0.7),
      slatMat,
    );
    slat.position.set(
      0,
      regH / 2 + 0.01,
      -regD * 0.44 / 2 + slatSpacing * i + slatSpacing * 0.5 - regD * 0.04,
    );
    slat.rotation.x = 0.45; // steeper angled louvers
    group.add(slat);
  }

  return group;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Return Grille Model
// ═══════════════════════════════════════════════════════════════════════════════
export function createReturnGrilleModel(
  showWireframe: boolean = false,
): THREE.Group {
  const group = new THREE.Group();
  const wf = showWireframe;

  const grilleW = 1.5;  // ft
  const grilleD = 1.5;  // ft
  const grilleH = 0.06; // ft

  // ── Outer frame (stamped lip) ───────────────────────────────────────────
  const frameMat = makeMat(Colors.sheetMetal, { wireframe: wf, metalness: 0.35, roughness: 0.4 });
  
  // Create hollow frame using 4 bars
  const frameThick = 0.1;
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(grilleW, grilleH, frameThick), frameMat);
  topBar.position.set(0, grilleH / 2, -grilleD / 2 + frameThick / 2);
  group.add(topBar);

  const bottomBar = new THREE.Mesh(new THREE.BoxGeometry(grilleW, grilleH, frameThick), frameMat);
  bottomBar.position.set(0, grilleH / 2, grilleD / 2 - frameThick / 2);
  group.add(bottomBar);

  const leftBar = new THREE.Mesh(new THREE.BoxGeometry(frameThick, grilleH, grilleD - frameThick * 2), frameMat);
  leftBar.position.set(-grilleW / 2 + frameThick / 2, grilleH / 2, 0);
  group.add(leftBar);

  const rightBar = new THREE.Mesh(new THREE.BoxGeometry(frameThick, grilleH, grilleD - frameThick * 2), frameMat);
  rightBar.position.set(grilleW / 2 - frameThick / 2, grilleH / 2, 0);
  group.add(rightBar);
  
  // ── Mounting Screws ─────────────────────────────────────────────────────
  const screwMat = makeMat(0xd0d0d0, { wireframe: wf, metalness: 0.8, roughness: 0.2 });
  const sx = grilleW / 2 - 0.05;
  const sz = grilleD / 2 - 0.05;
  for (const bx of [-sx, sx]) {
    for (const bz of [-sz, sz]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.01, 8), screwMat);
      screw.position.set(bx, grilleH + 0.005, bz);
      group.add(screw);
    }
  }

  // ── Horizontal fine bars ────────────────────────────────────────────────
  const barMat = makeMat(Colors.grilleBar, { wireframe: wf, metalness: 0.2, roughness: 0.5 });
  const barCount = 20; // more bars for finer texture
  const barW = grilleW - frameThick * 2;
  const barSpacing = (grilleD - frameThick * 2) / barCount;

  for (let i = 0; i < barCount; i++) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(barW, 0.02, 0.01),
      barMat,
    );
    bar.position.set(
      0,
      grilleH / 2,
      -(grilleD - frameThick * 2) / 2 + barSpacing * i + barSpacing / 2,
    );
    bar.rotation.x = -0.3; // stamped louvers angle
    group.add(bar);
  }

  // ── Duct neck (stub) ───────────────────────────────────────────────────
  const neckMat = makeMat(Colors.sheetMetalDk, { wireframe: wf, metalness: 0.5, roughness: 0.5 });
  const neck = new THREE.Mesh(
    new THREE.BoxGeometry(barW, 0.5, grilleD - frameThick * 2),
    neckMat,
  );
  neck.position.set(0, -0.25, 0);
  group.add(neck);

  return group;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Air Handler Model
// ═══════════════════════════════════════════════════════════════════════════════
export function createAirHandlerModel(
  showWireframe: boolean = false,
): THREE.Group {
  const group = new THREE.Group();
  const wf = showWireframe;

  const boxW = 2;   // ft
  const boxH = 3;   // ft
  const boxD = 2;   // ft

  // ── Main cabinet ────────────────────────────────────────────────────────
  const cabinetMat = makeMat(Colors.sheetMetal, { wireframe: wf, metalness: 0.35, roughness: 0.45 });
  const cabinet = new THREE.Mesh(
    new THREE.BoxGeometry(boxW, boxH, boxD),
    cabinetMat,
  );
  cabinet.position.set(0, boxH / 2, 0);
  group.add(cabinet);

  // ── Sub-panels and Seams ───────────────────────────────────────────────
  const seamMat = makeMat(Colors.sheetMetalDk, { wireframe: wf, metalness: 0.5, roughness: 0.5 });
  // Horizontal seam splitting the unit (blower vs coil sections)
  const midSeam = new THREE.Mesh(new THREE.BoxGeometry(boxW + 0.01, 0.02, boxD + 0.01), seamMat);
  midSeam.position.set(0, boxH * 0.55, 0);
  group.add(midSeam);

  // ── Supply / Return Collars ─────────────────────────────────────────────
  const collarMat = makeMat(Colors.sheetMetal, { wireframe: wf, metalness: 0.3, roughness: 0.6 });
  const topCollar = new THREE.Mesh(new THREE.BoxGeometry(boxW * 0.8, 0.2, boxD * 0.8), collarMat);
  topCollar.position.set(0, boxH + 0.1, 0);
  group.add(topCollar);

  const bottomCollar = new THREE.Mesh(new THREE.BoxGeometry(boxW * 0.8, 0.2, boxD * 0.8), collarMat);
  bottomCollar.position.set(0, -0.1, 0);
  group.add(bottomCollar);

  // ── Refrigerant Line Stubs (right side) ───────────────────────────────
  const copperMat = makeMat(Colors.refrigerantCopper, { wireframe: wf, metalness: 0.7, roughness: 0.2 });
  const insulMat = makeMat(Colors.refrigerantInsulation, { wireframe: wf, roughness: 0.9 });
  
  // Suction line (insulated)
  const suctionHole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 12), insulMat);
  suctionHole.rotation.z = Math.PI / 2;
  suctionHole.position.set(boxW / 2 + 0.05, boxH * 0.3, 0.2);
  group.add(suctionHole);

  // Liquid line (bare copper)
  const liquidLine = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.15, 8), copperMat);
  liquidLine.rotation.z = Math.PI / 2;
  liquidLine.position.set(boxW / 2 + 0.075, boxH * 0.3, -0.2);
  group.add(liquidLine);

  // ── Wiring Conduit (left side) ─────────────────────────────────────────
  const conduitMat = makeMat(Colors.pvcWhite, { wireframe: wf, roughness: 0.4 });
  const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), conduitMat);
  conduit.rotation.z = Math.PI / 2;
  conduit.position.set(-boxW / 2 - 0.2, boxH * 0.7, 0);
  group.add(conduit);
  
  const jBox = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.4), conduitMat);
  jBox.position.set(-boxW / 2 - 0.1, boxH * 0.7, 0);
  group.add(jBox);

  // ── Access Doors (front) ──────────────────────────────────────────────
  const doorMat = makeMat(Colors.servicePanelGreen, { wireframe: wf, roughness: 0.6, metalness: 0.15 });
  const topDoor = new THREE.Mesh(new THREE.BoxGeometry(boxW * 0.9, boxH * 0.4, 0.02), doorMat);
  topDoor.position.set(0, boxH * 0.75, boxD / 2 + 0.01);
  group.add(topDoor);

  const bottomDoor = new THREE.Mesh(new THREE.BoxGeometry(boxW * 0.9, boxH * 0.45, 0.02), doorMat);
  bottomDoor.position.set(0, boxH * 0.25, boxD / 2 + 0.01);
  group.add(bottomDoor);

  // Door handles/knobs
  const knobMat = makeMat(0x222222, { wireframe: wf, roughness: 0.8 });
  for (const hy of [boxH * 0.75, boxH * 0.25]) {
    const knob1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 12), knobMat);
    knob1.rotation.x = Math.PI / 2;
    knob1.position.set(-boxW * 0.35, hy, boxD / 2 + 0.03);
    group.add(knob1);

    const knob2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 12), knobMat);
    knob2.rotation.x = Math.PI / 2;
    knob2.position.set(boxW * 0.35, hy, boxD / 2 + 0.03);
    group.add(knob2);
  }

  // ── Return Filter Slot ────────────────────────────────────────────────
  const filterMat = makeMat(Colors.filterTan, { wireframe: wf, roughness: 0.8, metalness: 0.0 });
  const filter = new THREE.Mesh(new THREE.BoxGeometry(boxW * 0.95, 0.1, boxD * 0.9), filterMat);
  filter.position.set(0, 0.05, 0);
  group.add(filter);

  return group;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Condenser (Outdoor Unit) Model
// ═══════════════════════════════════════════════════════════════════════════════
export function createCondenserModel(
  showWireframe: boolean = false,
): THREE.Group {
  const group = new THREE.Group();
  const wf = showWireframe;

  const radius = 1.5;
  const height = 2.2;
  const segments = 32;

  // ── Main cylindrical body ───────────────────────────────────────────────
  const bodyMat = makeMat(Colors.condenserGray, { wireframe: wf, metalness: 0.35, roughness: 0.5 });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, segments),
    bodyMat,
  );
  body.position.set(0, height / 2, 0);
  group.add(body);

  // ── Fin texture (vertical strips around cylinder) ───────────────────────
  const finMat = makeMat(Colors.condenserFin, { wireframe: wf, metalness: 0.5, roughness: 0.6 });
  const finCount = 36; // denser fins
  for (let i = 0; i < finCount; i++) {
    const angle = (Math.PI * 2 / finCount) * i;
    // Leave a gap for the service panel
    if (angle > -0.2 && angle < 0.8) continue;
    
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, height * 0.85, 0.2),
      finMat,
    );
    fin.position.set(
      Math.cos(angle) * (radius - 0.02),
      height / 2,
      Math.sin(angle) * (radius - 0.02),
    );
    fin.rotation.y = -angle;
    group.add(fin);
  }

  // ── Service Panel (Side) ────────────────────────────────────────────────
  const panelMat = makeMat(Colors.sheetMetal, { wireframe: wf, metalness: 0.2, roughness: 0.4 });
  const panelAngle = 0.3;
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 0.6, height * 0.9, 0.1),
    panelMat,
  );
  panel.position.set(
    Math.cos(panelAngle) * radius,
    height / 2,
    Math.sin(panelAngle) * radius,
  );
  panel.rotation.y = -panelAngle + Math.PI / 2;
  group.add(panel);

  // ── Refrigerant Line Sets ───────────────────────────────────────────────
  const copperMat = makeMat(Colors.refrigerantCopper, { wireframe: wf, metalness: 0.8, roughness: 0.2 });
  const insulMat = makeMat(Colors.refrigerantInsulation, { wireframe: wf, roughness: 0.8 });

  // Valves on panel
  const valve1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 8), copperMat);
  valve1.rotation.x = Math.PI / 2;
  valve1.position.set(Math.cos(panelAngle) * radius + 0.1, 0.4, Math.sin(panelAngle) * radius - 0.1);
  group.add(valve1);

  const valve2 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12), insulMat);
  valve2.rotation.x = Math.PI / 2;
  valve2.position.set(Math.cos(panelAngle) * radius + 0.1, 0.25, Math.sin(panelAngle) * radius + 0.1);
  group.add(valve2);

  // ── Internal Compressor (visible through top) ───────────────────────────
  const compMat = makeMat(0x111111, { wireframe: wf, metalness: 0.9, roughness: 0.2 });
  const compressor = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.0, 16), compMat);
  compressor.position.set(-0.3, 0.5, -0.2); // Offset hump
  group.add(compressor);

  // Compressor dome
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2), compMat);
  dome.position.set(-0.3, 1.0, -0.2);
  group.add(dome);

  // ── Top fan guard (wire grill disk) ─────────────────────────────────────
  const guardMat = makeMat(Colors.condenserGuard, {
    wireframe: wf,
    metalness: 0.5,
    roughness: 0.3,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
  });
  const guard = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.95, radius * 0.95, 0.04, segments),
    guardMat,
  );
  guard.position.set(0, height + 0.02, 0);
  group.add(guard);

  // Guard cross-bars
  const crossMat = makeMat(Colors.condenserGuard, { wireframe: wf, metalness: 0.5, roughness: 0.3 });
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI / 4) * i;
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 1.8, 0.04, 0.04),
      crossMat,
    );
    bar.rotation.y = angle;
    bar.position.set(0, height + 0.04, 0);
    group.add(bar);
  }

  // Fan motor hub
  const hubMat = makeMat(Colors.fanBlade, { wireframe: wf, metalness: 0.6, roughness: 0.25 });
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.15, 12),
    hubMat,
  );
  hub.position.set(0, height - 0.1, 0);
  group.add(hub);

  // Fan blades (4)
  const bladeMat = makeMat(Colors.fanBlade, { wireframe: wf, metalness: 0.4, roughness: 0.35 });
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI / 2) * i;
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.02, radius * 0.75),
      bladeMat,
    );
    blade.rotation.y = angle + 0.3; // slight pitch
    blade.position.set(
      Math.cos(angle) * radius * 0.35,
      height - 0.08,
      Math.sin(angle) * radius * 0.35,
    );
    group.add(blade);
  }

  // ── Base / feet ─────────────────────────────────────────────────────────
  const baseMat = makeMat(Colors.sheetMetalDk, { wireframe: wf, metalness: 0.3, roughness: 0.6 });
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(radius + 0.1, radius + 0.15, 0.15, segments),
    baseMat,
  );
  base.position.set(0, 0.075, 0);
  group.add(base);

  // Feet (4 rubber pads)
  const footMat = makeMat(0x222222, { wireframe: wf, roughness: 0.9 });
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI / 2) * i + Math.PI / 4;
    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.08, 0.25),
      footMat,
    );
    foot.position.set(
      Math.cos(angle) * (radius - 0.1),
      -0.04,
      Math.sin(angle) * (radius - 0.1),
    );
    group.add(foot);
  }

  return group;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Thermostat Model
// ═══════════════════════════════════════════════════════════════════════════════
export function createThermostatModel(
  showWireframe: boolean = false,
): THREE.Group {
  const group = new THREE.Group();
  const wf = showWireframe;

  const bodyW = 0.35; // ft 
  const bodyH = 0.55; // ft 
  const bodyD = 0.08; // ft 

  // ── Main body ───────────────────────────────────────────────────────────
  const bodyMat = makeMat(Colors.thermostatBody, { wireframe: wf, roughness: 0.3, metalness: 0.05 });
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW, bodyH, bodyD),
    bodyMat,
  );
  body.position.set(0, 0, 0);
  group.add(body);

  // ── Bezel / border ──────────────────────────────────────────────────────
  const bezelMat = makeMat(Colors.thermostatBezel, { wireframe: wf, roughness: 0.25, metalness: 0.15 });
  const bezelThick = 0.02;

  // Top bezel
  const topBezel = new THREE.Mesh(new THREE.BoxGeometry(bodyW + 0.015, bezelThick, bodyD + 0.015), bezelMat);
  topBezel.position.set(0, bodyH / 2 - bezelThick / 2, 0);
  group.add(topBezel);

  // Bottom bezel
  const bottomBezel = new THREE.Mesh(new THREE.BoxGeometry(bodyW + 0.015, bezelThick, bodyD + 0.015), bezelMat);
  bottomBezel.position.set(0, -bodyH / 2 + bezelThick / 2, 0);
  group.add(bottomBezel);

  // ── Screen area (Glowing LCD) ───────────────────────────────────────────
  const screenMat = makeMat(Colors.thermostatScreen, {
    wireframe: wf,
    roughness: 0.05,
    metalness: 0.1,
    emissive: 0x1f4e85, // Brigher blue glow
    emissiveIntensity: 0.8
  });
  const screenW = bodyW * 0.75;
  const screenH = bodyH * 0.45;
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(screenW, screenH, 0.01),
    screenMat,
  );
  screen.position.set(0, bodyH * 0.1, bodyD / 2 + 0.005);
  group.add(screen);

  // LCD text mock (inner rectangle)
  const lcdTextMat = makeMat(0x66ccff, { wireframe: wf, emissive: 0x66ccff, emissiveIntensity: 1.0 });
  const textMock = new THREE.Mesh(new THREE.PlaneGeometry(screenW * 0.5, screenH * 0.4), lcdTextMat);
  textMock.position.set(0, bodyH * 0.1, bodyD / 2 + 0.011);
  group.add(textMock);

  // ── Buttons ─────────────────────────────────────────────────────────────
  const btnMat = makeMat(0xd0d0d0, { wireframe: wf, roughness: 0.3 });
  for (const bx of [-0.06, 0, 0.06]) {
    const btn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.015, 12),
      btnMat,
    );
    btn.rotation.x = Math.PI / 2;
    btn.position.set(bx, -bodyH * 0.25, bodyD / 2 + 0.005);
    group.add(btn);
  }

  // ── Wall mount plate (thickened) ───────────────────────────────────────
  const mountMat = makeMat(0xbbbbbb, { wireframe: wf, roughness: 0.7 });
  const mount = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW * 1.15, bodyH * 1.1, 0.03),
    mountMat,
  );
  // Bring it out slightly more realistically
  mount.position.set(0, 0, -bodyD / 2 - 0.015);
  group.add(mount);

  return group;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Duct Run Model
// ═══════════════════════════════════════════════════════════════════════════════
export function createDuctRunModel(
  showWireframe: boolean = false,
): THREE.Group {
  const group = new THREE.Group();
  const wf = showWireframe;

  const ductLen = 3.0; // ft
  const radiusX = 0.5; // ft (12" dia)
  const insulationThick = 0.08;

  // ── Inner spiral duct ────────────────────────────────────────────────────
  const ductMat = makeMat(Colors.ductSilver, { wireframe: wf, metalness: 0.5, roughness: 0.35 });
  const innerDuct = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusX, radiusX, ductLen, 24),
    ductMat,
  );
  // Cylinder default is Y-up, our duct length is along X axis
  innerDuct.rotation.z = Math.PI / 2;
  group.add(innerDuct);

  // ── Spiral Corrugation ──────────────────────────────────────────────────
  const seamMat = makeMat(Colors.ductFlange, { wireframe: wf, metalness: 0.6, roughness: 0.4 });
  const corrugationRings = 20;
  const ringSpacing = ductLen / corrugationRings;
  
  for (let i = 0; i < corrugationRings; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radiusX + 0.005, 0.008, 6, 24),
      seamMat
    );
    ring.rotation.y = Math.PI / 2;
    ring.position.set(-ductLen / 2 + ringSpacing * i + ringSpacing / 2, 0, 0);
    // Add small tilt to simulate spiral seam
    ring.rotation.x = 0.05;
    group.add(ring);
  }

  // ── Insulation jacket (Outer wrap) ───────────────────────────────────────
  const insulMat = makeMat(Colors.ductInsulation, { wireframe: wf, roughness: 0.85, metalness: 0.1 });
  const insulation = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusX + insulationThick, radiusX + insulationThick, ductLen - 0.1, 24),
    insulMat,
  );
  insulation.rotation.z = Math.PI / 2;
  group.add(insulation);

  // ── Connection collars (uninsulated ends) ──────────────────────────────
  const collarMat = makeMat(Colors.ductSilver, { wireframe: wf, metalness: 0.45, roughness: 0.35 });
  for (const side of [-1, 1]) {
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(radiusX + 0.01, radiusX + 0.01, 0.1, 24),
      collarMat,
    );
    collar.rotation.z = Math.PI / 2;
    collar.position.set(side * (ductLen / 2 + 0.05), 0, 0);
    group.add(collar);
  }

  // ── Hanging straps ──────────────────────────────────────────────────────
  const strapMat = makeMat(Colors.sheetMetalDk, { wireframe: wf, metalness: 0.3, roughness: 0.5 });
  for (const sx of [-0.6, 0.6]) {
    // Vertical drop
    const drop = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, radiusX + 0.5, 0.04), // strap down to middle
      strapMat,
    );
    drop.position.set(sx, radiusX + insulationThick + 0.25, 0);
    group.add(drop);

    // Band around insulation
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(radiusX + insulationThick + 0.01, 0.02, 6, 24),
      strapMat
    );
    band.rotation.y = Math.PI / 2;
    band.position.set(sx, 0, 0);
    group.add(band);
  }

  return group;
}
