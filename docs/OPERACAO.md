# Configuração e operação

## PostgreSQL e autenticação própria

O Supabase hospeda apenas o banco PostgreSQL. Não são usadas chaves anon/service role nem o Supabase Auth. As contas ficam em `private.accounts`, as sessões em `private.sessions` e perfis/permissões nas tabelas de aplicação. `DATABASE_URL` usa o pooler e `DIRECT_URL` executa migrations.

`JWT_SECRET` deve conter pelo menos 32 bytes aleatórios e ficar somente no servidor. O token HS256 valida emissor, audiência, assinatura e expiração de 8 horas. Cookie HttpOnly/SameSite=Lax e Secure em produção. A sessão é verificada no banco a cada requisição; logout, senha alterada ou bloqueio revogam acesso. Não há permissões confiadas a claims enviados pelo cliente.

Senhas usam scrypt (N=32768, r=8, p=1) com salt aleatório. Master usa TOTP próprio com segredo criptografado e proteção contra repetição de código. `INTEGRATION_ENCRYPTION_KEY` deve ser preservada e protegida, pois também cifra os fatores TOTP.

Configurar SMTP_HOST/PORT/USER/PASSWORD/FROM para confirmação de e-mail, recuperação e convites. Sem SMTP, contas provisionadas administrativamente conseguem entrar, mas cadastro público e recuperação mostram indisponibilidade. Links são aleatórios, têm validade e uso único. O operador pode provisionar uma conta com `node --env-file=.env.local --import tsx scripts/provision-account.mjs EMAIL NOME master|lifetime`, fornecendo a senha por stdin, nunca em argumentos ou no repositório.

Arquivos são guardados na tabela privada `private.files` e servidos por rotas que verificam sessão e tenant. Não há dependência do Supabase Storage. O painel envia até 3 MB e imagens são reencodadas. O armazenamento consome a cota do banco; mídias recebidas continuam limitadas a 20 MB. Atualizações das telas usam consultas autenticadas a cada 5 segundos, pausadas quando a aba está oculta, sem conexão direta ao Supabase Realtime.

Executar `npm run db:migrate`. O script valida o checksum das migrations já executadas, guarda inventário local do schema e utiliza transação/advisory lock. Não editar migrations aplicadas. Fazer backup externo do banco e Storage antes de migrações em uma operação existente. O inventário `.local/backups` não é backup dos dados.

## Evolution API

Instalar Evolution V2 em VPS com HTTPS, banco persistente e acesso seguro. Preencher `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` e um segredo forte em `EVOLUTION_WEBHOOK_SECRET`. O app cria uma instância determinística por loja e configura `/api/webhooks/evolution` com cabeçalho `x-webhook-secret` e eventos de conexão/mensagens/status. O QR fica somente na resposta e na memória da tela, com expiração curta.

Homologar contra a versão exata instalada: criação, QR, reconexão, envio, recebimento, status e download Base64 de mídia. A implementação usa os endpoints V2 documentados; diferenças de DTO entre versões precisam ser verificadas no servidor real.

## Entrega

ViaCEP não requer chave. `GEOAPIFY_API_KEY` permite geocodificação e distância de rota rodoviária. Preencher o endereço completo da loja. Não há distância aproximada por linha reta. Endereço ambíguo ou rota indisponível bloqueiam a cotação e permitem chamar um atendente. Configurar cobrança por bairro **ou** faixas de distância. O painel tem um simulador de endereço/taxa.

## Pagamentos dos pedidos

Mercado Pago está desativado por decisão do produto. A loja utiliza PIX manual, dinheiro, cartões na maquininha e formas personalizadas. Configure a chave PIX nas formas de pagamento e confirme o recebimento manualmente. Nenhuma credencial Mercado Pago é necessária no `.env`.

Conexão OAuth e geração de novos PIX automáticos estão bloqueadas. Métodos antigos foram desativados/arquivados, preservando pedidos e pagamentos históricos. A assinatura SaaS BravoPay permanece separada.

## BravoPay — assinatura do Pedizza

Preencher `BRAVOPAY_API_KEY`, `BRAVOPAY_WEBHOOK_SECRET` e `BRAVOPAY_PRODUCT_ID`. Plano único de R$ 89,90/mês, sem trial. Webhook: `/api/webhooks/bravopay`. O callback não libera acesso: somente conciliação autenticada do pagamento confirmado, com referência e valor corretos.

