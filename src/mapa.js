// O mapa da região numa cena do Foundry do mestre: o hub é a fonte. O mestre
// ativo baixa os carimbos quando a versão muda e desenha cada um como Tile
// travado (texto vira Drawing). O mestre carimba pela paleta da janela (/wm) com
// um clique no hex, e apaga com a borracha ou apagando o Tile — as duas coisas
// vão para o hub e valem para todos os mestres e VTTs.
import { hexGeom } from "../../../src/lib/hexgrid";
import { ORDEM_DA_CAMADA, encaixarNoHex } from "../../../src/data/mapa/paleta";
import { doSync, MOD, avisar, cfg, ehDoSync, gravarCfg, mesa, souGmAtivo, umPorVez } from "./comum.js";

const NOME_DA_CENA = "Mapa da região (West Marches)";
/** Tamanho do hex na cena do Foundry. O do hub é 42 (a cena "Ermos" original):
 *  a escala é a razão entre os dois. */
const TAM = 100;
/** Até o v13 o x/y de um Tile é o canto; do v14 em diante é o ponto da âncora da
 *  textura (centro, 0.5/0.5) — o mesmo tropeço que o módulo antigo resolveu no map.js. */
const ancoraNoCentro = () => (game.release?.generation ?? 12) >= 14;

let versaoAtual;
/** { k, hub:{x,y}, f:{x,y}, grade, cenaId } — a conversão hub ↔ cena do Foundry. */
let conv = null;
let cenaDoHub = null;
let carimbosDoHub = [];
/** As chaves que a última sincronização deixou na cena. */
let desenhados = new Set();

export const cenaDoMapa = () => game.scenes?.find((s) => s.getFlag(MOD, "mapa") === true) ?? null;

// ---------------------------------------------------------------- coordenadas

/** Casa UM centro de hex do hub com UM centro de hex do Foundry: as grades têm o
 *  mesmo tipo e a escala é exata, então isso casa a grade inteira. Quem diz onde
 *  cai o centro no Foundry é a própria grade da cena (`getCenterPoint`), e não
 *  uma conta nossa — a fase da grade hex muda conforme o tipo. */
function montarConversao(cena, hubCena, carimbos) {
  const { type, size } = hubCena.grade ?? {};
  if (!size || type < 2) return null;
  let ancora = hubCena.grade.ancora;
  if (!ancora) {
    // Antes da migração a grade do hub é deduzida das peças (a mesma conta do /mapa).
    const g = hexGeom({ grid: { type, size }, tiles: [...hubCena.pecasDoFoundry, ...carimbos.filter((c) => c.camada !== "rotulo")] });
    if (!g) return null;
    ancora = { cx: g.cx, cy: g.cy };
  }
  const k = TAM / size;
  const d = cena.dimensions ?? cena.getDimensions?.() ?? {};
  const perto = { x: (d.sceneX ?? 0) + ancora.cx * k, y: (d.sceneY ?? 0) + ancora.cy * k };
  const grade = typeof cena.grid?.getCenterPoint === "function" ? cena.grid : canvas?.scene === cena ? canvas.grid : null;
  const f = grade ? grade.getCenterPoint(perto) : perto;
  return { k, hub: { x: ancora.cx, y: ancora.cy }, f: { x: f.x, y: f.y }, grade: hubCena.grade, cenaId: cena.id };
}

const paraFoundry = (c, p) => ({ x: (p.x - c.hub.x) * c.k + c.f.x, y: (p.y - c.hub.y) * c.k + c.f.y });
const paraHub = (c, p) => ({ x: (p.x - c.f.x) / c.k + c.hub.x, y: (p.y - c.f.y) / c.k + c.hub.y });

/** Ponto da cena do Foundry → chave do hex do hub ("x|y"), ou null fora do mapa. */
function hexNoPonto(p) {
  if (!conv || !cenaDoHub) return null;
  const h = paraHub(conv, p);
  if (h.x < 0 || h.y < 0 || h.x > cenaDoHub.largura || h.y > cenaDoHub.altura) return null;
  return encaixarNoHex(conv.grade.type, conv.grade.size, { cx: conv.hub.x, cy: conv.hub.y }, h.x, h.y);
}

// ---------------------------------------------------------------- o que desenhar

