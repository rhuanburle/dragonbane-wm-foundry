// As fichas da mesa: o hub é a ficha oficial, o ator do Foundry é o espelho.
//
// O mestre ativo busca os heróis do chamado escolhido a cada poucos segundos e
// reimporta só quem mudou (a `versao` do hub é a impressão digital da ficha). Na
// volta, só PV e PD: mexeu no ator (dano no token, ficha), o módulo manda a
// DIFERENÇA ao hub — nunca o valor final, para um dano marcado no hub segundos
// antes não ser apagado por um Foundry atrasado. O resto (inventário, perícias,
// condições) se mexe no hub; aqui é sobrescrito na próxima versão.
import { doSync, MOD, avisar, cfg, ehDoSync, excluidos, imagemValida, marcarExcluido, mesa, souGmAtivo, umPorVez } from "./comum.js";

const PASTA = "West Marches";
const PHYS = ["weapon", "armor", "helmet", "item"];
/** derived.attributes do hub (rótulos pt-BR) → chave do sistema Dragonbane. */
const ATRIBUTO = { FOR: "str", CON: "con", AGI: "agl", AGL: "agl", INT: "int", VON: "wil", CAR: "cha" };
/** As seis condições do livro (p.51), na ordem dos atributos do sistema. */
const CONDICAO = { Exausto: "str", Adoecido: "con", Aturdido: "agl", Enraivecido: "int", Assustado: "wil", Desanimado: "cha" };
/** `system.age` do sistema. Ficha do hub sem idade fica de fora (o ator segue como está). */
const IDADES = new Set(["young", "adult", "old"]);
const idade = (f) => (IDADES.has(f.age) ? f.age : undefined);

/** heroId → { pv, pd, versao, callId, editavel } como o hub tem agora. PV/PD são
 *  a base da diferença que volta; `editavel` é se o hub aceita PV/PD (vivo e com
 *  a ficha no hub); `callId` é a missão de onde veio (herói de outra missão não manda). */
const conhecido = new Map();
/** Sobe a cada PV/PD mexido aqui: um ciclo que buscou ANTES não sobrescreve. */
let mexidas = 0;
/** heroId → envios de PV/PD ainda na fila. Com algum pendente, nem a resposta de
 *  um envio velho nem a importação mexem no PV/PD do ator. */
const pendentes = new Map();
const livre = (heroId, antes) => mexidas === antes && !pendentes.get(heroId);

function conhecer(h, callId, versao = h.versao) {
  conhecido.set(h.id, {
    pv: h.ficha.hp?.value ?? 0,
    pd: h.ficha.wp?.value ?? 0,
    versao,
    callId,
    editavel: h.fichaNoHub === true && h.estado === "alive",
  });
}
/** O último retrato da mesa, para a janela mostrar. */
export let ultimaMesa = null;

const igual = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

// ---------------------------------------------------------------- busca de itens

/** Clona um item por tipo e nome: itens do MUNDO primeiro (a fonte curada deste
 *  mestre), depois os compêndios pelo DoD_Utility do sistema. Mesma busca do
 *  `findItemObject` do módulo antigo (pull.js). */
async function acharItem(tipo, nome) {
  if (!nome) return null;
  const tipos = tipo ? [tipo] : PHYS;
  let doc = game.items?.find((i) => tipos.includes(i.type) && igual(i.name, nome)) ?? null;
  const U = globalThis.DoD_Utility;
  try {
    if (!doc && U) {
      if (tipo === "skill" && U.findSkill) doc = await U.findSkill(nome);
      else if (tipo === "kin" && U.findKin) doc = await U.findKin(nome);
      else if (tipo === "profession" && U.findProfession) doc = await U.findProfession(nome);
      else if (tipo === "ability" && U.findAbility) doc = await U.findAbility(nome);
      if (!doc && U.findItem) doc = await U.findItem(nome, tipo, game.items);
    }
  } catch (e) {
    console.warn(`${MOD} | busca de "${nome}" falhou`, e);
  }
  if (doc && !tipos.includes(doc.type)) doc = null;
  return doc ? doc.toObject() : null;
}

