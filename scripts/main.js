//#region foundry/dragonbane-wm-mesa/src/comum.js
var MOD = "dragonbane-wm-mesa";
var HUB_PADRAO = "https://dragonbane-west-marches.web.app";
function registrarConfiguracoes() {
	game.settings.register(MOD, "chave", {
		scope: "client",
		config: false,
		type: String,
		default: ""
	});
	game.settings.register(MOD, "hub", {
		name: "Endereço do hub",
		hint: "Só mude se for testar com outro hub. A API da mesa é <hub>/api/mesa.",
		scope: "world",
		config: true,
		type: String,
		default: HUB_PADRAO
	});
	game.settings.register(MOD, "callId", {
		scope: "world",
		config: false,
		type: String,
		default: ""
	});
	game.settings.register(MOD, "mapaLigado", {
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});
}
var cfg = (k) => game.settings.get(MOD, k);
var gravarCfg = (k, v) => game.settings.set(MOD, k, v);
var hub = () => String(cfg("hub") || "https://dragonbane-west-marches.web.app").replace(/\/+$/, "");
/** Opções de escrita que marcam "fomos nós" — os hooks ignoram para não fazer eco. */
var DO_SYNC = { [MOD]: { sync: true } };
var ehDoSync = (options) => options?.[MOD]?.sync === true;
/** Só o mestre ativo fala com o hub: com dois mestres logados no mesmo mundo,
*  os dois criariam o mesmo ator e mandariam o mesmo dano duas vezes. */
function souGmAtivo() {
	const ativo = game.users?.activeGM;
	return ativo ? ativo.isSelf : game.user?.isGM === true;
}
var ErroDaMesa = class extends Error {
	constructor(message, status) {
		super(message);
		this.status = status;
	}
};
/** Uma ação da API da mesa (functions: mesa). */
async function mesa(acao, corpo = {}, chave = cfg("chave")) {
	if (!chave) throw new ErroDaMesa("Cole a sua chave de mestre (Perfil do hub) — digite /wm no chat.", 401);
	const r = await fetch(`${hub()}/api/mesa`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-wm-chave": chave
		},
		body: JSON.stringify({
			acao,
			origem: "foundry",
			...corpo
		})
	});
	const b = await r.json().catch(() => ({}));
	if (!r.ok) throw new ErroDaMesa(String(b.error ?? `O hub respondeu ${r.status}.`), r.status);
	return b;
}
/** Uma sincronização por vez. O laço e os botões da janela se cruzam: rodando
*  juntas, as duas criariam o mesmo ator/carimbo duas vezes. Chamada durante
*  outra espera ela acabar; várias nesse meio viram UMA (e `forcar` de qualquer
*  uma delas vale para essa). Mesma ideia do `umPorVez` da extensão do Owlbear. */
function umPorVez(fn) {
	let fila = Promise.resolve();
	let esperando = false;
	let forcar = false;
	return (f = false) => {
		forcar ||= f;
		if (esperando) return fila;
		esperando = true;
		fila = fila.catch(() => void 0).then(() => {
			esperando = false;
			const agora = forcar;
			forcar = false;
			return fn(agora);
		});
		return fila;
	};
}
/** Link de imagem que o Foundry aceita como `img` (o DoDActor recusa o ator
*  inteiro com uma URL sem extensão de imagem). Mesma regra do pull.js antigo. */
function imagemValida(url) {
	if (typeof url !== "string") return false;
	const t = url.trim();
	return /^https?:\/\//i.test(t) && /\.(png|jpe?g|webp|gif|svg|avif|bmp|tiff?|apng)$/i.test(t.split(/[?#]/)[0]);
}
var avisar = (msg, tipo = "info") => ui.notifications?.[tipo]?.(`West Marches: ${msg}`);
//#endregion
//#region foundry/dragonbane-wm-mesa/src/fichas.js
var PASTA = "West Marches";
var PHYS = [
	"weapon",
	"armor",
	"helmet",
	"item"
];
/** derived.attributes do hub (rótulos pt-BR) → chave do sistema Dragonbane. */
var ATRIBUTO = {
	FOR: "str",
	CON: "con",
	AGI: "agl",
	AGL: "agl",
	INT: "int",
	VON: "wil",
	CAR: "cha"
};
/** As seis condições do livro (p.51), na ordem dos atributos do sistema. */
var CONDICAO = {
	Exausto: "str",
	Adoecido: "con",
	Aturdido: "agl",
	Enraivecido: "int",
	Assustado: "wil",
	Desanimado: "cha"
};
/** heroId → { pv, pd, versao, callId, editavel } como o hub tem agora. PV/PD são
*  a base da diferença que volta; `editavel` é se o hub aceita PV/PD (vivo e com
*  a ficha no hub); `callId` é a missão de onde veio (herói de outra missão não manda). */
var conhecido = /* @__PURE__ */ new Map();
/** Sobe a cada PV/PD mexido aqui: um ciclo que buscou ANTES não sobrescreve. */
var mexidas = 0;
/** heroId → envios de PV/PD ainda na fila. Com algum pendente, nem a resposta de
*  um envio velho nem a importação mexem no PV/PD do ator. */
var pendentes = /* @__PURE__ */ new Map();
var livre = (heroId, antes) => mexidas === antes && !pendentes.get(heroId);
function conhecer(h, callId, versao = h.versao) {
	conhecido.set(h.id, {
		pv: h.ficha.hp?.value ?? 0,
		pd: h.ficha.wp?.value ?? 0,
		versao,
		callId,
		editavel: h.fichaNoHub === true && h.estado === "alive"
	});
}
/** O último retrato da mesa, para a janela mostrar. */
var ultimaMesa = null;
var igual = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
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
		cost: custo(i.costCopper)
	};
	if (tipo === "weapon") Object.assign(system, {
		damage: i.damage ?? "",
		durability: Number(i.durability) || 0,
		range: i.range ?? "",
		features: Array.isArray(i.features) ? i.features : [],
		str: Number(i.str) || 0,
		grip: { value: i.grip || "none" }
	});
	return {
		name: i.name,
		type: tipo,
		img: imagemValida(i.img) ? i.img : "icons/svg/item-bag.svg",
		system
	};
}
/** Só os campos do sistema que mudaram (atualizar o que já está igual dispara
*  hooks e redesenha a ficha à toa a cada ciclo). */
function camposDoSistema(ator, f) {
	const quero = {
		"system.hitPoints.value": f.hp?.value,
		"system.willPoints.value": f.wp?.value,
		"system.currency.gc": f.money?.gold ?? 0,
		"system.currency.sc": f.money?.silver ?? 0,
		"system.currency.cc": f.money?.copper ?? 0
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
		if (v === void 0) continue;
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
	if (criando) for (const [tipo, nome] of [["kin", f.kin], ["profession", f.profession]]) {
		if (!nome || tem(tipo, nome)) continue;
		const obj = await acharItem(tipo, nome);
		if (obj) criar.push(obj);
		else faltou.push(nome);
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
		const obj = await acharItem("skill", s.name) ?? {
			name: s.name,
			type: "skill",
			system: {}
		};
		Object.assign(obj.system, {
			value: s.value,
			advance: avanco
		});
		if (s.skillType) obj.system.skillType = s.skillType;
		if (s.attribute) obj.system.attribute = s.attribute;
		criar.push(obj);
	}
	for (const nome of f.heroicAbilities ?? []) {
		if (tem("ability", nome)) continue;
		criar.push(await acharItem("ability", nome) ?? {
			name: nome,
			type: "ability",
			system: {}
		});
	}
	for (const m of f.spells ?? []) {
		if (tem("spell", m.name)) continue;
		const obj = await acharItem("spell", m.name) ?? {
			name: m.name,
			type: "spell",
			system: {
				rank: m.rank ?? 0,
				school: m.school ?? ""
			}
		};
		criar.push(obj);
	}
	const noAtor = /* @__PURE__ */ new Map();
	for (const it of ator.items) {
		if (!PHYS.includes(it.type)) continue;
		const k = it.name.toLowerCase();
		noAtor.set(k, [...noAtor.get(k) ?? [], it]);
	}
	for (const i of f.inventory ?? []) {
		const it = noAtor.get(String(i.name).toLowerCase())?.shift();
		const quero = {
			"system.quantity": Math.max(1, Number(i.qty) || 1),
			"system.worn": !!i.worn,
			"system.storage": !!i.storage
		};
		if (it) {
			const u = { _id: it.id };
			for (const [campo, v] of Object.entries(quero)) if (foundry.utils.getProperty(it, campo) !== v) u[campo] = v;
			if (Object.keys(u).length > 1) mudar.push(u);
			continue;
		}
		const obj = await acharItem(null, i.name) ?? itemDoHub(i);
		obj.system = {
			...obj.system,
			quantity: quero["system.quantity"],
			worn: quero["system.worn"],
			storage: quero["system.storage"]
		};
		criar.push(obj);
	}
	for (const sobra of noAtor.values()) apagar.push(...sobra.map((it) => it.id));
	if (apagar.length) await ator.deleteEmbeddedDocuments("Item", apagar, DO_SYNC);
	if (mudar.length) await ator.updateEmbeddedDocuments("Item", mudar, DO_SYNC);
	if (criar.length) await ator.createEmbeddedDocuments("Item", criar, DO_SYNC);
	return faltou;
}
async function pasta() {
	return game.folders.find((p) => p.type === "Actor" && p.getFlag("dragonbane-wm-mesa", "pasta")) ?? await Folder.create({
		name: PASTA,
		type: "Actor",
		color: "#6b4f2a",
		flags: { ["dragonbane-wm-mesa"]: { pasta: true } }
	});
}
/** Cria ou atualiza o ator do herói. Se PV/PD mexeram aqui desde a busca
*  (`antes`), o valor do hub está velho: fica de fora e o próximo ciclo traz o
*  certo. A conferência é na hora de gravar — a importação demora (compêndios). */
async function importar(h, ator, callId, antes) {
	const f = h.ficha;
	const criando = !ator;
	const img = imagemValida(h.img) ? h.img : null;
	if (criando) ator = await Actor.create({
		name: h.nome || "Herói",
		type: "character",
		folder: (await pasta()).id,
		...img ? { img } : {},
		prototypeToken: {
			name: h.nome,
			actorLink: true,
			...img ? { texture: { src: img } } : {}
		},
		flags: { [MOD]: { heroId: h.id } }
	}, DO_SYNC);
	const faltou = await acertarItens(ator, f, criando);
	if (criando) {
		try {
			if (typeof ator.updateProfession === "function") await ator.updateProfession();
			if (typeof ator.updateKinAbilities === "function") await ator.updateKinAbilities();
		} catch (e) {
			console.warn(`${MOD} | updateProfession/updateKinAbilities falhou`, e);
		}
		await acertarItens(ator, f, false);
	}
	const sistema = camposDoSistema(ator, f);
	const comPvPd = livre(h.id, antes);
	if (!comPvPd) {
		delete sistema["system.hitPoints.value"];
		delete sistema["system.willPoints.value"];
	}
	const dados = {
		...sistema,
		[`flags.${MOD}.versao`]: comPvPd ? h.versao : null
	};
	if (ator.name !== h.nome) dados.name = h.nome;
	if (img && ator.img !== img) Object.assign(dados, {
		img,
		"prototypeToken.texture.src": img
	});
	await ator.update(dados, DO_SYNC);
	if (comPvPd && livre(h.id, antes)) conhecer(h, callId);
	else if (comPvPd) await ator.update({ [`flags.${MOD}.versao`]: null }, DO_SYNC);
	if (criando) avisar(`${h.nome} chegou do hub (pasta "${PASTA}"). Dê a posse ao jogador se ele for mexer no token.`);
	if (faltou.length) avisar(`${h.nome}: não achei ${faltou.join(", ")} neste mundo — o resto entrou.`, "warn");
}
/** Busca os heróis do chamado e deixa os atores iguais. */
var sincronizarFichas = umPorVez(async () => {
	const callId = cfg("callId");
	if (!callId || !cfg("chave") || !souGmAtivo()) return;
	const antes = mexidas;
	const r = await mesa("fichas", { callId });
	ultimaMesa = r;
	for (const h of r.herois ?? []) {
		if (!h.ficha) continue;
		const ator = game.actors.find((a) => a.getFlag(MOD, "heroId") === h.id);
		if (ator && ator.getFlag("dragonbane-wm-mesa", "versao") === h.versao) {
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
/** PV/PD mexidos no Foundry → a diferença vai para o hub. */
function vigiarPvPd() {
	Hooks.on("updateActor", (ator, mudancas, options) => {
		if (ehDoSync(options) || ator.isToken || !souGmAtivo()) return;
		const heroId = ator.getFlag(MOD, "heroId");
		const base = heroId && conhecido.get(heroId);
		if (!base || base.callId !== cfg("callId") || !cfg("chave")) return;
		const pv = foundry.utils.getProperty(mudancas, "system.hitPoints.value");
		const pd = foundry.utils.getProperty(mudancas, "system.willPoints.value");
		const corpo = {};
		if (typeof pv === "number" && pv !== base.pv) corpo.dpv = pv - base.pv;
		if (typeof pd === "number" && pd !== base.pd) corpo.dpd = pd - base.pd;
		if (!Object.keys(corpo).length) return;
		if (!base.editavel) {
			ator.update({
				"system.hitPoints.value": base.pv,
				"system.willPoints.value": base.pd
			}, DO_SYNC);
			avisar(`${ator.name}: PV/PD deste herói não mudam pela mesa (caído, ou ficha ainda no Foundry antigo). Ajuste no hub.`, "warn");
			return;
		}
		mexidas++;
		base.pv = typeof pv === "number" ? pv : base.pv;
		base.pd = typeof pd === "number" ? pd : base.pd;
		pendentes.set(heroId, (pendentes.get(heroId) ?? 0) + 1);
		enviar(() => mandarPvPd(ator, heroId, base.callId, corpo));
	});
}
/** Os envios vão em fila: dois danos seguidos chegam na ordem. */
var filaDeEnvio = Promise.resolve();
var enviar = (fn) => filaDeEnvio = filaDeEnvio.then(fn, fn);
async function mandarPvPd(ator, heroId, callId, corpo) {
	const base = conhecido.get(heroId);
	try {
		const r = await mesa("pvpd", {
			callId,
			charId: heroId,
			...corpo,
			versao: base?.versao ?? null
		});
		if (base) base.versao = r.versao ?? null;
		if (pendentes.get(heroId) > 1) return;
		if (base) Object.assign(base, {
			pv: r.hp.value,
			pd: r.wp.value
		});
		const acerto = { [`flags.${MOD}.versao`]: r.versao ?? null };
		if (ator.system.hitPoints.value !== r.hp.value) acerto["system.hitPoints.value"] = r.hp.value;
		if (ator.system.willPoints.value !== r.wp.value) acerto["system.willPoints.value"] = r.wp.value;
		await ator.update(acerto, DO_SYNC);
	} catch (e) {
		conhecido.delete(heroId);
		await ator.update({ [`flags.${MOD}.versao`]: null }, DO_SYNC).catch(() => void 0);
		avisar(`PV/PD de ${ator.name} não foram para o hub: ${e.message}`, "warn");
	} finally {
		pendentes.set(heroId, Math.max(0, (pendentes.get(heroId) ?? 1) - 1));
	}
}
//#endregion
//#region src/data/mapa/paleta.ts
var PALETA = [
	{
		id: "floresta",
		nome: "Floresta",
		camada: "terreno"
	},
	{
		id: "bosque",
		nome: "Bosque",
		camada: "terreno"
	},
	{
		id: "pinheiral",
		nome: "Pinheiral",
		camada: "terreno"
	},
	{
		id: "planicie",
		nome: "Planície",
		camada: "terreno"
	},
	{
		id: "plantacao",
		nome: "Plantação",
		camada: "terreno"
	},
	{
		id: "colinas",
		nome: "Colinas",
		camada: "terreno"
	},
	{
		id: "montanhas",
		nome: "Montanhas",
		camada: "terreno"
	},
	{
		id: "pantano",
		nome: "Pântano",
		camada: "terreno"
	},
	{
		id: "deserto",
		nome: "Deserto",
		camada: "terreno"
	},
	{
		id: "ermo",
		nome: "Ermo",
		camada: "terreno"
	},
	{
		id: "mar",
		nome: "Mar",
		camada: "terreno"
	},
	{
		id: "estrada-reta",
		nome: "Estrada reta",
		camada: "caminho"
	},
	{
		id: "estrada-curva",
		nome: "Estrada em curva",
		camada: "caminho"
	},
	{
		id: "estrada-fechada",
		nome: "Estrada em curva fechada",
		camada: "caminho"
	},
	{
		id: "estrada-fim",
		nome: "Fim de estrada",
		camada: "caminho"
	},
	{
		id: "rio-reto",
		nome: "Rio reto",
		camada: "caminho"
	},
	{
		id: "rio-curvo",
		nome: "Rio em curva",
		camada: "caminho"
	},
	{
		id: "rio-fechado",
		nome: "Rio em curva fechada",
		camada: "caminho"
	},
	{
		id: "rio-nascente",
		nome: "Nascente",
		camada: "caminho"
	},
	{
		id: "vila",
		nome: "Vila",
		camada: "marco"
	},
	{
		id: "cidade",
		nome: "Cidade",
		camada: "marco"
	},
	{
		id: "castelo",
		nome: "Castelo",
		camada: "marco"
	},
	{
		id: "torre",
		nome: "Torre",
		camada: "marco"
	},
	{
		id: "templo",
		nome: "Templo",
		camada: "marco"
	},
	{
		id: "ruina",
		nome: "Ruína",
		camada: "marco"
	},
	{
		id: "caverna",
		nome: "Caverna",
		camada: "marco"
	},
	{
		id: "covil",
		nome: "Covil",
		camada: "marco"
	},
	{
		id: "acampamento",
		nome: "Acampamento",
		camada: "marco"
	},
	{
		id: "ponte",
		nome: "Ponte",
		camada: "marco"
	},
	{
		id: "marco",
		nome: "Marco (X)",
		camada: "marco"
	}
];
Object.fromEntries(PALETA.map((p) => [p.id, p]));
/** Ordem de empilhamento por camada (o mapa desenha do menor para o maior). */
var ORDEM_DA_CAMADA = {
	terreno: 1e3,
	caminho: 1100,
	marco: 1200,
	rotulo: 1300
};
/** Caminho público da arte de uma peça (relativo ao site do hub). */
function arteDaPeca(id) {
	return `/mapa/pecas/${id}.svg`;
}
/** Encaixa um ponto da cena no centro do hex mais próximo e devolve a chave
*  ("x|y"). `ancora` é o centro de um hex qualquer da grade (gravado em
*  map/scene.grid.ancora na migração): com ela a grade é fixa, e o servidor não
*  aceita carimbo fora do centro de um hex, venha de onde vier. */
function encaixarNoHex(gridType, gridSize, ancora, px, py) {
	const long = gridSize * 2 / Math.sqrt(3);
	const colunas = gridType === 4 || gridType === 5;
	const w = colunas ? long : gridSize;
	const h = colunas ? gridSize : long;
	const passo = (colunas ? w : h) * 3 / 4;
	const iA = colunas ? (px - ancora.cx) / passo : (py - ancora.cy) / passo;
	let melhor = {
		x: px,
		y: py
	};
	let menor = Infinity;
	for (let i = Math.floor(iA) - 1; i <= Math.ceil(iA) + 1; i++) {
		const impar = (i % 2 + 2) % 2 === 1;
		const jA = colunas ? (py - ancora.cy - (impar ? h / 2 : 0)) / h : (px - ancora.cx - (impar ? w / 2 : 0)) / w;
		for (let j = Math.floor(jA) - 1; j <= Math.ceil(jA) + 1; j++) {
			const c = colunas ? {
				x: ancora.cx + i * passo,
				y: ancora.cy + j * h + (impar ? h / 2 : 0)
			} : {
				x: ancora.cx + j * w + (impar ? w / 2 : 0),
				y: ancora.cy + i * passo
			};
			const d = (c.x - px) ** 2 + (c.y - py) ** 2;
			if (d < menor) {
				menor = d;
				melhor = c;
			}
		}
	}
	return `${Math.round(melhor.x)}|${Math.round(melhor.y)}`;
}
new Intl.DateTimeFormat("en-GB", {
	timeZone: "America/Sao_Paulo",
	weekday: "short",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false
});
new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/Sao_Paulo",
	year: "numeric",
	month: "2-digit",
	day: "2-digit"
});
/** Grid hexagonal em colunas (flat-top): tipos 4 e 5 do Foundry. */
function isHexColumns(gridType) {
	return gridType === 4 || gridType === 5;
}
/** Largura/altura de UM hex, na convenção do Foundry (grid.size é a medida do
*  lado "achatado": largura nos grids em linhas, altura nos em colunas). */
function hexSize(gridType, size) {
	const long = size * 2 / Math.sqrt(3);
	return isHexColumns(gridType) ? {
		w: long,
		h: size
	} : {
		w: size,
		h: long
	};
}
//#endregion
//#region src/lib/hexgrid.ts
var mod = (n, m) => (n % m + m) % m;
/** Geometria do grid a partir da cena. A fase (onde cai a primeira linha de
*  hexes) é deduzida das próprias peças: elas foram encaixadas no grid ao serem
*  carimbadas, então são a referência mais fiel — mais que a origem da cena, que
*  o Foundry desloca conforme o tipo de hex.
*
*  Vale pela MODA e não pela primeira peça: o mestre arrasta marcadores para
*  fora do encaixe (um ícone de vila deslocado meio hex para caber na arte), e
*  ancorar num desses jogaria o grid inteiro fora de lugar. */
function hexGeom(scene) {
	const { type, size } = scene.grid;
	if (!size || type < 2) return null;
	const { w, h } = hexSize(type, size);
	const columns = isHexColumns(type);
	const step = (columns ? w : h) * 3 / 4;
	const ancora = scene.grid.ancora;
	if (ancora && Number.isFinite(ancora.cx) && Number.isFinite(ancora.cy)) return {
		w,
		h,
		step,
		cx: ancora.cx,
		cy: ancora.cy,
		columns
	};
	const periodU = columns ? h : w;
	const periodV = step * 2;
	const votes = /* @__PURE__ */ new Map();
	for (const t of scene.tiles) {
		if (Math.abs(t.w - w) > Math.max(2, w * .1)) continue;
		if (Math.abs(t.h - h) > Math.max(2, h * .1)) continue;
		const cxT = t.x + t.w / 2;
		const cyT = t.y + t.h / 2;
		let u = mod(columns ? cyT : cxT, periodU);
		let v = mod(columns ? cxT : cyT, periodV);
		if (v >= step) {
			v -= step;
			u = mod(u - periodU / 2, periodU);
		}
		const key = `${Math.round(u)}|${Math.round(v)}`;
		const cur = votes.get(key);
		if (cur) cur.n++;
		else votes.set(key, {
			n: 1,
			u,
			v
		});
	}
	let best = null;
	for (const cand of votes.values()) if (!best || cand.n > best.n) best = cand;
	return {
		w,
		h,
		step,
		cx: best ? columns ? best.v : best.u : w / 2,
		cy: best ? columns ? best.u : best.v : h / 2,
		columns
	};
}
//#endregion
//#region foundry/dragonbane-wm-mesa/src/mapa.js
var NOME_DA_CENA = "Mapa da região (West Marches)";
/** Tamanho do hex na cena do Foundry. O do hub é 42 (a cena "Ermos" original):
*  a escala é a razão entre os dois. */
var TAM = 100;
/** Até o v13 o x/y de um Tile é o canto; do v14 em diante é o ponto da âncora da
*  textura (centro, 0.5/0.5) — o mesmo tropeço que o módulo antigo resolveu no map.js. */
var ancoraNoCentro = () => (game.release?.generation ?? 12) >= 14;
var versaoAtual;
/** { k, hub:{x,y}, f:{x,y}, grade, cenaId } — a conversão hub ↔ cena do Foundry. */
var conv = null;
var cenaDoHub = null;
var carimbosDoHub = [];
/** As chaves que a última sincronização deixou na cena. */
var desenhados = /* @__PURE__ */ new Set();
var cenaDoMapa = () => game.scenes?.find((s) => s.getFlag("dragonbane-wm-mesa", "mapa") === true) ?? null;
/** Casa UM centro de hex do hub com UM centro de hex do Foundry: as grades têm o
*  mesmo tipo e a escala é exata, então isso casa a grade inteira. Quem diz onde
*  cai o centro no Foundry é a própria grade da cena (`getCenterPoint`), e não
*  uma conta nossa — a fase da grade hex muda conforme o tipo. */
function montarConversao(cena, hubCena, carimbos) {
	const { type, size } = hubCena.grade ?? {};
	if (!size || type < 2) return null;
	let ancora = hubCena.grade.ancora;
	if (!ancora) {
		const g = hexGeom({
			grid: {
				type,
				size
			},
			tiles: [...hubCena.pecasDoFoundry, ...carimbos.filter((c) => c.camada !== "rotulo")]
		});
		if (!g) return null;
		ancora = {
			cx: g.cx,
			cy: g.cy
		};
	}
	const k = TAM / size;
	const d = cena.dimensions ?? cena.getDimensions?.() ?? {};
	const perto = {
		x: (d.sceneX ?? 0) + ancora.cx * k,
		y: (d.sceneY ?? 0) + ancora.cy * k
	};
	const grade = typeof cena.grid?.getCenterPoint === "function" ? cena.grid : canvas?.scene === cena ? canvas.grid : null;
	const f = grade ? grade.getCenterPoint(perto) : perto;
	return {
		k,
		hub: {
			x: ancora.cx,
			y: ancora.cy
		},
		f: {
			x: f.x,
			y: f.y
		},
		grade: hubCena.grade,
		cenaId: cena.id
	};
}
var paraFoundry = (c, p) => ({
	x: (p.x - c.hub.x) * c.k + c.f.x,
	y: (p.y - c.hub.y) * c.k + c.f.y
});
var paraHub = (c, p) => ({
	x: (p.x - c.f.x) / c.k + c.hub.x,
	y: (p.y - c.f.y) / c.k + c.hub.y
});
/** Ponto da cena do Foundry → chave do hex do hub ("x|y"), ou null fora do mapa. */
function hexNoPonto(p) {
	if (!conv || !cenaDoHub) return null;
	const h = paraHub(conv, p);
	if (h.x < 0 || h.y < 0 || h.x > cenaDoHub.largura || h.y > cenaDoHub.altura) return null;
	return encaixarNoHex(conv.grade.type, conv.grade.size, {
		cx: conv.hub.x,
		cy: conv.hub.y
	}, h.x, h.y);
}
function tile(c, chave, assinatura, src, r, rot, sort) {
	const w = Math.max(1, Math.round(r.w * c.k));
	const h = Math.max(1, Math.round(r.h * c.k));
	const centro = paraFoundry(c, {
		x: r.x + r.w / 2,
		y: r.y + r.h / 2
	});
	const meio = ancoraNoCentro();
	return {
		texture: {
			src,
			anchorX: .5,
			anchorY: .5
		},
		x: Math.round(meio ? centro.x : centro.x - w / 2),
		y: Math.round(meio ? centro.y : centro.y - h / 2),
		width: w,
		height: h,
		rotation: rot ?? 0,
		sort,
		locked: true,
		flags: { [MOD]: {
			carimboId: chave,
			assinatura
		} }
	};
}
/** Rótulo do hub → Drawing só com texto (sem borda nem preenchimento). O retângulo
*  do hub é estreito: o texto ganha 4× a largura, centrado nele (como no Owlbear). */
function rotulo(c, s, assinatura, sort) {
	const fonte = Math.min(256, Math.max(8, Math.round((s.fontSize ?? 8) * c.k)));
	const w = Math.max(fonte * 4, Math.round(s.w * c.k * 4));
	const h = Math.max(Math.round(fonte * 1.6), Math.round(s.h * c.k));
	const centro = paraFoundry(c, {
		x: s.x + s.w / 2,
		y: s.y + s.h / 2
	});
	return {
		x: Math.round(centro.x - w / 2),
		y: Math.round(centro.y - h / 2),
		shape: {
			type: "r",
			width: w,
			height: h
		},
		text: s.texto,
		fontSize: fonte,
		textColor: s.color ?? "#2a2219",
		fillType: 0,
		fillAlpha: 0,
		strokeWidth: 0,
		strokeAlpha: 0,
		sort,
		locked: true,
		flags: { [MOD]: {
			carimboId: s.id,
			assinatura
		} }
	};
}
function desejados(c, hubCena, carimbos) {
	const m = /* @__PURE__ */ new Map();
	if (hubCena.fundo?.src) {
		const r = {
			x: 0,
			y: 0,
			w: hubCena.largura,
			h: hubCena.altura
		};
		const ass = `${hubCena.fundo.src}|${r.w}|${r.h}`;
		m.set("fundo", {
			tipo: "Tile",
			ass,
			dados: () => tile(c, "fundo", ass, hubCena.fundo.src, r, 0, 0)
		});
	}
	hubCena.pecasDoFoundry.forEach((t, i) => {
		const chave = `foundry:${i}`;
		const ass = `${t.src}|${t.x}|${t.y}|${t.w}|${t.h}|${t.rot}`;
		m.set(chave, {
			tipo: "Tile",
			ass,
			dados: () => tile(c, chave, ass, t.src, t, t.rot, 1 + (t.sort ?? 0))
		});
	});
	[...carimbos].sort((a, b) => ORDEM_DA_CAMADA[a.camada] - ORDEM_DA_CAMADA[b.camada] || a.criadoEm - b.criadoEm).forEach((s, i) => {
		const ass = `${s.src}|${s.texto}|${s.x}|${s.y}|${s.w}|${s.h}|${s.rot}|${s.fontSize}|${s.color}`;
		const sort = 2e3 + i;
		if (s.camada === "rotulo" && s.texto) m.set(s.id, {
			tipo: "Drawing",
			ass,
			dados: () => rotulo(c, s, ass, sort)
		});
		else if (s.src) m.set(s.id, {
			tipo: "Tile",
			ass,
			dados: () => tile(c, s.id, ass, s.src, s, s.rot, sort)
		});
	});
	return m;
}
async function criarCena(hubCena) {
	const k = TAM / hubCena.grade.size;
	return Scene.create({
		name: NOME_DA_CENA,
		width: Math.ceil(hubCena.largura * k) + TAM,
		height: Math.ceil(hubCena.altura * k) + TAM,
		padding: 0,
		backgroundColor: hubCena.fundo?.cor ?? "#d9c9a3",
		grid: {
			type: hubCena.grade.type,
			size: TAM
		},
		tokenVision: false,
		flags: { [MOD]: { mapa: true } }
	}, DO_SYNC);
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
var sincronizarMapa = umPorVez(async (forcar) => {
	if (!cfg("mapaLigado") || !cfg("chave") || !game.user.isGM) return;
	const escreve = souGmAtivo();
	let cena = cenaDoMapa();
	if (!cena && !escreve) return;
	const r = await mesa("mapa", forcar || !conv || !cena || escreve && faltaNaCena(cena) ? {} : { versao: versaoAtual });
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
	const sair = {
		Tile: [],
		Drawing: []
	};
	const tem = /* @__PURE__ */ new Set();
	for (const [tipo, colecao] of [["Tile", cena.tiles], ["Drawing", cena.drawings]]) for (const doc of colecao) {
		const meta = doc.flags?.[MOD];
		if (!meta?.carimboId) continue;
		const alvo = quero.get(meta.carimboId);
		if (redesenhar || !alvo || alvo.tipo !== tipo || alvo.ass !== meta.assinatura || tem.has(meta.carimboId)) sair[tipo].push(doc.id);
		else tem.add(meta.carimboId);
	}
	const entrar = {
		Tile: [],
		Drawing: []
	};
	for (const [id, d] of quero) if (!tem.has(id)) entrar[d.tipo].push(d.dados());
	for (const tipo of ["Tile", "Drawing"]) {
		if (sair[tipo].length) await cena.deleteEmbeddedDocuments(tipo, sair[tipo], DO_SYNC);
		if (entrar[tipo].length) await cena.createEmbeddedDocuments(tipo, entrar[tipo], DO_SYNC);
	}
	desenhados = new Set(quero.keys());
});
/** O mestre apagou um carimbo (Delete no Tile/Drawing): apaga no hub também.
*  Limpeza em massa (muitos de uma vez) NÃO apaga nada no hub — seria fácil
*  demais um "limpar tiles" acabar com o mapa de todos os mestres. */
function vigiarApagados() {
	let pendentes = [];
	let espera = null;
	const apagou = (doc, options, userId) => {
		if (ehDoSync(options) || userId !== game.user.id || !game.user.isGM) return;
		if (doc.parent?.getFlag("dragonbane-wm-mesa", "mapa") !== true) return;
		const id = doc.flags?.[MOD]?.carimboId;
		if (!id || id === "fundo" || id.startsWith("foundry:")) return;
		pendentes.push(id);
		clearTimeout(espera);
		espera = setTimeout(async () => {
			const ids = pendentes;
			pendentes = [];
			if (ids.length > 3) avisar(`${ids.length} carimbos apagados de uma vez: no hub nada mudou, eles voltam no próximo ciclo. Para apagar no mapa de todos, use a borracha.`, "warn");
			else for (const id of ids) await mesa("apagarCarimbo", { id }).catch((e) => avisar(e.message, "error"));
			await sincronizarMapa(true).catch(() => void 0);
		}, 400);
	};
	Hooks.on("deleteTile", apagou);
	Hooks.on("deleteDrawing", apagou);
	Hooks.on("deleteScene", (cena, options, userId) => {
		if (cena.getFlag("dragonbane-wm-mesa", "mapa") !== true || userId !== game.user.id) return;
		conv = null;
		gravarCfg("mapaLigado", false);
	});
}
/** A ferramenta armada pela paleta: { tipo:'peca', id, rot } | { tipo:'texto', texto } | { tipo:'borracha' } | null */
var ferramenta = null;
var ferramentaAtual = () => ferramenta;
function escolherFerramenta(f) {
	ferramenta = f;
	if (f && canvas?.scene?.getFlag("dragonbane-wm-mesa", "mapa") !== true) avisar(`abra a cena "${NOME_DA_CENA}" e clique no hex.`, "warn");
	Hooks.callAll(`${MOD}.ferramenta`, f);
}
/** O carimbo mais de cima no hex clicado (marco > caminho > terreno; o mais novo vence). */
function carimboNoHex(hexKey) {
	const g = conv.grade;
	const ancora = {
		cx: conv.hub.x,
		cy: conv.hub.y
	};
	return [...carimbosDoHub].filter((s) => encaixarNoHex(g.type, g.size, ancora, s.x + s.w / 2, s.y + s.h / 2) === hexKey).sort((a, b) => ORDEM_DA_CAMADA[b.camada] - ORDEM_DA_CAMADA[a.camada] || b.criadoEm - a.criadoEm)[0];
}
async function clicou(ev) {
	const f = ferramenta;
	if (!f || ev.button !== 0 || canvas.scene?.getFlag("dragonbane-wm-mesa", "mapa") !== true) return;
	const hexKey = hexNoPonto(ev.getLocalPosition?.(canvas.stage) ?? canvas.mousePosition);
	if (!hexKey) {
		avisar("fora do mapa da região — ou o mapa ainda está carregando.", "warn");
		return;
	}
	try {
		if (f.tipo === "borracha") {
			const alvo = carimboNoHex(hexKey);
			if (!alvo) return;
			await mesa("apagarCarimbo", { id: alvo.id });
		} else await mesa("carimbar", f.tipo === "peca" ? {
			hexKey,
			peca: f.id,
			rot: f.rot
		} : {
			hexKey,
			texto: f.texto
		});
		await sincronizarMapa(true);
	} catch (e) {
		avisar(e.message || "não deu para carimbar.", "error");
	}
}
/** Liga o clique da paleta no palco do canvas (uma vez só: o palco sobrevive à
*  troca de cena) e o Esc que desarma. */
function prepararCarimbo() {
	const ligar = () => {
		if (!canvas?.stage || canvas.stage["dragonbane-wm-mesa"]) return;
		canvas.stage[MOD] = true;
		canvas.stage.on("pointerdown", (ev) => void clicou(ev));
	};
	ligar();
	Hooks.on("canvasReady", ligar);
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && ferramenta) escolherFerramenta(null);
	});
}
/** Liga o mapa neste mundo (cria a cena na primeira sincronização) e a abre. */
async function ligarMapa(ligado) {
	await gravarCfg("mapaLigado", ligado);
	if (!ligado) {
		escolherFerramenta(null);
		return;
	}
	await sincronizarMapa(true);
	await cenaDoMapa()?.view();
}
//#endregion
//#region foundry/dragonbane-wm-mesa/src/janela.js
var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&#39;"
})[c]);
var CAMADAS = [
	["terreno", "Terreno"],
	["caminho", "Caminhos"],
	["marco", "Marcos"]
];
var CSS = `
.wm-mesa .window-content { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
.wm-mesa section { border: 1px solid var(--color-border-light-tertiary, #8884); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.wm-mesa h3 { margin: 0; border: 0; font-size: 1.05em; }
.wm-mesa .linha { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.wm-mesa .linha > input[type=text], .wm-mesa .linha > input[type=password], .wm-mesa .linha > select { flex: 1; min-width: 0; }
.wm-mesa .muted { opacity: .75; font-size: .9em; }
.wm-mesa .erro { color: #c0392b; }
.wm-mesa ul { margin: 0; padding-left: 18px; }
.wm-mesa .pecas { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: 4px; }
.wm-mesa .peca { padding: 2px; height: auto; line-height: 1; background: #0001; border: 2px solid transparent; }
.wm-mesa .peca.on, .wm-mesa .on { border-color: #d48a1e; }
.wm-mesa .peca img { width: 44px; height: 44px; border: 0; }
.wm-mesa button { flex: 0 0 auto; width: auto; }
`;
var quemSou = null;
var erro = "";
var aba = "terreno";
var rot = 0;
var JanelaDaMesa = class JanelaDaMesa extends foundry.applications.api.ApplicationV2 {
	static DEFAULT_OPTIONS = {
		id: "wm-mesa",
		classes: ["wm-mesa"],
		window: {
			title: "West Marches — Mesa",
			resizable: true
		},
		position: {
			width: 440,
			height: 640
		}
	};
	static #aberta = null;
	static abrir() {
		if (!game.user.isGM) {
			avisar("a mesa do West Marches é do mestre. A sua ficha está no hub.", "warn");
			return;
		}
		JanelaDaMesa.#aberta ??= new JanelaDaMesa();
		JanelaDaMesa.#aberta.render({ force: true });
		if (cfg("chave") && !quemSou) JanelaDaMesa.conectar(cfg("chave"));
	}
	static redesenhar() {
		if (JanelaDaMesa.#aberta?.rendered) JanelaDaMesa.#aberta.render();
	}
	static async conectar(chave) {
		try {
			quemSou = await mesa("quemSou", {}, chave);
			erro = "";
			if (chave !== cfg("chave")) await gravarCfg("chave", chave);
			sincronizarFichas().catch(() => void 0);
		} catch (e) {
			quemSou = null;
			erro = e.message;
		}
		JanelaDaMesa.redesenhar();
	}
	async _renderHTML() {
		const div = document.createElement("div");
		div.innerHTML = `<style>${CSS}</style>${this.#conexao()}${this.#missao()}${this.#mapa()}`;
		return div;
	}
	_replaceHTML(resultado, conteudo) {
		conteudo.replaceChildren(...resultado.childNodes);
	}
	#conexao() {
		const status = quemSou ? `Conectado como <b>${esc(quemSou.mestre?.nome)}</b>.` : cfg("chave") ? "Chave guardada, conferindo…" : `Gere a chave no Perfil do hub (<a href="${esc(hub())}/perfil" target="_blank">${esc(hub())}</a>) e cole aqui. Ela fica só neste navegador.`;
		return `<section>
      <h3>Chave do mestre</h3>
      <div class="linha"><input type="password" name="chave" placeholder="wm_…" value="${esc(cfg("chave"))}" autocomplete="off"><button type="button" data-acao="conectar">Conectar</button></div>
      <span class="muted">${status}</span>
      ${erro ? `<span class="erro">${esc(erro)}</span>` : ""}
    </section>`;
	}
	#missao() {
		if (!quemSou) return "";
		const callId = cfg("callId");
		const chamados = quemSou.chamados ?? [];
		const opcoes = chamados.map((c) => {
			const quando = c.quando ? new Date(c.quando).toLocaleString("pt-BR", {
				dateStyle: "short",
				timeStyle: "short"
			}) : "sem data";
			const de = c.meu ? "" : " (de outro mestre)";
			return `<option value="${esc(c.id)}" ${c.id === callId ? "selected" : ""}>${esc(c.titulo)} — ${esc(quando)}${de}</option>`;
		}).join("");
		const herois = ((ultimaMesa?.chamado?.id === callId ? ultimaMesa : null)?.herois ?? []).map((h) => {
			const f = h.ficha;
			const pv = f ? ` — PV ${f.hp?.value ?? "?"}/${f.hp?.max ?? "?"} · PD ${f.wp?.value ?? "?"}/${f.wp?.max ?? "?"}` : " — sem ficha";
			const nota = !h.fichaNoHub ? " (ficha ainda no Foundry antigo: PV/PD não voltam)" : h.estado !== "alive" ? " (caído)" : "";
			return `<li>${esc(h.nome)}${esc(pv)}${esc(nota)}</li>`;
		}).join("");
		return `<section>
      <h3>Missão</h3>
      ${chamados.length ? `<div class="linha"><select name="callId"><option value="">— escolha —</option>${opcoes}</select><button type="button" data-acao="importar">Importar agora</button></div>` : `<span class="muted">Nenhuma missão confirmada sua no hub.</span>`}
      ${callId ? herois ? `<ul>${herois}</ul>` : `<span class="muted">Buscando os heróis…</span>` : ""}
      <span class="muted">Os heróis entram na pasta "West Marches" e se atualizam sozinhos a cada 10 s. PV e PD mexidos aqui voltam para o hub; o resto se mexe na ficha do hub.</span>
    </section>`;
	}
	#mapa() {
		if (!quemSou) return "";
		const ligado = cfg("mapaLigado");
		const f = ferramentaAtual();
		const pecas = PALETA.filter((p) => p.camada === aba).map((p) => {
			const on = f?.tipo === "peca" && f.id === p.id;
			const giro = rot ? `style="transform: rotate(${rot}deg)"` : "";
			return `<button type="button" class="peca ${on ? "on" : ""}" title="${esc(p.nome)}" data-peca="${esc(p.id)}"><img src="${esc(hub() + arteDaPeca(p.id))}" alt="" ${giro}></button>`;
		}).join("");
		const dica = f ? f.tipo === "borracha" ? "Borracha armada: clique no hex (apaga o carimbo de cima). Esc solta." : "Clique nos hexes da cena para carimbar. Esc solta a ferramenta." : "Escolha uma peça e clique no hex. Os carimbos vêm travados; destravar e apagar (Delete) também apaga no hub.";
		return `<section>
      <h3>Mapa da região</h3>
      <label class="linha"><input type="checkbox" name="mapaLigado" ${ligado ? "checked" : ""}> Ter o mapa da região neste mundo (é o mesmo de todos os mestres)</label>
      ${ligado ? `<div class="linha"><button type="button" data-acao="abrirCena" ${cenaDoMapa() ? "" : "disabled"}>Abrir a cena</button><button type="button" data-acao="atualizarMapa">Atualizar</button></div>
      <div class="linha">${CAMADAS.map(([id, nome]) => `<button type="button" data-aba="${id}" class="${aba === id ? "on" : ""}">${nome}</button>`).join("")}</div>
      <div class="pecas">${pecas}</div>
      <div class="linha"><span class="muted">Girar</span><button type="button" data-girar="-60">⟲</button><button type="button" data-girar="60">⟳</button><span>${rot}°</span></div>
      <div class="linha"><input type="text" name="texto" maxlength="60" placeholder="Nome do lugar" value="${f?.tipo === "texto" ? esc(f.texto) : ""}"><button type="button" data-acao="texto" class="${f?.tipo === "texto" ? "on" : ""}">Rótulo</button></div>
      <div class="linha"><button type="button" data-acao="borracha" class="${f?.tipo === "borracha" ? "on" : ""}">Borracha</button><button type="button" data-acao="soltar" ${f ? "" : "disabled"}>Soltar</button></div>
      <span class="muted">${dica}</span>` : ""}
    </section>`;
	}
	_onRender() {
		const el = this.element;
		const valor = (n) => el.querySelector(`[name="${n}"]`)?.value?.trim() ?? "";
		el.querySelector("[data-acao=\"conectar\"]")?.addEventListener("click", () => void JanelaDaMesa.conectar(valor("chave")));
		el.querySelector("[name=\"callId\"]")?.addEventListener("change", async (e) => {
			await gravarCfg("callId", e.target.value);
			this.render();
			sincronizarFichas().catch((err) => avisar(err.message, "error"));
		});
		el.querySelector("[data-acao=\"importar\"]")?.addEventListener("click", () => sincronizarFichas().then(() => avisar("heróis atualizados.")).catch((err) => avisar(err.message, "error")));
		el.querySelector("[name=\"mapaLigado\"]")?.addEventListener("change", (e) => ligarMapa(e.target.checked).catch((err) => avisar(err.message, "error")).finally(() => this.render()));
		el.querySelector("[data-acao=\"abrirCena\"]")?.addEventListener("click", () => void cenaDoMapa()?.view());
		el.querySelector("[data-acao=\"atualizarMapa\"]")?.addEventListener("click", () => sincronizarMapa(true).then(() => this.render()).catch((err) => avisar(err.message, "error")));
		for (const b of el.querySelectorAll("[data-aba]")) b.addEventListener("click", () => {
			aba = b.dataset.aba;
			this.render();
		});
		for (const b of el.querySelectorAll("[data-peca]")) b.addEventListener("click", () => {
			const f = ferramentaAtual();
			escolherFerramenta(f?.tipo === "peca" && f.id === b.dataset.peca ? null : {
				tipo: "peca",
				id: b.dataset.peca,
				rot
			});
		});
		for (const b of el.querySelectorAll("[data-girar]")) b.addEventListener("click", () => {
			rot = (rot + Number(b.dataset.girar) + 360) % 360;
			const f = ferramentaAtual();
			if (f?.tipo === "peca") escolherFerramenta({
				...f,
				rot
			});
			else this.render();
		});
		el.querySelector("[data-acao=\"texto\"]")?.addEventListener("click", () => {
			const texto = valor("texto");
			if (!texto) return avisar("escreva o nome do lugar.", "warn");
			escolherFerramenta({
				tipo: "texto",
				texto
			});
		});
		el.querySelector("[data-acao=\"borracha\"]")?.addEventListener("click", () => escolherFerramenta(ferramentaAtual()?.tipo === "borracha" ? null : { tipo: "borracha" }));
		el.querySelector("[data-acao=\"soltar\"]")?.addEventListener("click", () => escolherFerramenta(null));
	}
};
Hooks.on(`${MOD}.mesa`, () => JanelaDaMesa.redesenhar());
Hooks.on(`${MOD}.ferramenta`, () => JanelaDaMesa.redesenhar());
//#endregion
//#region foundry/dragonbane-wm-mesa/src/main.js
var CICLO_MS = 1e4;
/** Uma volta do laço: falha de rede não para o laço (o próximo ciclo tenta de
*  novo) e não vira aviso na tela a cada 10 s — o erro fica no console. */
var ultimoErro = "";
async function ciclo() {
	if (!game.user.isGM || !cfg("chave")) return;
	for (const [nome, fn] of [["fichas", souGmAtivo() ? sincronizarFichas : null], ["mapa", sincronizarMapa]]) {
		if (!fn) continue;
		try {
			await fn();
		} catch (e) {
			const msg = `${nome}: ${e.message}`;
			if (msg !== ultimoErro) console.warn(`${MOD} | ${msg}`);
			ultimoErro = msg;
		}
	}
}
Hooks.once("init", () => {
	registrarConfiguracoes();
	game.modules.get(MOD).api = { abrir: () => JanelaDaMesa.abrir() };
});
Hooks.once("ready", () => {
	if (!game.user.isGM) return;
	vigiarPvPd();
	vigiarApagados();
	prepararCarimbo();
	ciclo();
	setInterval(() => void ciclo(), CICLO_MS);
});
Hooks.on("chatMessage", (_log, mensagem) => {
	if (!/^\/wm\b/i.test(String(mensagem).trim())) return;
	JanelaDaMesa.abrir();
	return false;
});
Hooks.on("renderActorDirectory", (_app, html) => {
	if (!game.user.isGM) return;
	const onde = (html instanceof HTMLElement ? html : html?.[0])?.querySelector(".header-actions");
	if (!onde || onde.querySelector(".wm-mesa-abrir")) return;
	const b = document.createElement("button");
	b.type = "button";
	b.className = "wm-mesa-abrir";
	b.innerHTML = "<i class=\"fas fa-dragon\"></i> West Marches";
	b.addEventListener("click", () => JanelaDaMesa.abrir());
	onde.append(b);
});
//#endregion
