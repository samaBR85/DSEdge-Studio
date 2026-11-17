// Built-in presets. Applying one only changes the draft; nothing reaches the controller until "Gravar".
// stick: { p: preset id (0 Padrão,1 Rápida,2 Precisa,3 Estável,4 Digital,5 Dinâmica), i: intensity 0..10, dz: deadzone % }
// map: { physicalIndex: targetIndex } — 4 Círculo, 5 Xis, 6 Quadrado, 7 Triângulo, 8 R1, 11 L1, 14/15 paddles
"use strict";

const PRESETS = [
  { cat: T("FPS competitivo"), name: T("Mira Precisa"), d: T("Curva lenta no centro para microajustes e rápida nas bordas, nos dois analógicos."),
    left: { p: 2, i: 5 }, right: { p: 2, i: 5 }, tags: [T("Analógicos"), T("Precisa")] },
  { cat: T("FPS competitivo"), name: T("Gatilho Instantâneo"), d: T("L2 e R2 disparam com ~15% de curso. Bom para armas semiautomáticas."),
    left: { p: 1, i: 5 }, right: { p: 1, i: 5 }, l2: [0, 40], r2: [0, 40], tags: [T("Gatilho curto"), T("Rápida")], hot: true },
  { cat: T("FPS competitivo"), name: T("Paddles: Pular e Agachar"), d: T("Paddle esquerdo vira ✕ e o direito vira ○. O polegar fica livre no analógico."),
    map: { 14: 5, 15: 4 }, tags: [T("Paddles")] },
  { cat: T("Battle Royale"), name: T("Resposta Linear"), d: T("Curva 1:1 com zona morta mínima, para quem quer a entrada mais pura."),
    left: { p: 0, i: 5, dz: 4 }, right: { p: 0, i: 5, dz: 4 }, tags: [T("Linear"), T("Zona morta 4%")] },
  { cat: T("Battle Royale"), name: T("Construção Rápida"), d: T("L1 e R1 nos paddles e curva dinâmica para virar rápido."),
    left: { p: 5, i: 5 }, right: { p: 5, i: 6 }, map: { 14: 11, 15: 8 }, tags: [T("Paddles"), T("Dinâmica")] },
  { cat: T("Corrida"), name: T("Aceleração Suave"), d: T("Gatilhos com zona morta de 8% e curso completo, para dosar o acelerador."),
    left: { p: 5, i: 4 }, l2: [20, 255], r2: [20, 255], tags: [T("Gatilhos"), T("Dinâmica")] },
  { cat: T("Corrida"), name: T("Marchas nos Paddles"), d: T("Paddles viram ○ e ✕ (troca de marcha em muitos jogos) e a direção fica estável."),
    left: { p: 3, i: 5 }, map: { 14: 4, 15: 5 }, tags: [T("Paddles"), T("Estável")] },
  { cat: T("Luta"), name: T("Direcional Digital"), d: T("Analógico esquerdo responde como direcional digital, com L1 e R1 nos paddles."),
    left: { p: 4, i: 5 }, map: { 14: 11, 15: 8 }, tags: [T("Digital"), T("Paddles")] },
  { cat: T("Esportes"), name: T("Passe Rápido"), d: T("Gatilhos com meio curso e analógicos rápidos para dribles."),
    left: { p: 1, i: 3 }, right: { p: 1, i: 3 }, l2: [0, 120], r2: [0, 120], tags: [T("Rápida"), T("Gatilhos")] },
  { cat: T("Acessibilidade"), name: T("Ações nos Paddles"), d: T("□ e △ nos paddles, para alcançar as ações principais sem soltar o analógico direito."),
    map: { 14: 6, 15: 7 }, tags: [T("Paddles")] },
  { cat: T("Acessibilidade"), name: T("Gatilhos Leves"), d: T("L2 e R2 atingem 100% com pouca força."),
    l2: [0, 70], r2: [0, 70], tags: [T("Gatilhos")] },
  { cat: T("Geral"), name: T("Padrão de fábrica"), d: T("Volta tudo ao padrão: curvas, gatilhos e botões."),
    left: { p: 0, i: 5 }, right: { p: 0, i: 5 }, l2: [0, 255], r2: [0, 255], resetMap: true, tags: [T("Reset")] },
];

function applyPreset(profile, pr) {
  const stick = (j, s) => {
    if (!s) return;
    j.profileId = s.p;
    j.modifier = Proto.STICK_PRESETS[s.p].mod;
    j.curveValues = Proto.presetCurve(s.p, s.i ?? 5);
    if (s.dz) Proto.applyDeadzone(j, s.dz);
  };
  stick(profile.leftJoystick, pr.left);
  stick(profile.rightJoystick, pr.right);
  if (pr.l2) profile.leftTrigger = { min: pr.l2[0], max: pr.l2[1] };
  if (pr.r2) profile.rightTrigger = { min: pr.r2[0], max: pr.r2[1] };
  if (pr.resetMap) profile.buttonMapping.buttons = Array.from({ length: 16 }, (_, i) => i);
  if (pr.map) for (const [k, v] of Object.entries(pr.map)) profile.buttonMapping.buttons[Number(k)] = v;
}

// curve points (3 × [x,y]) for previews
function presetPreviewCurve(s) {
  const j = { profileId: s?.p ?? 0, modifier: 3, curveValues: Proto.presetCurve(s?.p ?? 0, s?.i ?? 5) };
  if (s?.dz) Proto.applyDeadzone(j, s.dz);
  const c = j.curveValues;
  return [[c[0], c[1]], [c[2], c[3]], [c[4], c[5]]];
}
