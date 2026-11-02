# RebecaPed — protótipo PWA 0.1

## Conteúdo
- `index.html`: interface e funcionalidades iniciais.
- `manifest.webmanifest`: configuração instalável.
- `service-worker.js`: cache da interface para uso offline.
- `icon.svg`: ícone do aplicativo.

## Como testar no computador
A PWA precisa ser servida por `localhost` ou HTTPS; abrir o HTML diretamente como `file://` não ativa o Service Worker.
1. Instale Python 3, se ainda não estiver instalado.
2. Abra o terminal na pasta extraída.
3. Execute: `python -m http.server 8000`
4. No próprio computador, acesse `http://localhost:8000`.

## Como testar no iPhone
Para instalar no iPhone, publique os arquivos em um host HTTPS confiável. Depois, no Safari do iPhone:
1. Abra o endereço HTTPS do app.
2. Toque em Compartilhar.
3. Selecione “Adicionar à Tela de Início”.
4. Abra pelo ícone criado.

## O que funciona nesta versão
- Navegação e identidade visual.
- Catálogo com 13 calculadoras identificadas.
- Calculadora de idade corrigida do prematuro (estimativa matemática).
- Equação Mifflin–St Jeor para adultos, com aviso explícito de que não é pediátrica.
- Equação simplificada de Weir, com aviso para validar a aplicabilidade.
- Cadastro, edição por exclusão e resumo mensal de plantões, com cálculo de horas e valor médio por hora.
- Importação local de PDFs para a biblioteca de protocolos via IndexedDB.
- Estrutura inicial de medicamentos com bloqueio explícito de cálculo não validado.
- Cache offline do shell após primeira carga bem-sucedida.

## Limitações e segurança
- Este é um protótipo técnico, não um dispositivo médico validado.
- As calculadoras clínicas ainda pendentes não produzem resultados; precisam de fórmulas, referências, testes e revisão clínica antes de serem habilitadas.
- A área de medicamentos não contém doses prontas. Não usar para prescrição.
- A função de exportação de protocolos exporta somente um índice, não os bytes dos PDFs. Mantenha cópias dos documentos originais.
- Dados de plantões são armazenados no localStorage do navegador; PDFs ficam no IndexedDB. Limpar os dados do navegador pode apagar informações.
- Use apenas protocolos sem dados identificáveis de pacientes.
- A instalação offline depende de hospedagem HTTPS/localhost e pode variar conforme navegador e espaço de armazenamento.

## Próximas etapas recomendadas
1. Validar as fórmulas e fontes de cada calculadora com referências clínicas atualizadas.
2. Implementar os esquemas de medicamentos por indicação, faixa etária, unidade, intervalo, dose máxima e concentração, com testes de segurança.
3. Implementar backup e restauração completos, incluindo PDFs.
4. Testar a instalação e o comportamento offline em um iPhone real.
