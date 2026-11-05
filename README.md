# Lavaflux — acompanhamento de lavagem

Um único `index.html` com duas telas:

- **Painel da equipe** (abrir o site sem nada no link): login, registrar veículo, avançar etapas, gerar link/QR/WhatsApp.
- **Tela do cliente** (`...index.html?c=CODIGO`): mostra só aquele veículo, atualizando sozinha em tempo real.

Etapas: cadastradas pelo próprio estabelecimento em **⚙️ Etapas** (padrão: Lavagem externa, Secagem, Limpeza interna, Finalização). Cada veículo tem suas etapas, marcadas como checklist em qualquer ordem. Ao **Concluir**, o cliente vê "Pronto para retirada" e a equipe pode avisá-lo no WhatsApp.

Cada cadastro pode ser alterado em **✏️ Editar** (placa, modelo, nome, WhatsApp e etapas).

## Por que o cliente só vê o próprio veículo
Cada atendimento recebe um código aleatório de 20 caracteres (impossível de adivinhar). As regras do Firestore permitem abrir um documento **pelo código**, mas bloqueiam listar a coleção. Telefone fica guardado, mas a tela do cliente não o exibe.

## Configuração
O `firebaseConfig` já está no `index.html` (projeto `lavaflux-1da77`). Falta, no console do Firebase:
1. **Firestore Database** → Criar banco → local `southamerica-east1 (São Paulo)` → modo produção → aba *Regras* → colar `firestore.rules` com os e-mails da equipe → Publicar.
2. **Authentication** → Vamos começar → *E-mail/senha* → Ativar → aba *Usuários* → Adicionar usuário para cada funcionário.
3. Todo funcionário novo: criar o usuário (passo 2) **e** incluir o e-mail dele na lista de `firestore.rules` (passo 1).

Site: https://santos1gav14.github.io/lavaflux/

## Uso no dia a dia
1. Cliente chega → equipe registra placa (modelo, nome e WhatsApp opcionais).
2. Abre a janela de compartilhamento: copiar link, enviar no WhatsApp ou mostrar o QR no balcão.
3. A cada etapa, toca em **Avançar**. "↶ Voltar" desfaz um toque errado.
4. Ao concluir, o cliente vê "Pronto para retirada".

## Observações
- Os horários vêm do relógio do celular/computador da equipe.
- "Remover" apaga o atendimento e invalida o link. Atendimentos antigos podem ser removidos periodicamente.
