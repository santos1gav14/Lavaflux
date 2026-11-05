# Lavaflux

Plataforma para lava jatos: o cliente acompanha pelo link o andamento do próprio veículo.

**App:** https://lavaflux.web.app

## Como funciona
- **Lava jato** cria a conta em "Criar conta do estabelecimento" (nome, e-mail, senha) e aguarda aprovação.
- **Administrador** (conta registrada em `admins/` no Firestore) entra no mesmo link e vê o painel de contas: aguardando, ativas e desativadas, com uso de cada uma. Aprova, recusa, desativa ou reativa.
- **Estabelecimento aprovado**: um login por lava jato; cada celular informa o nome do funcionário (fica salvo no aparelho) para o histórico.
  - Registra veículos (carro/moto), marca etapas em qualquer ordem, conclui e avisa pelo WhatsApp.
  - Em ⚙️ Ajustes: nome do estabelecimento, etapas e horário de funcionamento.
- **Cliente** (`?c=código`): vê nome do estabelecimento, etapas concluídas, status e horário de funcionamento.

As mensagens do WhatsApp usam o nome do estabelecimento.

## Dados (Firestore)
- `contas/{uid}` privado: e-mail, status (pendente | ativo | inativo)
- `estabelecimentos/{uid}` público: nome, etapas, horário
- `lavagens/{código}` veículo, com `est` = uid do estabelecimento
- `admins/{uid}` administradores

## Publicação
Cada push na `main` publica automaticamente (GitHub Actions → Firebase Hosting + regras do Firestore).
