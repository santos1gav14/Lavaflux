// Ponta a ponta do Escalaflux (escala/app.html), contra os emuladores.
// Coordenação se cadastra → é aprovada → ajusta turnos → cria médicos → gera a escala → médica pega vaga
// → oferece troca → colega assume → coordenação aprova → disponibilidade → fechamento → revogação → segregação.
import { chromium } from "playwright";

const SITE = "http://localhost:5000", APP = `${SITE}/escala/app`, FS = "http://127.0.0.1:8080/v1/projects/demo-lavaflux/databases/(default)/documents";
const ADMIN = {Authorization: "Bearer owner", "Content-Type": "application/json"};
let ok = 0, falhas = 0;
const t = (c, m) => { console.log((c ? "✅" : "❌") + " " + m); c ? ok++ : falhas++; };
const pad = n => String(n).padStart(2, "0"), hoje = new Date(), MES = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}`;
const DIAS = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
const plantoes = async () => ((await (await fetch(`${FS}/esc_plantoes?pageSize=300`, {headers: ADMIN})).json()).documents || []).map(d => ({id: d.name.split("/").pop(), f: d.fields}));

const b = await chromium.launch();
async function pagina(nome){
  const p = await (await b.newContext({viewport: {width: 390, height: 844}})).newPage();
  p.on("dialog", d => d.accept());
  p.on("pageerror", e => { console.log(`ERRO NA PÁGINA (${nome}):`, e.message); falhas++; });
  return p;
}

// 1. Cadastro e aprovação
const co = await pagina("coordenação");
await co.goto(`${APP}?emu=1#cadastro`); await co.waitForSelector("#fCad:visible");
await co.fill("#cNome", "PS Teste"); await co.fill("#cWhats", "51955554444"); await co.fill("#cEmail", "coord@teste.com");
await co.fill("#cSenha", "segredo1"); await co.fill("#cSenha2", "segredo1"); await co.click("#cBt");
await co.waitForSelector("#esperaBox:has-text('aguardando aprovação')", {timeout: 15000}); t(true, "conta da coordenação fica aguardando aprovação");
const contas = await (await fetch(`${FS}/esc_contas`, {headers: ADMIN})).json();
const uid = contas.documents.find(d => d.fields.email.stringValue === "coord@teste.com").name.split("/").pop();
await fetch(`${FS}/esc_contas/${uid}?updateMask.fieldPaths=status&updateMask.fieldPaths=venceEm&updateMask.fieldPaths=plano`, {method: "PATCH", headers: ADMIN,
  body: JSON.stringify({fields: {status: {stringValue: "ativo"}, plano: {stringValue: "teste"}, venceEm: {integerValue: String(Date.now() + 15 * 864e5)}}})});
await co.waitForSelector("#vApp:visible", {timeout: 15000});
t((await co.textContent("#guia")).includes("Primeiros passos"), "painel abre após a aprovação, com primeiros passos");

// 2. Turnos e médicos
await co.click("[data-aba=ajustes]");
await co.fill('[data-t="0"][data-c=valor]', "1.000,00"); await co.click("[data-act=ajSalvar]");
await co.waitForSelector("#ajErro:has-text('Ajustes salvos')"); t(true, "coordenação ajusta o valor do turno");
await co.click("[data-aba=medicos]");
const codigo = (await co.textContent("#medCodigo")).trim();
t(/^[a-z0-9]{6}$/.test(codigo), "serviço tem código de acesso dos médicos");
for (const [nome, usuario] of [["Ana", "ana"], ["Bruno", "bruno"]]){
  await co.fill("#nmNome", nome); await co.fill("#nmUsuario", usuario); await co.fill("#nmSenha", "123456"); await co.click("#nmBt");
  await co.waitForSelector(`#nmErro:has-text('Acesso criado para ${nome}')`, {timeout: 15000});
}
await co.waitForSelector("#conteudo .item:has-text('Bruno')"); t((await co.$$("#conteudo .item")).length === 2, "dois médicos criados sem derrubar a sessão da coordenação");

// 3. Gerar a escala do mês
await co.click("[data-aba=escala]"); await co.click("[data-act=gerar]");
await co.waitForFunction(n => document.querySelectorAll("#conteudo .pl").length === n, DIAS * 2, {timeout: 30000});
t(true, `escala do mês gerada (${DIAS * 2} plantões vagos)`);