/** Cobre → `system.cost` ("N de ouro"), a maior moeda que fecha exato. */
function custo(cobre) {
  const n = Math.max(0, Math.round(Number(cobre) || 0));
  if (!n) return "";
  if (n % 100 === 0) return `${n / 100} de ouro`;
  if (n % 10 === 0) return `${n / 10} de prata`;
  return `${n} de cobre`;
}

/** Item do hub que este mundo não tem: nasce com o que a ficha do hub sabe dele. */
function itemDoHub(i) {
  const tipo = PHYS.includes(i.type) ? i.type : "item";
  const system = {
    itemDescription: "<p>Veio da ficha do hub (West Marches). Não existe neste mundo nem nos compêndios.</p>",
    quantity: Math.max(1, Number(i.qty) || 1),
    weight: Number(i.weight) || 0,
    cost: custo(i.costCopper),
  };
  if (tipo === "weapon") {
    Object.assign(system, {
      damage: i.damage ?? "",
      durability: Number(i.durability) || 0,
      range: i.range ?? "",
      features: Array.isArray(i.features) ? i.features : [],
      str: Number(i.str) || 0,
      grip: { value: i.grip || "none" },
    });
  }
  return { name: i.name, type: tipo, img: imagemValida(i.img) ? i.img : "icons/svg/item-bag.svg", system };
}

// ---------------------------------------------------------------- ficha → ator

/** Só os campos do sistema que mudaram (atualizar o que já está igual dispara
 *  hooks e redesenha a ficha à toa a cada ciclo). */
function camposDoSistema(ator, f) {
  const quero = {
    "system.hitPoints.value": f.hp?.value,
    "system.willPoints.value": f.wp?.value,
    "system.currency.gc": f.money?.gold ?? 0,
    "system.currency.sc": f.money?.silver ?? 0,
    "system.currency.cc": f.money?.copper ?? 0,
    // Os atributos do hub já trazem o modificador de idade. Gravar a idade pelo
    // update não reaplica nada (quem soma a diferença é a edição na ficha, o
    // _onAgeEdit do sistema), e os atributos são regravados logo abaixo.
    "system.age": idade(f),
  };
  for (const [rotulo, v] of Object.entries(f.attributes ?? {})) {
    const k = ATRIBUTO[rotulo];
    if (!k || typeof v !== "number") continue;
    quero[`system.attributes.${k}.value`] = v;
    quero[`system.attributes.${k}.base`] = v;
  }
  const marcadas = new Set((f.conditions ?? []).map((c) => CONDICAO[c]).filter(Boolean));
  for (const k of Object.values(CONDICAO)) quero[`system.conditions.${k}.value`] = marcadas.has(k);
  const mudou = {};
  for (const [campo, v] of Object.entries(quero)) {
    if (v === undefined) continue;
    if (!ator || foundry.utils.getProperty(ator, campo) !== v) mudou[campo] = v;
  }
  return mudou;
}

/** Deixa os itens do ator iguais aos da ficha do hub.
 *  - Perícias: valor e marca de avanço; a que falta é criada.
 *  - Equipamento: o hub manda — sobra no ator sai, falta entra, quantidade e
 *    "vestido/guardado" acompanham. Pareia por nome (dois itens de mesmo nome
 *    pareiam na ordem).
 *  - Habilidades e magias: só ACRESCENTA. As inatas da ancestralidade não vêm
 *    no hub, e apagar o que não reconhecemos levaria junto o que o sistema pôs. */
