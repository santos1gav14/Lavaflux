// Testes das regras de segurança do Firestore (rodam no emulador oficial, projeto fictício demo-lavaflux)
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, writeBatch, increment } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-lavaflux",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 }
});
const agora = Date.now(), DIA = 864e5;
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, "admins/adm"), {admin: true});
  await setDoc(doc(db, "contas/estA"), {status: "ativo", venceEm: agora + 10*DIA, email: "a@x.com", nome: "A"});
  await setDoc(doc(db, "contas/estB"), {status: "ativo", venceEm: agora + 10*DIA, email: "b@x.com", nome: "B"});
  await setDoc(doc(db, "contas/estV"), {status: "ativo", venceEm: agora - DIA, email: "v@x.com", nome: "V"});
  await setDoc(doc(db, "contas/estP"), {status: "pendente", email: "p@x.com", nome: "P"});
  for (const e of ["estA","estB","estV"]) await setDoc(doc(db, `estabelecimentos/${e}`), {nome: e, uso: {total: 0}});
  await setDoc(doc(db, "membros/f1"), {est: "estA", nome: "Carlos", usuario: "carlos", ativo: true, criadoEm: agora});
  await setDoc(doc(db, "membros/f2"), {est: "estA", nome: "Revogado", usuario: "rev", ativo: false, criadoEm: agora});
  await setDoc(doc(db, "membros/fB"), {est: "estB", nome: "Bia", usuario: "bia", ativo: true, criadoEm: agora});
  await setDoc(doc(db, "lavagens/L1"), {est: "estA", placa: "AAA1A11", concluido: false, retirado: false, criadoEm: agora, checks: {}});
  await setDoc(doc(db, "lavagens/L1/privado/dados"), {est: "estA", telefone: "51999990000", historico: []});
  await setDoc(doc(db, "lavagens/L2"), {est: "estB", placa: "BBB2B22", concluido: false, retirado: false, criadoEm: agora, checks: {}});
  await setDoc(doc(db, "lavagens/L2/privado/dados"), {est: "estB", telefone: "51988880000", historico: []});
  await setDoc(doc(db, "lavagens/LV"), {est: "estV", placa: "VVV1V11", concluido: false, retirado: false, criadoEm: agora, checks: {}});
  await setDoc(doc(db, "config/publico"), {suporteWhats: "51900000000"});
  await setDoc(doc(db, "config/plataforma"), {pix: "x"});
});

const anon = env.unauthenticatedContext().firestore();
const dono = (uid) => env.authenticatedContext(uid, {email: `${uid}@x.com`}).firestore();
const func = (uid) => env.authenticatedContext(uid, {email: `${uid}.abc123@equipe.lavaflux.app`}).firestore();
const A = dono("estA"), B = dono("estB"), V = dono("estV"), P = dono("estP"), F1 = func("f1"), F2 = func("f2"), FB = func("fB"), ADM = dono("adm");
const lista = (db, est) => getDocs(query(collection(db, "lavagens"), where("est", "==", est)));

let ok = 0, falhas = 0;
async function t(nome, fn){ try { await fn(); ok++; console.log("✅", nome); } catch(e){ falhas++; console.log("❌", nome, "—", e.message.split("\n")[0]); } }

// Cliente pelo link
await t("cliente abre o próprio veículo pelo código", () => assertSucceeds(getDoc(doc(anon, "lavagens/L1"))));
await t("cliente NÃO lista veículos", () => assertFails(getDocs(collection(anon, "lavagens"))));
await t("cliente NÃO lê telefone/histórico (privado)", () => assertFails(getDoc(doc(anon, "lavagens/L1/privado/dados"))));
await t("cliente lê nome/horário do estabelecimento", () => assertSucceeds(getDoc(doc(anon, "estabelecimentos/estA"))));
await t("cliente NÃO lê dados da conta", () => assertFails(getDoc(doc(anon, "contas/estA"))));

