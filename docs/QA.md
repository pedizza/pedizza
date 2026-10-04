# QA e estado de entrega

Verificação local: lint e TypeScript sem erros, 23 testes de domínio/segurança/banco/autenticação aprovados. Os 6 testes de navegador passaram em localhost e na publicação Vercel.

## Automatizado

- Domínio: centavos/arredondamento, dois sabores, horário noturno, sobreposição semanal, transições, telefone e documentos.
- PostgreSQL real embutido (PGlite): migrations de aplicação, RLS entre duas lojas, FK composta, revogação, suspensão, acesso anônimo, tentativa de autopromoção, escrita direta bloqueada.
- Pedido: orçamento obsoleto recusado, finalização idempotente, snapshot preservado após alteração de cardápio e isolamento de carrinho.
- Integrações: criptografia autenticada, assinatura HMAC, janela contra replay e limite de streaming.
- Navegador: home/login em desktop e mobile, hidratação, sem overflow horizontal, redirecionamento de páginas privadas, APIs sem sessão, webhook sem assinatura, manifest e service worker.

Os testes de providers não chamam serviços pagos. Os testes de banco não inserem fixtures no Supabase de produção.

## Homologação pendente

A autenticação foi migrada para JWT próprio. SMTP e credenciais de Evolution, Geoapify, OpenAI e BravoPay continuam necessários para homologar: cadastro público/e-mail, recuperação, convites por e-mail, QR de WhatsApp, envio/recebimento de anexos, rotas de endereço, PIX e pagamento recorrente, push em dispositivo físico e impressão térmica.

Com as chaves configuradas, executar:

1. Cadastrar duas lojas; confirmar e-mail; verificar cobrança pendente e rotas bloqueadas. Pagar pelo ambiente de teste do provider e verificar liberação somente pelo webhook.
2. Montar cardápios diferentes. Tentar usar IDs da outra loja em cada endpoint e no Storage. Revogar um membro com a aba aberta.
3. Configurar horário que cruza meia-noite, endereço e entrega. Validar bairro não atendido, rota sem cobertura, faixa de fronteira e falha do provider.
4. Pedir via WhatsApp: retirada/entrega, CEP genérico, endereço salvo, dois sabores, borda, observação, cupom limitado, troco e PIX. Alterar preço antes de confirmar e exigir novo aceite.
5. Repetir webhook e confirmação; confirmar um único pedido e um único resgate. Simular pagamento atrasado/estorno e eventos fora de ordem.
6. Assumir atendimento com resposta do bot pendente; enviar texto e mídias, reiniciar a instância e conferir mensagens com falha antes de reenviar.
7. Aceitar com impressão manual e automática configurada, testar popup bloqueado e papel 58/80 mm. Conferir cancelamento pago sem marcar estorno automaticamente.
8. Testar owner/manager/atendente/cozinha, overrides, convite expirado e revogação de quem convidou.
9. Testar notificações lidas em duas abas, preferências, push com tela fechada e troca de tenant.
10. Homologar mensalidade, renovação, cancelamento e suspensão no BravoPay. O contrato completo de recorrência/cancelamento ainda precisa ser confirmado.
11. Testar Master sem allowlist e com allowlist; suporte expira em 15 minutos, não altera pedidos e deixa auditoria.
12. Validar backup/restauração, fila durante queda de provider, scheduler a cada minuto, documentos legais e monitoramento.

## Limites conhecidos desta versão

- Cancelamento de recorrência BravoPay pelo painel ainda não implementado; depende do contrato/ID real do provider.
- Master possui suporte de consulta e não impersonação com edição; MFA/TOTP obrigatório implementado, ainda sem homologação com a conta real.
- Gravação de áudio usa MediaRecorder, limite de 60 segundos/3 MB; precisa de homologação no browser e na versão instalada da Evolution.
- Uploads do painel limitados a 3 MB. Não há importação em lote de cardápio nem antivírus de anexos.
- Tabelas autenticadas e fluxos completos ainda precisam de teste visual com conta real; a inspeção visual feita cobre as telas públicas.
- Cron diário sozinho não atende retentativas e alertas em tempo real; provisionar scheduler contínuo.
- Nenhuma cobrança ou mensagem externa foi disparada durante a implementação.

Autenticação própria: testados login Torre, exibição vitalícia, negação ao Master, cookie HttpOnly e revogação de sessão após logout. Login do administrador encaminha para TOTP; o fator deve ser configurado pelo próprio administrador.

Mercado Pago desativado: não é mais pendência para esta versão. Validar somente PIX manual, dinheiro, maquininha e formas personalizadas nos pedidos. A cobrança BravoPay continua independente.