// 4. Médica pega uma vaga e oferece para troca
const ana = await pagina("Ana");
await ana.goto(`${APP}?emu=1&medico=${codigo}`); await ana.waitForSelector("#fMed:visible");
t((await ana.inputValue("#mCodigo")) === codigo, "link de acesso já preenche o código do serviço");
await ana.fill("#mUsuario", "ana"); await ana.fill("#mSenha", "errada"); await ana.click("#fMed button.pri");
await ana.waitForSelector("#mErro:has-text('incorretos')", {timeout: 10000}); t(true, "senha errada mostra erro claro");
await ana.fill("#mSenha", "123456"); await ana.click("#fMed button.pri");
await ana.waitForSelector("#vApp:visible", {timeout: 15000});
t(await ana.isHidden("[data-aba=ajustes]") && await ana.isHidden("[data-aba=medicos]") && await ana.isHidden("[data-aba=fech]"), "médica não vê ajustes, médicos nem fechamento");
await ana.click("[data-aba=vagas]"); await ana.waitForSelector("#conteudo [data-act=pegar]");
await ana.click("#conteudo [data-act=pegar]");
await ana.waitForFunction(() => document.querySelectorAll("#conteudo [data-act=pegar]").length > 0);
let pAna; for (let i = 0; i < 20 && !pAna; i++){ pAna = (await plantoes()).find(p => p.f.medicoNome && p.f.medicoNome.stringValue === "Ana"); if (!pAna) await new Promise(r => setTimeout(r, 300)); }
t(!!pAna && pAna.f.status.stringValue === "escalado", "médica pega o plantão vago");
await co.waitForSelector("#conteudo .pl:has-text('Ana')", {timeout: 10000}); t(true, "coordenação vê a médica no plantão na hora");
await ana.click("[data-aba=meus]"); await ana.waitForSelector("#conteudo [data-act=oferecer]"); await ana.click("#conteudo [data-act=oferecer]");
await ana.waitForSelector("#conteudo:has-text('Oferecido para troca')", {timeout: 10000}); t(true, "médica oferece o plantão para troca");

// 5. Colega assume e a coordenação aprova
const bruno = await pagina("Bruno");
await bruno.goto(`${APP}?emu=1&medico=${codigo}`); await bruno.waitForSelector("#fMed:visible");
await bruno.fill("#mUsuario", "bruno"); await bruno.fill("#mSenha", "123456"); await bruno.click("#fMed button.pri");
await bruno.waitForSelector("#vApp:visible", {timeout: 15000});
await bruno.click("[data-aba=trocas]"); await bruno.waitForSelector("#conteudo [data-act=assumir]"); await bruno.click("#conteudo [data-act=assumir]");
await bruno.waitForSelector("#conteudo:has-text('aguardando a coordenação')", {timeout: 10000}); t(true, "colega assume a troca e aguarda aprovação");
await co.click("[data-aba=trocas]"); await co.waitForSelector("#conteudo [data-act=aprovarL]", {timeout: 10000});
t((await co.textContent("#abas")).includes("1"), "aba de trocas mostra a pendência");
await co.click("#conteudo [data-act=aprovarL]");
await co.waitForSelector("#conteudo:has-text('Nenhuma troca pendente')", {timeout: 10000});
const pDepois = (await plantoes()).find(p => p.id === pAna.id).f;
t(pDepois.medicoNome.stringValue === "Bruno" && pDepois.troca.nullValue === null, "troca aprovada: plantão passa para o colega");
t(pDepois.hist.arrayValue.values.length >= 4, "histórico registra vaga, oferta, aceite e aprovação");

// 6. Disponibilidade
await ana.click("[data-aba=disp]"); await ana.waitForSelector("[data-act=dTodos]"); await ana.click("[data-act=dTodos]");
await ana.fill("#dObs", "Sem noturno às sextas"); await ana.click("[data-act=dSalvar]");
await ana.waitForSelector("#dErro:has-text('Salva em')", {timeout: 10000}); t(true, "médica salva a disponibilidade do próximo mês");
await co.click("[data-aba=disp]"); await co.click("[data-act=mes][data-k='1']");
await co.waitForSelector("#conteudo .item:has-text('Ana') .pill.ab", {timeout: 10000});
t((await co.textContent("#conteudo")).includes("Sem noturno às sextas"), "coordenação vê a disponibilidade e a observação");

// 7. Fechamento
await co.click("[data-act=mes][data-k='-1']"); await co.click("[data-aba=fech]");
await co.waitForSelector("#conteudo .tab");
const fech = (await co.textContent("#conteudo .tab")).replace(/\s+/g, " ");   // o real usa espaço não separável
t(fech.includes("Bruno") && fech.includes("R$ 1.000,00") && !fech.includes("Ana"), "fechamento soma os plantões por médico");

// 8. Revogação e segregação
await co.click("[data-aba=medicos]"); await co.click("#conteudo .item:has-text('Ana') [data-act=revogar]");
await ana.waitForSelector("#esperaBox:has-text('Acesso revogado')", {timeout: 15000}); t(true, "médica revogada perde o acesso na hora");
const lava = await pagina("lavaflux");
await lava.goto(`${APP}?emu=1`); await lava.waitForSelector("#fLogin:visible");
await lava.fill("#lEmail", "dono@teste.com"); await lava.fill("#lSenha", "novaSenha9"); await lava.click("#fLogin button.pri");
await lava.waitForSelector("#lErro:has-text('não tem conta no Escalaflux')", {timeout: 15000});
t(await lava.isHidden("#vApp"), "conta do Lavaflux não entra no Escalaflux");

await b.close();
console.log(`\nEscalaflux ponta a ponta: ${ok} passaram, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