function tile(c, chave, assinatura, src, r, rot, sort) {
  const w = Math.max(1, Math.round(r.w * c.k));
  const h = Math.max(1, Math.round(r.h * c.k));
  const centro = paraFoundry(c, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const meio = ancoraNoCentro();
  return {
    texture: { src, anchorX: 0.5, anchorY: 0.5 },
    x: Math.round(meio ? centro.x : centro.x - w / 2),
    y: Math.round(meio ? centro.y : centro.y - h / 2),
    width: w,
    height: h,
    rotation: rot ?? 0,
    sort,
    locked: true,
    flags: { [MOD]: { carimboId: chave, assinatura } },
  };
}

/** Rótulo do hub → Drawing só com texto (sem borda nem preenchimento). O retângulo
 *  do hub é estreito: o texto ganha 4× a largura, centrado nele (como no Owlbear). */
function rotulo(c, s, assinatura, sort) {
  const fonte = Math.min(256, Math.max(8, Math.round((s.fontSize ?? 8) * c.k)));
  const w = Math.max(fonte * 4, Math.round(s.w * c.k * 4));
  const h = Math.max(Math.round(fonte * 1.6), Math.round(s.h * c.k));
  const centro = paraFoundry(c, { x: s.x + s.w / 2, y: s.y + s.h / 2 });
  return {
    x: Math.round(centro.x - w / 2),
    y: Math.round(centro.y - h / 2),
    shape: { type: "r", width: w, height: h },
    text: s.texto,
    fontSize: fonte,
    textColor: s.color ?? "#2a2219",
    fillType: 0,
    fillAlpha: 0,
    strokeWidth: 0,
    strokeAlpha: 0,
    sort,
    locked: true,
    flags: { [MOD]: { carimboId: s.id, assinatura } },
  };
}

function desejados(c, hubCena, carimbos) {
  const m = new Map();
  if (hubCena.fundo?.src) {
    const r = { x: 0, y: 0, w: hubCena.largura, h: hubCena.altura };
    const ass = `${hubCena.fundo.src}|${r.w}|${r.h}`;
    m.set("fundo", { tipo: "Tile", ass, dados: () => tile(c, "fundo", ass, hubCena.fundo.src, r, 0, 0) });
  }
  hubCena.pecasDoFoundry.forEach((t, i) => {
    const chave = `foundry:${i}`;
    const ass = `${t.src}|${t.x}|${t.y}|${t.w}|${t.h}|${t.rot}`;
    m.set(chave, { tipo: "Tile", ass, dados: () => tile(c, chave, ass, t.src, t, t.rot, 1 + (t.sort ?? 0)) });
  });
  const ordem = [...carimbos].sort((a, b) => ORDEM_DA_CAMADA[a.camada] - ORDEM_DA_CAMADA[b.camada] || a.criadoEm - b.criadoEm);
  ordem.forEach((s, i) => {
    const ass = `${s.src}|${s.texto}|${s.x}|${s.y}|${s.w}|${s.h}|${s.rot}|${s.fontSize}|${s.color}`;
    const sort = 2000 + i;
    if (s.camada === "rotulo" && s.texto) m.set(s.id, { tipo: "Drawing", ass, dados: () => rotulo(c, s, ass, sort) });
    else if (s.src) m.set(s.id, { tipo: "Tile", ass, dados: () => tile(c, s.id, ass, s.src, s, s.rot, sort) });
  });
  return m;
}

// ---------------------------------------------------------------- sincronia

async function criarCena(hubCena) {
  const k = TAM / hubCena.grade.size;
  return Scene.create(
    {
      name: NOME_DA_CENA,
      // um hex de folga: casar a grade desloca o mapa em até meio hex.
      width: Math.ceil(hubCena.largura * k) + TAM,
      height: Math.ceil(hubCena.altura * k) + TAM,
      padding: 0,
      backgroundColor: hubCena.fundo?.cor ?? "#d9c9a3",
      grid: { type: hubCena.grade.type, size: TAM },
      tokenVision: false,
      flags: { [MOD]: { mapa: true } },
    },
    doSync(),
  );
}

/** Algo que a sincronização desenhou sumiu da cena (o mestre apagou o fundo, ou
 *  uma limpeza em massa que o hub ignorou): a versão do hub não muda por isso,
 *  então quem percebe é a cena. */
function faltaNaCena(cena) {
  const ids = new Set([...cena.tiles, ...cena.drawings].map((d) => d.flags?.[MOD]?.carimboId).filter(Boolean));
  return [...desenhados].some((id) => !ids.has(id));
}

/** Busca o mapa (só se a versão mudou, a não ser com `forcar`) e deixa a cena
 *  igual: apaga o que saiu ou mudou, cria o que falta. Qualquer mestre com a
 *  chave busca (o clique da paleta precisa da conversão), mas só o ativo escreve
 *  na cena — dois escrevendo duplicariam tudo. */
export const sincronizarMapa = umPorVez(async (forcar) => {
  if (!cfg("mapaLigado") || !cfg("chave") || !game.user.isGM) return;
  const escreve = souGmAtivo();
  let cena = cenaDoMapa();
  if (!cena && !escreve) return;
  const r = await mesa("mapa", forcar || !conv || !cena || (escreve && faltaNaCena(cena)) ? {} : { versao: versaoAtual });
  if (r.igual) return;
  if (!r.cena) {
    if (escreve) avisar("o hub ainda não tem o mapa da região.", "warn");
    return;
  }
  cena ??= await criarCena(r.cena);
  const carimbos = r.carimbos ?? [];
  const c = montarConversao(cena, r.cena, carimbos);
  if (!c) return;
  const redesenhar = !conv || conv.cenaId !== c.cenaId || conv.k !== c.k || conv.f.x !== c.f.x || conv.f.y !== c.f.y;
  conv = c;
  cenaDoHub = r.cena;
  carimbosDoHub = carimbos;
  versaoAtual = r.versao;
  if (!escreve) return;

  const quero = desejados(c, r.cena, carimbos);
  const sair = { Tile: [], Drawing: [] };
  const tem = new Set();
  for (const [tipo, colecao] of [["Tile", cena.tiles], ["Drawing", cena.drawings]]) {
    for (const doc of colecao) {
      const meta = doc.flags?.[MOD];
      if (!meta?.carimboId) continue;
      const alvo = quero.get(meta.carimboId);
      if (redesenhar || !alvo || alvo.tipo !== tipo || alvo.ass !== meta.assinatura || tem.has(meta.carimboId)) sair[tipo].push(doc.id);
      else tem.add(meta.carimboId);
    }
  }
  const entrar = { Tile: [], Drawing: [] };
  for (const [id, d] of quero) if (!tem.has(id)) entrar[d.tipo].push(d.dados());
  for (const tipo of ["Tile", "Drawing"]) {
    if (sair[tipo].length) await cena.deleteEmbeddedDocuments(tipo, sair[tipo], doSync());
    if (entrar[tipo].length) await cena.createEmbeddedDocuments(tipo, entrar[tipo], doSync());
  }
  desenhados = new Set(quero.keys());
});

/** O mestre apagou um carimbo (Delete no Tile/Drawing): apaga no hub também.
 *  Limpeza em massa (muitos de uma vez) NÃO apaga nada no hub — seria fácil
 *  demais um "limpar tiles" acabar com o mapa de todos os mestres. */
export function vigiarApagados() {
  let pendentes = [];
  let espera = null;
  const apagou = (doc, options, userId) => {
    if (ehDoSync(options) || userId !== game.user.id || !game.user.isGM) return;
    if (doc.parent?.getFlag(MOD, "mapa") !== true) return;
    const id = doc.flags?.[MOD]?.carimboId;
    // fundo e peças antigas do Foundry não são carimbos: não apaga nada no hub, e
    // o próximo ciclo do mestre ativo os põe de volta (faltaNaCena)
    if (!id || id === "fundo" || id.startsWith("foundry:")) return;
    pendentes.push(id);
    clearTimeout(espera);
    espera = setTimeout(async () => {
      const ids = pendentes;
      pendentes = [];
      if (ids.length > 3) {
        avisar(`${ids.length} carimbos apagados de uma vez: no hub nada mudou, eles voltam no próximo ciclo. Para apagar no mapa de todos, use a borracha.`, "warn");
      } else {
        for (const id of ids) await mesa("apagarCarimbo", { id }).catch((e) => avisar(e.message, "error"));
      }
      await sincronizarMapa(true).catch(() => undefined);
    }, 400);
  };
  Hooks.on("deleteTile", apagou);
  Hooks.on("deleteDrawing", apagou);
  // A cena do mapa apagada à mão: o mestre desligou o mapa.
  Hooks.on("deleteScene", (cena, options, userId) => {
    if (cena.getFlag(MOD, "mapa") !== true || userId !== game.user.id) return;
    conv = null;
    void gravarCfg("mapaLigado", false);
  });
}

// ---------------------------------------------------------------- carimbar

/** A ferramenta armada pela paleta: { tipo:'peca', id, rot } | { tipo:'texto', texto } | { tipo:'borracha' } | null */
let ferramenta = null;
export const ferramentaAtual = () => ferramenta;

export function escolherFerramenta(f) {
  ferramenta = f;
  if (f && canvas?.scene?.getFlag(MOD, "mapa") !== true)
    avisar(`abra a cena "${NOME_DA_CENA}" e clique no hex.`, "warn");
  Hooks.callAll(`${MOD}.ferramenta`, f);
}

/** O carimbo mais de cima no hex clicado (marco > caminho > terreno; o mais novo vence). */
function carimboNoHex(hexKey) {
  const g = conv.grade;
  const ancora = { cx: conv.hub.x, cy: conv.hub.y };
  return [...carimbosDoHub]
    .filter((s) => encaixarNoHex(g.type, g.size, ancora, s.x + s.w / 2, s.y + s.h / 2) === hexKey)
    .sort((a, b) => ORDEM_DA_CAMADA[b.camada] - ORDEM_DA_CAMADA[a.camada] || b.criadoEm - a.criadoEm)[0];
}

async function clicou(ev) {
  const f = ferramenta;
  if (!f || ev.button !== 0 || canvas.scene?.getFlag(MOD, "mapa") !== true) return;
  const p = ev.getLocalPosition?.(canvas.stage) ?? canvas.mousePosition;
  const hexKey = hexNoPonto(p);
  if (!hexKey) {
    avisar("fora do mapa da região — ou o mapa ainda está carregando.", "warn");
    return;
  }
  let tirar;
  try {
    if (f.tipo === "borracha") {
      const alvo = carimboNoHex(hexKey);
      if (!alvo) return;
      tirar = marcarPendente(hexKey, true);
      await mesa("apagarCarimbo", { id: alvo.id });
    } else {
      tirar = marcarPendente(hexKey, false);
      await mesa("carimbar", f.tipo === "peca" ? { hexKey, peca: f.id, rot: f.rot } : { hexKey, texto: f.texto });
    }
    await sincronizarMapa(true);
  } catch (e) {
    avisar(e.message || "não deu para carimbar.", "error");
  } finally {
    tirar?.();
  }
}

/** Clique esperando o hub: um círculo pulsando no hex, só na tela de quem clicou
 *  (desenho solto no canvas, não vira documento), até a cena redesenhar.
 *  Devolve quem o tira. Se o PIXI desta versão do Foundry não colaborar, fica
 *  sem o círculo — nunca atrapalha o carimbo. */
function marcarPendente(hexKey, apagando) {
  try {
    const [x, y] = hexKey.split("|").map(Number);
    const camada = canvas?.controls ?? canvas?.interface;
    if (!conv || !camada || !Number.isFinite(x) || !Number.isFinite(y)) return () => {};
    const c = paraFoundry(conv, { x, y });
    const r = conv.grade.size * conv.k * 0.4;
    const cor = apagando ? 0xe2664a : 0xcba25a;
    const g = new PIXI.Graphics();
    g.lineStyle(Math.max(2, r / 6), cor, 1).beginFill(cor, 0.3).drawCircle(0, 0, r).endFill();
    g.position.set(c.x, c.y);
    camada.addChild(g);
    let t = 0;
    const pulso = () => {
      t += canvas.app.ticker.deltaMS / 450;
      g.alpha = 0.55 + 0.45 * Math.sin(t * Math.PI);
    };
    canvas.app.ticker.add(pulso);
    return () => {
      canvas.app?.ticker?.remove(pulso);
      g.destroy();
    };
  } catch {
    return () => {};
  }
}

/** Liga o clique da paleta no palco do canvas (uma vez só: o palco sobrevive à
 *  troca de cena) e o Esc que desarma. */
export function prepararCarimbo() {
  const ligar = () => {
    if (!canvas?.stage || canvas.stage[MOD]) return;
    canvas.stage[MOD] = true;
    canvas.stage.on("pointerdown", (ev) => void clicou(ev));
  };
  // o primeiro canvasReady costuma vir antes do ready do módulo
  ligar();
  Hooks.on("canvasReady", ligar);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ferramenta) escolherFerramenta(null);
  });
}

/** Liga o mapa neste mundo (cria a cena na primeira sincronização) e a abre. */
export async function ligarMapa(ligado) {
  await gravarCfg("mapaLigado", ligado);
  if (!ligado) {
    escolherFerramenta(null);
    return;
  }
  await sincronizarMapa(true);
  await cenaDoMapa()?.view();
}