A documentação pública verificada oferece criação de transação PIX com parâmetro `subscription` mensal. A cobrança inicial está implementada. **A homologação do ciclo recorrente completo, associação do ID de assinatura e cancelamento pelo painel ainda está pendente.** O OpenAPI publicado apenas resume os endpoints de assinatura/cancelamento, sem contrato completo de resposta. Não foi inventado um contrato. Até a homologação, tratar o cancelamento diretamente no painel BravoPay e refletir a situação pelo fluxo operacional de suporte; não anunciar cancelamento automático pelo Pedizza.

## OpenAI

Opcional: `OPENAI_API_KEY` e `OPENAI_MODEL`. A Responses API retorna somente uma classificação estruturada de intenção e consulta textual, com `store:false`. O modelo não decide preço, taxa, desconto, pagamento nem confirmação. Quando indisponível, permanece o fluxo determinístico numerado.

## Push e filas

Gerar VAPID com `web-push generate-vapid-keys`, preencher chave pública, privada e `VAPID_SUBJECT` com contato real. Ativar notificações a partir de um gesto do usuário. No iPhone, testar como PWA instalada. O service worker não armazena respostas de API nem páginas privadas. Som exige interação anterior e permissão do navegador.

Webhooks são persistidos antes da resposta e processados em `after()`. Filas usam locks, idempotência e tentativas limitadas. Erros de envio de mensagem não são repetidos automaticamente, pois um timeout pode ocorrer após o WhatsApp já ter enviado. Conferir a mensagem antes de reenviar.

`/api/cron` exige `Authorization: Bearer CRON_SECRET`. O `vercel.json` contém um cron diário compatível com o plano gratuito. Para reprocessamento e alertas de atraso em poucos minutos, configurar um scheduler HTTPS confiável a cada minuto ou um worker na VPS. Não colocar o segredo em URLs/logs. Sem esse scheduler, falhas podem aguardar o próximo webhook ou cron diário. Monitorar filas com erro no Master.

## Administração Master

Acesso depende exclusivamente da tabela privada `private.super_admins`, não do papel owner ou metadata de cadastro. Depois de confirmar o e-mail do administrador, o operador do banco pode inserir seu UUID nessa tabela. Essa operação não está exposta na aplicação. Não há promoção automática de quem se cadastra primeiro.

`/master` oferece visão da plataforma, suspensão por motivo, auditoria e suporte somente para consulta, por sessão de 15 minutos. Remover uma suspensão administrativa não cria um período pago. O Master exige sessão AAL2; `/master/seguranca` permite configurar e confirmar TOTP. Homologar recuperação de acesso com o operador do banco. Suporte com alteração operacional não é oferecido.

## Publicação

Repositório público: https://github.com/pedizza/pedizza. Site: https://pedizza.vercel.app. A publicação via CLI foi validada; a conexão automática GitHub→Vercel foi recusada pelo serviço e ainda precisa da autorização do app GitHub na Vercel. Deploy com Vercel CLI autenticada, após `npm run check`. Configurar as variáveis no ambiente Production, definir `NEXT_PUBLIC_APP_URL` para o domínio real e publicar novamente quando variáveis públicas mudarem. Nunca copiar `.env.local` para o repositório.

Homologar callbacks, e-mail, pagamento, webhook, scheduler, mobile e impressão com dois tenants reais de teste antes de comercializar. Os textos de termos e privacidade estão marcados como rascunhos e precisam dos dados e regras reais do operador.

Referências de contrato: [Evolution API](https://github.com/evolution-foundation/evolution-api), [Geoapify](https://apidocs.geoapify.com/), [Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs), [BravoPay](https://www.bravopay.club/docs), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Domínio de produção

Endereço canônico: `https://www.pedizza.com.br`. Na produção, `NEXT_PUBLIC_APP_URL` deve usar esse endereço para links de autenticação e convites. O `.env.local` de desenvolvimento continua usando localhost. Páginas acessadas pelo domínio `pedizza.vercel.app` redirecionam ao canônico; `/api/*` permanece acessível diretamente, sem redirecionar callbacks.

Cadastrar na BravoPay → Integrações a URL `https://pedizza.vercel.app/api/webhooks/bravopay`. Salvar o segredo `whsec_...` gerado pela BravoPay em `BRAVOPAY_WEBHOOK_SECRET` e replicá-lo na Vercel antes de testar entregas. Não gerar um segredo diferente no Pedizza.

O redirecionamento ao domínio canônico só é habilitado quando `CANONICAL_REDIRECT_ENABLED=true` na produção. Manter desativado enquanto os servidores DNS autoritativos divergirem, para preservar acesso pelo domínio Vercel. A metadata canônica continua apontando para www.
