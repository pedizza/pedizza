# Pedizza

Site de acompanhamento: https://pedizza.vercel.app · Local: http://localhost:3000

Gestão multi-tenant para pizzarias: cardápio, entrega, pedidos via WhatsApp, atendimento, equipe, pagamentos e assinatura SaaS.

**Estado:** implementação em validação. Login próprio e acesso vitalício foram implementados. Provedores e cobrança precisam das credenciais e da homologação descritas em [operação](docs/OPERACAO.md). Não usar para cobrar clientes antes de concluir essa homologação.

## Executar

Node.js 22 ou superior e PostgreSQL/Supabase.

```sh
npm ci
cp .env.example .env.local
# Preencher as variáveis conforme docs/OPERACAO.md
npm run db:migrate
npm run dev -- --hostname 0.0.0.0
```

Abra http://localhost:3000. O arquivo `.env.local` é ignorado pelo Git e pela publicação do código. O certificado público do Supabase está em `config/supabase-ca.crt`; a conexão verifica TLS.

```sh
npm run check       # ESLint, TypeScript, testes PostgreSQL/domínio e build
npm run test:e2e    # servidor localhost já iniciado
```

## Estrutura

- `src/app`: páginas e endpoints Next.js App Router.
- `src/lib/domain`: dinheiro em centavos, horários, documentos e transições.
- `src/lib/services`: preço, pedidos, chatbot persistente, filas e notificações.
- `src/lib/integrations`: Evolution, ViaCEP/Geoapify, Mercado Pago, BravoPay e OpenAI.
- `supabase/migrations`: schema, permissões, RLS, integridade e arquivos privados.
- `tests`: domínio, criptografia, PostgreSQL embutido e navegador.

O acesso de conta usa autenticação própria JWT (HS256), senha scrypt e sessões revogáveis no PostgreSQL. Não utiliza Supabase Auth nem chaves anon/service role. O backend usa `pg` e transações explícitas. Leituras de conta executam com papel `authenticated` e RLS; escritas usam endpoints com autorização, tenant validado, validação de regras e auditoria. As permissões de escrita direta do navegador foram revogadas. Este projeto não depende de Prisma.

Os dados de teste vivem apenas no PostgreSQL isolado dos testes. Não há lojas, pedidos ou integrações fictícias na aplicação.

Veja [segurança e arquitetura](docs/SEGURANCA.md), [operação](docs/OPERACAO.md) e [QA e pendências](docs/QA.md).
