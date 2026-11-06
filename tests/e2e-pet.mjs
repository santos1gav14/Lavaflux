// Ponta a ponta do Petflux (mesmo app, endereço com ?produto=pet), contra os emuladores.
// Cadastro grava o produto → pet com foto e entrega em casa → tutor acompanha → foto do pet pronto
// → saiu para entrega → entregue em casa → conta do Lavaflux não entra pelo Petflux.
import { chromium } from "playwright";

const SITE = "http://localhost:5000", FS = "http://127.0.0.1:8080/v1/projects/demo-lavaflux/databases/(default)/documents";
const ADMIN = {Authorization: "Bearer owner", "Content-Type": "application/json"};
const FOTO = new URL("../pet/og.png", import.meta.url).pathname;
let ok = 0, falhas = 0;
const t = (c, m) => { console.log((c ? "✅" : "❌") + " " + m); c ? ok++ : falhas++; };

const b = await chromium.launch();
const ctx = await b.newContext({viewport: {width: 390, height: 844}});
const dono = await ctx.newPage();
dono.on("dialog", d => d.accept());
dono.on("pageerror", e => { console.log("ERRO NA PÁGINA (pet):", e.message); falhas++; });

// 1. Cadastro pelo Petflux
await dono.goto(`${SITE}/app?produto=pet&emu=1#cadastro`);
await dono.waitForSelector("#fCad:visible");
t(await dono.evaluate(() => document.body.classList.contains("pet")) && (await dono.textContent("header .marca, .marca")).includes("Petflux"), "app abre com a marca Petflux");
await dono.fill("#cNome", "Pet Shop Teste"); await dono.fill("#cWhats", "51977776666");
await dono.fill("#cEmail", "pet@teste.com"); await dono.fill("#cSenha", "segredo1"); await dono.fill("#cSenha2", "segredo1");
await dono.click("#cBt");
await dono.waitForSelector("#esperaBox:has-text('aguardando aprovação')", {timeout: 15000});
const contas = await (await fetch(`${FS}/contas`, {headers: ADMIN})).json();
const conta = contas.documents.find(d => d.fields.email.stringValue === "pet@teste.com"), uid = conta.name.split("/").pop();
t(conta.fields.produto.stringValue === "petflux", "conta registrada como Petflux");
await fetch(`${FS}/contas/${uid}?updateMask.fieldPaths=status&updateMask.fieldPaths=venceEm&updateMask.fieldPaths=plano`, {method: "PATCH", headers: ADMIN,
  body: JSON.stringify({fields: {status: {stringValue: "ativo"}, plano: {stringValue: "teste"}, venceEm: {integerValue: String(Date.now() + 15 * 864e5)}}})});
await dono.waitForSelector("#mNome.on", {timeout: 15000});
await dono.fill("#nomeInput", "Santos"); await dono.click("#fNome button.pri");
await dono.click("[data-g=pular]");
t((await dono.textContent("#tNovo")) === "Novo atendimento" && (await dono.textContent("#nEtapas")).includes("Tosa"), "formulário e etapas de banho e tosa");

// 2. Novo atendimento: fêmea, entrega em casa, com foto
await dono.fill("#nPlaca", "luna"); await dono.fill("#nNome", "Ana"); await dono.fill("#nTel", "(51) 98888-7777");
await dono.click("label:has(input[name=nSexo][value=femea])"); await dono.click("label:has(input[name=nEntrega][value=casa])");
await dono.setInputFiles("#nFotoIn", FOTO); await dono.waitForSelector("#nFotoPrev:visible");
await dono.click("#fNovo button.pri");
await dono.waitForSelector("#mShare.on");
const cod = (await dono.inputValue("#shLink")).split("c=")[1];
t((await dono.textContent("#shMsg")).includes("atendimento da Luna"), "mensagem do link no feminino e com o nome do pet");
await dono.click("#mShare [data-close]");
let d = (await (await fetch(`${FS}/lavagens/${cod}`)).json()).fields;
t(d.entrega.stringValue === "casa" && d.sexo.stringValue === "femea" && d.foto.stringValue.startsWith("data:image/jpeg") && d.foto.stringValue.length < 200000, "foto reduzida e dados do pet gravados");

// 3. Tutor acompanha
const cli = await (await b.newContext({viewport: {width: 390, height: 844}})).newPage();
await cli.goto(`${SITE}/app?c=${cod}&produto=pet&emu=1`);
await cli.waitForSelector("#cliente .nomepet");
t(await cli.isVisible("#cliente img.avatar") && (await cli.textContent("#cliente")).includes("entrega em casa"), "tutor vê a foto e a entrega em casa");
for (const e of ["p0","p1","p2","p3","p4","p5"]) await dono.click(`#lista .card:has(.nomepet:text("Luna")) [data-e=${e}]`);
await cli.waitForSelector("#cliente .hero:has-text('6 de 6')", {timeout: 10000}); t(true, "tutor vê o andamento");

// 4. Pronto com foto
await dono.click(`#lista .card:has(.nomepet:text("Luna")) [data-act=concluir]`);
await dono.waitForSelector("#mShare.on");
t(await dono.isVisible("#shCompart") && await dono.isVisible("#shWpp"), "dois botões: compartilhar com foto e abrir WhatsApp");
await dono.setInputFiles("#shFotoIn", FOTO);
await dono.waitForSelector("#shFotoBt:has-text('Trocar')", {timeout: 10000});
await dono.click("#mShare [data-close]");
await cli.waitForSelector("#cliente img.fotopronto", {timeout: 10000});
t((await cli.textContent("#cliente .hero")).includes("Em breve sai para entrega"), "tutor vê a foto do pet pronto e que logo sai para entrega");

// 5. Saiu para entrega → entregue
await dono.click(`#lista .card:has(.nomepet:text("Luna")) [data-act=saiu]`);
await dono.waitForSelector("#mShare.on");
t((await dono.textContent("#shMsg")).includes("A Luna saiu para entrega"), "aviso de saída para entrega");
await dono.click("#mShare [data-close]");
await cli.waitForSelector("#cliente .hero:has-text('Saiu para entrega')", {timeout: 10000}); t(true, "tutor vê 'Saiu para entrega'");
await dono.click(`#lista .card:has(.nomepet:text("Luna")) [data-act=retirar]`);
await cli.waitForSelector("#cliente .hero:has-text('Entregue em casa')", {timeout: 10000}); t(true, "tutor vê 'Entregue em casa'");
d = (await (await fetch(`${FS}/lavagens/${cod}`)).json()).fields;
t(d.saiuEntrega.booleanValue && +d.retiradoEm.integerValue >= +d.saiuEm.integerValue, "saída e entrega com horários próprios");
await dono.click("#tabsV [data-tab=retirado]");
t((await dono.$$('#lista .nomepet:text("Luna")')).length === 1, "pet aparece em Entregues");
await dono.fill("#busca", "LUN"); t((await dono.$$("#lista .nomepet")).length === 1, "busca pelo nome do pet");

// 6. Conta do Lavaflux não entra pelo endereço do Petflux
await dono.fill("#busca", ""); await dono.click("#vPainel [data-sair]");
await dono.waitForSelector("#fLogin:visible");
await dono.fill("#lEmail", "dono@teste.com"); await dono.fill("#lSenha", "novaSenha9"); await dono.click("#fLogin button.pri");
await dono.waitForSelector("#esperaBox:has-text('Esta conta é do Lavaflux')", {timeout: 15000}); t(true, "conta do Lavaflux é orientada a entrar pelo endereço certo");

await b.close();
console.log(`\nPetflux ponta a ponta: ${ok} passaram, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