// Proprietário
await t("proprietário lista os próprios veículos", () => assertSucceeds(lista(A, "estA")));
await t("proprietário NÃO lista veículos de outro estabelecimento", () => assertFails(lista(A, "estB")));
await t("proprietário lê privado do próprio veículo", () => assertSucceeds(getDoc(doc(A, "lavagens/L1/privado/dados"))));
await t("proprietário NÃO lê privado de outro estabelecimento", () => assertFails(getDoc(doc(A, "lavagens/L2/privado/dados"))));
await t("proprietário NÃO altera veículo de outro estabelecimento", () => assertFails(updateDoc(doc(A, "lavagens/L2"), {checks: {p0: agora}})));
await t("proprietário NÃO transfere veículo para outro estabelecimento", () => assertFails(updateDoc(doc(A, "lavagens/L1"), {est: "estB"})));
await t("proprietário registra veículo + privado + contador numa operação", async () => {
  const b = writeBatch(A);
  b.set(doc(A, "lavagens/N1"), {est: "estA", placa: "NNN1N11", concluido: false, retirado: false, criadoEm: agora, checks: {}});
  b.set(doc(A, "lavagens/N1/privado/dados"), {est: "estA", telefone: "", historico: []});
  b.set(doc(A, "estabelecimentos/estA"), {uso: {total: increment(1)}}, {merge: true});
  await assertSucceeds(b.commit());
});
await t("privado com estabelecimento diferente do veículo é recusado", async () => {
  const b = writeBatch(A);
  b.set(doc(A, "lavagens/N2"), {est: "estA", placa: "NNN2N22", concluido: false, retirado: false, criadoEm: agora, checks: {}});
  b.set(doc(A, "lavagens/N2/privado/dados"), {est: "estB", telefone: "", historico: []});
  await assertFails(b.commit());
});
await t("proprietário marca pronto e entregue (campos separados)", () => assertSucceeds(updateDoc(doc(A, "lavagens/L1"), {concluido: true, fimEm: agora, retirado: true, retiradoEm: agora + 1})));
await t("proprietário altera ajustes", () => assertSucceeds(updateDoc(doc(A, "estabelecimentos/estA"), {nome: "Novo nome"})));
await t("proprietário cria acesso de funcionário do próprio estabelecimento", () => assertSucceeds(setDoc(doc(A, "membros/f9"), {est: "estA", nome: "Novo", usuario: "novo", ativo: true, criadoEm: agora})));
await t("proprietário NÃO cria funcionário em outro estabelecimento", () => assertFails(setDoc(doc(A, "membros/f8"), {est: "estB", nome: "X", usuario: "x", ativo: true, criadoEm: agora})));
await t("proprietário revoga acesso", () => assertSucceeds(updateDoc(doc(A, "membros/f9"), {ativo: false, alteradoEm: agora})));
await t("proprietário NÃO move funcionário para outro estabelecimento", () => assertFails(updateDoc(doc(A, "membros/f9"), {est: "estB"})));
await t("proprietário lista a própria equipe", () => assertSucceeds(getDocs(query(collection(A, "membros"), where("est", "==", "estA")))));
await t("proprietário NÃO lista equipe de outro", () => assertFails(getDocs(query(collection(A, "membros"), where("est", "==", "estB")))));
await t("proprietário NÃO aprova a própria conta", () => assertFails(updateDoc(doc(A, "contas/estA"), {venceEm: agora + 999*DIA})));

// Funcionário ativo
await t("funcionário lista veículos do seu estabelecimento", () => assertSucceeds(lista(F1, "estA")));
await t("funcionário lê privado (telefone/histórico) do seu estabelecimento", () => assertSucceeds(getDoc(doc(F1, "lavagens/L1/privado/dados"))));
await t("funcionário registra veículo + privado + contador", async () => {
  const b = writeBatch(F1);
  b.set(doc(F1, "lavagens/N3"), {est: "estA", placa: "FFF1F11", concluido: false, retirado: false, criadoEm: agora, checks: {}});
  b.set(doc(F1, "lavagens/N3/privado/dados"), {est: "estA", telefone: "", historico: []});
  b.set(doc(F1, "estabelecimentos/estA"), {uso: {total: increment(1)}}, {merge: true});
  await assertSucceeds(b.commit());
});
await t("funcionário marca etapa", () => assertSucceeds(updateDoc(doc(F1, "lavagens/N3"), {checks: {p0: agora}})));
await t("funcionário NÃO remove veículo", () => assertFails(deleteDoc(doc(F1, "lavagens/N3"))));
await t("funcionário NÃO altera ajustes (nome/etapas)", () => assertFails(updateDoc(doc(F1, "estabelecimentos/estA"), {nome: "Hack"})));
await t("funcionário NÃO cria acessos", () => assertFails(setDoc(doc(F1, "membros/f7"), {est: "estA", nome: "X", usuario: "x", ativo: true, criadoEm: agora})));
await t("funcionário NÃO se reativa nem altera o próprio acesso", () => assertFails(updateDoc(doc(F1, "membros/f1"), {ativo: true, nome: "Outro"})));
await t("funcionário NÃO lista a equipe", () => assertFails(getDocs(query(collection(F1, "membros"), where("est", "==", "estA")))));
await t("funcionário lê a situação da conta (para saber se está pausada)", () => assertSucceeds(getDoc(doc(F1, "contas/estA"))));
await t("funcionário NÃO acessa outro estabelecimento", () => assertFails(lista(F1, "estB")));

