// Teste de ponta a ponta no navegador, contra os emuladores (Auth + Firestore) e o site servido localmente.
// Proprietário se cadastra → é aprovado → registra veículo → cliente acompanha → funcionário entra com login próprio
// → histórico identifica quem marcou → proprietário revoga o acesso → pronto e entregue aparecem separados.
import { chromium } from "playwright";

const SITE = "http://localhost:5000", FS = "http://127.0.0.1:8080/v1/projects/demo-lavaflux/databases/(default)/documents";
const ADMIN = {Authorization: "Bearer owner", "Content-Type": "application/json"};   // ignora regras (só no emulador)
let ok = 0, falhas = 0;
const t = (c, m) => { console.log((c ? "✅" : "❌") + " " + m); c ? ok++ : falhas++; };
const espera = ms => new Promise(r => setTimeout(r, ms));

const b = await chromium.launch();
const ctxDono = await b.newContext({viewport: {width: 390, height: 844}});
const dono = await ctxDono.newPage();
dono.on("dialog", d => d.accept());
dono.on("pageerror", e => { console.log("ERRO NA PÁGINA (dono):", e.message); falhas++; });

// 1. Cadastro
await dono.goto(`${SITE}/app?emu=1#cadastro`);
await dono.waitForSelector("#fCad:visible");
t((await dono.textContent("#fCad .oferta")).includes("15 dias grátis") && (await dono.textContent("#fCad .oferta")).includes("sem cartão") && (await dono.textContent("#fCad .oferta")).includes("49,90"), "cadastro mostra teste, ausência de cartão e preço");
await dono.fill("#cNome", "Lava Jato Teste");
await dono.fill("#cWhats", "51999990000");
await dono.fill("#cEmail", "dono@teste.com");
await dono.fill("#cSenha", "segredo1"); await dono.fill("#cSenha2", "segredo2");
await dono.click("#cBt");
t((await dono.textContent("#cErro")).includes("não são iguais") && (await dono.inputValue("#cNome")) === "Lava Jato Teste", "erro de senha mantém os campos preenchidos");
await dono.fill("#cSenha2", "segredo1"); await dono.click("#cBt");
await dono.waitForSelector("#esperaBox:has-text('aguardando aprovação')", {timeout: 15000});
t(true, "conta criada fica aguardando aprovação");

// 2. Aprovação (como o admin faria)
const contas = await (await fetch(`${FS}/contas`, {headers: ADMIN})).json();
const uidDono = contas.documents.find(d => d.fields.email.stringValue === "dono@teste.com").name.split("/").pop();
await fetch(`${FS}/contas/${uidDono}?updateMask.fieldPaths=status&updateMask.fieldPaths=venceEm&updateMask.fieldPaths=plano`, {method: "PATCH", headers: ADMIN,
  body: JSON.stringify({fields: {status: {stringValue: "ativo"}, plano: {stringValue: "teste"}, venceEm: {integerValue: String(Date.now() + 15 * 864e5)}}})});
await dono.waitForSelector("#mNome.on", {timeout: 15000});
t(true, "painel abre sozinho após a aprovação e pergunta quem usa o aparelho");
await dono.fill("#nomeInput", "Santos"); await dono.click("#fNome button.pri");
t((await dono.textContent("#guia")).includes("Primeiros passos"), "primeiros passos aparecem para conta nova");
await dono.click("[data-g=pular]");
await dono.waitForSelector("#guia:has-text('pausados')");

