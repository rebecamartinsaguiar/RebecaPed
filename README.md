# Meu Plantão

MVP local em português, com foco somente nas quatro áreas priorizadas: calculadoras, medicações/bulas, protocolos e calendário/relatório de plantões.

## Abrir

- Para usar todos os recursos, inclusive anexos, sirva esta pasta por HTTP em `localhost` (por exemplo, `py -m http.server 4173`) e abra `http://localhost:4173`.
- O cache offline do app é habilitado quando ele é servido em `localhost` ou HTTPS. Também é possível abrir `index.html` diretamente para uma prévia, mas o armazenamento de anexos depende de IndexedDB.

## O que está implementado

- Calculadoras aritméticas de dose por peso, volume pela concentração e velocidade de infusão. Os valores clínicos são sempre inseridos pelo usuário; não há dose padrão ou recomendação terapêutica.
- Referências pessoais de medicamentos com dose e concentração opcionais, contraindicações, interações, fonte e data de revisão. Os campos começam vazios e precisam ser preenchidos/verificados por você; o app não verifica interações automaticamente.
- Biblioteca pessoal de protocolos com fonte, link, data de revisão e anexos PDF/imagem. Cada arquivo pode ter até 20 MB.
- Calendário mensal com registro de data, hora de início/fim e valor; relatório mensal por dia, quantidade de turnos e total de horas/ganhos. Turnos que cruzam a meia-noite são contabilizados como até 24 horas na data de início.
- Persistência atual no navegador: dados em localStorage e anexos em IndexedDB. A configuração do cliente Supabase existe, mas o app ainda não autentica usuários nem sincroniza dados ou arquivos.

## Limites dos dados clínicos

O app não traz bulas, doses, posologias, contraindicações, interações ou protocolos clínicos pré-carregados. Ele calcula apenas a matemática dos valores informados e organiza referências que você cadastrar. “Não registrado” não quer dizer “não existe”. Confira produto, apresentação, unidades, prescrição, dose máxima e versão vigente da fonte antes de usar em atendimento.

Fontes oficiais incluídas como atalhos:

- Anvisa, [Bulário Eletrônico](https://consultas.anvisa.gov.br/#/bulario/). A Anvisa descreve o Bulário como acesso às bases de dados das bulas e diferencia as bulas destinadas a pacientes e profissionais de saúde.
- Ministério da Saúde, [Protocolos Clínicos e Diretrizes Terapêuticas](https://www.gov.br/saude/pt-br/assuntos/pcdt). Os documentos oficiais devem ser consultados na fonte para confirmar conteúdo e vigência.

## Supabase e catálogo amplo

O catálogo de escopo observado está em `CATALOGO-MAPEADO.md`. O esquema inicial em `supabase/migrations/001_initial_schema.sql` foi aplicado manualmente pelo SQL Editor ao projeto BecaPed em 02/11/2026. A consulta de verificação encontrou as sete tabelas e o bucket privado `protocol-attachments`. A execução manual não cria uma entrada no histórico de migrações do Supabase CLI. A configuração pública em `supabase-config.js` inicializa o cliente JavaScript, mas não ativa autenticação, sincronização ou envio de anexos; essas operações ainda precisam ser implementadas no frontend.

O Project URL e a chave pública `publishable` estão configurados. Não coloque a chave `service_role` no frontend ou em arquivos versionados. GitHub é opcional para versionamento/deploy; Supabase é necessário para autenticação, banco e armazenamento privado de arquivos.

Este app é uma ferramenta auxiliar e não substitui julgamento clínico, prescrição nem protocolos institucionais.