async function acertarItens(ator, f, criando) {
  const criar = [];
  const mudar = [];
  const apagar = [];
  const faltou = [];
  const tem = (tipo, nome) => ator.items.some((it) => it.type === tipo && igual(it.name, nome));

  if (criando) {
    for (const [tipo, nome] of [["kin", f.kin], ["profession", f.profession]]) {
      if (!nome || tem(tipo, nome)) continue;
      const obj = await acharItem(tipo, nome);
      if (obj) criar.push(obj);
      else faltou.push(nome);
    }
  }

  for (const s of f.skills ?? []) {
    const avanco = s.marked ? 1 : 0;
    const atual = ator.items.find((it) => it.type === "skill" && igual(it.name, s.name));
    if (atual) {
      const u = { _id: atual.id };
      if (atual.system.value !== s.value) u["system.value"] = s.value;
      if (Number(atual.system.advance ?? 0) > 0 !== !!s.marked) u["system.advance"] = avanco;
      if (Object.keys(u).length > 1) mudar.push(u);
      continue;
    }
    const obj = (await acharItem("skill", s.name)) ?? { name: s.name, type: "skill", system: {} };
    Object.assign(obj.system, { value: s.value, advance: avanco });
    if (s.skillType) obj.system.skillType = s.skillType;
    if (s.attribute) obj.system.attribute = s.attribute;
    criar.push(obj);
  }

  for (const nome of f.heroicAbilities ?? []) {
    if (tem("ability", nome)) continue;
    criar.push((await acharItem("ability", nome)) ?? { name: nome, type: "ability", system: {} });
  }
  for (const m of f.spells ?? []) {
    if (tem("spell", m.name)) continue;
    const obj = (await acharItem("spell", m.name)) ?? { name: m.name, type: "spell", system: { rank: m.rank ?? 0, school: m.school ?? "" } };
    criar.push(obj);
  }

  const noAtor = new Map();
  for (const it of ator.items) {
    if (!PHYS.includes(it.type)) continue;
    const k = it.name.toLowerCase();
    noAtor.set(k, [...(noAtor.get(k) ?? []), it]);
  }
  for (const i of f.inventory ?? []) {
    const fila = noAtor.get(String(i.name).toLowerCase());
    const it = fila?.shift();
    const quero = { "system.quantity": Math.max(1, Number(i.qty) || 1), "system.worn": !!i.worn, "system.storage": !!i.storage };
    if (it) {
      const u = { _id: it.id };
      for (const [campo, v] of Object.entries(quero)) if (foundry.utils.getProperty(it, campo) !== v) u[campo] = v;
      if (Object.keys(u).length > 1) mudar.push(u);
      continue;
    }
    const obj = (await acharItem(null, i.name)) ?? itemDoHub(i);
    obj.system = { ...obj.system, quantity: quero["system.quantity"], worn: quero["system.worn"], storage: quero["system.storage"] };
    criar.push(obj);
  }
  for (const sobra of noAtor.values()) apagar.push(...sobra.map((it) => it.id));

  if (apagar.length) await ator.deleteEmbeddedDocuments("Item", apagar, doSync());
  if (mudar.length) await ator.updateEmbeddedDocuments("Item", mudar, doSync());
  if (criar.length) await ator.createEmbeddedDocuments("Item", criar, doSync());
  return faltou;
}

async function pasta() {
  return (
    game.folders.find((p) => p.type === "Actor" && p.getFlag(MOD, "pasta")) ??
    (await Folder.create({ name: PASTA, type: "Actor", color: "#6b4f2a", flags: { [MOD]: { pasta: true } } }))
  );
}

/** Cria ou atualiza o ator do herói. Se PV/PD mexeram aqui desde a busca
 *  (`antes`), o valor do hub está velho: fica de fora e o próximo ciclo traz o
 *  certo. A conferência é na hora de gravar — a importação demora (compêndios). */