// 3. Registro de veículo
await dono.fill("#nPlaca", "ABC1D23"); await dono.fill("#nNome", "Ana"); await dono.fill("#nTel", "(51) 98888-7777");
await dono.click("#fNovo button.pri");
await dono.waitForSelector("#mShare.on");
const link = await dono.inputValue("#shLink"), cod = link.split("c=")[1];
await espera(500);
t((await dono.getAttribute("#shWpp", "href")).startsWith("https://wa.me/5551988887777?text="), "botão do WhatsApp abre a conversa com a mensagem (envio manual)");
t((await dono.textContent("#shExplica")).includes("toque em enviar"), "texto explica que o envio é feito no WhatsApp");
await dono.click("#mShare [data-close]");
const publico = await (await fetch(`${FS}/lavagens/${cod}`)).json();
t(publico.fields && !publico.fields.telefone && !publico.fields.historico, "documento público do link NÃO contém telefone nem histórico");
const privado = await (await fetch(`${FS}/lavagens/${cod}/privado/dados`, {headers: ADMIN})).json();
t(privado.fields.telefone.stringValue === "51988887777", "telefone guardado na parte privada");
const semAuth = await fetch(`${FS}/lavagens/${cod}/privado/dados`);
t(semAuth.status === 403, "parte privada recusada para quem tem só o link");

// 4. Cliente acompanha em tempo real (link no formato já enviado: /?c=)
const ctxCli = await b.newContext({viewport: {width: 390, height: 844}});
const cli = await ctxCli.newPage();
await cli.goto(`${SITE}/?c=${cod}&emu=1`);
await cli.waitForSelector("#cliente .placa");
t(cli.url().includes("/app?c="), "link /?c= redireciona para o acompanhamento");
t((await cli.textContent("#cliente")).includes("Na fila"), "cliente vê 'Na fila'");
await dono.click(`#lista .card:has(.placa:text("ABC1D23")) [data-e=p0]`);
await cli.waitForSelector("#cliente .hero:has-text('1 de 4')", {timeout: 10000});
const w = await cli.$eval("#cliente .bar i", e => e.style.width);
t(w === "25%", "cliente vê 1 de 4 com barra em 25% logo após a marcação");
t(!(await cli.textContent("#cliente")).includes("Santos"), "cliente não vê o nome de quem marcou");

// 5. Acesso individual de funcionário
await dono.click("#btEquipe"); await dono.waitForFunction(() => /^[a-z0-9]{6}$/.test(document.querySelector("#eqCodigo").textContent));
const codigo = await dono.textContent("#eqCodigo");
await dono.fill("#mbNome", "Carlos"); await dono.fill("#mbUsuario", "carlos"); await dono.fill("#mbSenha", "123456"); await dono.click("#mbBt");
await dono.waitForSelector("#eqLista:has-text('Carlos')", {timeout: 15000});
t((await dono.textContent("#mbErro")).includes("Acesso criado"), "proprietário cria acesso do funcionário sem sair da própria sessão");
t((await dono.textContent("#painelNome")) === "Lava Jato Teste", "sessão do proprietário continua ativa");
await dono.click("#mEquipe [data-close]");

const ctxF = await b.newContext({viewport: {width: 390, height: 844}});
const f = await ctxF.newPage(); f.on("dialog", d => d.accept());
f.on("pageerror", e => { console.log("ERRO NA PÁGINA (func):", e.message); falhas++; });
await f.goto(`${SITE}/app?emu=1&equipe=${codigo}`);
await f.waitForSelector("#fLoginFunc:visible");
t((await f.inputValue("#fCodigo")) === codigo, "link de acesso da equipe já preenche o código");
await f.fill("#fUsuario", "carlos"); await f.fill("#fSenha", "errada"); await f.click("#fLoginFunc button.pri");
await f.waitForSelector("#fErro:has-text('incorretos')");
t(true, "senha errada mostra erro claro");
await f.fill("#fSenha", "123456"); await f.click("#fLoginFunc button.pri");
await f.waitForSelector("#lista .placa:text('ABC1D23')", {timeout: 15000});
t(true, "funcionário entra e vê o pátio do estabelecimento");
t(await f.isHidden("#btAjustes") && await f.isHidden("#btEquipe") && (await f.$$("[data-act=remover]")).length === 0, "funcionário não vê ajustes, equipe nem remover");
t(!(await f.isVisible("#mNome")), "funcionário não precisa informar nome no aparelho");
await f.click(`#lista .card:has(.placa:text("ABC1D23")) [data-e=p1]`);
await cli.waitForSelector("#cliente .hero:has-text('2 de 4')", {timeout: 10000});
t(true, "marcação do funcionário aparece para o cliente");
await f.click(`#lista .card:has(.placa:text("ABC1D23")) summary`);
await f.waitForSelector(`#lista .card:has(.placa:text("ABC1D23")) details li:has-text('Carlos')`, {timeout: 10000});
const hist = await f.textContent(`#lista .card:has(.placa:text("ABC1D23")) details`);
t(hist.includes("Carlos login próprio marcou ✓ Secagem") && hist.includes("Santos (login do proprietário) marcou ✓ Lavagem externa"), "histórico diferencia login próprio do login do proprietário");

