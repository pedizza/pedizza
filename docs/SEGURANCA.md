# Segurança e arquitetura

## Isolamento

Todas as entidades operacionais carregam `tenant_id`. Relações sensíveis usam chaves estrangeiras compostas `(tenant_id,id)`. RLS restringe leituras à associação ativa, às permissões efetivas e à assinatura. O servidor obtém o usuário pela sessão JWT própria e revalida a associação; o tenant do cookie precisa pertencer ao usuário.

O backend usa um papel privilegiado somente em transações de serviço, com filtro explícito de tenant e autorização antes das escritas. Não expor `DATABASE_URL`, credenciais dos providers ao navegador. A migration 007 revoga escrita direta do papel `authenticated` para impedir contorno das validações via REST do Supabase.

Permissões: owner, presets de equipe e overrides booleanos. Quem gerencia a equipe não concede permissões que não possui, não modifica o owner e não altera seu próprio acesso. Aceitar convite valida hash, e-mail confirmado, prazo, status e autoridade atual do convidador.

## Pedidos e pagamentos

Dinheiro usa inteiros em centavos. O orçamento é reconstruído dos registros ativos. Um hash exige nova confirmação quando muda. Finalização trava a loja, verifica horário/assinatura/pagamento, revalida cupom, cria snapshots e impede duplicação pelo carrinho. Pagamento e estado de preparo são independentes. Cancelamento/recusa preservam histórico e revertem resgate do cupom; estorno financeiro não é presumido.

Credenciais de Mercado Pago usam AES-256-GCM. OAuth state aleatório é armazenado como hash e consumido uma única vez, vinculado ao usuário/tenant. Webhooks assinados são conferidos antes de enfileirar. A conciliação consulta o provider: um JSON de cliente ou retorno de navegador não ativa assinatura e não marca PIX pago.

## Limites operacionais

Rotas de mutação exigem sessão, origem same-origin, schema estrito e limite de frequência quando aplicável. Webhooks usam autenticação própria. Corpos e downloads têm limites. Uploads validam assinatura do arquivo; imagens são reencodadas. PDF e demais anexos são servidos por rotas autenticadas para download. A validação de formato não substitui antivírus; não há scanner de malware nesta versão.

CSP usa nonce por requisição e páginas dinâmicas. Tokens, corpos de conversa e QR não entram no log de erro. Auditoria guarda ação/IDs e metadados reduzidos. PWA não oferece operação offline de pedidos; apresenta página offline para evitar ações sobre dados antigos.

## Dependências

O audit inicial encontrou um advisory em `braces@3.0.3`, transitivo do ESLint/Next (ferramenta de desenvolvimento), sem versão corrigida publicada na verificação. Não foi aplicado o downgrade incompatível sugerido automaticamente pelo npm. Reavaliar com `npm audit`; `npm audit --omit=dev` verifica separadamente o runtime. Evitar padrões glob não confiáveis na ferramenta de lint.

## Antes da abertura comercial

Concluir testes com credenciais reais, política de retenção/backups, restauração, SMTP, homologação do MFA administrativo, scheduler contínuo, ciclo de cancelamento BravoPay, monitoramento e revisão dos documentos legais. Nenhuma dessas tarefas deve ser inferida como concluída apenas porque o build passou.

## JWT próprio

O JWT não é aceito pelo Supabase Auth: serve somente ao backend Pedizza. Após validá-lo, o servidor valida a sessão privada e define a identidade apenas na transação SQL. As políticas RLS existentes permanecem ativas. Contas não dependem da tabela gerenciada `auth.users`. Não há escrita direta do navegador.

Referências: [jose](https://github.com/panva/jose), [OTPAuth](https://github.com/hectorm/otpauth), [Node.js scrypt](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).