// Funcionário revogado / de outro estabelecimento
await t("funcionário revogado NÃO lista veículos", () => assertFails(lista(F2, "estA")));
await t("funcionário revogado NÃO marca etapa", () => assertFails(updateDoc(doc(F2, "lavagens/N3"), {checks: {}})));
await t("funcionário de B NÃO altera veículo de A", () => assertFails(updateDoc(doc(FB, "lavagens/N3"), {checks: {}})));

// Conta vencida ou pendente
await t("conta vencida NÃO registra veículo", () => assertFails(setDoc(doc(V, "lavagens/N4"), {est: "estV", placa: "VVV2V22", concluido: false, retirado: false, criadoEm: agora, checks: {}})));
await t("conta vencida NÃO lista veículos", () => assertFails(lista(V, "estV")));
await t("conta pendente NÃO registra veículo", () => assertFails(setDoc(doc(P, "lavagens/N5"), {est: "estP", placa: "PPP1P11", concluido: false, retirado: false, criadoEm: agora, checks: {}})));
await t("link do cliente de conta vencida continua abrindo", () => assertSucceeds(getDoc(doc(anon, "lavagens/LV"))));

// Cadastro e configuração
await t("novo cadastro cria conta pendente", () => assertSucceeds(setDoc(doc(dono("novo1"), "contas/novo1"), {email: "n@x.com", nome: "N", whatsapp: "51999999999", status: "pendente", criadoEm: agora})));
await t("novo cadastro NÃO se cria já ativo", () => assertFails(setDoc(doc(dono("novo2"), "contas/novo2"), {email: "n@x.com", nome: "N", whatsapp: "5199", status: "ativo", criadoEm: agora})));
await t("cadastro do Petflux grava o produto", () => assertSucceeds(setDoc(doc(dono("pet1"), "contas/pet1"), {email: "p@x.com", nome: "Pet", whatsapp: "51999999999", produto: "petflux", status: "pendente", criadoEm: agora})));
await t("cadastro NÃO aceita produto desconhecido", () => assertFails(setDoc(doc(dono("pet2"), "contas/pet2"), {email: "p@x.com", nome: "Pet", whatsapp: "5199", produto: "outro", status: "pendente", criadoEm: agora})));
await t("atendimento com foto do pet dentro do limite", () => assertSucceeds(updateDoc(doc(A, "lavagens/N1"), {foto: "data:image/jpeg;base64," + "a".repeat(100000), fotoPronto: null})));
await t("foto grande demais é recusada", () => assertFails(updateDoc(doc(A, "lavagens/N1"), {fotoPronto: "x".repeat(250000)})));
await t("site lê o contato público de suporte", () => assertSucceeds(getDoc(doc(anon, "config/publico"))));
await t("visitante NÃO lê dados de cobrança", () => assertFails(getDoc(doc(anon, "config/plataforma"))));
await t("estabelecimento NÃO altera contato de suporte", () => assertFails(setDoc(doc(A, "config/publico"), {suporteWhats: "1"})));
await t("admin altera contato de suporte", () => assertSucceeds(setDoc(doc(ADM, "config/publico"), {suporteWhats: "51911111111"})));
await t("admin aprova conta", () => assertSucceeds(updateDoc(doc(ADM, "contas/estP"), {status: "ativo", venceEm: agora + 15*DIA})));

await env.cleanup();
console.log(`\nRegras: ${ok} passaram, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