// 6. Revogação
await dono.click("#btEquipe"); await dono.waitForSelector("#eqLista [data-rev]");
await dono.click("#eqLista [data-rev]");
await f.waitForSelector("#esperaBox:has-text('Acesso revogado')", {timeout: 15000});
t(true, "funcionário revogado perde o acesso na hora");
await dono.click("#mEquipe [data-close]");

// 7. Pronto e entregue separados
await dono.click(`#lista .card:has(.placa:text("ABC1D23")) [data-act=concluir]`);
await dono.waitForSelector("#mShare.on"); t((await dono.textContent("#shTit")) === "Avisar o cliente", "concluir abre o aviso (não envia sozinho)");
await dono.click("#mShare [data-close]");
await cli.waitForSelector("#cliente .hero:has-text('Pronto para retirada')", {timeout: 10000});
t(true, "cliente vê 'Pronto para retirada'");
let d = (await (await fetch(`${FS}/lavagens/${cod}`)).json()).fields;
t(d.concluido.booleanValue === true && d.retirado.booleanValue === false && d.fimEm, "pronto registrado sem marcar retirada");
await dono.click(`#lista .card:has(.placa:text("ABC1D23")) [data-act=retirar]`);
await cli.waitForSelector("#cliente .hero:has-text('entregue')", {timeout: 10000});
d = (await (await fetch(`${FS}/lavagens/${cod}`)).json()).fields;
t(d.retirado.booleanValue === true && +d.retiradoEm.integerValue >= +d.fimEm.integerValue, "entrega registrada com horário próprio, depois da conclusão");
await dono.click("#tabsV [data-tab=retirado]");
t((await dono.$$('#lista .placa:text("ABC1D23")')).length === 1, "veículo aparece em Retirados");
await dono.fill("#busca", "abc1");
t((await dono.$$('#lista .placa')).length === 1, "busca por placa encontra o veículo");

// 8. Indicadores não contam a demonstração
await dono.fill("#busca", "");
const uso = (await (await fetch(`${FS}/estabelecimentos/${uidDono}`)).json()).fields.uso.mapValue.fields.total.integerValue;
t(uso === "1", "contador de uso conta só o veículo real (" + uso + ")");

// 9. Proprietário troca a própria senha e entra com a nova
await dono.click("#vPainel [data-senha]");
await dono.fill("#snAtual", "errada"); await dono.fill("#snNova", "novaSenha9"); await dono.fill("#snNova2", "novaSenha9"); await dono.click("#snBt");
await dono.waitForSelector("#snErro:has-text('incorreta')", {timeout: 10000}); t(true, "troca de senha recusa senha atual errada");
await dono.fill("#snAtual", "segredo1"); await dono.click("#snBt");
await dono.waitForSelector("#snErro:has-text('Senha alterada')", {timeout: 10000}); t(true, "proprietário troca a senha");
await dono.click("#mSenha [data-close]"); await dono.click("#vPainel [data-sair]");
await dono.waitForSelector("#fLogin:visible");
await dono.fill("#lEmail", "dono@teste.com"); await dono.fill("#lSenha", "segredo1"); await dono.click("#fLogin button.pri");
await dono.waitForSelector("#lErro:has-text('incorretos')", {timeout: 10000}); t(true, "senha antiga deixa de funcionar");
await dono.fill("#lSenha", "novaSenha9"); await dono.click("#fLogin button.pri");
await dono.waitForSelector("#painelNome:has-text('Lava Jato Teste')", {timeout: 15000}); t(true, "entra com a senha nova");

await b.close();
console.log(`\nPonta a ponta: ${ok} passaram, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