async function importar(h, ator, callId, antes) {
  const f = h.ficha;
  const criando = !ator;
  const img = imagemValida(h.img) ? h.img : null;
  if (criando) {
    ator = await Actor.create(
      {
        name: h.nome || "Herói",
        type: "character",
        folder: (await pasta()).id,
        ...(img ? { img } : {}),
        // Nasce com a idade certa: o default do sistema é 'adult'.
        ...(idade(f) ? { system: { age: idade(f) } } : {}),
        prototypeToken: { name: h.nome, actorLink: true, ...(img ? { texture: { src: img } } : {}) },
        flags: { [MOD]: { heroId: h.id } },
      },
      doSync(),
    );
  }
  const faltou = await acertarItens(ator, f, criando);
  if (criando) {
    // A ficha do sistema completa a profissão e as inatas da ancestralidade no
    // drop, não na criação — o pull.js antigo chamava os mesmos métodos.
    try {
      if (typeof ator.updateProfession === "function") await ator.updateProfession();
      if (typeof ator.updateKinAbilities === "function") await ator.updateKinAbilities();
    } catch (e) {
      console.warn(`${MOD} | updateProfession/updateKinAbilities falhou`, e);
    }
    // updateProfession pode ter criado perícias da profissão com o valor base:
    // uma segunda passada põe o valor do hub nelas.
    await acertarItens(ator, f, false);
  }
  const sistema = camposDoSistema(ator, f);
  const comPvPd = livre(h.id, antes);
  if (!comPvPd) {
    delete sistema["system.hitPoints.value"];
    delete sistema["system.willPoints.value"];
  }
  const dados = { ...sistema, [`flags.${MOD}.versao`]: comPvPd ? h.versao : null };
  if (ator.name !== h.nome) dados.name = h.nome;
  if (img && ator.img !== img) Object.assign(dados, { img, "prototypeToken.texture.src": img });
  await ator.update(dados, doSync());
  // mexeu enquanto gravávamos: o valor do hub já é velho, reimporta no próximo ciclo
  if (comPvPd && livre(h.id, antes)) conhecer(h, callId);
  else if (comPvPd) await ator.update({ [`flags.${MOD}.versao`]: null }, doSync());
  if (criando) avisar(`${h.nome} chegou do hub (pasta "${PASTA}"). Dê a posse ao jogador se ele for mexer no token.`);
  if (faltou.length) avisar(`${h.nome}: não achei ${faltou.join(", ")} neste mundo — o resto entrou.`, "warn");
}

/** Busca os heróis do chamado e deixa os atores iguais. */
export const sincronizarFichas = umPorVez(async () => {
  const callId = cfg("callId");
  if (!callId || !cfg("chave") || !souGmAtivo()) return;
  const antes = mexidas;
  const r = await mesa("fichas", { callId });
  ultimaMesa = r;
  const fora = new Set(excluidos());
  for (const h of r.herois ?? []) {
    // Excluído pelo mestre nesta missão: não volta sozinho (a janela /wm traz de volta).
    if (!h.ficha || fora.has(h.id)) continue;
    const ator = game.actors.find((a) => a.getFlag(MOD, "heroId") === h.id);
    if (ator && ator.getFlag(MOD, "versao") === h.versao) {
      if (conhecido.get(h.id)?.callId !== callId && livre(h.id, antes)) conhecer(h, callId);
      continue;
    }
    try {
      await importar(h, ator, callId, antes);
    } catch (e) {
      console.error(`${MOD} | importar ${h.nome}`, e);
      avisar(`não deu para importar ${h.nome}: ${e.message}`, "error");
    }
  }
  Hooks.callAll(`${MOD}.mesa`, r);
});

/** O mestre excluiu o ator de um herói da mesa: sem isto o próximo ciclo (3 s)
 *  o recriava. Fica excluído nesta missão até a janela /wm trazer de volta. */
export function vigiarExclusoes() {
  Hooks.on("deleteActor", (ator, options) => {
    if (ehDoSync(options) || !souGmAtivo()) return;
    const heroId = ator.getFlag(MOD, "heroId");
    if (!heroId || !cfg("callId")) return;
    conhecido.delete(heroId);
    void marcarExcluido(heroId, true).then(() => {
      avisar(`${ator.name} saiu da mesa e não volta nesta missão. Para trazer de volta, use a janela /wm.`);
      Hooks.callAll(`${MOD}.mesa`, ultimaMesa);
    });
  });
}

