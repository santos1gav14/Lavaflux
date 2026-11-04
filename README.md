# Lavaflux — acompanhamento de lavagem

Um único `index.html` com duas telas:

- **Painel da equipe** (abrir o site sem nada no link): login, registrar veículo, avançar etapas, gerar link/QR/WhatsApp.
- **Tela do cliente** (`...index.html?c=CODIGO`): mostra só aquele veículo, atualizando sozinha em tempo real.

Etapas: Em espera → Lavagem → Secagem → Limpeza interna → Finalização → **Pronto para retirada**.

## Por que o cliente só vê o próprio veículo
Cada atendimento recebe um código aleatório de 20 caracteres (impossível de adivinhar). As regras do Firestore permitem abrir um documento **pelo código**, mas bloqueiam listar a coleção. Telefone fica guardado, mas a tela do cliente não o exibe.

## Configuração (≈15 min)
1. **Firebase** → console.firebase.google.com → criar projeto → adicionar app Web → copiar o `firebaseConfig` para o topo do `<script>` no `index.html` (troque também `NOME_LAVAJATO` se quiser).
2. **Firestore Database** → criar → aba *Regras* → colar o conteúdo de `firestore.rules` → Publicar.
3. **Authentication** → ativar *E-mail/senha* → aba *Usuários* → adicionar cada funcionário (e-mail + senha). Copie o **UID** de cada um.
4. **Firestore** → criar coleção `equipe` → um documento por funcionário, com **ID = UID** dele (pode ter um campo `nome`). Só quem está nessa coleção mexe nos veículos — mesmo que alguém crie conta por fora, não consegue nada.
5. **Hospedagem**: subir o `index.html` num repositório do GitHub e ativar o GitHub Pages (ou usar Firebase Hosting).

Enquanto o `firebaseConfig` não for preenchido, o app abre em **modo demonstração** (dados só na tela), útil para testar o fluxo.

## Uso no dia a dia
1. Cliente chega → equipe registra placa (modelo, nome e WhatsApp opcionais).
2. Abre a janela de compartilhamento: copiar link, enviar no WhatsApp ou mostrar o QR no balcão.
3. A cada etapa, toca em **Avançar**. "↶ Voltar" desfaz um toque errado.
4. Ao concluir, o cliente vê "Pronto para retirada".

## Observações
- Os horários vêm do relógio do celular/computador da equipe.
- "Remover" apaga o atendimento e invalida o link. Atendimentos antigos podem ser removidos periodicamente.