/** Traz de volta um herói excluído: o próximo ciclo o importa de novo. */
export async function trazerDeVolta(heroId) {
  await marcarExcluido(heroId, false);
  await sincronizarFichas();
}

/** PV/PD mexidos no Foundry → a diferença vai para o hub. */
export function vigiarPvPd() {
  Hooks.on("updateActor", (ator, mudancas, options) => {
    if (ehDoSync(options) || ator.isToken || !souGmAtivo()) return;
    const heroId = ator.getFlag(MOD, "heroId");
    const base = heroId && conhecido.get(heroId);
    // herói de outra missão (o mestre trocou): o hub recusaria, nem tenta
    if (!base || base.callId !== cfg("callId") || !cfg("chave")) return;
    const pv = foundry.utils.getProperty(mudancas, "system.hitPoints.value");
    const pd = foundry.utils.getProperty(mudancas, "system.willPoints.value");
    const corpo = {};
    if (typeof pv === "number" && pv !== base.pv) corpo.dpv = pv - base.pv;
    if (typeof pd === "number" && pd !== base.pd) corpo.dpd = pd - base.pd;
    if (!Object.keys(corpo).length) return;
    if (!base.editavel) {
      // Caído ou com a ficha ainda no Foundry antigo: o hub não aceita. Volta o
      // ator ao valor do hub em vez de deixar um PV que não existe lá.
      void ator.update({ "system.hitPoints.value": base.pv, "system.willPoints.value": base.pd }, doSync());
      avisar(`${ator.name}: PV/PD deste herói não mudam pela mesa (caído, ou ficha ainda no Foundry antigo). Ajuste no hub.`, "warn");
      return;
    }
    mexidas++;
    // A base anda junto, já: o próximo clique manda só a diferença dele.
    base.pv = typeof pv === "number" ? pv : base.pv;
    base.pd = typeof pd === "number" ? pd : base.pd;
    pendentes.set(heroId, (pendentes.get(heroId) ?? 0) + 1);
    enviar(() => mandarPvPd(ator, heroId, base.callId, corpo));
  });
}

/** Os envios vão em fila: dois danos seguidos chegam na ordem. */
let filaDeEnvio = Promise.resolve();
const enviar = (fn) => (filaDeEnvio = filaDeEnvio.then(fn, fn));

async function mandarPvPd(ator, heroId, callId, corpo) {
  const base = conhecido.get(heroId);
  try {
    // `versao` é a que o ator espelha: o hub devolve a nova só se ninguém mudou a
    // ficha lá no meio — aí o ator fica com ela e não reimporta a cada dano.
    const r = await mesa("pvpd", { callId, charId: heroId, ...corpo, versao: base?.versao ?? null });
    if (base) base.versao = r.versao ?? null;
    if (pendentes.get(heroId) > 1) return; // outro envio vem aí: a resposta dele vale
    // O hub pode ter limitado (0..máx) ou somado com um dano marcado lá: o ator
    // fica com o valor do hub.
    if (base) Object.assign(base, { pv: r.hp.value, pd: r.wp.value });
    const acerto = { [`flags.${MOD}.versao`]: r.versao ?? null };
    if (ator.system.hitPoints.value !== r.hp.value) acerto["system.hitPoints.value"] = r.hp.value;
    if (ator.system.willPoints.value !== r.wp.value) acerto["system.willPoints.value"] = r.wp.value;
    await ator.update(acerto, doSync());
  } catch (e) {
    // Não chegou: esquece a versão para o próximo ciclo trazer o valor do hub de
    // volta (o Foundry não fica mostrando um PV que o hub não tem).
    conhecido.delete(heroId);
    await ator.update({ [`flags.${MOD}.versao`]: null }, doSync()).catch(() => undefined);
    avisar(`PV/PD de ${ator.name} não foram para o hub: ${e.message}`, "warn");
  } finally {
    pendentes.set(heroId, Math.max(0, (pendentes.get(heroId) ?? 1) - 1));
  }
}
