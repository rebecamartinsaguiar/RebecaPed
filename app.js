const STORAGE_KEY = 'meu-plantao:v1';
const FILE_DB_NAME = 'meu-plantao-files-v1';
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const SYNC_META_KEY = 'meu-plantao:sync:v1';
const LOCAL_BACKUP_KEY = 'meu-plantao:pre-sync-backup:v1';
const STORAGE_BUCKET = 'protocol-attachments';
const SUPPORTED_ATTACHMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const CALCULATOR_CATALOG = {
  'Hidroeletrolítico': 'Hidratação Venosa|Ânion Gap|Osmolaridade Plasmática|Sódio Corrigido — Hiperglicemia|Cálcio Corrigido — Albumina|Hipernatremia|Hiponatremia|Hipocalemia|SRO|Reposição de Bicarbonato',
  'UTI / Emergência': 'Emergência Pediátrica|Equivalência de Corticoides|PRISM Original|PRISM III CPCCRN 4h|PRISM IV|PIM 2|PIM 3|PELOD-2|pSOFA|Phoenix Sepsis Score|VIS|OI / OSI|PASS|Pediatric Trauma Score|SIPA|Triagem SIRS pediátrica|Queimaduras — Lund & Browder|Infusão contínua|Vasopressores',
  'Neonatologia': 'Classificação do RN|Reanimação Neonatal|Crescimento do Prematuro INTERGROWTH-21st|Icterícia Neonatal|Nomograma de Bhutani|Score de Rodwell|Capurro Somático|Capurro Somatoneurológico|Escala de Apgar|Idade Corrigida do Prematuro|Escala de Finnegan|Escala de Ballard|Escore de Downes|FiO₂ em baixo fluxo|New Ballard Score|SNAPPE-II|CRIB-II|nSOFA|Silverman-Andersen',
  'Procedimentos': 'Dispositivos Pediátricos|Gotejamento|Tubo IOT Pediátrico',
  'Antropometria': 'IG por Ultrassonografia|IG pela DUM|Crescimento OMS|Circunferência Braquial OMS|Acondroplasia CLARITY|Síndrome de Down Zemel/CDC|Turner Brasil|Prega Tricipital OMS|Prega Subescapular OMS|Velocidade de Peso OMS|Velocidade de Perímetro Cefálico OMS|Velocidade de Comprimento OMS|Perímetro Cefálico|IMC e Superfície Corporal|Estatura Alvo',
  'Clínicas': 'Pressão Arterial Pediátrica|Fração de Excreção de Ureia|Fração de Excreção de Sódio|Sinais Vitais Pediátricos|Critérios de Roma IV',
  'Nefrologia': 'Clearance de Creatinina — Bedside Schwartz|Clearance de Creatinina — Schwartz|IRA KDIGO Pediátrico',
  'Escores': 'Escore de Raimondi|Escala RASS|Glasgow Pediátrico|FLACC|Escore de Westley|Wood-Downes|Wood-Downes-Ferrés|PECARN — TCE|PEWS|Escala de Faces Wong-Baker|GINA — Controle de Asma|PAS|Centor e McIsaac',
  'Nutrição': 'GEB WHO/FAO/UNU|GEB Harris-Benedict|GEB Schofield|Energia Holliday-Segar|GEB Mifflin-St Jeor|Energia DRI/NASEM|Energia FAO/WHO/UNU|Calorimetria Indireta|Energia em Nutrição Parenteral Pediátrica|Manejo da Desnutrição Aguda',
};
const CALCULATOR_CATEGORIES = Object.keys(CALCULATOR_CATALOG);
const READY_CALCULATOR_CATEGORIES = new Set(['Hidroeletrolítico']);
const CALCULATOR_IMPLEMENTATIONS = {
  'hidratacao-venosa': {
    title: 'Hidratação Venosa', category: 'Hidroeletrolítico',
    fields: [
      { id: 'weight', label: 'Peso', unit: 'kg' }, { id: 'fluidRate', label: 'Volume hídrico prescrito', unit: 'mL/kg/dia' }, { id: 'tig', label: 'TIG prescrita', unit: 'mg/kg/min' },
      { id: 'naDose', label: 'Sódio prescrito', unit: 'mEq/kg/dia', optional: true }, { id: 'naConc', label: 'Concentração do estoque de sódio', unit: 'mEq/mL', optional: true },
      { id: 'kDose', label: 'Potássio prescrito', unit: 'mEq/kg/dia', optional: true }, { id: 'kConc', label: 'Concentração do estoque de potássio', unit: 'mEq/mL', optional: true },
      { id: 'caDose', label: 'Cálcio prescrito', unit: 'mg/kg/dia', optional: true }, { id: 'caConc', label: 'Concentração do estoque de cálcio', unit: 'mg/mL', optional: true },
      { id: 'mgDose', label: 'Magnésio prescrito', unit: 'mEq/kg/dia', optional: true }, { id: 'mgConc', label: 'Concentração do estoque de magnésio', unit: 'mEq/mL', optional: true },
    ],
    formula: 'Calcula volume diário, glicose necessária para a TIG informada e volumes de eletrólitos somente quando você preencher a prescrição e a concentração do produto. Não sugere doses nem composição da solução.',
    source: { label: 'NICE — fluidoterapia IV em crianças', url: 'https://www.nice.org.uk/guidance/ng29/chapter/recommendations' },
    calculate: v => {
      const volume = v.weight * v.fluidRate;
      const glucoseG = v.tig * v.weight * 1.44;
      const lines = [`Volume total calculado: ${number.format(volume)} mL/dia (${number.format(volume / 24)} mL/h).`, `Glicose para a TIG informada: ${number.format(glucoseG)} g/dia; concentração equivalente aproximada: ${number.format(glucoseG * 100 / volume)}% m/v.`];
      for (const [name, dose, conc, unit] of [['Sódio', v.naDose, v.naConc, 'mL'], ['Potássio', v.kDose, v.kConc, 'mL'], ['Cálcio', v.caDose, v.caConc, 'mL'], ['Magnésio', v.mgDose, v.mgConc, 'mL']]) {
        if ((dose == null) !== (conc == null)) throw new Error(`Preencha dose e concentração do estoque de ${name.toLowerCase()}, ou deixe ambos vazios.`);
        if (dose != null) {
          const amount = dose * v.weight;
          lines.push(`${name}: ${number.format(amount)} ${name === 'Cálcio' ? 'mg' : 'mEq'}/dia; volume do estoque: ${number.format(amount / conc)} ${unit}/dia.`);
        }
      }
      return { lines, warning: 'Confirme indicação, compatibilidade, acesso, limites de concentração e velocidade com protocolo local. O volume dos aditivos deve ser considerado no volume final conforme a prescrição.' };
    },
  },
  'anion-gap': {
    title: 'Ânion Gap', category: 'Hidroeletrolítico',
    fields: [{ id: 'na', label: 'Sódio', unit: 'mEq/L', hint: 'Faixa aceita: 100–200' }, { id: 'cl', label: 'Cloreto', unit: 'mEq/L', hint: 'Faixa aceita: 60–160' }, { id: 'hco3', label: 'Bicarbonato', unit: 'mEq/L', hint: 'Faixa aceita: 1–60' }],
    formula: 'Ânion gap = Na − (Cl + HCO₃). Não inclui potássio.',
    clinicalGuide: {
      reference: '10–14 mEq/L (referência exibida pelo Proped para pediatria; confirme a faixa do laboratório local).',
      sections: [
        { title: 'O que é', paragraphs: ['O ânion gap estima a diferença entre os cátions e ânions medidos e ajuda a classificar acidose metabólica. Esta calculadora usa Na⁺ − (Cl⁻ + HCO₃⁻), sem incluir K⁺.'] },
        { title: 'Quando usar', bullets: ['Na avaliação de distúrbio ácido-base, especialmente quando há acidose metabólica.', 'Como parte da investigação de causas com ânion gap aumentado ou normal; o resultado não identifica a causa sozinho.'] },
        { title: 'Como usar', bullets: ['Informe sódio, cloreto e bicarbonato da mesma coleta e confira as unidades.', 'Compare o resultado com a faixa pediátrica do laboratório e interprete junto da gasometria, albumina e quadro clínico.'] },
        { title: 'Como interpretar', bullets: ['Um valor acima da referência pode acompanhar acúmulo de ânions não medidos; considere lactato, cetonas, função renal e exposições conforme o contexto.', 'Um valor dentro da faixa não exclui distúrbio ácido-base. Acidose hiperclorêmica pode ocorrer com ânion gap normal.', 'A hipoalbuminemia pode reduzir o ânion gap medido e mascarar aumento; uma fórmula usada para correção é AG + 2,5 × (4 − albumina em g/dL).'] },
        { title: 'Pontos de atenção', bullets: ['Faixas variam com método, laboratório e idade; use a referência pediátrica local.', 'Considere delta gap/delta ratio quando houver suspeita de distúrbio misto, usando valores de referência adequados ao serviço.', 'O cálculo não substitui gasometria, avaliação clínica ou investigação etiológica.'] },
      ],
      references: [{ label: 'Proped — Ânion Gap', url: 'https://proped.app/calculadoras/anion-gap' }, { label: 'ISPAD — diretriz de cetoacidose diabética pediátrica', url: 'https://www.ispad.org/static/6dd62eae-c8cb-4b4a-84e1efc768505746/Ch11PediatricDiabetes.pdf' }],
    },
    calculate: v => {
      const value = v.na - v.cl - v.hco3;
      const status = value < 10 ? 'Abaixo da referência' : value > 14 ? 'Acima da referência' : 'Ânion gap normal';
      return { clinical: { label: 'Resultado · Ânion gap', value: clinicalNumber.format(value), unit: 'mEq/L', reference: '10–14 mEq/L', status, tone: value < 10 || value > 14 ? 'out' : 'normal', formula: 'AG = Na⁺ − (Cl⁻ + HCO₃⁻)', memory: `${number.format(v.na)} − (${number.format(v.cl)} + ${number.format(v.hco3)}) = ${clinicalNumber.format(value)} mEq/L` } };
    },
  },
  'osmolaridade-plasmatica': {
    title: 'Osmolaridade Plasmática', category: 'Hidroeletrolítico',
    fields: [{ id: 'na', label: 'Sódio', unit: 'mEq/L', hint: 'Faixa aceita: 100–200' }, { id: 'glucose', label: 'Glicose', unit: 'mg/dL', hint: 'Faixa aceita: 30–1000' }, { id: 'urea', label: 'Ureia', unit: 'mg/dL' }],
    formula: 'Osmolaridade plasmática estimada = 2 × Na⁺ + glicose/18 + ureia/6.',
    clinicalGuide: {
      reference: '275–295 mOsm/L (faixa exibida pelo Proped; confirme referência e unidade do laboratório local).',
      sections: [
        { title: 'O que é', paragraphs: ['A osmolaridade calculada estima a concentração de partículas osmoticamente ativas no plasma. A fórmula desta tela usa sódio, glicose e ureia; a tonicidade efetiva exclui a ureia.'] },
        { title: 'Quando usar', bullets: ['Na avaliação de alterações de hidratação e de sódio, alteração de consciência e hiperglicemia importante.', 'Pode apoiar investigação de osmóis não medidos quando comparada com osmolaridade medida; o gap osmolar exige uma medida laboratorial.'] },
        { title: 'Como usar', bullets: ['Informe sódio em mEq/L e glicose e ureia em mg/dL, de uma mesma coleta.', 'Use o resultado como estimativa e, quando indicado, compare com osmolaridade medida e calcule o gap osmolar conforme protocolo.'] },
        { title: 'Como interpretar', bullets: ['Abaixo de 275 mOsm/L: abaixo da faixa de referência do Proped.', '275–295 mOsm/L: dentro da faixa de referência do Proped.', 'Acima de 295 mOsm/L: acima da faixa; avalie sódio, glicose, ureia, hidratação e possível contribuição de osmóis não medidos.', 'A tonicidade efetiva é 2 × Na⁺ + glicose/18; não inclui ureia.'] },
        { title: 'Pontos de atenção', bullets: ['A osmolaridade calculada não é igual à osmolaridade medida; suspeita de tóxicos ou discrepância clínica requer avaliação apropriada.', 'Hiperlipidemia ou hiperproteinemia podem interferir na medida do sódio; confira método e contexto.', 'A velocidade de correção de distúrbios de sódio e glicose exige monitorização e protocolo clínico; este valor isolado não orienta tratamento.'] },
      ],
      references: [{ label: 'Proped — Osmolaridade Plasmática', url: 'https://proped.app/calculadoras/osmolaridade' }, { label: 'Worthley et al. — fórmula de osmolaridade (1987)', url: 'https://doi.org/10.1177/0310057X8701500214' }],
    },
    calculate: v => {
      const sodiumTerm = 2 * v.na, glucoseTerm = v.glucose / 18, ureaTerm = v.urea / 6;
      const value = sodiumTerm + glucoseTerm + ureaTerm;
      const tonicity = sodiumTerm + glucoseTerm;
      const status = value < 275 ? 'Abaixo da referência' : value > 295 ? 'Acima da referência' : 'Normal';
      return { clinical: { label: 'Osmolaridade plasmática', value: clinicalNumber.format(value), unit: 'mOsm/L', reference: '275–295 mOsm/L', status, tone: value < 275 || value > 295 ? 'out' : 'normal', scale: { value, min: 250, max: 320, low: 275, high: 295 }, formula: '2 × Na⁺ + glicose/18 + ureia/6', memory: [`2 × Na⁺: 2 × ${number.format(v.na)} = ${clinicalNumber.format(sodiumTerm)}`, `Glicose ÷ 18: ${number.format(v.glucose)} ÷ 18 = ${clinicalNumber.format(glucoseTerm)}`, `Ureia ÷ 6: ${number.format(v.urea)} ÷ 6 = ${clinicalNumber.format(ureaTerm)}`, `Total: ${clinicalNumber.format(value)} mOsm/L`, `Tonicidade efetiva (sem ureia): ${clinicalNumber.format(tonicity)} mOsm/L`] } };
    },
  },
  'sodio-corrigido-hiperglicemia': {
    title: 'Sódio Corrigido — Hiperglicemia', category: 'Hidroeletrolítico',
    fields: [{ id: 'na', label: 'Sódio sérico (Na⁺)', unit: 'mEq/L', hint: 'Faixa aceita: 100–200' }, { id: 'glucose', label: 'Glicemia', unit: 'mg/dL', hint: 'Faixa aceita: 30–1000' }],
    formula: 'Estimativa exibida: Na medido + 0,016 × (glicose − 100), com glicose em mg/dL.',
    clinicalGuide: {
      reference: '135–145 mEq/L (faixa exibida pelo Proped para pediatria; confira o laboratório local).',
      sections: [
        { title: 'O que é', paragraphs: ['Na hiperglicemia, a glicose extracelular desloca água para o espaço extracelular e pode reduzir temporariamente o sódio medido. O cálculo estima o sódio ajustado para glicemia de 100 mg/dL.'] },
        { title: 'Quando usar', bullets: ['Na interpretação do sódio durante hiperglicemia, inclusive em cetoacidose diabética e estado hiperglicêmico.', 'Ajuda a distinguir hiponatremia translocacional de possível hiponatremia concomitante; não escolhe solução nem velocidade de correção.'] },
        { title: 'Como usar', bullets: ['Informe sódio medido em mEq/L e glicemia em mg/dL da mesma coleta.', 'Esta calculadora usa a fórmula do Proped: Na corrigido = Na medido + 0,016 × (glicemia − 100).'] },
        { title: 'Como interpretar', bullets: ['Compare com a faixa pediátrica exibida e com a referência do laboratório.', 'Sódio corrigido baixo pode indicar hiponatremia concomitante; valor elevado pode indicar déficit de água livre, conforme avaliação clínica.', 'Acompanhe medidas seriadas durante o tratamento, pois glicemia e sódio medido mudam ao longo do tempo.'] },
        { title: 'Pontos de atenção', bullets: ['Há diferentes coeficientes publicados para correção; esta tela mantém o coeficiente 0,016 mostrado pelo Proped. Estudos descrevem resultados diferentes, em especial com glicemias muito elevadas.', 'Pseudo-hiponatremia por hiperlipidemia ou hiperproteinemia não é corrigida por esta fórmula.', 'Use protocolo pediátrico vigente para decisões terapêuticas e monitorização; o resultado isolado não define reposição de sódio.'] },
      ],
      references: [{ label: 'Proped — Sódio Corrigido pela Hiperglicemia', url: 'https://proped.app/calculadoras/sodio-hiperglicemia' }, { label: 'ISPAD — diretriz de cetoacidose diabética pediátrica', url: 'https://www.ispad.org/static/6dd62eae-c8cb-4b4a-84e1efc768505746/Ch11PediatricDiabetes.pdf' }, { label: 'Hillier et al. — fator de correção para hiperglicemia (1999)', url: 'https://pubmed.ncbi.nlm.nih.gov/10225241/' }],
    },
    calculate: v => {
      const correction = 0.016 * (v.glucose - 100), value = v.na + correction;
      const status = value < 135 ? 'Sódio corrigido abaixo da faixa normal' : value > 145 ? 'Sódio corrigido acima da faixa normal' : 'Sódio corrigido dentro da faixa normal';
      return { clinical: { label: 'Resultado · Sódio corrigido', value: clinicalNumber.format(value), unit: 'mEq/L', reference: '135–145 mEq/L', status, tone: value < 135 || value > 145 ? 'out' : 'normal', formula: 'Na⁺ corrigido = Na⁺ medido + 0,016 × (glicemia − 100)', memory: `${number.format(v.na)} + 0,016 × (${number.format(v.glucose)} − 100) = ${clinicalNumber.format(value)} mEq/L` } };
    },
  },
  'calcio-corrigido-albumina': {
    title: 'Cálcio Corrigido — Albumina', category: 'Hidroeletrolítico',
    fields: [{ id: 'calcium', label: 'Cálcio total', unit: 'mg/dL' }, { id: 'albumin', label: 'Albumina', unit: 'g/dL' }, { id: 'ageGroup', label: 'Faixa etária', unit: '', type: 'select', allowZero: true, options: [{ value: '0', label: 'Recém-nascido' }, { value: '1', label: 'Lactente/criança' }, { value: '2', label: 'Adolescente' }] }],
    formula: 'Estimativa: cálcio total + 0,8 × (4 − albumina). Unidades exigidas: mg/dL e g/dL.',
    clinicalGuide: {
      reference: 'Recém-nascido: 7,8–11,0; lactente/criança: 8,8–10,8; adolescente: 8,5–10,5 mg/dL (faixas exibidas pelo Proped; confirmar laboratório e idade).',
      sections: [
        { title: 'O que é', paragraphs: ['O cálcio total inclui cálcio ionizado, ligado a proteínas e complexado a ânions. A fórmula estima o cálcio total ajustado para albumina de 4 g/dL; não mede o cálcio biologicamente ativo.'] },
        { title: 'Quando usar', bullets: ['Como estimativa em pacientes com alteração de albumina, interpretada junto ao quadro clínico e ao laboratório.', 'Em paciente crítico, sintomático ou com resultado discordante, prefira cálcio ionizado medido diretamente.'] },
        { title: 'Como usar', bullets: ['Informe cálcio total em mg/dL, albumina em g/dL, da mesma coleta, e selecione a faixa etária.', 'Compare com a faixa etária selecionada e com o intervalo de referência do laboratório.'] },
        { title: 'Como interpretar', bullets: ['Resultado abaixo da faixa pode ser compatível com hipocalcemia, mas a correção é apenas estimativa.', 'Resultado dentro ou acima da faixa não substitui avaliação de sintomas, pH, magnésio e cálcio ionizado quando indicado.'] },
        { title: 'Pontos de atenção', bullets: ['A fórmula pode estimar mal o cálcio em doença crítica, distúrbios de pH, doença renal ou alterações importantes de proteínas.', 'Alcalose reduz o cálcio ionizado e acidose pode elevá-lo sem mudança proporcional do cálcio total.', 'Sintomas neuromusculares ou decisão de tratamento urgente exigem avaliação clínica e, quando disponível, cálcio ionizado.'] },
      ],
      references: [{ label: 'Proped — Cálcio Corrigido por Albumina', url: 'https://proped.app/calculadoras/calcio-albumina' }, { label: 'AAP Pediatric Care Online — cálcio e faixas etárias', url: 'https://publications.aap.org/pediatriccare/article/doi/10.1542/aap.ppcqr.396452/238/Hypocalcemia-Hypercalcemia-and-Hypercalciuria' }, { label: 'Endotext — abordagem do cálcio', url: 'https://www.ncbi.nlm.nih.gov/books/NBK279129/' }],
    },
    calculate: v => {
      const value = v.calcium + 0.8 * (4 - v.albumin);
      const ranges = [{ label: 'Recém-nascido', min: 7.8, max: 11.0 }, { label: 'Lactente/criança', min: 8.8, max: 10.8 }, { label: 'Adolescente', min: 8.5, max: 10.5 }];
      const age = ranges[v.ageGroup], status = value < age.min ? 'Abaixo da referência etária' : value > age.max ? 'Acima da referência etária' : 'Dentro da referência etária';
      return { clinical: { label: 'Resultado · Cálcio corrigido', value: clinicalNumber.format(value), unit: 'mg/dL', reference: `${age.label}: ${number.format(age.min)}–${number.format(age.max)} mg/dL`, status, tone: value < age.min || value > age.max ? 'out' : 'normal', formula: 'Ca corrigido = Ca total + 0,8 × (4 − albumina)', memory: `${number.format(v.calcium)} + 0,8 × (4 − ${number.format(v.albumin)}) = ${clinicalNumber.format(value)} mg/dL` } };
    },
  },
  'hipernatremia': {
    title: 'Hipernatremia — Déficit de Água Livre', category: 'Hidroeletrolítico',
    fields: [{ id: 'weight', label: 'Peso atual', unit: 'kg' }, { id: 'na', label: 'Sódio atual', unit: 'mEq/L' }, { id: 'targetNa', label: 'Sódio-alvo definido pelo profissional', unit: 'mEq/L' }, { id: 'correctionHours', label: 'Tempo de correção', unit: 'horas', type: 'select', options: [{ value: '24', label: '24 horas (1 dia)' }, { value: '48', label: '48 horas (2 dias)' }, { value: '72', label: '72 horas (3 dias)' }] }],
    formula: 'Água corporal estimada = peso × 0,6. Déficit (L) = água corporal × (Na atual/Na alvo − 1). Distribuição do déficit pelo tempo escolhido.',
    clinicalGuide: {
      reference: 'Sódio pediátrico: 135–145 mEq/L. Hipernatremia leve 146–150; moderada 151–160; grave >160 mEq/L (classificação exibida pelo Proped).',
      sections: [
        { title: 'O que é', paragraphs: ['Hipernatremia é Na⁺ sérico acima de 145 mEq/L e geralmente representa excesso relativo de sódio ou déficit de água livre. Esta estimativa usa fator 0,6 para água corporal em crianças e não substitui a avaliação de volume, perdas nem causa.'] },
        { title: 'Quando usar', bullets: ['Após confirmar hipernatremia em amostra confiável, como estimativa matemática do déficit de água livre.', 'Para apoiar planejamento e discussão clínica junto da manutenção e das perdas em curso.'] },
        { title: 'Como usar', bullets: ['Informe peso em kg, sódio atual, alvo definido no plano clínico e o tempo de correção.', 'O resultado distribui o déficit estimado pelo tempo escolhido. Manutenção e perdas contínuas não estão incluídas.'] },
        { title: 'Como interpretar', bullets: ['A classificação exibida é leve 146–150, moderada 151–160 e grave acima de 160 mEq/L.', 'A queda calculada por dia é uma projeção; compare com medidas seriadas e ajuste somente conforme avaliação clínica e protocolo local.', 'As soluções listadas são referências de conteúdo de sódio: SG 5% 0, SF 0,45% 77, SG 5% + SF 0,9% em partes iguais 77 e SF 0,9% 154 mEq/L. A calculadora não seleciona uma solução para o paciente.'] },
        { title: 'Pontos de atenção', bullets: ['Após restaurar perfusão se houver choque, a correção pediátrica costuma ser limitada a cerca de 0,5 mEq/L/h ou 10–12 mEq/L/dia; hipernatremia grave exige condução especializada.', 'O déficit calculado não inclui manutenção nem perdas em curso e não deve ser usado isoladamente como prescrição de volume.', 'O fator fixo 0,6 representa criança; não aplicar automaticamente a recém-nascido, cuja água corporal é diferente.', 'Monitorize sódio, estado neurológico, balanço hídrico e peso seriados conforme gravidade e protocolo.'] },
      ],
      references: [{ label: 'Proped — Hipernatremia', url: 'https://proped.app/calculadoras/hipernatremia' }, { label: 'Royal Children’s Hospital — Hypernatraemia', url: 'https://www.rch.org.au/clinicalguide/guideline_index/Hypernatraemia/' }, { label: 'NICE — fluidoterapia IV em crianças', url: 'https://www.nice.org.uk/guidance/ng29/chapter/recommendations' }],
    },
    calculate: v => {
      if (v.na <= 145) throw new Error('O sódio atual informado não está acima do limite de referência de 145 mEq/L para esta estimativa de hipernatremia.');
      if (v.na <= v.targetNa) throw new Error('Para estimar déficit de água livre, o sódio atual precisa ser maior que o alvo informado.');
      const bodyWater = v.weight * 0.6, deficitL = bodyWater * (v.na / v.targetNa - 1), deficitMl = deficitL * 1000;
      const dailyVolume = deficitMl * 24 / v.correctionHours, hourlyVolume = deficitMl / v.correctionHours;
      const dailyDrop = (v.na - v.targetNa) * 24 / v.correctionHours;
      const severity = v.na > 160 ? 'Grave' : v.na >= 151 ? 'Moderada' : v.na >= 146 ? 'Leve' : 'Abaixo do limiar de hipernatremia';
      const status = dailyDrop > 12 ? `${severity} · queda projetada acima de 12 mEq/L/dia` : severity;
      return { clinical: { label: 'Resultado · Déficit de água livre', value: number.format(Math.round(deficitMl)), unit: 'mL total', reference: 'Na⁺ pediátrico 135–145 mEq/L', status, tone: dailyDrop > 12 || v.na > 160 ? 'out' : 'normal', formula: 'Déficit (L) = peso × 0,6 × (Na atual/Na alvo − 1)', memory: [`ΔNa: ${number.format(v.na)} − ${number.format(v.targetNa)} = ${number.format(v.na - v.targetNa)} mEq/L`, `Água corporal estimada: ${number.format(v.weight)} × 0,6 = ${number.format(bodyWater)} L`, `Déficit: (${number.format(v.na - v.targetNa)}/${number.format(v.targetNa)}) × ${number.format(bodyWater)} = ${clinicalNumber.format(deficitL)} L`, `Tempo selecionado: ${v.correctionHours} h`, `Volume distribuído: ${number.format(Math.round(deficitMl))} mL total · ${number.format(Math.round(dailyVolume))} mL/dia · ${clinicalNumber.format(hourlyVolume)} mL/h`, `Queda projetada: ${clinicalNumber.format(dailyDrop)} mEq/L/dia`], metrics: [{ label: 'Infusão horária', value: `${clinicalNumber.format(hourlyVolume)} mL/h` }, { label: 'Volume por dia', value: `${number.format(Math.round(dailyVolume))} mL/dia` }, { label: 'Queda projetada', value: `${clinicalNumber.format(dailyDrop)} mEq/L/dia` }, { label: 'Déficit total', value: `${clinicalNumber.format(deficitL)} L` }] } };
    },
  },
  'hiponatremia': {
    title: 'Hiponatremia — Déficit de Sódio', category: 'Hidroeletrolítico',
    fields: [{ id: 'weight', label: 'Peso', unit: 'kg' }, { id: 'na', label: 'Sódio atual', unit: 'mEq/L' }, { id: 'targetNa', label: 'Sódio-alvo definido pelo profissional', unit: 'mEq/L' }, { id: 'correctionHours', label: 'Tempo de correção', unit: 'horas', type: 'number', hint: 'Informe o tempo em horas, conforme plano clínico.' }],
    formula: 'Déficit de Na⁺ (mEq) = (Na alvo − Na atual) × peso × 0,6. Volume teórico de NaCl 3% (mL) = déficit ÷ 0,513 mEq/mL.',
    clinicalGuide: {
      reference: 'Sódio pediátrico: 135–145 mEq/L. Leve 130–134; moderada 125–129; grave <125 mEq/L (classificação exibida pelo Proped).',
      sections: [
        { title: 'O que é', paragraphs: ['Hiponatremia é Na⁺ sérico abaixo de 135 mEq/L. A estimativa mostrada calcula a diferença de sódio até o alvo informado e o volume teórico de NaCl 3% correspondente; não determina indicação, bolus ou velocidade apropriada.'] },
        { title: 'Quando usar', bullets: ['Como apoio matemático quando a equipe já definiu um alvo e plano de reposição.', 'A avaliação exige sintomas, tonicidade/osmolaridade, volemia, causa, duração, glicemia e perdas.'] },
        { title: 'Como usar', bullets: ['Informe peso, Na⁺ atual, Na⁺ alvo e tempo em horas conforme o plano clínico.', 'Confira a memória de cálculo, a quantidade estimada e o preparo teórico por uma das duas misturas exibidas.'] },
        { title: 'Como interpretar', bullets: ['O resultado não é uma recomendação automática de administrar todo o volume calculado.', 'NaCl 3% contém aproximadamente 0,513 mEq de Na⁺ por mL. As duas opções de preparo exibem a composição matemática correspondente.', 'A velocidade em mEq/L/h e a projeção em 24 horas devem ser avaliadas considerando sintomas, cronicidade e monitorização.'] },
        { title: 'Pontos de atenção', bullets: ['Em criança sem convulsão, a diretriz RCH recomenda que a correção não exceda 8 mmol/L em 24 horas; protocolos locais podem diferir conforme contexto e gravidade.', 'Convulsão ou alteração importante de consciência é emergência e requer protocolo próprio; esta estimativa não calcula bolus de resgate.', 'Correção excessiva pode causar desmielinização osmótica. NaCl 3% é medicamento de alta vigilância: dupla checagem, bomba e dosagens seriadas conforme protocolo.', 'O fator 0,6 é a aproximação usada pelo Proped; recém-nascidos podem ter proporção de água corporal diferente.'] },
      ],
      references: [{ label: 'Proped — Hiponatremia', url: 'https://proped.app/calculadoras/hiponatremia' }, { label: 'Royal Children’s Hospital — Hyponatraemia', url: 'https://www.rch.org.au/clinicalguide/guideline_index/hyponatraemia/' }, { label: 'Verbalis et al. — expert panel recommendations', url: 'https://doi.org/10.1016/j.amjmed.2013.07.006' }],
    },
    calculate: v => {
      if (v.na >= 135) throw new Error('O sódio atual informado não está abaixo de 135 mEq/L, limite usual para hiponatremia.');
      if (v.targetNa <= v.na) throw new Error('O sódio-alvo informado deve ser maior que o sódio medido.');
      const delta = v.targetNa - v.na, deficit = delta * v.weight * 0.6, volume = deficit / 0.513;
      const hours = v.correctionHours, rate = volume / hours, sodiumRate = delta / hours, dailyCorrection = delta * 24 / hours;
      const nacl20 = volume * (0.513 - 0.154) / (3.4 - 0.154), saline09 = volume - nacl20;
      const nacl20Water = volume * 0.513 / 3.4, sterileWater = volume - nacl20Water;
      const severity = v.na < 125 ? 'Grave' : v.na < 130 ? 'Moderada' : v.na < 135 ? 'Leve' : 'Sódio dentro da faixa';
      const status = dailyCorrection > 8 ? `${severity} · projeção >8 mEq/L/24 h` : severity;
      return { clinical: { label: 'Resultado · Volume teórico de NaCl 3%', value: clinicalNumber.format(volume), unit: 'mL', reference: 'Na⁺ pediátrico 135–145 mEq/L', status, tone: dailyCorrection > 8 || v.na < 125 ? 'out' : 'normal', formula: 'Déficit (mEq) = ΔNa × peso × 0,6; volume NaCl 3% = déficit ÷ 0,513', memory: [`Incremento-alvo (ΔNa): ${number.format(v.targetNa)} − ${number.format(v.na)} = ${number.format(delta)} mEq/L`, `Déficit teórico: ${number.format(delta)} × ${number.format(v.weight)} × 0,6 = ${number.format(deficit)} mEq`, `Volume NaCl 3%: ${number.format(deficit)} ÷ 0,513 = ${clinicalNumber.format(volume)} mL`, `Tempo informado: ${number.format(hours)} h · taxa volumétrica: ${clinicalNumber.format(rate)} mL/h`, `Velocidade de correção: ${number.format(sodiumRate)} mEq/L/h · projeção em 24 h: ${number.format(dailyCorrection)} mEq/L`], metrics: [{ label: 'Déficit estimado de Na⁺', value: `${number.format(deficit)} mEq` }, { label: 'Taxa de infusão', value: `${clinicalNumber.format(rate)} mL/h` }, { label: 'Correção projetada', value: `${number.format(sodiumRate)} mEq/L/h · ${number.format(dailyCorrection)} mEq/L/24 h` }, { label: 'Preparo 1 · NaCl 20% + SF 0,9%', value: `${clinicalNumber.format(nacl20)} mL + ${clinicalNumber.format(saline09)} mL` }, { label: 'Preparo 2 · NaCl 20% + água estéril', value: `${clinicalNumber.format(nacl20Water)} mL + ${clinicalNumber.format(sterileWater)} mL` }], caution: 'Estimativa matemática, não prescrição. Revise limite de correção, sintomas, concentração final, acesso e monitorização com protocolo pediátrico local.' } };
    },
  },
  'hipocalemia': {
    title: 'Hipocalemia — Reposição de KCl', category: 'Hidroeletrolítico',
    clinicalGuide: {
      reference: 'K⁺ sérico ≥3,5 mEq/L como limite inferior usual; confirme intervalo do laboratório e idade.',
      sections: [
        { title: 'O que é', paragraphs: ['Hipocalemia é potássio sérico abaixo de 3,5 mEq/L. Pode decorrer de perdas gastrointestinais ou renais, redistribuição, baixa ingestão ou hipomagnesemia. A calculadora converte parâmetros informados em quantidades e volumes.'] },
        { title: 'Quando usar', bullets: ['Após confirmar K⁺ em amostra adequada, para conferir a matemática de um plano de reposição oral ou EV já definido.', 'Hipocalemia grave, sintomas ou alterações de ECG requerem avaliação urgente e protocolo clínico específico.'] },
        { title: 'Como usar', bullets: ['Informe peso e potássio sérico e selecione via oral ou endovenosa.', 'Via EV: informe dose em mEq/kg/h, duração, concentração final e apresentação de KCl; o cálculo mostra quantidade, diluente e bomba.', 'Via oral: informe dose diária em mEq/kg/dia, número de tomadas e concentração do produto; o cálculo mostra volume por tomada.', 'Esta calculadora não solicita nem usa seleção de ambiente de reposição.'] },
        { title: 'Como interpretar', bullets: ['A classificação exibida pelo Proped é 3,0–3,4 mEq/L leve, 2,5–2,9 moderada e abaixo de 2,5 grave; abaixo de 2,0 é crítica em diretrizes pediátricas.', 'A via oral/enteral costuma ser preferida se tolerada; via EV é considerada quando não há tolerância enteral, K⁺ é muito baixo ou há alterações de ECG.', 'Na reposição EV, confira taxa, concentração, volume, produto e acesso. O resultado não escolhe dose nem ambiente de cuidado.'] },
        { title: 'Pontos de atenção', bullets: ['KCl EV é medicamento de alta vigilância: usar bomba de infusão, dupla checagem e nunca administrar em bolus.', 'Avalie função renal e diurese; monitorize ECG conforme gravidade e protocolo; confira K⁺ após reposição antes de redosar.', 'Hipomagnesemia pode manter hipocalemia refratária; equilíbrio ácido-base e insulina também alteram o potássio sérico.', 'Considere todas as fontes de potássio recebidas e o risco de sobrecarga de volume.'] },
      ],
      references: [{ label: 'Proped — Hipocalemia', url: 'https://proped.app/calculadoras/hipocalemia' }, { label: 'Royal Children’s Hospital — Hypokalaemia', url: 'https://www.rch.org.au/clinicalguide/guideline_index/hypokalaemia/' }, { label: 'ANVISA — Bulário Eletrônico', url: 'https://consultas.anvisa.gov.br/#/bulario/' }],
    },
    calculate: () => { throw new Error('Use os campos de reposição oral ou endovenosa.'); },
  },
  'sro': {
    title: 'SRO — Planos A, B e C', category: 'Hidroeletrolítico', fields: [],
    formula: 'Planos de reidratação organizados conforme o protocolo do Ministério da Saúde.',
    calculate: () => ({ lines: [] }),
  },
  'reposicao-de-bicarbonato': {
    title: 'Reposição de Bicarbonato', category: 'Hidroeletrolítico',
    fields: [{ id: 'weight', label: 'Peso', unit: 'kg' }, { id: 'current', label: 'Bicarbonato medido', unit: 'mEq/L' }, { id: 'target', label: 'Alvo definido pelo profissional', unit: 'mEq/L' }, { id: 'factor', label: 'Fator de distribuição adotado no protocolo', unit: 'L/kg' }],
    formula: 'Estimativa aritmética = peso × fator informado × (bicarbonato-alvo − bicarbonato medido). O fator não é pré-preenchido.',
    calculate: v => {
      if (v.target <= v.current) throw new Error('O alvo informado precisa ser maior que o bicarbonato medido.');
      return { lines: [`Diferença estimada pelo fator informado: ${number.format(v.weight * v.factor * (v.target - v.current))} mEq.`], warning: 'Não recomenda bicarbonato nem substitui a avaliação da causa. O uso depende de indicação e protocolo, com monitorização.' };
    },
  },
  'gotejamento': {
    title: 'Gotejamento', category: 'Procedimentos',
    fields: [{ id: 'volume', label: 'Volume', unit: 'mL' }, { id: 'time', label: 'Tempo de infusão', unit: 'horas' }, { id: 'dropFactor', label: 'Fator do equipo informado pelo fabricante', unit: 'gotas/mL' }],
    formula: 'mL/h = volume/tempo. gotas/min = volume × fator do equipo/(tempo × 60).',
    calculate: v => ({ lines: [`Velocidade: ${number.format(v.volume / v.time)} mL/h.`, `Gotejamento: ${number.format(v.volume * v.dropFactor / (v.time * 60))} gotas/min.`], warning: 'Confirme o fator impresso no equipo, a via e a programação da bomba conforme prescrição.' }),
  },
  'imc-e-superficie-corporal': {
    title: 'IMC e Superfície Corporal', category: 'Antropometria',
    fields: [{ id: 'weight', label: 'Peso', unit: 'kg' }, { id: 'height', label: 'Estatura', unit: 'cm' }],
    formula: 'IMC = peso/estatura². Superfície corporal estimada por Haycock, Mosteller e Du Bois.',
    source: { label: 'Haycock et al. — superfície corporal em crianças', url: 'https://pubmed.ncbi.nlm.nih.gov/650346/' },
    calculate: v => {
      const heightM = v.height / 100;
      const bmi = v.weight / (heightM * heightM);
      const haycock = 0.024265 * (v.height ** 0.3964) * (v.weight ** 0.5378);
      const mosteller = Math.sqrt(v.height * v.weight / 3600);
      const dubois = 0.007184 * (v.height ** 0.725) * (v.weight ** 0.425);
      return { lines: [`IMC: ${number.format(bmi)} kg/m².`, `Superfície corporal — Haycock: ${number.format(haycock)} m².`, `Superfície corporal — Mosteller: ${number.format(mosteller)} m².`, `Superfície corporal — Du Bois: ${number.format(dubois)} m².`], warning: 'Em crianças, o IMC deve ser interpretado por idade e sexo em curvas de crescimento. O valor isolado não classifica estado nutricional.' };
    },
  },
  'clearance-de-creatinina-bedside-schwartz': {
    title: 'Clearance de Creatinina — Bedside Schwartz', category: 'Nefrologia',
    fields: [{ id: 'height', label: 'Estatura', unit: 'cm' }, { id: 'creatinine', label: 'Creatinina sérica', unit: 'mg/dL' }],
    formula: 'eTFG = 0,413 × estatura (cm)/creatinina sérica (mg/dL), para crianças, com creatinina padronizada IDMS.',
    source: { label: 'NIDDK — equações pediátricas de eTFG', url: 'https://www.niddk.nih.gov/research-funding/research-programs/kidney-clinical-research-epidemiology/laboratory/glomerular-filtration-rate-equations/children-adolescents-young-adults' },
    calculate: v => ({ lines: [`eTFG estimada: ${number.format(0.413 * v.height / v.creatinine)} mL/min/1,73 m².`], warning: 'Equação para uso pediátrico e creatinina padronizada. Não é clearance medido; confirme a aplicabilidade clínica e o método laboratorial.' }),
  },
  'clearance-de-creatinina-schwartz': {
    title: 'Clearance de Creatinina — Schwartz', category: 'Nefrologia',
    fields: [{ id: 'height', label: 'Estatura', unit: 'cm' }, { id: 'creatinine', label: 'Creatinina sérica', unit: 'mg/dL' }, { id: 'k', label: 'Constante k da faixa etária/sexo', unit: 'valor da fórmula' }],
    formula: 'eTFG estimada = k × estatura (cm)/creatinina sérica (mg/dL). Escolha k conforme a fórmula de Schwartz adotada e o método de creatinina.',
    source: { label: 'Schwartz et al. — estimativa de TFG em crianças', url: 'https://pubmed.ncbi.nlm.nih.gov/3588043/' },
    calculate: v => ({ lines: [`eTFG estimada: ${number.format(v.k * v.height / v.creatinine)} mL/min/1,73 m².`], warning: 'O k varia com idade, sexo, prematuridade e método laboratorial. Não use sem confirmar qual versão da equação é adequada.' }),
  },
  'ira-kdigo-pediatrico': {
    title: 'IRA KDIGO Pediátrico', category: 'Nefrologia',
    fields: [{ id: 'baseline', label: 'Creatinina basal', unit: 'mg/dL' }, { id: 'current', label: 'Creatinina atual', unit: 'mg/dL' }, { id: 'creatinineHours', label: 'Horas entre creatinina basal e atual', unit: 'h' }, { id: 'urineRate', label: 'Diurese média no período', unit: 'mL/kg/h', optional: true, allowZero: true }, { id: 'urineHours', label: 'Duração da diurese informada', unit: 'h', optional: true }],
    formula: 'Estadiamento por creatinina e débito urinário conforme critérios KDIGO. Preencha a diurese e duração juntas; deixe ambas vazias se indisponíveis.',
    source: { label: 'KDIGO — diretriz de lesão renal aguda', url: 'https://kdigo.org/wp-content/uploads/2016/10/KDIGO-2012-AKI-Guideline-English.pdf' },
    calculate: v => {
      if ((v.urineRate == null) !== (v.urineHours == null)) throw new Error('Preencha diurese e duração juntas ou deixe ambos vazios.');
      const ratio = v.current / v.baseline;
      let stage = 0;
      if (v.creatinineHours <= 168 && (ratio >= 3 || (v.current >= 4 && v.current > v.baseline))) stage = 3;
      else if (v.creatinineHours <= 168 && ratio >= 2) stage = 2;
      else if ((v.creatinineHours <= 168 && ratio >= 1.5) || (v.creatinineHours <= 48 && v.current - v.baseline >= 0.3)) stage = 1;
      if (v.urineRate != null) {
        if ((v.urineRate === 0 && v.urineHours >= 12) || (v.urineRate < 0.3 && v.urineHours >= 24)) stage = Math.max(stage, 3);
        else if (v.urineRate < 0.5 && v.urineHours >= 12) stage = Math.max(stage, 2);
        else if (v.urineRate < 0.5 && v.urineHours >= 6) stage = Math.max(stage, 1);
      }
      return { lines: [stage ? `Critério numérico compatível com estágio ${stage}.` : 'Os valores informados não alcançam os limiares numéricos de estágio 1–3.'], warning: 'Não substitui avaliação clínica. A aplicação pediátrica requer contexto, tendência temporal, diurese medida e atenção a neonatos; KDIGO também considera critérios adicionais.' };
    },
  },
  'fracao-de-excrecao-de-sodio': {
    title: 'Fração de Excreção de Sódio', category: 'Clínicas',
    fields: [{ id: 'urineNa', label: 'Sódio urinário', unit: 'mesma unidade do sódio sérico' }, { id: 'serumNa', label: 'Sódio sérico', unit: 'mesma unidade do sódio urinário' }, { id: 'urineCr', label: 'Creatinina urinária', unit: 'mesma unidade da creatinina sérica' }, { id: 'serumCr', label: 'Creatinina sérica', unit: 'mesma unidade da creatinina urinária' }],
    formula: 'FENa (%) = (Na urinário × creatinina sérica)/(Na sérico × creatinina urinária) × 100. Use amostras pareadas e unidades compatíveis.',
    source: { label: 'OPAS — calculadora FENa', url: 'https://recursos.opas.org.br/en/tools/fena-calculator' },
    calculate: v => ({ lines: [`FENa estimada: ${number.format((v.urineNa * v.serumCr / (v.serumNa * v.urineCr)) * 100)}%.`], warning: 'Interpretação limitada por diuréticos, doença renal e contexto clínico; não distingue etiologia isoladamente.' }),
  },
  'fracao-de-excrecao-de-ureia': {
    title: 'Fração de Excreção de Ureia', category: 'Clínicas',
    fields: [{ id: 'urineUrea', label: 'Ureia urinária', unit: 'mesma unidade da ureia sérica' }, { id: 'serumUrea', label: 'Ureia sérica', unit: 'mesma unidade da ureia urinária' }, { id: 'urineCr', label: 'Creatinina urinária', unit: 'mesma unidade da creatinina sérica' }, { id: 'serumCr', label: 'Creatinina sérica', unit: 'mesma unidade da creatinina urinária' }],
    formula: 'FEUreia (%) = (ureia urinária × creatinina sérica)/(ureia sérica × creatinina urinária) × 100. Use amostras pareadas e unidades compatíveis.',
    source: { label: 'AACC — investigação laboratorial da lesão renal aguda', url: 'https://academic.oup.com/jalm/article/6/5/1316/6272705' },
    calculate: v => ({ lines: [`FEUreia estimada: ${number.format((v.urineUrea * v.serumCr / (v.serumUrea * v.urineCr)) * 100)}%.`], warning: 'O desempenho diagnóstico varia; interpretação depende do contexto, diuréticos, doença renal e outras causas de alteração da ureia.' }),
  },
  'energia-holliday-segar': {
    title: 'Energia Holliday-Segar', category: 'Nutrição',
    fields: [{ id: 'weight', label: 'Peso', unit: 'kg' }],
    formula: 'Estimativa clássica de gasto calórico diário: 100 kcal/kg para os primeiros 10 kg + 50 kcal/kg para os próximos 10 kg + 20 kcal/kg acima de 20 kg.',
    source: { label: 'Holliday & Segar — necessidade de água de manutenção', url: 'https://publications.aap.org/pediatrics/article/19/5/823/29135/THE-MAINTENANCE-NEED-FOR-WATER-IN-PARENTERAL-FLUID' },
    calculate: v => {
      const kcal = Math.min(v.weight, 10) * 100 + Math.max(0, Math.min(v.weight - 10, 10)) * 50 + Math.max(0, v.weight - 20) * 20;
      return { lines: [`Estimativa pelo método: ${number.format(kcal)} kcal/dia.`], warning: 'Estimativa clássica de manutenção, não é meta nutricional individual nem substitui avaliação do gasto energético e do estado clínico.' };
    },
  },
  'calorimetria-indireta': {
    title: 'Calorimetria Indireta', category: 'Nutrição',
    fields: [{ id: 'vo2', label: 'Consumo de oxigênio (VO₂)', unit: 'mL/min' }, { id: 'vco2', label: 'Produção de dióxido de carbono (VCO₂)', unit: 'mL/min' }],
    formula: 'Equação simplificada de Weir: gasto energético = [3,941 × VO₂ (L/min) + 1,106 × VCO₂ (L/min)] × 1.440 min/dia.',
    source: { label: 'Weir — método de cálculo da taxa metabólica', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1392602/' },
    calculate: v => ({ lines: [`Gasto energético estimado: ${number.format((3.941 * v.vo2 / 1000 + 1.106 * v.vco2 / 1000) * 1440)} kcal/dia.`], warning: 'Versão simplificada sem correção por nitrogênio urinário. Verifique unidades, estabilidade da medida e limitações do método.' }),
  },
  'ig-pela-dum': {
    title: 'IG pela DUM', category: 'Antropometria',
    fields: [{ id: 'lmp', label: 'Primeiro dia da última menstruação', unit: 'data', type: 'date' }],
    formula: 'Calcula idade gestacional pela diferença entre a DUM informada e a data de hoje; estima a DPP como DUM + 280 dias.',
    source: { label: 'ACOG — métodos para estimar a data provável do parto', url: 'https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/05/methods-for-estimating-the-due-date' },
    calculate: v => {
      const start = new Date(`${v.lmp}T00:00:00`);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const days = Math.floor((today - start) / 86400000);
      if (days < 0) throw new Error('A DUM não pode estar no futuro.');
      const due = new Date(start); due.setDate(due.getDate() + 280);
      return { lines: [`Idade gestacional estimada: ${Math.floor(days / 7)} semanas e ${days % 7} dias.`, `DPP estimada pela DUM: ${new Intl.DateTimeFormat('pt-BR').format(due)}.`], warning: 'Estimativa de calendário. Ciclos irregulares e ultrassonografia podem alterar a datação obstétrica; use a melhor estimativa documentada.' };
    },
  },
  'ig-por-ultrassonografia': {
    title: 'IG por Ultrassonografia', category: 'Antropometria',
    fields: [{ id: 'scanDate', label: 'Data do ultrassom', unit: 'data', type: 'date' }, { id: 'scanWeeks', label: 'Idade gestacional no ultrassom', unit: 'semanas' }, { id: 'scanDays', label: 'Dias adicionais', unit: 'dias', allowZero: true }],
    formula: 'Projeta a idade gestacional informada no exame até hoje e calcula a DPP correspondente a 40 semanas.',
    source: { label: 'ACOG — métodos para estimar a data provável do parto', url: 'https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/05/methods-for-estimating-the-due-date' },
    calculate: v => {
      if (v.scanDays >= 7) throw new Error('Informe os dias adicionais entre 0 e 6.');
      const scan = new Date(`${v.scanDate}T00:00:00`);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const daysSinceScan = Math.floor((today - scan) / 86400000);
      if (daysSinceScan < 0) throw new Error('A data do exame não pode estar no futuro.');
      const gaDays = v.scanWeeks * 7 + v.scanDays + daysSinceScan;
      const due = new Date(scan); due.setDate(due.getDate() + 280 - (v.scanWeeks * 7 + v.scanDays));
      return { lines: [`Idade gestacional projetada: ${Math.floor(gaDays / 7)} semanas e ${gaDays % 7} dias.`, `DPP estimada pelo exame: ${new Intl.DateTimeFormat('pt-BR').format(due)}.`], warning: 'A precisão da datação depende da idade gestacional e da qualidade do exame. Use a melhor estimativa obstétrica documentada; não redatar automaticamente.' };
    },
  },
  'escala-de-apgar': {
    title: 'Escala de Apgar', category: 'Neonatologia',
    fields: [...['Aparência', 'Pulso', 'Reflexos', 'Tônus', 'Respiração'].map((label, index) => ({ id: `item${index}`, label, unit: 'pontos', type: 'select', allowZero: true, options: [{ value: 0, label: '0' }, { value: 1, label: '1' }, { value: 2, label: '2' }] })), { id: 'minute', label: 'Minuto de avaliação', unit: 'min', type: 'select', options: [1, 5, 10, 15, 20].map(value => ({ value, label: String(value) })) }],
    formula: 'Some os cinco componentes pontuados de 0 a 2. Registre separadamente o momento da avaliação (1, 5, 10, 15 ou 20 minutos).',
    source: { label: 'ACOG/AAP — uso e significado do escore de Apgar', url: 'https://doi.org/10.1097/AOG.0000000000001108' },
    calculate: v => ({ lines: [`Escore de Apgar aos ${v.minute} minutos: ${v.item0 + v.item1 + v.item2 + v.item3 + v.item4}/10.`], warning: 'Apgar não deve ser usado isoladamente para prever desfecho neurológico individual.' }),
  },
  'escala-rass': {
    title: 'Escala RASS', category: 'Escores',
    fields: [{ id: 'score', label: 'Pontuação observada', unit: '−5 a +4', type: 'select', allowNegative: true, allowZero: true, options: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4].map(value => ({ value, label: `${value > 0 ? '+' : ''}${value}` })) }],
    formula: 'Registra o valor RASS selecionado após avaliação clínica estruturada. Esta tela soma ou transforma nenhum outro dado.',
    source: { label: 'RASS — validação e confiabilidade em UTI', url: 'https://pubmed.ncbi.nlm.nih.gov/12421743/' },
    calculate: v => ({ lines: [`RASS selecionado: ${v.score > 0 ? '+' : ''}${v.score}.`], warning: 'A validação original foi em adultos. Para crianças, use a escala e as orientações adotadas pela sua UTI pediátrica.' }),
  },
  'glasgow-pediatrico': {
    title: 'Glasgow Pediátrico', category: 'Escores',
    fields: [{ id: 'eye', label: 'Abertura ocular', unit: '1–4', type: 'select', options: [1, 2, 3, 4].map(value => ({ value, label: String(value) })) }, { id: 'verbal', label: 'Resposta verbal pediátrica', unit: '1–5', type: 'select', options: [1, 2, 3, 4, 5].map(value => ({ value, label: String(value) })) }, { id: 'motor', label: 'Resposta motora', unit: '1–6', type: 'select', options: [1, 2, 3, 4, 5, 6].map(value => ({ value, label: String(value) })) }],
    formula: 'Pontuação total = abertura ocular + resposta verbal pediátrica + resposta motora. Selecione os componentes observados conforme idade e protocolo.',
    source: { label: 'Royal Children’s Hospital — escala de Glasgow infantil', url: 'https://www.rch.org.au/clinicalguide/guideline_index/Altered_conscious_state/' },
    calculate: v => ({ lines: [`Glasgow Pediátrico: ${v.eye + v.verbal + v.motor}/15 (E${v.eye} V${v.verbal} M${v.motor}).`], warning: 'Registre cada componente, horário e fatores que limitam a avaliação. Uma queda do escore exige avaliação clínica imediata.' }),
  },
  'flacc': {
    title: 'FLACC', category: 'Escores',
    fields: ['Face', 'Pernas', 'Atividade', 'Choro', 'Consolabilidade'].map((label, index) => ({ id: `item${index}`, label, unit: '0–2', type: 'select', allowZero: true, options: [0, 1, 2].map(value => ({ value, label: String(value) })) })),
    formula: 'Some as cinco categorias observadas, cada uma pontuada de 0 a 2. Escore total de 0 a 10.',
    source: { label: 'Merkel et al. — escala FLACC', url: 'https://pubmed.ncbi.nlm.nih.gov/9220806/' },
    calculate: v => ({ lines: [`FLACC: ${v.item0 + v.item1 + v.item2 + v.item3 + v.item4}/10.`], warning: 'Instrumento comportamental para crianças que não conseguem autorrelatar a dor. Interprete com idade, condição e protocolo local.' }),
  },
  'escala-de-faces-wong-baker': {
    title: 'Escala de Faces Wong-Baker', category: 'Escores',
    fields: [{ id: 'score', label: 'Pontuação apontada pela criança', unit: '0, 2, 4, 6, 8 ou 10', type: 'select', allowZero: true, options: [0, 2, 4, 6, 8, 10].map(value => ({ value, label: String(value) })) }],
    formula: 'Registra o valor correspondente à face escolhida pela própria criança; não escolha a face pela expressão observada no rosto.',
    source: { label: 'Wong-Baker FACES Foundation', url: 'https://wongbakerfaces.org/home-2/' },
    calculate: v => ({ lines: [`Pontuação registrada: ${v.score}/10.`], warning: 'Use a escala original sem alterar as faces e siga o protocolo institucional para seleção da ferramenta de dor.' }),
  },
  'oi-osi': {
    title: 'OI / OSI', category: 'UTI / Emergência',
    fields: [{ id: 'map', label: 'Pressão média de vias aéreas', unit: 'cmH₂O' }, { id: 'fio2', label: 'FiO₂ como fração (ex.: 0,40)', unit: '0–1' }, { id: 'pao2', label: 'PaO₂', unit: 'mmHg', optional: true }, { id: 'spo2', label: 'SpO₂', unit: '%', optional: true }],
    formula: 'OI = MAP × FiO₂ × 100/PaO₂. OSI = MAP × FiO₂ × 100/SpO₂. Informe pelo menos PaO₂ ou SpO₂.',
    source: { label: 'PALICC-2 — definição e estratificação de PARDS', url: 'https://pmc.ncbi.nlm.nih.gov/articles/9848214/' },
    calculate: v => {
      if (v.fio2 > 1 || v.fio2 <= 0) throw new Error('FiO₂ deve ser informada como fração entre 0 e 1.');
      if (v.pao2 == null && v.spo2 == null) throw new Error('Informe PaO₂, SpO₂, ou ambos.');
      if (v.spo2 != null && v.spo2 > 100) throw new Error('SpO₂ deve estar entre 0 e 100%.');
      const lines = [];
      if (v.pao2 != null) lines.push(`OI: ${number.format(v.map * v.fio2 * 100 / v.pao2)}.`);
      if (v.spo2 != null) lines.push(`OSI: ${number.format(v.map * v.fio2 * 100 / v.spo2)}.`);
      return { lines, warning: 'Para estratificação PALICC-2 com SpO₂, a medida deve estar em estado estável e ≤97%. Os índices isolados não estabelecem diagnóstico.' };
    },
  },
  'sipa': {
    title: 'SIPA', category: 'UTI / Emergência',
    fields: [{ id: 'age', label: 'Idade', unit: 'anos' }, { id: 'hr', label: 'Frequência cardíaca', unit: 'bpm' }, { id: 'sbp', label: 'Pressão arterial sistólica', unit: 'mmHg' }],
    formula: 'Índice de choque = frequência cardíaca/pressão sistólica. Limiares de referência usados em estudos de trauma: >1,22 (4–6 anos), >1,0 (7–12), >0,9 (13–16).',
    source: { label: 'Acker et al. — SIPA e ativação de equipe de trauma', url: 'https://pubmed.ncbi.nlm.nih.gov/27814956/' },
    calculate: v => {
      const score = v.hr / v.sbp;
      const cutoff = v.age >= 4 && v.age <= 6 ? 1.22 : v.age <= 12 && v.age >= 7 ? 1 : v.age <= 16 && v.age >= 13 ? 0.9 : null;
      return { lines: [`SIPA calculado: ${number.format(score)}.`, cutoff == null ? 'Sem limiar etário configurado nesta tela.' : `Limiar de referência para a faixa etária: ${number.format(cutoff)}; resultado ${score > cutoff ? 'acima' : 'não acima'} do limiar.`], warning: 'Limiar derivado de estudos de trauma e não diagnóstico. A faixa configurada não cobre menores de 4 ou maiores de 16 anos; considere o contexto e protocolo local.' };
    },
  },
};
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const clinicalNumber = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const monthFormat = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const longDateFormat = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

function todayKey() { return dateKey(new Date()); }
function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function parseDateKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}
function hoursFor(shift) {
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;
  return minutes / 60;
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function cleanUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}
function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { shifts: Array.isArray(parsed.shifts) ? parsed.shifts : [], medications: Array.isArray(parsed.medications) ? parsed.medications : [], protocols: Array.isArray(parsed.protocols) ? parsed.protocols : [] };
  } catch { return { shifts: [], medications: [], protocols: [] }; }
}
function emptyPendingDeletes() { return { shifts: [], medications: [], protocols: [], attachments: [] }; }
function emptySyncMeta() { return { ownerId: null, baseline: { shifts: [], medications: [], protocols: [], attachments: [] }, pendingDeletes: emptyPendingDeletes() }; }
function loadSyncMeta() {
  try {
    const stored = JSON.parse(localStorage.getItem(SYNC_META_KEY) || 'null');
    if (!stored || typeof stored !== 'object') return emptySyncMeta();
    return { ...emptySyncMeta(), ...stored, baseline: { ...emptySyncMeta().baseline, ...(stored.baseline || {}) }, pendingDeletes: { ...emptyPendingDeletes(), ...(stored.pendingDeletes || {}) } };
  } catch { return emptySyncMeta(); }
}
function cloneState(value = state) { return JSON.parse(JSON.stringify(value)); }
function hasRecords(value) { return Boolean(value && ['shifts', 'medications', 'protocols'].some(key => Array.isArray(value[key]) && value[key].length)); }
function currentAttachmentIds(value = state) { return new Set(value.protocols.flatMap(protocol => (protocol.attachments || []).map(file => file.id))); }
function countRecords(value) {
  const attachments = value.protocols.reduce((sum, protocol) => sum + (protocol.attachments || []).length, 0);
  return { shifts: value.shifts.length, medications: value.medications.length, protocols: value.protocols.length, attachments };
}
function openFileDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('Este navegador não oferece armazenamento de anexos.')); return; }
    const request = indexedDB.open(FILE_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('attachments', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento de anexos.'));
  });
}
async function saveAttachment(file) {
  const id = crypto.randomUUID();
  const db = await openFileDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attachments', 'readwrite');
    tx.objectStore('attachments').put({ id, name: file.name, type: file.type, size: file.size, blob: file });
    tx.oncomplete = () => { db.close(); resolve({ id, name: file.name, type: file.type, size: file.size }); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('Falha ao salvar anexo.')); };
  });
}
async function readAttachment(id) {
  const db = await openFileDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attachments', 'readonly');
    const request = tx.objectStore('attachments').get(id);
    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => { db.close(); reject(request.error || new Error('Falha ao abrir anexo.')); };
  });
}
async function removeAttachment(id) {
  const db = await openFileDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attachments', 'readwrite');
    tx.objectStore('attachments').delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('Falha ao remover anexo.')); };
  });
}
let state = loadState();
let syncMeta = loadSyncMeta();
let cloudBaseline = {
  shifts: new Set(syncMeta.baseline.shifts),
  medications: new Set(syncMeta.baseline.medications),
  protocols: new Set(syncMeta.baseline.protocols),
  attachments: new Map(syncMeta.baseline.attachments.map(item => [item.id, item])),
};
let activeCloudUser = null;
let cloudPhase = 'signed-out';
let cloudBootPromise = null;
let cloudBootUserId = null;
let cloudWriteQueue = Promise.resolve();
let pendingLocalImport = null;
let pendingRemoteState = null;
let viewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedDate = todayKey();
let toastTimer;
let selectedCalculatorCategory = CALCULATOR_CATEGORIES[0];
let calculatorSearch = '';
let activeCalculator = null;
let hydrationDraft = {
  weight: '', rate: '', glucoseEnabled: true, glucoseMode: 'tig', glucose: '', glucoseValues: { tig: '', grams: '' }, electrolyteMode: 'dose', base: '5+50', distributionEnabled: false, aliquotHours: '6',
  referencesOpen: false, referenceTab: 'term',
  na: { dose: '3', presentation: 'nacl10', enabled: true },
  k: { dose: '1.5', presentation: 'kcl10', enabled: true },
  ca: { dose: '0.5', unit: 'meq', presentation: 'ca10', enabled: false },
  mg: { dose: '0.3', presentation: 'mg10', enabled: true },
};
let hypokalemiaDraft = { weight: '', potassium: '', route: 'iv', dose: '', time: '6', finalConcentration: '12', kclPresentation: 'kcl10', frequency: '4', oralConcentration: '1.33' };
let sroDraft = { age: '', weight: '', plan: 'A', zincProduct: 'suspension4', antibioticsOpen: false, antibiotic: '' };

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  recordPendingDeletes();
  renderAll();
  if (activeCloudUser && cloudPhase === 'ready') queueCloudSync();
}
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}
function byDateAndTime(a, b) { return a.date.localeCompare(b.date) || a.start.localeCompare(b.start); }
function monthShifts(date = viewMonth) {
  const prefix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return state.shifts.filter(shift => shift.date.startsWith(prefix)).sort(byDateAndTime);
}
function hoursTotal(shifts) { return shifts.reduce((sum, shift) => sum + hoursFor(shift), 0); }
function amountTotal(shifts) { return shifts.reduce((sum, shift) => sum + Number(shift.value || 0), 0); }

function setSyncStatus(message, status = 'ready') {
  const element = document.getElementById('syncStatus');
  element.textContent = message;
  element.dataset.state = status;
}
function persistStateOnly() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function saveCloudMetadata() {
  syncMeta = {
    ownerId: activeCloudUser?.id || syncMeta.ownerId,
    baseline: {
      shifts: [...cloudBaseline.shifts],
      medications: [...cloudBaseline.medications],
      protocols: [...cloudBaseline.protocols],
      attachments: [...cloudBaseline.attachments.values()],
    },
    pendingDeletes: syncMeta.pendingDeletes,
  };
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(syncMeta));
}
function recordPendingDeletes() {
  if (!activeCloudUser || syncMeta.ownerId !== activeCloudUser.id) return;
  const current = {
    shifts: new Set(state.shifts.map(item => item.id)),
    medications: new Set(state.medications.map(item => item.id)),
    protocols: new Set(state.protocols.map(item => item.id)),
    attachments: currentAttachmentIds(),
  };
  for (const type of ['shifts', 'medications', 'protocols']) {
    const pending = new Set(syncMeta.pendingDeletes[type]);
    for (const id of cloudBaseline[type]) if (!current[type].has(id)) pending.add(id);
    syncMeta.pendingDeletes[type] = [...pending];
  }
  const pendingAttachments = new Set(syncMeta.pendingDeletes.attachments);
  for (const id of cloudBaseline.attachments.keys()) if (!current.attachments.has(id)) pendingAttachments.add(id);
  syncMeta.pendingDeletes.attachments = [...pendingAttachments];
  saveCloudMetadata();
}
function dataOrThrow(result) {
  if (result.error) throw result.error;
  return result.data || [];
}
function setCloudBaseline(remote) {
  cloudBaseline = {
    shifts: new Set(remote.state.shifts.map(item => item.id)),
    medications: new Set(remote.state.medications.map(item => item.id)),
    protocols: new Set(remote.state.protocols.map(item => item.id)),
    attachments: new Map(remote.attachments.map(item => [item.id, item])),
  };
}
async function fetchUserCloudState(userId) {
  const [shiftResult, medicationResult, protocolResult, attachmentResult] = await Promise.all([
    authClient.from('shifts').select('*').eq('owner_id', userId).order('work_date'),
    authClient.from('user_medication_references').select('*').eq('owner_id', userId).order('medication_name'),
    authClient.from('protocols').select('*').eq('owner_id', userId).order('title'),
    authClient.from('protocol_attachments').select('*').eq('owner_id', userId),
  ]);
  const shiftRows = dataOrThrow(shiftResult);
  const medicationRows = dataOrThrow(medicationResult);
  const protocolRows = dataOrThrow(protocolResult);
  const attachmentRows = dataOrThrow(attachmentResult);
  const attachmentsByProtocol = new Map();
  const attachments = attachmentRows.map(row => ({ id: row.id, protocolId: row.protocol_id, storagePath: row.storage_path }));
  attachmentRows.forEach(row => {
    const list = attachmentsByProtocol.get(row.protocol_id) || [];
    list.push({ id: row.id, name: row.original_name, type: row.mime_type, size: Number(row.size_bytes), storagePath: row.storage_path });
    attachmentsByProtocol.set(row.protocol_id, list);
  });
  return {
    state: {
      shifts: shiftRows.map(row => ({ id: row.id, date: row.work_date, start: String(row.start_time).slice(0, 5), end: String(row.end_time).slice(0, 5), value: Number(row.amount_brl) })),
      medications: medicationRows.map(row => ({ id: row.id, name: row.medication_name, presentation: row.presentation || '', dosePerKg: row.dose_per_kg_per_dose == null ? '' : Number(row.dose_per_kg_per_dose), concentration: row.concentration_mg_ml == null ? '' : Number(row.concentration_mg_ml), maxDose: row.max_dose_mg == null ? '' : Number(row.max_dose_mg), interval: row.interval_text || '', contraindications: row.contraindications || '', interactions: row.interactions || '', url: row.source_url || '', reviewed: row.reviewed_on || '' })),
      protocols: protocolRows.map(row => ({ id: row.id, title: row.title, source: row.source_name || '', url: row.external_url || '', reviewed: row.reviewed_on || '', attachments: attachmentsByProtocol.get(row.id) || [] })),
    },
    attachments,
  };
}
function removePendingDeletes(remoteState, pending) {
  const deleted = {
    shifts: new Set(pending.shifts), medications: new Set(pending.medications),
    protocols: new Set(pending.protocols), attachments: new Set(pending.attachments),
  };
  return {
    ...remoteState,
    shifts: remoteState.shifts.filter(item => !deleted.shifts.has(item.id)),
    medications: remoteState.medications.filter(item => !deleted.medications.has(item.id)),
    protocols: remoteState.protocols.filter(item => !deleted.protocols.has(item.id)).map(protocol => ({ ...protocol, attachments: protocol.attachments.filter(file => !deleted.attachments.has(file.id)) })),
  };
}
function localOnlyCounts(local, remote) {
  const shiftIds = new Set(remote.shifts.map(item => item.id));
  const medicationIds = new Set(remote.medications.map(item => item.id));
  const protocolIds = new Set(remote.protocols.map(item => item.id));
  const attachmentIds = currentAttachmentIds(remote);
  return {
    shifts: local.shifts.filter(item => !shiftIds.has(item.id)).length,
    medications: local.medications.filter(item => !medicationIds.has(item.id)).length,
    protocols: local.protocols.filter(item => !protocolIds.has(item.id)).length,
    attachments: local.protocols.reduce((sum, protocol) => sum + (protocol.attachments || []).filter(file => !attachmentIds.has(file.id)).length, 0),
  };
}
function mergeRemoteAndLocal(remote, local) {
  const mergeById = (remoteItems, localItems) => {
    const result = [...remoteItems];
    const ids = new Set(remoteItems.map(item => item.id));
    localItems.forEach(item => { if (!ids.has(item.id)) result.push(item); });
    return result;
  };
  const remoteProtocols = new Map(remote.protocols.map(item => [item.id, item]));
  const protocols = [...remote.protocols];
  local.protocols.forEach(localProtocol => {
    const remoteProtocol = remoteProtocols.get(localProtocol.id);
    if (!remoteProtocol) { protocols.push(localProtocol); return; }
    const ids = new Set(remoteProtocol.attachments.map(file => file.id));
    remoteProtocol.attachments.push(...(localProtocol.attachments || []).filter(file => !ids.has(file.id)));
  });
  return {
    shifts: mergeById(remote.shifts, local.shifts),
    medications: mergeById(remote.medications, local.medications),
    protocols,
  };
}
function localBackupAvailable() {
  try { return Boolean(JSON.parse(localStorage.getItem(LOCAL_BACKUP_KEY) || 'null')?.state); }
  catch { return false; }
}
function updateCloudButtons() {
  document.getElementById('syncNow').hidden = !activeCloudUser;
  document.getElementById('importLocalBackup').hidden = !activeCloudUser || !localBackupAvailable();
}
async function upsertSnapshot(snapshot, user) {
  const now = new Date().toISOString();
  const shifts = snapshot.shifts.map(item => ({ id: item.id, owner_id: user.id, work_date: item.date, start_time: item.start, end_time: item.end, amount_brl: Number(item.value || 0), updated_at: now }));
  const medications = snapshot.medications.map(item => ({
    id: item.id, owner_id: user.id, medication_name: item.name, presentation: item.presentation || null,
    dose_per_kg_per_dose: item.dosePerKg === '' || item.dosePerKg == null ? null : Number(item.dosePerKg),
    concentration_mg_ml: item.concentration === '' || item.concentration == null ? null : Number(item.concentration),
    max_dose_mg: item.maxDose === '' || item.maxDose == null ? null : Number(item.maxDose),
    interval_text: item.interval || null, contraindications: item.contraindications || null,
    interactions: item.interactions || null, source_url: cleanUrl(item.url) || null, reviewed_on: item.reviewed || null, updated_at: now,
  }));
  const protocols = snapshot.protocols.map(item => ({ id: item.id, owner_id: user.id, title: item.title, source_name: item.source || null, external_url: cleanUrl(item.url) || null, reviewed_on: item.reviewed || null, updated_at: now }));
  if (shifts.length) dataOrThrow(await authClient.from('shifts').upsert(shifts, { onConflict: 'id' }));
  if (medications.length) dataOrThrow(await authClient.from('user_medication_references').upsert(medications, { onConflict: 'id' }));
  if (protocols.length) dataOrThrow(await authClient.from('protocols').upsert(protocols, { onConflict: 'id' }));

  const attachmentRows = [];
  for (const protocol of snapshot.protocols) {
    for (const file of protocol.attachments || []) {
      let storagePath = file.storagePath || '';
      let mimeType = file.type || '';
      let fileSize = Number(file.size || 0);
      if (!storagePath) {
        const localFile = await readAttachment(file.id);
        if (!localFile?.blob) throw new Error(`O anexo “${file.name}” não foi encontrado neste navegador. Ele continua listado nos dados locais.`);
        mimeType = localFile.type || mimeType;
        fileSize = Number(localFile.size || fileSize);
        if (!SUPPORTED_ATTACHMENT_TYPES.has(mimeType)) throw new Error(`O formato do anexo “${file.name}” não é aceito pelo armazenamento privado.`);
        if (fileSize < 1 || fileSize > MAX_ATTACHMENT_BYTES) throw new Error(`O anexo “${file.name}” excede o limite de 20 MB.`);
        storagePath = `${user.id}/${protocol.id}/${file.id}`;
        const upload = await authClient.storage.from(STORAGE_BUCKET).upload(storagePath, localFile.blob, { contentType: mimeType, upsert: true });
        if (upload.error) throw upload.error;
        file.storagePath = storagePath;
        file.type = mimeType;
        file.size = fileSize;
      }
      attachmentRows.push({ id: file.id, protocol_id: protocol.id, owner_id: user.id, storage_path: storagePath, original_name: file.name, mime_type: mimeType, size_bytes: fileSize });
    }
  }
  if (attachmentRows.length) dataOrThrow(await authClient.from('protocol_attachments').upsert(attachmentRows, { onConflict: 'id' }));
  persistStateOnly();
}
async function deleteCloudRows(table, ids, userId) {
  for (const id of ids) {
    const result = await authClient.from(table).delete().eq('owner_id', userId).eq('id', id);
    if (result.error) throw result.error;
  }
}
async function syncLocalStateToCloud(user) {
  if (!user || cloudPhase !== 'ready') return;
  const snapshot = cloneState();
  recordPendingDeletes();
  setSyncStatus('Sincronizando…', 'loading');
  await upsertSnapshot(snapshot, user);
  const uploadedPaths = new Map(snapshot.protocols.flatMap(protocol => (protocol.attachments || []).filter(file => file.storagePath).map(file => [file.id, file])));
  state.protocols.forEach(protocol => (protocol.attachments || []).forEach(file => {
    const uploaded = uploadedPaths.get(file.id);
    if (uploaded) { file.storagePath = uploaded.storagePath; file.type = uploaded.type; file.size = uploaded.size; }
  }));

  const deletedProtocols = new Set(syncMeta.pendingDeletes.protocols);
  const deletedAttachments = new Set(syncMeta.pendingDeletes.attachments);
  for (const [id, file] of cloudBaseline.attachments) if (deletedProtocols.has(file.protocolId)) deletedAttachments.add(id);
  const storagePaths = [...deletedAttachments].map(id => cloudBaseline.attachments.get(id)?.storagePath).filter(Boolean);
  if (storagePaths.length) {
    const result = await authClient.storage.from(STORAGE_BUCKET).remove(storagePaths);
    if (result.error) throw result.error;
  }
  await deleteCloudRows('protocol_attachments', [...deletedAttachments], user.id);
  await deleteCloudRows('shifts', syncMeta.pendingDeletes.shifts, user.id);
  await deleteCloudRows('user_medication_references', syncMeta.pendingDeletes.medications, user.id);
  await deleteCloudRows('protocols', [...deletedProtocols], user.id);

  cloudBaseline = {
    shifts: new Set(snapshot.shifts.map(item => item.id)),
    medications: new Set(snapshot.medications.map(item => item.id)),
    protocols: new Set(snapshot.protocols.map(item => item.id)),
    attachments: new Map(snapshot.protocols.flatMap(protocol => (protocol.attachments || []).filter(file => file.storagePath).map(file => [file.id, { id: file.id, protocolId: protocol.id, storagePath: file.storagePath }]))),
  };
  syncMeta.pendingDeletes = emptyPendingDeletes();
  syncMeta.ownerId = user.id;
  saveCloudMetadata();
  persistStateOnly();
  setSyncStatus('Sincronizado', 'ready');
}
function queueCloudSync() {
  const user = activeCloudUser;
  const task = cloudWriteQueue.catch(() => {}).then(() => syncLocalStateToCloud(user));
  cloudWriteQueue = task;
  return task;
}
function scheduleCloudSync() {
  queueCloudSync().catch(error => {
    setSyncStatus('Salvo neste aparelho; nuvem indisponível', 'error');
    showToast(error.message || 'Não foi possível sincronizar. Os dados locais foram preservados.');
  });
}
function saveLocalBackup(value) {
  if (!hasRecords(value)) return;
  localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), state: value }));
  updateCloudButtons();
}
function persistLoadedState(value) {
  state = value;
  persistStateOnly();
  renderAll();
}
function openLocalImportDialog(local, remote) {
  pendingLocalImport = cloneState(local);
  pendingRemoteState = cloneState(remote);
  const counts = localOnlyCounts(pendingLocalImport, pendingRemoteState);
  document.getElementById('localImportSummary').textContent = `Há ${counts.shifts} plantão(ões), ${counts.medications} referência(s), ${counts.protocols} protocolo(s) e ${counts.attachments} anexo(s) que ainda não estão na nuvem.`;
  document.getElementById('appShell').hidden = false;
  document.getElementById('authGate').hidden = true;
  document.getElementById('localImportDialog').showModal();
  setSyncStatus('Escolha como continuar', 'loading');
}
async function initializeCloudForUser(user) {
  const savedMetadata = loadSyncMeta();
  syncMeta = savedMetadata.ownerId === user.id ? savedMetadata : { ...emptySyncMeta(), ownerId: user.id };
  try {
    setSyncStatus('Carregando nuvem…', 'loading');
    const remote = await fetchUserCloudState(user.id);
    // Include edits made locally while the first cloud fetch was in flight.
    const local = cloneState();
    setCloudBaseline(remote);
    const visibleRemote = removePendingDeletes(remote.state, syncMeta.pendingDeletes);
    const unmatched = localOnlyCounts(local, visibleRemote);
    const unmatchedTotal = Object.values(unmatched).reduce((sum, value) => sum + value, 0);
    if (unmatchedTotal > 0) {
      cloudPhase = 'choosing';
      openLocalImportDialog(local, visibleRemote);
      updateCloudButtons();
      return;
    }
    persistLoadedState(visibleRemote);
    syncMeta.ownerId = user.id;
    cloudPhase = 'ready';
    saveCloudMetadata();
    setSyncStatus('Sincronizado', 'ready');
    updateCloudButtons();
    if (Object.values(syncMeta.pendingDeletes).some(ids => ids.length)) scheduleCloudSync();
  } catch (error) {
    cloudPhase = 'offline';
    document.getElementById('authGate').hidden = true;
    document.getElementById('appShell').hidden = false;
    renderAll();
    updateCloudButtons();
    setSyncStatus('Offline: dados mantidos neste aparelho', 'error');
    showToast(error.message || 'Não foi possível carregar a nuvem. Os dados deste aparelho foram preservados.');
  }
}
function beginCloudBootstrap(user, force = false) {
  if (!user) return;
  if (activeCloudUser?.id === user.id && ['ready', 'choosing', 'loading'].includes(cloudPhase)) return cloudBootPromise;
  if (activeCloudUser?.id === user.id && cloudPhase === 'offline' && !force) return;
  activeCloudUser = user;
  cloudPhase = 'loading';
  cloudBootUserId = user.id;
  cloudBootPromise = initializeCloudForUser(user).finally(() => {
    if (cloudBootUserId === user.id) { cloudBootPromise = null; cloudBootUserId = null; }
  });
  return cloudBootPromise;
}
async function chooseLocalImport(importLocal) {
  const dialog = document.getElementById('localImportDialog');
  const importButton = document.getElementById('importLocalData');
  const cloudButton = document.getElementById('useCloudData');
  importButton.disabled = true;
  cloudButton.disabled = true;
  try {
    if (!activeCloudUser || !pendingRemoteState || !pendingLocalImport) throw new Error('A sessão mudou. Entre novamente para continuar a sincronização.');
    if (importLocal) {
      const merged = mergeRemoteAndLocal(pendingRemoteState, pendingLocalImport);
      state = merged;
      setSyncStatus('Importando registros…', 'loading');
      await upsertSnapshot(state, activeCloudUser);
      const remote = await fetchUserCloudState(activeCloudUser.id);
      setCloudBaseline(remote);
      persistLoadedState(removePendingDeletes(remote.state, syncMeta.pendingDeletes));
      localStorage.removeItem(LOCAL_BACKUP_KEY);
    } else {
      saveLocalBackup(pendingLocalImport);
      persistLoadedState(pendingRemoteState);
    }
    syncMeta.ownerId = activeCloudUser.id;
    cloudPhase = 'ready';
    saveCloudMetadata();
    dialog.close();
    pendingLocalImport = null;
    pendingRemoteState = null;
    setSyncStatus('Sincronizado', 'ready');
    updateCloudButtons();
    if (Object.values(syncMeta.pendingDeletes).some(ids => ids.length)) scheduleCloudSync();
  } catch (error) {
    setSyncStatus('Importação pendente', 'error');
    showToast(error.message || 'Não foi possível concluir a importação. Os dados locais continuam preservados.');
  } finally {
    importButton.disabled = false;
    cloudButton.disabled = false;
  }
}
async function importLocalBackup() {
  try {
    const backup = JSON.parse(localStorage.getItem(LOCAL_BACKUP_KEY) || 'null');
    if (!backup?.state || !activeCloudUser) return;
    const remote = await fetchUserCloudState(activeCloudUser.id);
    setCloudBaseline(remote);
    const visibleRemote = removePendingDeletes(remote.state, syncMeta.pendingDeletes);
    const counts = localOnlyCounts(backup.state, visibleRemote);
    if (!Object.values(counts).some(value => value > 0)) {
      localStorage.removeItem(LOCAL_BACKUP_KEY);
      updateCloudButtons();
      showToast('Esse backup já está na nuvem.');
      return;
    }
    cloudPhase = 'choosing';
    openLocalImportDialog(backup.state, visibleRemote);
  } catch (error) {
    showToast(error.message || 'Não foi possível abrir o backup local.');
  }
}
async function syncNow() {
  if (!activeCloudUser) return;
  const button = document.getElementById('syncNow');
  button.disabled = true;
  try {
    if (cloudPhase === 'offline') {
      await beginCloudBootstrap(activeCloudUser, true);
      if (cloudPhase !== 'ready') return;
    }
    if (cloudPhase !== 'ready') return;
    await queueCloudSync();
    const remote = await fetchUserCloudState(activeCloudUser.id);
    setCloudBaseline(remote);
    const visibleRemote = removePendingDeletes(remote.state, syncMeta.pendingDeletes);
    persistLoadedState(mergeRemoteAndLocal(visibleRemote, state));
    syncMeta.ownerId = activeCloudUser.id;
    saveCloudMetadata();
    setSyncStatus('Sincronizado', 'ready');
  } catch (error) {
    setSyncStatus('Falha na sincronização', 'error');
    showToast(error.message || 'Não foi possível sincronizar agora.');
  } finally {
    button.disabled = false;
  }
}
document.getElementById('syncNow').addEventListener('click', syncNow);
document.getElementById('importLocalBackup').addEventListener('click', importLocalBackup);
document.getElementById('useCloudData').addEventListener('click', () => chooseLocalImport(false));
document.getElementById('importLocalData').addEventListener('click', () => chooseLocalImport(true));
window.addEventListener('online', () => {
  if (!activeCloudUser) return;
  if (cloudPhase === 'offline') beginCloudBootstrap(activeCloudUser, true);
  else if (cloudPhase === 'ready') scheduleCloudSync();
});

function renderHome() {
  const shifts = monthShifts(new Date());
  document.getElementById('homeEarnings').textContent = money.format(amountTotal(shifts));
  document.getElementById('homeShiftCount').textContent = `${shifts.length} ${shifts.length === 1 ? 'plantão registrado' : 'plantões registrados'}`;
  document.getElementById('homeHours').textContent = `${number.format(hoursTotal(shifts))} h`;
  document.getElementById('homeMedCount').textContent = state.medications.length;
  document.getElementById('homeProtocolCount').textContent = state.protocols.length;
}
function renderCalendar() {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const date = new Date(year, month, 1);
  const title = monthFormat.format(date);
  document.getElementById('monthTitle').textContent = title.charAt(0).toLocaleUpperCase('pt-BR') + title.slice(1);
  document.getElementById('reportPeriod').textContent = title;
  const grid = document.getElementById('calendarGrid');
  const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const offset = date.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevious = new Date(year, month, 0).getDate();
  const shiftsInMonth = monthShifts(viewMonth);
  const shiftDates = new Set(shiftsInMonth.map(shift => shift.date));
  let html = weekdays.map(day => `<div class="weekday">${day}</div>`).join('');
  for (let index = 0; index < 42; index++) {
    let day, dayDate, outside = false;
    if (index < offset) { day = daysInPrevious - offset + index + 1; dayDate = new Date(year, month - 1, day); outside = true; }
    else if (index >= offset + daysInMonth) { day = index - offset - daysInMonth + 1; dayDate = new Date(year, month + 1, day); outside = true; }
    else { day = index - offset + 1; dayDate = new Date(year, month, day); }
    const key = dateKey(dayDate);
    const classes = ['calendar-day', outside ? 'outside' : '', selectedDate === key ? 'selected' : '', shiftDates.has(key) ? 'has-shift' : ''].filter(Boolean).join(' ');
    html += `<button class="${classes}" data-date="${key}" aria-label="${escapeHtml(longDateFormat.format(dayDate))}${shiftDates.has(key) ? ', tem plantão' : ''}" aria-pressed="${selectedDate === key}">${day}</button>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('[data-date]').forEach(button => button.addEventListener('click', () => {
    selectedDate = button.dataset.date;
    if (parseDateKey(selectedDate).getMonth() !== viewMonth.getMonth() || parseDateKey(selectedDate).getFullYear() !== viewMonth.getFullYear()) {
      const picked = parseDateKey(selectedDate);
      viewMonth = new Date(picked.getFullYear(), picked.getMonth(), 1);
    }
    renderShifts();
  }));
}
function renderShifts() {
  renderCalendar();
  const selected = parseDateKey(selectedDate);
  const formatted = longDateFormat.format(selected);
  document.getElementById('selectedDateTitle').textContent = formatted.charAt(0).toLocaleUpperCase('pt-BR') + formatted.slice(1);
  const dayShifts = state.shifts.filter(shift => shift.date === selectedDate).sort(byDateAndTime);
  const list = document.getElementById('dayShiftList');
  if (!dayShifts.length) {
    list.innerHTML = '<div class="empty-state">Nenhum plantão neste dia.<br>Use “＋ Plantão” para registrar um turno.</div>';
  } else {
    list.innerHTML = dayShifts.map(shift => `<div class="shift-row"><div class="shift-time">${escapeHtml(shift.start)}<br>${escapeHtml(shift.end)}</div><div class="shift-info"><b>${number.format(hoursFor(shift))} horas</b><small>${escapeHtml(shortDateFormat.format(parseDateKey(shift.date)))}</small></div><strong class="shift-value">${money.format(Number(shift.value))}</strong><button class="delete-shift" data-delete-shift="${escapeHtml(shift.id)}" aria-label="Excluir plantão de ${escapeHtml(shift.start)}" title="Excluir">×</button></div>`).join('');
    list.querySelectorAll('[data-delete-shift]').forEach(button => button.addEventListener('click', () => deleteShift(button.dataset.deleteShift)));
  }
  const shifts = monthShifts(viewMonth);
  document.getElementById('monthEarnings').textContent = money.format(amountTotal(shifts));
  document.getElementById('monthShiftCount').textContent = shifts.length;
  document.getElementById('monthHours').textContent = `${number.format(hoursTotal(shifts))} h`;
  renderReport(shifts);
}
function renderReport(shifts) {
  const report = document.getElementById('monthlyReport');
  if (!shifts.length) {
    report.innerHTML = '<div class="empty-state">Nenhum plantão registrado neste mês.<br>Quando você adicionar turnos, o total e os valores por dia aparecerão aqui.</div>';
    return;
  }
  const daily = new Map();
  shifts.forEach(shift => {
    const current = daily.get(shift.date) || { count: 0, amount: 0, hours: 0 };
    current.count += 1;
    current.amount += Number(shift.value || 0);
    current.hours += hoursFor(shift);
    daily.set(shift.date, current);
  });
  const rows = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b));
  report.innerHTML = `<table class="report-table"><thead><tr><th>Data</th><th>Plantões</th><th>Horas</th><th>Ganhos</th></tr></thead><tbody>${rows.map(([date, item]) => `<tr><td>${escapeHtml(shortDateFormat.format(parseDateKey(date)))}</td><td>${item.count}</td><td>${number.format(item.hours)} h</td><td>${money.format(item.amount)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total do mês</td><td>${shifts.length}</td><td>${number.format(hoursTotal(shifts))} h</td><td>${money.format(amountTotal(shifts))}</td></tr></tfoot></table>`;
}
function renderMedicationList() {
  const element = document.getElementById('medicationList');
  if (!state.medications.length) { element.innerHTML = '<div class="empty-state">Nenhuma referência salva.<br>Cadastre o nome, a apresentação e o link da bula profissional que você consulta.</div>'; return; }
  element.innerHTML = state.medications.map(item => {
    const url = cleanUrl(item.url);
    const dose = item.dosePerKg ? `<p><b>Dose registrada:</b> ${escapeHtml(item.dosePerKg)} mg/kg/dose${item.maxDose ? ` · limite ${escapeHtml(item.maxDose)} mg/dose` : ''}${item.interval ? ` · ${escapeHtml(item.interval)}` : ''}</p>` : '<p><b>Dose:</b> não registrada</p>';
    const contraindications = item.contraindications ? `<p><b>Contraindicações:</b> ${escapeHtml(item.contraindications)}</p>` : '<p><b>Contraindicações:</b> não registradas; consulte a bula.</p>';
    const interactions = item.interactions ? `<p><b>Interações:</b> ${escapeHtml(item.interactions)}</p>` : '<p><b>Interações:</b> não registradas; isso não confirma ausência.</p>';
    const review = item.reviewed ? `<p>Revisado em ${escapeHtml(shortDateFormat.format(parseDateKey(item.reviewed)))}</p>` : '<p>Data de revisão não informada</p>';
    return `<article class="saved-card"><h3>${escapeHtml(item.name)}</h3>${item.presentation ? `<p>${escapeHtml(item.presentation)}</p>` : ''}${dose}${contraindications}${interactions}${review}${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">Abrir bula profissional ↗</a>` : '<p>Sem link de bula</p>'}<div class="saved-actions"><button class="text-button" data-delete-med="${escapeHtml(item.id)}">Remover</button></div></article>`;
  }).join('');
  element.querySelectorAll('[data-delete-med]').forEach(button => button.addEventListener('click', () => {
    state.medications = state.medications.filter(item => item.id !== button.dataset.deleteMed);
    saveState(); showToast('Referência removida.');
  }));
}
function renderProtocolList() {
  const element = document.getElementById('protocolList');
  if (!state.protocols.length) { element.innerHTML = '<div class="empty-state">Nenhum protocolo salvo.<br>Adicione um título e o link da fonte oficial que você usa.</div>'; return; }
  element.innerHTML = state.protocols.map(item => {
    const url = cleanUrl(item.url);
    const reviewed = item.reviewed ? `Revisado em ${shortDateFormat.format(parseDateKey(item.reviewed))}` : 'Data de revisão não informada';
    const files = Array.isArray(item.attachments) ? item.attachments : [];
    const attachmentLinks = files.map(file => `<button class="attachment-link" data-open-file="${escapeHtml(file.id)}">${escapeHtml(file.name)} <span>${number.format(file.size / (1024 * 1024))} MB ↗</span></button>`).join('');
    return `<article class="saved-card"><h3>${escapeHtml(item.title)}</h3>${item.source ? `<p>${escapeHtml(item.source)}</p>` : ''}<p>${escapeHtml(reviewed)}</p>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">Abrir documento ↗</a>` : '<p>Sem link externo</p>'}${files.length ? `<div class="attachment-list"><b>Anexos</b>${attachmentLinks}</div>` : ''}<div class="saved-actions"><button class="text-button" data-delete-protocol="${escapeHtml(item.id)}">Remover</button></div></article>`;
  }).join('');
  element.querySelectorAll('[data-open-file]').forEach(button => button.addEventListener('click', async () => {
    try {
      const fileInfo = files.find(file => file.id === button.dataset.openFile);
      let blob = (await readAttachment(button.dataset.openFile))?.blob;
      if (!blob && fileInfo?.storagePath && activeCloudUser) {
        const { data, error } = await authClient.storage.from(STORAGE_BUCKET).download(fileInfo.storagePath);
        if (error) throw error;
        blob = data;
      }
      if (!blob) { showToast('Anexo não encontrado neste aparelho nem na nuvem.'); return; }
      const fileUrl = URL.createObjectURL(blob);
      window.open(fileUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(fileUrl), 60_000);
    } catch (error) { showToast(error.message || 'Não foi possível abrir o anexo.'); }
  }));
  element.querySelectorAll('[data-delete-protocol]').forEach(button => button.addEventListener('click', () => {
    const item = state.protocols.find(protocol => protocol.id === button.dataset.deleteProtocol);
    if (!item || !confirm('Remover este protocolo e seus anexos?')) return;
    Promise.all((item.attachments || []).map(file => removeAttachment(file.id).catch(() => {}))).then(() => {
      state.protocols = state.protocols.filter(protocol => protocol.id !== item.id);
      saveState(); showToast('Protocolo removido.');
    });
  }));
}
function renderAll() { renderHome(); renderShifts(); renderMedicationList(); renderProtocolList(); renderDoseMedicationOptions(); renderCalculatorCatalog(); }
function renderDoseMedicationOptions() {
  const select = document.getElementById('doseMedication');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Informar valores manualmente</option>' + state.medications.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  if (state.medications.some(item => item.id === current)) select.value = current;
}
function renderCalculatorCatalog() {
  const categories = document.getElementById('calculatorCategories');
  categories.innerHTML = CALCULATOR_CATEGORIES.map(category => {
    const count = CALCULATOR_CATALOG[category].split('|').length;
    const active = category === selectedCalculatorCategory;
    return `<button class="calculator-category${active ? ' active' : ''}" type="button" role="tab" aria-selected="${active}" data-category="${escapeHtml(category)}">${escapeHtml(category)} <span>${count}</span></button>`;
  }).join('');
  categories.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
    selectedCalculatorCategory = button.dataset.category;
    renderCalculatorCatalog();
  }));

  const query = calculatorSearch.trim().toLocaleLowerCase('pt-BR');
  const entries = CALCULATOR_CATEGORIES.flatMap(category => CALCULATOR_CATALOG[category].split('|').map(title => ({ title, category })))
    .filter(item => (query ? `${item.title} ${item.category}`.toLocaleLowerCase('pt-BR').includes(query) : item.category === selectedCalculatorCategory));
  document.getElementById('calculatorCatalog').innerHTML = entries.length
    ? entries.map(item => {
      const implementation = READY_CALCULATOR_CATEGORIES.has(item.category) ? CALCULATOR_IMPLEMENTATIONS[calculatorSlug(item.title)] : null;
      const action = implementation ? `<button type="button" class="button secondary small" data-open-calculator="${escapeHtml(calculatorSlug(item.title))}">Abrir</button>` : '<span class="catalog-status">Em implementação</span>';
      return `<article class="calculator-catalog-card${implementation ? ' calculator-ready' : ''}" role="listitem"><div><span class="catalog-category-label">${escapeHtml(item.category)}</span><h3>${escapeHtml(item.title)}</h3></div>${action}</article>`;
    }).join('')
    : '<p class="empty-state">Nenhuma calculadora encontrada.</p>';
  document.getElementById('calculatorCatalog').querySelectorAll('[data-open-calculator]').forEach(button => button.addEventListener('click', () => openCalculator(button.dataset.openCalculator)));
}
function calculatorSlug(title) { return title.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function openCalculator(id) {
  const calculator = CALCULATOR_IMPLEMENTATIONS[id];
  if (!calculator) return;
  activeCalculator = calculator;
  document.getElementById('dynamicCalculatorTitle').textContent = calculator.title;
  if (id === 'hidratacao-venosa') {
    document.getElementById('dynamicCalculatorFormula').hidden = true;
    document.getElementById('dynamicCalculatorFields').classList.remove('hypokalemia-calculator-fields', 'sro-calculator-fields');
    document.getElementById('dynamicCalculatorFields').classList.add('hydration-calculator-fields');
    document.getElementById('calculateDynamicCalculator').hidden = true;
    document.getElementById('dynamicCalculatorResult').classList.add('hidden');
    document.getElementById('dynamicCalculatorSource').hidden = true;
    renderHydrationCalculator();
    document.getElementById('calculatorDialog').showModal();
    return;
  }
  if (id === 'hipocalemia') {
    document.getElementById('dynamicCalculatorFormula').hidden = true;
    document.getElementById('dynamicCalculatorFields').classList.remove('hydration-calculator-fields', 'sro-calculator-fields');
    document.getElementById('dynamicCalculatorFields').classList.add('hypokalemia-calculator-fields');
    document.getElementById('calculateDynamicCalculator').hidden = false;
    document.getElementById('calculateDynamicCalculator').textContent = 'Calcular reposição';
    document.getElementById('dynamicCalculatorResult').classList.add('hidden');
    document.getElementById('dynamicCalculatorResult').classList.remove('clinical-result');
    document.getElementById('dynamicCalculatorSource').hidden = true;
    renderHypokalemiaCalculator();
    document.getElementById('calculatorDialog').showModal();
    return;
  }
  if (id === 'sro') {
    document.getElementById('dynamicCalculatorFormula').hidden = true;
    document.getElementById('dynamicCalculatorFields').classList.remove('hydration-calculator-fields', 'hypokalemia-calculator-fields');
    document.getElementById('dynamicCalculatorFields').classList.add('sro-calculator-fields');
    document.getElementById('calculateDynamicCalculator').hidden = true;
    document.getElementById('dynamicCalculatorResult').classList.add('hidden');
    document.getElementById('dynamicCalculatorResult').classList.remove('clinical-result');
    document.getElementById('dynamicCalculatorSource').hidden = true;
    renderSroCalculator();
    document.getElementById('calculatorDialog').showModal();
    return;
  }
  document.getElementById('dynamicCalculatorFormula').hidden = Boolean(calculator.clinicalGuide);
  document.getElementById('dynamicCalculatorFields').classList.remove('hydration-calculator-fields', 'hypokalemia-calculator-fields', 'sro-calculator-fields');
  document.getElementById('calculateDynamicCalculator').hidden = false;
  document.getElementById('calculateDynamicCalculator').textContent = 'Calcular';
  document.getElementById('dynamicCalculatorFormula').textContent = calculator.formula;
  document.getElementById('dynamicCalculatorFields').innerHTML = calculator.fields.map(field => {
    const input = field.options
      ? `<select data-calculator-input="${escapeHtml(field.id)}"><option value="">Selecione</option>${field.options.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('')}</select>`
      : `<input type="${field.type || 'number'}" ${field.type === 'date' ? '' : 'step="any"'} data-calculator-input="${escapeHtml(field.id)}" ${field.optional ? '' : 'required'}>`;
    return `<label>${escapeHtml(field.label)}${field.optional ? ' <span class="unit">opcional</span>' : ''}<span class="unit">${escapeHtml(field.unit)}</span>${input}${field.hint ? `<small class="calculator-field-hint">${escapeHtml(field.hint)}</small>` : ''}</label>`;
  }).join('');
  const source = document.getElementById('dynamicCalculatorSource');
  if (calculator.source) {
    source.href = calculator.source.url;
    source.textContent = `Fonte: ${calculator.source.label} ↗`;
    source.hidden = false;
  } else { source.hidden = true; }
  document.getElementById('dynamicCalculatorResult').classList.add('hidden');
  document.getElementById('dynamicCalculatorResult').classList.remove('clinical-result');
  document.getElementById('dynamicCalculatorResult').replaceChildren();
  document.getElementById('calculatorDialog').showModal();
}
function renderSroCalculator() {
  const container = document.getElementById('dynamicCalculatorFields');
  const d = sroDraft;
  const age = d.age === '' ? NaN : Number(d.age), weight = Number(d.weight);
  const nf = value => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value);
  const plans = [['A', 'Plano A · domicílio'], ['B', 'Plano B · unidade de saúde'], ['C', 'Plano C · hospital']];
  const ageLabel = age < 1 ? 'Menor de 1 ano' : age <= 10 ? 'De 1 a 10 anos' : 'Maior de 10 anos';
  const fields = `<section class="sro-section"><h3>Dados da criança</h3><div class="sro-grid"><label>IDADE<input type="number" min="0" step="any" data-sro-input="age" value="${escapeHtml(d.age)}" placeholder="Anos (ex.: 0,5)"><span>anos</span><small>Use 0 para menor de 1 ano; 1 ano ou mais para a faixa seguinte.</small></label><label>PESO<input type="number" min="0" step="any" data-sro-input="weight" value="${escapeHtml(d.weight)}" placeholder="Ex.: 15"><span>kg</span></label></div></section><section class="sro-section"><h3>Plano de tratamento</h3><div class="sro-plan-tabs" role="group" aria-label="Plano de reidratação">${plans.map(([key, label]) => `<button type="button" data-sro-plan="${key}" class="${d.plan === key ? 'active' : ''}" aria-pressed="${d.plan === key}">${label}</button>`).join('')}</div>${renderSroPlan(d, age, weight, ageLabel, nf)}</section><section class="sro-section sro-antibiotics"><label class="sro-checkbox"><input type="checkbox" data-sro-antibiotics ${d.antibioticsOpen ? 'checked' : ''}><span>Abrir cálculo de doses de antibióticos e antiparasitários</span></label>${d.antibioticsOpen ? `<div class="sro-antibiotic-result" id="sroAntibioticResult">${renderSroAntibiotic(d.antibiotic, weight, age, nf)}</div>` : ''}</section><details class="sro-guide"><summary><span><small>SOBRE O MÉTODO</small><strong>Guia da prática clínica</strong></span><i aria-hidden="true"></i></summary><div class="sro-guide-content"><section><h4>O que é</h4><p>A solução de sais de reidratação oral (SRO) é usada para prevenir ou tratar desidratação por diarreia, conforme avaliação clínica do estado de hidratação.</p></section><section><h4>Quando usar</h4><ul><li>Plano A: sem sinais de desidratação, tratamento domiciliar e prevenção.</li><li>Plano B: desidratação sem gravidade, com reidratação oral supervisionada em serviço de saúde.</li><li>Plano C: desidratação grave, em unidade de saúde/hospital, com expansão e manutenção/reposição intravenosas.</li></ul></section><section><h4>Como usar</h4><ul><li>Informe idade e peso. Selecione o plano após classificar clinicamente a hidratação; a ferramenta não seleciona o plano.</li><li>No Plano A, ofereça líquidos após evacuações e episódios de vômito em pequenas quantidades e com frequência; mantenha alimentação e aleitamento.</li><li>No Plano B, o volume calculado é uma orientação inicial para 4–6 horas. A quantidade ingerida depende da sede e a solução é mantida até os sinais de desidratação desaparecerem.</li><li>No Plano C, use os volumes, tempos e soluções mostrados como organização do protocolo hospitalar. Reavalie continuamente e acompanhe resposta clínica.</li></ul></section><section><h4>Como interpretar e reavaliar</h4><ul><li>Plano B: se resolver a desidratação, migrar ao Plano A; se persistir, considerar sonda nasogástrica conforme protocolo; se evoluir para grave, Plano C. Sem melhora após 6 horas, encaminhar para referência hospitalar.</li><li>Plano C: iniciar SRO quando puder beber, em geral 2–3 horas após início da hidratação EV; observar pelo menos 6 horas e reavaliar. Manter em serviço até hidratação completa e manutenção por via oral.</li><li>Plano A: procurar atendimento se não melhorar em 2 dias ou se houver piora, vômitos repetidos, sangue nas fezes, redução da diurese, sede intensa ou recusa alimentar.</li></ul></section><section><h4>Pontos de atenção</h4><ul><li>Classificação de gravidade depende do exame clínico; diante de dúvida, o protocolo orienta considerar o cenário de maior gravidade.</li><li>Em recém-nascidos e menores de 5 anos com cardiopatia grave, iniciar expansão do Plano C com 10 mL/kg e seguir protocolo especializado.</li><li>No Plano C, a reposição é inicialmente 50 mL/kg/dia e deve ser ajustada às perdas. KCl só deve ser incluído conforme protocolo, função renal, diurese e eletrólitos.</li><li>Antibióticos são reservados às indicações descritas no protocolo (ex.: disenteria com comprometimento geral ou cólera grave). Antiparasitários têm indicações específicas. Não usar a lista como recomendação automática.</li><li>A calculadora não substitui avaliação médica, reavaliação seriada nem protocolo institucional.</li></ul></section><section><h4>Referência</h4><ul><li><a href="https://www.gov.br/saude/pt-br/centrais-de-conteudo/publicacoes/svsa/doencas-diarreicas-agudas/manejo-do-paciente-com-diarreia-avaliacao-do-estado-do-paciente" target="_blank" rel="noopener">Ministério da Saúde. Manejo do paciente com diarreia: avaliação do estado de hidratação do paciente (2023) ↗</a></li></ul></section></div></details>`;
  container.innerHTML = `<div class="sro-layout">${fields}<p class="form-hint">A ferramenta organiza cálculos do protocolo. A classificação do plano e a decisão terapêutica dependem da avaliação clínica.</p></div>`;
  container.querySelectorAll('[data-sro-input]').forEach(input => input.addEventListener('input', () => { const field = input.dataset.sroInput; d[field] = input.value; renderSroCalculator(); container.querySelector(`[data-sro-input="${field}"]`)?.focus(); }));
  container.querySelectorAll('[data-sro-plan]').forEach(button => button.addEventListener('click', () => { d.plan = button.dataset.sroPlan; renderSroCalculator(); }));
  container.querySelector('[data-sro-antibiotics]')?.addEventListener('change', event => { d.antibioticsOpen = event.target.checked; renderSroCalculator(); });
  container.querySelectorAll('[data-sro-antibiotic]').forEach(input => input.addEventListener('change', event => { d.antibiotic = event.target.value; renderSroCalculator(); }));
  container.querySelector('[data-sro-zinc]')?.addEventListener('change', event => { d.zincProduct = event.target.value; renderSroCalculator(); });
}
function renderSroPlan(d, age, weight, ageLabel, nf) {
  const validWeight = weight > 0;
  if (d.plan === 'A') {
    if (!(age >= 0)) return '<p class="sro-hint">Informe a idade para exibir as orientações do Plano A.</p>';
    const liquid = age < 1 ? '50–100 mL' : age <= 10 ? '100–200 mL' : 'Quantidade que a criança aceitar';
    const zincDose = age < 0.5 ? 10 : age < 5 ? 20 : 0;
    const zincProduct = `<label>APRESENTAÇÃO DO ZINCO<select data-sro-zinc><option value="suspension4" ${d.zincProduct==='suspension4'?'selected':''}>Suspensão 4 mg/mL (inclui 2 mg/0,5 mL)</option><option value="biozinc" ${d.zincProduct==='biozinc'?'selected':''}>Biozinc gotas · 10 mg/20 gotas</option><option value="zintrix" ${d.zincProduct==='zintrix'?'selected':''}>Zintrix · 2 mg/gota</option></select></label>`;
    const zincVolume = d.zincProduct === 'suspension4' ? `${nf(zincDose / 4)} mL/dia` : d.zincProduct === 'biozinc' ? `${nf(zincDose * 2)} gotas/dia` : `${nf(zincDose / 2)} gotas/dia`;
    return `<div class="sro-result-card"><h4>PLANO A · APÓS CADA EVACUAÇÃO DIARREICA</h4><div class="sro-result-value">${liquid}</div><p>${ageLabel}. Oferecer líquidos/SRO em pequenas quantidades e com maior frequência.</p><div class="sro-subcard"><strong>Zinco</strong>${zincDose ? `<p>${zincDose} mg por via oral, 1 vez ao dia, por 10–14 dias · ${zincVolume}</p>${zincProduct}` : '<p>O protocolo indica zinco para crianças menores de 5 anos; não calcular dose para esta idade.</p>'}</div><p class="sro-reassess"><b>Orientação:</b> manter alimentação habitual e aleitamento. Procurar atendimento se não melhorar em 2 dias ou diante de sinais de alerta.</p></div>`;
  }
  if (d.plan === 'B') {
    if (!validWeight) return '<p class="sro-hint">Informe o peso para calcular o volume inicial de SRO.</p>';
    const min = 50 * weight, target = 75 * weight, max = 100 * weight;
    return `<div class="sro-result-card"><h4>PLANO B · SRO SUPERVISIONADA</h4><div class="sro-result-value">${nf(target)} mL <small>alvo inicial (75 mL/kg)</small></div><div class="sro-metrics"><div><span>Faixa inicial</span><b>${nf(min)}–${nf(max)} mL (50–100 mL/kg)</b></div><div><span>Período</span><b>4–6 horas</b></div><div><span>Taxa média orientativa</span><b>${nf(target / 6)}–${nf(target / 4)} mL/h*</b></div></div><p class="sro-formula">${nf(weight)} kg × 75 mL/kg = ${nf(target)} mL; faixa: ${nf(weight)} × 50–100 mL/kg = ${nf(min)}–${nf(max)} mL.</p><p class="sro-reassess"><b>Reavaliação:</b> oferta contínua conforme sede até desaparecerem os sinais. Se resolver, Plano A; se persistir, considerar sonda nasogástrica; se evoluir para desidratação grave, Plano C. Sem melhora após 6 horas, encaminhar para hospital de referência. O Plano B deve ocorrer em serviço de saúde e a criança deve permanecer sob observação.</p><small>*Taxa calculada sobre o alvo de 75 mL/kg distribuído entre 4 e 6 horas.</small></div>`;
  }
  if (!validWeight || !(age >= 0)) return '<p class="sro-hint">Informe idade e peso para calcular as fases do Plano C.</p>';
  const infant = age < 1;
  const firstMl = weight * 30, secondMl = weight * 70;
  const firstHours = infant ? 1 : 0.5, secondHours = infant ? 5 : 2.5;
  const maintenanceMl = weight <= 10 ? weight * 100 : weight <= 20 ? 1000 + (weight - 10) * 50 : Math.min(2000, 1500 + (weight - 20) * 20);
  const replacementMl = weight * 50;
  const kclMl = maintenanceMl * 0.02;
  const rate = (volume, hours) => volume / hours;
  const drops = (volume, hours, factor) => Math.round(volume / hours * factor / 60);
  return `<div class="sro-result-card"><h4>PLANO C · EXPANSÃO IV — ${infant ? 'MENOR DE 1 ANO' : 'A PARTIR DE 1 ANO'}</h4><div class="sro-phase"><div><strong>1ª fase · SF 0,9% ou Ringer Lactato</strong><span>${nf(firstMl)} mL (${nf(weight)} × 30 mL/kg) · ${infant ? '1 hora' : '30 minutos'}</span><small>${nf(rate(firstMl, firstHours))} mL/h · ${drops(firstMl, firstHours, 20)} gotas/min (macro 20 gtt/mL) · ${drops(firstMl, firstHours, 60)} microgotas/min</small></div></div><div class="sro-phase"><div><strong>2ª fase · SF 0,9% ou Ringer Lactato</strong><span>${nf(secondMl)} mL (${nf(weight)} × 70 mL/kg) · ${infant ? '5 horas' : '2 h 30 min'}</span><small>${nf(rate(secondMl, secondHours))} mL/h · ${drops(secondMl, secondHours, 20)} gotas/min (macro 20 gtt/mL) · ${drops(secondMl, secondHours, 60)} microgotas/min</small></div></div><p class="sro-reassess"><b>Exceção:</b> recém-nascidos ou crianças menores de 5 anos com cardiopatia grave: iniciar com 10 mL/kg e seguir protocolo especializado.</p><h4>MANUTENÇÃO + REPOSIÇÃO · 24 HORAS</h4><div class="sro-metrics"><div><span>Manutenção · SG5% + SF 0,9% 4:1</span><b>${nf(maintenanceMl)} mL/dia · ${nf(maintenanceMl / 24)} mL/h</b></div><div><span>Reposição · SG5% + SF 0,9% 1:1</span><b>${nf(replacementMl)} mL/dia inicial · ${nf(replacementMl / 24)} mL/h</b></div><div><span>KCl 10% · apenas na manutenção</span><b>${nf(kclMl)} mL (2 mL/100 mL)</b></div></div><p class="sro-formula">Manutenção: ${weight <= 10 ? '100 mL/kg' : weight <= 20 ? '1.000 mL + 50 mL/kg acima de 10 kg' : '1.500 mL + 20 mL/kg acima de 20 kg (máx. 2.000 mL)'} · Reposição: 50 mL/kg/dia inicial, ajustar às perdas.</p><p class="sro-reassess"><b>Reavaliação:</b> avaliar continuamente e ajustar gotejamento se não houver melhora. Iniciar SRO quando puder beber, geralmente após 2–3 horas de hidratação EV. Observar por pelo menos 6 horas e reavaliar. Manter no serviço até hidratação completa e manutenção adequada por via oral.</p><small>Confira função renal, diurese, eletrólitos e indicação de KCl antes de adicionar à solução.</small></div>`;
}
function renderSroAntibiotic(choice, weight, age, nf) {
  const options = [
    ['azithro', 'Azitromicina', 'Disenteria com comprometimento do estado geral; a partir de 3 meses e sem imunodeficiência.', age < 0.25 ? 'Não calcular: o protocolo limita esta opção a crianças a partir de 3 meses.' : `<b>Dia 1:</b> ${nf(weight * 10)} mg VO, 1 vez ao dia (10 mg/kg). <b>Dias 2–5:</b> ${nf(weight * 5)} mg VO/dia (5 mg/kg/dia).`],
    ['ceftriaxone-im', 'Ceftriaxona IM', 'Alternativa para disenteria com comprometimento geral; 3–5 dias.', weight <= 30 ? (age >= 0.25 ? `${nf(weight * 50)} mg IM 1 vez ao dia (50 mg/kg/dia), por 3–5 dias; confirmar ausência de imunodeficiência.` : 'Não calcular sem confirmar idade ≥3 meses e ausência de imunodeficiência; protocolo indica ceftriaxona EV 50–100 mg/kg/dia para esses grupos.') : `${nf(weight * 50)}–${nf(weight * 100)} mg IM 1 vez ao dia (50–100 mg/kg/dia), por 3–5 dias.`],
    ['ceftriaxone-iv', 'Ceftriaxona EV', 'Menores de 3 meses ou criança com imunodeficiência; avaliação hospitalar.', `${nf(weight * 50)}–${nf(weight * 100)} mg EV 1 vez ao dia (50–100 mg/kg/dia).`],
    ['cipro', 'Ciprofloxacino', 'Criança >30 kg (>10 anos), adolescente/adulto com disenteria.', weight > 30 && age > 10 ? '500 mg VO a cada 12 horas por 3 dias (dose fixa; não é calculada por kg).' : 'Não se aplica: o protocolo indica esta opção para >30 kg e >10 anos.'],
    ['metro-amebiasis', 'Metronidazol · amebíase', 'Falha do tratamento de disenteria por Shigella ou achado compatível de E. histolytica, conforme protocolo.', `${nf(weight * 50)} mg/dia VO em 3 doses (${nf(weight * 50 / 3)} mg por dose), por 10 dias.`],
    ['metro-giardia', 'Metronidazol · giardíase', 'Diarreia ≥14 dias com cistos/trofozoítos identificados, conforme protocolo.', `${nf(weight * 15)} mg/dia VO em 3 doses (${nf(weight * 5)} mg por dose), por 5 dias.`],
  ];
  if (!(weight > 0)) return '<p class="sro-hint">Informe o peso para exibir as doses calculadas.</p>';
  return `<p class="sro-hint">Doses calculadas para ${nf(weight)} kg. Marque uma opção após confirmar indicação, idade, limites e protocolo.</p><div class="sro-antibiotic-options">${options.map(([id,label,indication,dose])=>`<label class="sro-antibiotic-option ${choice===id?'selected':''}"><input type="radio" name="sroAntibiotic" data-sro-antibiotic value="${id}" ${choice===id?'checked':''}><span><b>${label}</b><small>${indication}</small><strong>${dose}</strong></span></label>`).join('')}</div><small>Não calcula volume em mL porque a concentração do produto não foi informada. Os antibióticos são indicados apenas nas situações do protocolo; antiparasitários têm indicações específicas.</small>`;
}
function renderHydrationCalculator() {
  const container = document.getElementById('dynamicCalculatorFields');
  const ionConfig = {
    na: { label: 'Sódio', symbol: 'Na', doses: ['nacl20', 'nacl10', 'nacl09'], default: 'nacl10', options: [['nacl20', 'NaCl 20%'], ['nacl10', 'NaCl 10%'], ['nacl09', 'NaCl 0,9%']] },
    k: { label: 'Potássio', symbol: 'K', doses: ['kcl191', 'kcl10'], default: 'kcl10', options: [['kcl191', 'KCl 19,1%'], ['kcl10', 'KCl 10%']] },
    ca: { label: 'Cálcio', symbol: 'Ca', doses: ['ca10'], default: 'ca10', options: [['ca10', 'Gluconato 10%']] },
    mg: { label: 'Magnésio', symbol: 'Mg', doses: ['mg50', 'mg10'], default: 'mg10', options: [['mg50', 'MgSO₄ 50%'], ['mg10', 'MgSO₄ 10%']] },
  };
  const modeButtons = (kind, current, choices) => `<div class="hv-switch" role="group">${choices.map(([value, label]) => `<button type="button" class="${current === value ? 'active' : ''}" data-hv-mode="${kind}" data-mode="${value}" aria-pressed="${current === value}">${label}</button>`).join('')}</div>`;
  const referenceTabs = [['term', 'RN termo'], ['preterm', 'RN pré-termo'], ['pediatrics', 'Pediatria']];
  const referenceRates = hydrationDraft.referenceTab === 'term'
    ? [{ title: '', rows: [['D1', ['60']], ['D2', ['90']], ['D3', ['100', '120']], ['D4+', ['100', '120']]] }]
    : hydrationDraft.referenceTab === 'preterm'
      ? [
        { title: '>1500 g', note: 'Faixa de referência mais conservadora', rows: [['D1', ['60', '80']], ['D2', ['80', '100']], ['D3', ['100', '120']], ['D4+', ['120', '140']]] },
        { title: '<1500 g', note: 'Faixa mais ampla para prematuros menores', rows: [['D1', ['70', '100']], ['D2', ['90', '120']], ['D3', ['110', '140']], ['D4+', ['130', '180']]] },
      ] : [];
  const caloricWeightForReferences = (() => { const w = Number(hydrationDraft.weight); return w > 0 ? Math.round(((Math.min(w, 10) * 100 + Math.min(Math.max(w - 10, 0), 10) * 50 + Math.max(w - 20, 0) * 20) / 100) * 10) / 10 : 0; })();
  const referencePanel = hydrationDraft.referencesOpen ? `<div class="hv-reference-panel"><p>Toque em um valor para preencher ${hydrationDraft.referenceTab === 'pediatrics' ? 'o percentual do Holliday' : 'a taxa hídrica'}.</p><div class="hv-reference-tabs">${referenceTabs.map(([value, label]) => `<button type="button" class="${hydrationDraft.referenceTab === value ? 'active' : ''}" data-hv-reference-tab="${value}" aria-pressed="${hydrationDraft.referenceTab === value}">${label}</button>`).join('')}</div>${hydrationDraft.referenceTab === 'pediatrics' ? `<div class="hv-ped-reference"><strong>Percentual do Holliday</strong><p>Depois de informar o peso, confira o volume diário em cada percentual do Holliday e toque na linha que deseja usar.</p>${[[100, 'Criança bem hidratada, sem necessidade de restrição hídrica.'], [80, 'Pode ser usado quando você decide restringir a manutenção de forma mais leve.'], [70, 'Redução moderada da manutenção quando você decide restringir mais do que 80%, mas sem chegar a 50%.'], [50, 'Maior restrição hídrica quando houver retenção hídrica ou risco de hipervolemia.']].map(([pct, note]) => `<button type="button" class="hv-ped-option ${Number(hydrationDraft.rate) === pct ? 'active' : ''}" data-hv-reference-rate="${pct}" data-hv-ped-option="${pct}"><span><strong>${pct}% do Holliday</strong><small>${note}</small></span><span class="hv-ped-volume">${caloricWeightForReferences ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(caloricWeightForReferences * pct) + ' mL/dia' : 'Informe o peso'}<small>${pct}%</small></span></button>`).join('')}<div class="hv-ped-reference"><strong>Peso calórico</strong><p>Aqui, o <b>peso calórico</b> é usado como base para Holliday, macronutrientes e eletrólitos.</p><div class="hv-ped-option"><span><strong>Peso calórico calculado</strong><small>Base para Holliday, macro e eletrólitos</small></span><span class="hv-ped-volume" id="hvReferenceCaloricWeight">${caloricWeightForReferences ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(caloricWeightForReferences) + ' kg' : 'Informe o peso'}</span></div></div></div>` : `${referenceRates.map(group => `<div class="hv-neonatal-group">${group.title ? `<div class="hv-neonatal-group-title"><strong>${group.title}</strong><small>${group.note}</small></div>` : ''}${group.rows.map(([day, values]) => `<div class="hv-reference-row"><strong>${day}${day === 'D4+' ? '<small> A partir do dia 4</small>' : ''}</strong><span>${values.map(value => `<button type="button" class="${hydrationDraft.rate === value ? 'active' : ''}" data-hv-reference-rate="${value}">${value} mL/kg/dia</button>`).join('')}</span></div>`).join('')}</div>`).join('')}<div class="hv-reference-warning">⚠ Ajuste a referência neonatal ao peso ao nascer, perdas insensíveis, fototerapia, calor radiante e protocolo local.</div>`}</div>` : '';
  const ionCard = (key, config) => {
    const ion = hydrationDraft[key];
    const perConcentration = hydrationDraft.electrolyteMode === 'concentration';
    const unit = perConcentration ? 'mEq/L' : 'mEq/kg/dia';
    const dose = key === 'ca' && !perConcentration && ion.unit !== 'meq'
      ? (ion.unit === 'mgCa' ? 'mg Ca/kg/dia' : 'mg gluconato/kg/dia')
      : unit;
    const inputValue = perConcentration ? (ion.concentration || '') : ion.dose;
    const calciumUnit = key === 'ca' && !perConcentration
      ? `<div class="hv-ca-units"><span>Dose em</span>${[['meq', 'mEq'], ['mgCa', 'mg Ca'], ['mgGluconate', 'mg glucon.']].map(([value, label]) => `<button type="button" data-hv-ca-unit="${value}" class="${ion.unit === value ? 'active' : ''}">${label}</button>`).join('')}</div>` : '';
    const doseRange = key === 'na' ? 'Faixa usual: 2–4 mEq/kg/dia' : key === 'k' ? 'Faixa usual: 1–3 mEq/kg/dia' : key === 'ca' ? 'Faixa mostrada pelo Proped: 100–450 mg de gluconato/kg/dia' : 'Faixa usual: 0,2–0,5 mEq/kg/dia';
    return `<section class="hv-ion-card"><div class="hv-ion-heading"><span class="hv-ion-symbol">${config.symbol}</span><div><strong>${config.label}</strong><small>${doseRange}</small><span class="hv-ion-result" data-hv-ion-result="${key}"></span></div><button type="button" class="hv-toggle ${ion.enabled ? 'selected' : ''}" data-hv-toggle="${key}" aria-pressed="${ion.enabled}" aria-label="${ion.enabled ? 'Incluir' : 'Não incluir'} ${config.label} na composição">${ion.enabled ? '✓' : ''}</button></div><div class="hv-ion-fields"><label>DOSE<input type="number" min="0" step="any" data-hv-ion-input="${key}" data-field="${perConcentration ? 'concentration' : 'dose'}" value="${escapeHtml(String(inputValue))}" placeholder="Informe ${unit}"><span class="unit">${perConcentration ? 'mEq/L' : dose}</span></label><label>APRESENTAÇÃO<select data-hv-ion-input="${key}" data-field="presentation">${config.options.map(([value, label]) => `<option value="${value}" ${(ion.presentation || config.default) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>${calciumUnit}</section>`;
  };
  container.innerHTML = `
    <div class="hv-layout">
      <section class="hv-section"><div class="hv-section-title"><span>1 · BASE HÍDRICA</span><button type="button" class="hv-reference-trigger" data-hv-references aria-expanded="${hydrationDraft.referencesOpen}">▤ Referências <span>${hydrationDraft.referencesOpen ? '⌃' : '⌄'}</span></button></div><div class="hv-fields two"><label>PESO<input type="number" min="0" step="any" data-hv-input="weight" value="${escapeHtml(hydrationDraft.weight)}" placeholder="Ex: 12,5"><span class="unit">kg</span></label><label>${hydrationDraft.referenceTab === 'pediatrics' ? 'PERCENTUAL DO HOLLIDAY' : 'TAXA HÍDRICA PRESCRITA'}<input type="number" min="0" step="any" data-hv-input="rate" value="${escapeHtml(hydrationDraft.rate)}" placeholder="${hydrationDraft.referenceTab === 'pediatrics' ? 'Ex: 80' : 'Ex: 100'}"><span class="unit">${hydrationDraft.referenceTab === 'pediatrics' ? '%' : 'mL/kg/dia'}</span></label></div><p class="hv-hint" id="hvCaloricHint">Informe peso e taxa hídrica.</p>${referencePanel}</section>
      <section class="hv-section"><div class="hv-section-title"><span>2 · GLICOSE</span>${modeButtons('glucose', hydrationDraft.glucoseMode, [['tig', 'TIG · mg/kg/min'], ['grams', 'Gramas · g/Kcal']])}</div><label class="hv-checkbox"><input type="checkbox" data-hv-glucose-toggle ${hydrationDraft.glucoseEnabled ? 'checked' : ''}><span>Incluir glicose no cálculo da HV</span></label>${hydrationDraft.glucoseEnabled ? `<label class="hv-main-input"><span data-hv-glucose-label>${hydrationDraft.glucoseMode === 'tig' ? 'TIG' : 'GRAMAS POR CALORIA'}</span><input type="number" min="0" step="any" data-hv-input="glucose" value="${escapeHtml(hydrationDraft.glucose)}" placeholder="${hydrationDraft.glucoseMode === 'tig' ? 'Ex: 5' : 'Ex: 1,5'}"><span class="unit">${hydrationDraft.glucoseMode === 'tig' ? 'mg/kg/min' : 'g/Kcal'}</span></label><p class="hv-hint" id="hvGlucoseHint">${hydrationDraft.glucoseMode === 'tig' ? 'Sobre o peso real' : 'Sobre o peso calórico'}</p>` : `<div class="hv-isotonic-note">Sem glicose: o volume basal será preparado com Soro Fisiológico 0,9% (solução isotônica).</div>`}</section>
      <section class="hv-section"><div class="hv-section-title">3 · ELETRÓLITOS ${modeButtons('electrolyte', hydrationDraft.electrolyteMode, [['dose', 'Por dose · mEq/kg/dia'], ['concentration', 'Por concentração · mEq/L']])}</div><div class="hv-ions">${Object.entries(ionConfig).map(([key, config]) => ionCard(key, config)).join('')}</div></section>
      <section class="hv-section"><div class="hv-section-title">DISTRIBUIÇÃO EM ALÍQUOTAS</div><label class="hv-checkbox"><input type="checkbox" data-hv-distribution-toggle ${hydrationDraft.distributionEnabled ? 'checked' : ''}><span>Distribuir a solução final em alíquotas</span></label>${hydrationDraft.distributionEnabled ? modeButtons('aliquot', hydrationDraft.aliquotHours, [['4', '4/4 h'], ['6', '6/6 h'], ['8', '8/8 h'], ['12', '12/12 h']]) : '<p class="hv-hint">Ative para ver volume e vazão de cada alíquota no preparo e na prescrição para copiar.</p>'}<div class="hv-aliquot-result" id="hvAliquotResult"></div></section>
      <section class="hv-section"><div class="hv-section-title">PREPARO DA BOLSA</div>${hydrationDraft.glucoseEnabled ? modeButtons('base', hydrationDraft.base, [['5', 'SG5% + AD'], ['10', 'SG10% + AD'], ['25', 'SG25% + AD'], ['50', 'SG50% + AD'], ['5+50', 'SG5% + SG50%']]) : '<p class="hv-hint">Soro Fisiológico 0,9% como solução basal isotônica.</p>'}<div class="hv-preparation" id="hvPreparation"><p class="empty-state">Preencha peso e taxa hídrica para visualizar o preparo.</p></div></section>
      <section class="hv-section hv-final"><div class="hv-section-title">VELOCIDADE DE INFUSÃO</div><div id="hvInfusion" class="hv-infusion"></div><div class="hv-section-title">SOLUÇÃO FINAL</div><div id="hvFinal" class="hv-final-grid"></div><div class="hv-section-title">PRESCRIÇÃO PRONTA PARA COPIAR</div><div id="hvPrescription"></div><button type="button" class="button secondary small" id="hvCopy">Copiar tudo</button></section>
      <details class="hv-practice-guide"><summary><span><small>SOBRE O MÉTODO</small><strong>Guia da prática clínica</strong></span><i aria-hidden="true"></i></summary><div class="hv-guide-content"><section><h4>Taxa horária de manutenção por peso (Holliday–Segar)</h4><div class="hv-guide-table-wrap"><table><thead><tr><th>Faixa de peso</th><th>Taxa horária</th><th>Volume diário</th></tr></thead><tbody><tr><td>0–10 kg</td><td>4 mL/kg/h</td><td>100 mL/kg/dia</td></tr><tr><td>10–20 kg</td><td>40 mL/h + 2 mL/kg/h para cada kg acima de 10</td><td>1.000 mL + 50 mL/kg acima de 10</td></tr><tr><td>&gt;20 kg</td><td>60 mL/h + 1 mL/kg/h para cada kg acima de 20</td><td>1.500 mL + 20 mL/kg acima de 20</td></tr></tbody></table></div><p>A equação estima manutenção; não foi validada prospectivamente como taxa ideal individual. Considere condição clínica, perdas, balanço e restrição de volume.</p></section><section><h4>Tonicidade e composição de soluções de manutenção</h4><div class="hv-guide-table-wrap"><table><thead><tr><th>Parâmetro</th><th>Isotônica (recomendada como padrão em crianças elegíveis)</th><th>Hipotônica (uso tradicional)</th></tr></thead><tbody><tr><td>Sódio</td><td>135–154 mEq/L; equivalente a SF 0,9% ou cristalóide isotônico balanceado</td><td>30–100 mEq/L; ex.: SF 0,2–0,45%</td></tr><tr><td>Potássio</td><td>Adicionar conforme necessidade individual de manutenção e protocolo</td><td>Mesma lógica, considerando a solução de base</td></tr><tr><td>Cálcio</td><td>Não incluído rotineiramente; reposição individual conforme indicação</td><td>—</td></tr><tr><td>Dextrose</td><td>2,5–5%, conforme necessidade clínica</td><td>Historicamente 5%</td></tr></tbody></table></div><p>Referência AAP: crianças de 28 dias a 18 anos que necessitam de manutenção IV devem receber solução isotônica com dextrose e KCl apropriados. A recomendação não se aplica a neonatos/UTI neonatal nem a vários grupos com comorbidades ou perdas especiais descritos na diretriz.</p></section><section><h4>Como usar e pontos de atenção</h4><ul><li>Escolha a taxa hídrica prescrita ou consulte a aba Referências, que reúne taxas neonatais e os percentuais pediátricos do Holliday.</li><li>A opção sem glicose monta a base com SF 0,9%; o sódio do SF basal participa da estimativa de osmolaridade, mas não é somado à concentração de sódio adicionado exibida.</li><li>As alíquotas apenas repartem a composição diária calculada; confirme estabilidade, compatibilidade e técnica de preparo para cada intervalo.</li><li>Monitore eletrólitos e balanço conforme o quadro clínico. A equação não determina a solução ou a taxa apropriada para todos os pacientes.</li></ul></section><section><h4>Referências</h4><ul><li><a href="https://doi.org/10.1542/peds.2018-3083" target="_blank" rel="noopener">Feld LG et al. AAP Clinical Practice Guideline: Maintenance Intravenous Fluids in Children. Pediatrics. 2018;142:e20183083.</a></li><li><a href="https://doi.org/10.1056/NEJMra1207442" target="_blank" rel="noopener">Moritz ML, Ayus JC. Maintenance Intravenous Fluids in Acutely Ill Patients. N Engl J Med. 2015.</a></li></ul></section></div></details>
      <p class="form-hint">Ferramenta de apoio. Confira os valores, as unidades, a compatibilidade dos aditivos e o protocolo do seu serviço antes de prescrever.</p>
    </div>`;
  container.querySelectorAll('[data-hv-input]').forEach(input => input.addEventListener('input', () => {
    hydrationDraft[input.dataset.hvInput] = input.value;
    if (input.dataset.hvInput === 'glucose') hydrationDraft.glucoseValues[hydrationDraft.glucoseMode] = input.value;
    calculateHydration(true);
  }));
  container.querySelector('[data-hv-glucose-toggle]').addEventListener('change', event => { hydrationDraft.glucoseEnabled = event.target.checked; renderHydrationCalculator(); calculateHydration(true); });
  container.querySelector('[data-hv-distribution-toggle]').addEventListener('change', event => { hydrationDraft.distributionEnabled = event.target.checked; renderHydrationCalculator(); calculateHydration(true); });
  container.querySelector('[data-hv-references]').addEventListener('click', () => {
    hydrationDraft.referencesOpen = !hydrationDraft.referencesOpen;
    renderHydrationCalculator();
    calculateHydration(true);
  });
  container.querySelectorAll('[data-hv-reference-tab]').forEach(button => button.addEventListener('click', () => {
    hydrationDraft.referenceTab = button.dataset.hvReferenceTab;
    renderHydrationCalculator();
    calculateHydration(true);
  }));
  container.querySelectorAll('[data-hv-reference-rate]').forEach(button => button.addEventListener('click', () => {
    hydrationDraft.rate = button.dataset.hvReferenceRate;
    renderHydrationCalculator();
    calculateHydration(true);
  }));
  container.querySelectorAll('[data-hv-ion-input]').forEach(input => input.addEventListener('change', () => {
    hydrationDraft[input.dataset.hvIonInput][input.dataset.field] = input.value;
    calculateHydration(true);
  }));
  container.querySelectorAll('[data-hv-ion-input][type="number"]').forEach(input => input.addEventListener('input', () => {
    hydrationDraft[input.dataset.hvIonInput][input.dataset.field] = input.value;
    calculateHydration(true);
  }));
  container.querySelectorAll('[data-hv-mode]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.hvMode === 'glucose') {
      hydrationDraft.glucoseValues[hydrationDraft.glucoseMode] = hydrationDraft.glucose;
      hydrationDraft.glucoseMode = button.dataset.mode;
      hydrationDraft.glucose = hydrationDraft.glucoseValues[hydrationDraft.glucoseMode] || '';
      if (hydrationDraft.glucoseMode === 'grams' && hydrationDraft.base === '5+50') hydrationDraft.base = '5';
      else if (hydrationDraft.glucoseMode === 'tig' && hydrationDraft.base === '5') hydrationDraft.base = '5+50';
    }
    else if (button.dataset.hvMode === 'electrolyte') hydrationDraft.electrolyteMode = button.dataset.mode;
    else if (button.dataset.hvMode === 'aliquot') hydrationDraft.aliquotHours = button.dataset.mode;
    else hydrationDraft.base = button.dataset.mode;
    renderHydrationCalculator();
    calculateHydration(true);
  }));
  container.querySelectorAll('[data-hv-ca-unit]').forEach(button => button.addEventListener('click', () => {
    if (hydrationDraft.ca.unit !== button.dataset.hvCaUnit) hydrationDraft.ca.dose = '';
    hydrationDraft.ca.unit = button.dataset.hvCaUnit;
    renderHydrationCalculator();
    calculateHydration(true);
  }));
  container.querySelectorAll('[data-hv-toggle]').forEach(button => button.addEventListener('click', () => {
    hydrationDraft[button.dataset.hvToggle].enabled = !hydrationDraft[button.dataset.hvToggle].enabled;
    renderHydrationCalculator();
    calculateHydration(true);
  }));
  document.getElementById('calculateDynamicCalculator').hidden = false;
  document.getElementById('calculateDynamicCalculator').textContent = 'Calcular hidratação';
  document.getElementById('hvCopy').addEventListener('click', async () => {
    const textToCopy = document.getElementById('hvPrescription').innerText;
    if (!textToCopy.trim()) return showToast('Calcule a hidratação antes de copiar.');
    try { await navigator.clipboard.writeText(textToCopy); showToast('Preparo copiado.'); }
    catch { showToast('Não foi possível acessar a área de transferência.'); }
  });
  calculateHydration(true);
}
function renderHypokalemiaCalculator() {
  const container = document.getElementById('dynamicCalculatorFields');
  const d = hypokalemiaDraft;
  const ev = d.route === 'iv';
  container.innerHTML = `<div class="hk-layout">
    <section class="hk-section"><h3>Dados da criança</h3><div class="hk-grid"><label>PESO<input type="number" min="0" step="any" data-hk-input="weight" value="${escapeHtml(d.weight)}" placeholder="Ex: 15"><span>kg</span></label><label>K⁺ SÉRICO<input type="number" min="0" step="any" data-hk-input="potassium" value="${escapeHtml(d.potassium)}" placeholder="Ex: 2,5"><span>mEq/L</span></label></div>
    <label>VIA DE REPOSIÇÃO<select data-hk-input="route"><option value="oral" ${!ev ? 'selected' : ''}>Via oral</option><option value="iv" ${ev ? 'selected' : ''}>Endovenosa</option></select></label><p class="hk-hint">A via oral é preferencial quando tolerada. Considere a via EV conforme condição clínica e protocolo.</p></section>
    <section class="hk-section"><h3>Parâmetros de reposição</h3>${ev ? `<div class="hk-grid"><label>DOSE<input type="number" min="0" step="any" data-hk-input="dose" value="${escapeHtml(d.dose)}" placeholder="Ex: 0,2"><span>mEq/kg/h</span></label><label>TEMPO<input type="number" min="0" step="any" data-hk-input="time" value="${escapeHtml(d.time)}" placeholder="Ex: 3"><span>horas</span></label><label>CONCENTRAÇÃO FINAL<input type="number" min="0" step="any" data-hk-input="finalConcentration" value="${escapeHtml(d.finalConcentration)}" placeholder="Ex: 12"><span>mEq/L</span></label><label>APRESENTAÇÃO DE KCl<select data-hk-input="kclPresentation"><option value="kcl10" ${d.kclPresentation === 'kcl10' ? 'selected' : ''}>KCl 10% · 1,34 mEq/mL</option><option value="kcl15" ${d.kclPresentation === 'kcl15' ? 'selected' : ''}>KCl 15% · 2,01 mEq/mL</option><option value="kcl191" ${d.kclPresentation === 'kcl191' ? 'selected' : ''}>KCl 19,1% · 2,56 mEq/mL</option></select></label></div><p class="hk-hint">O preparo calculado é uma estimativa de volume final e diluente. Confira acesso, compatibilidade e limites institucionais.</p>` : `<div class="hk-grid"><label>DOSE DIÁRIA<input type="number" min="0" step="any" data-hk-input="dose" value="${escapeHtml(d.dose)}" placeholder="Ex: 1"><span>mEq/kg/dia</span></label><label>NÚMERO DE TOMADAS<input type="number" min="0" step="1" data-hk-input="frequency" value="${escapeHtml(d.frequency)}" placeholder="Ex: 4"><span>por dia</span></label><label>CONCENTRAÇÃO DO XAROPE<input type="number" min="0" step="any" data-hk-input="oralConcentration" value="${escapeHtml(d.oralConcentration)}" placeholder="Ex: 1,33"><span>mEq/mL</span></label></div><p class="hk-hint">Confira a concentração no rótulo do produto oral disponível.</p>`}</section>
  </div>`;
  container.querySelectorAll('[data-hk-input]').forEach(input => input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
    if (input.dataset.hkInput === 'route' && hypokalemiaDraft.route !== input.value) {
      hypokalemiaDraft.route = input.value;
      hypokalemiaDraft.dose = '';
    } else hypokalemiaDraft[input.dataset.hkInput] = input.value;
    if (input.dataset.hkInput === 'route') { renderHypokalemiaCalculator(); calculateHypokalemia(true); }
    else calculateHypokalemia(true);
  }));
  calculateHypokalemia(true);
}
function calculateHypokalemia(silent = false) {
  const d = hypokalemiaDraft, ev = d.route === 'iv';
  const weight = Number(d.weight), potassium = Number(d.potassium), dose = Number(d.dose);
  const box = document.getElementById('dynamicCalculatorResult');
  if (!(weight > 0 && potassium > 0 && dose > 0)) { box.classList.add('hidden'); if (!silent) showToast('Informe peso, K⁺ sérico e dose prescrita.'); return; }
  let total, metrics, memory, formula, alerts = [];
  const severity = potassium < 2.0 ? 'Crítica' : potassium < 2.5 ? 'Grave' : potassium < 3.0 ? 'Moderada' : potassium < 3.5 ? 'Leve' : 'K⁺ sem hipocalemia';
  const references = [{ label: 'kcl10', concentration: 1.34 }, { label: 'kcl15', concentration: 2.01 }, { label: 'kcl191', concentration: 2.56 }];
  if (ev) {
    const time = Number(d.time), finalConcentration = Number(d.finalConcentration), stock = references.find(item => item.label === d.kclPresentation)?.concentration || 0;
    if (!(time > 0 && time <= 24 && finalConcentration > 0 && stock > 0)) { box.classList.add('hidden'); if (!silent) showToast('Informe tempo até 24 horas, concentração final e apresentação de KCl válidas.'); return; }
    total = weight * dose * time;
    const finalVolume = total * 1000 / finalConcentration, kclVolume = total / stock, diluent = finalVolume - kclVolume, infusion = finalVolume / time, hourlyPotassium = total / time;
    if (diluent < 0) { box.classList.add('hidden'); if (!silent) showToast('A concentração final é menor que a concentração do estoque; confira os valores.'); return; }
    if (dose > 0.2) alerts.push('Dose acima de 0,2 mEq/kg/h: reposição EV de alta vigilância; confirme monitorização cardíaca e bomba de infusão conforme protocolo.');
    if (dose > 0.3) alerts.push('Acima de 0,3 mEq/kg/h: o Proped recomenda considerar acesso central e monitorização intensiva.');
    if (dose > 0.5) alerts.push('Dose acima de 0,5 mEq/kg/h: excede o teto exibido pelo Proped; interrompa e revise o plano com protocolo/especialista.');
    if (hourlyPotassium > 20) alerts.push('Taxa acima de 20 mEq/h: excede o limite exibido no guia do Proped; revise o plano com especialista/protocolo local.');
    if (finalConcentration > 40 && finalConcentration <= 60) alerts.push('Concentração acima de 40 mEq/L: excede o limite periférico usual; requer exceção institucional e vigilância do acesso.');
    if (finalConcentration > 60 && finalConcentration <= 120) alerts.push('Concentração acima de 60 mEq/L: requer acesso central e protocolo de monitorização.');
    if (finalConcentration > 120) alerts.push('Concentração acima de 120 mEq/L: excede o teto exibido pelo Proped; revise o plano com especialista/protocolo local.');
    if (total > Math.min(weight, 40)) alerts.push(`Total de ${number.format(total)} mEq acima do esquema usual por evento (1 mEq/kg ou 40 mEq); reavalie K⁺ antes de redosar.`);
    if (finalVolume / weight > 250) alerts.push('Volume acima de 250 mL/kg: confira risco de sobrecarga e a concentração final.');
    metrics = [{ label: 'KCl concentrado', value: `${clinicalNumber.format(kclVolume)} mL` }, { label: 'Diluente', value: `${clinicalNumber.format(diluent)} mL` }, { label: 'Volume final', value: `${clinicalNumber.format(finalVolume)} mL` }, { label: 'Bomba de infusão', value: `${clinicalNumber.format(infusion)} mL/h por ${number.format(time)} h` }, { label: 'K⁺ por hora', value: `${clinicalNumber.format(hourlyPotassium)} mEq/h` }];
    memory = [`Dose total = peso × dose × tempo = ${number.format(weight)} × ${number.format(dose)} × ${number.format(time)} = ${clinicalNumber.format(total)} mEq`, `Volume final = total × 1.000 ÷ concentração = ${number.format(total)} × 1.000 ÷ ${number.format(finalConcentration)} = ${clinicalNumber.format(finalVolume)} mL`, `Volume de ${d.kclPresentation === 'kcl10' ? 'KCl 10%' : d.kclPresentation === 'kcl15' ? 'KCl 15%' : 'KCl 19,1%'} = ${number.format(total)} ÷ ${number.format(stock)} = ${clinicalNumber.format(kclVolume)} mL`, `Diluente = ${clinicalNumber.format(finalVolume)} − ${clinicalNumber.format(kclVolume)} = ${clinicalNumber.format(diluent)} mL`, `Bomba = ${clinicalNumber.format(finalVolume)} ÷ ${number.format(time)} = ${clinicalNumber.format(infusion)} mL/h`];
    formula = 'Dose total (mEq) = peso × dose (mEq/kg/h) × tempo; volume final (mL) = dose total × 1.000 ÷ concentração (mEq/L).';
  } else {
    const frequency = Number(d.frequency), oralConcentration = Number(d.oralConcentration);
    if (!(Number.isInteger(frequency) && frequency >= 2 && frequency <= 6 && oralConcentration > 0)) { box.classList.add('hidden'); if (!silent) showToast('Informe de 2 a 6 tomadas por dia e a concentração oral do produto.'); return; }
    total = weight * dose; const perDose = total / frequency, mlPerDose = perDose / oralConcentration;
    if (dose < 1 || dose > 4) alerts.push('Dose diária fora da faixa de 1–4 mEq/kg/dia apresentada no guia do Proped; confirme o plano prescrito.');
    if (perDose > Math.min(weight, 40)) alerts.push('Dose por tomada acima de 1 mEq/kg ou 40 mEq; confira o limite por dose no protocolo e a apresentação.');
    metrics = [{ label: 'Dose total diária', value: `${number.format(total)} mEq/dia` }, { label: 'Dose por tomada', value: `${number.format(perDose)} mEq · ${number.format(mlPerDose)} mL` }, { label: 'Frequência', value: `${number.format(frequency)} tomadas/dia` }];
    memory = [`Dose diária = peso × dose = ${number.format(weight)} × ${number.format(dose)} = ${number.format(total)} mEq/dia`, `Dose por tomada = ${number.format(total)} ÷ ${number.format(frequency)} = ${number.format(perDose)} mEq`, `Volume por tomada = ${number.format(perDose)} ÷ ${number.format(oralConcentration)} = ${number.format(mlPerDose)} mL`];
    formula = 'Dose diária (mEq) = peso × dose (mEq/kg/dia); volume por tomada = dose diária ÷ tomadas/dia ÷ concentração oral.';
  }
  if (potassium >= 3.5) alerts.push('K⁺ informado não está abaixo de 3,5 mEq/L; confirme a indicação clínica da reposição.');
  const tone = alerts.length || potassium < 2.5 ? 'out' : potassium < 3.5 ? 'out' : 'normal';
  const status = potassium >= 3.5 ? 'K⁺ sem hipocalemia' : `Hipocalemia ${severity.toLocaleLowerCase('pt-BR')}`;
  box.innerHTML = renderClinicalCalculatorResult({ label: ev ? 'Resultado · Reposição EV de KCl' : 'Resultado · Reposição oral de KCl', value: clinicalNumber.format(total), unit: ev ? 'mEq total' : 'mEq/dia', reference: 'K⁺ sérico ≥3,5 mEq/L; confirme intervalo do laboratório', status, tone, formula, memory, metrics, alerts, caution: 'Estimativa de apoio. KCl é medicamento de alta vigilância; confira prescrição, função renal, diurese, ECG e protocolo institucional antes da administração.' }, CALCULATOR_IMPLEMENTATIONS.hipocalemia.clinicalGuide);
  box.classList.add('clinical-result'); box.classList.remove('hidden');
}
function calculateHydration(silent = false) {
  const d = hydrationDraft;
  const weight = Number(d.weight), rate = Number(d.rate), glucose = Number(d.glucose);
  if (!(weight > 0 && rate > 0 && (!d.glucoseEnabled || glucose > 0))) {
    document.getElementById('hvPreparation').innerHTML = '<p class="empty-state">Preencha peso e taxa hídrica e, se incluir glicose, informe o valor prescrito.</p>';
    document.getElementById('hvInfusion').replaceChildren();
    document.getElementById('hvFinal').replaceChildren();
    document.getElementById('hvPrescription').replaceChildren();
    document.getElementById('hvAliquotResult').replaceChildren();
    document.querySelectorAll('.hv-ion-result').forEach(node => { node.textContent = ''; });
    if (!silent) showToast('Preencha peso e taxa hídrica e informe glicose se ela estiver incluída.');
    return;
  }
  const energy = Math.min(weight, 10) * 100 + Math.min(Math.max(weight - 10, 0), 10) * 50 + Math.max(weight - 20, 0) * 20;
  const caloricWeight = Math.round((energy / 100) * 10) / 10;
  const totalMl = caloricWeight * rate;
  const totalL = totalMl / 1000;
  const glucoseG = d.glucoseEnabled ? (d.glucoseMode === 'tig' ? glucose * weight * 1.44 : glucose * caloricWeight) : 0;
  const glucosePercent = glucoseG * 100 / totalMl;
  const stock = { nacl20: 3.4, nacl10: 1.7, nacl09: 0.154, kcl191: 2.56, kcl10: 1.34, ca10: 0.45, mg50: 4.06, mg10: 0.8 };
  const ionMeta = [
    { key: 'na', label: 'Sódio', symbol: 'Na', baseUnit: 'mEq', mmol: 2 },
    { key: 'k', label: 'Potássio', symbol: 'K', baseUnit: 'mEq', mmol: 2 },
    { key: 'ca', label: 'Cálcio', symbol: 'Ca', baseUnit: 'mEq', mmol: 0 },
    { key: 'mg', label: 'Magnésio', symbol: 'Mg', baseUnit: 'mEq', mmol: 2 },
  ];
  const ions = {};
  for (const ion of ionMeta) {
    const item = d[ion.key];
    if (item.enabled) {
      const activeValue = ion.key === 'ca' && d.electrolyteMode === 'dose' ? item.dose : (d.electrolyteMode === 'dose' ? item.dose : item.concentration);
      if (!(Number(activeValue) > 0)) {
        document.getElementById('hvPreparation').innerHTML = '<p class="empty-state">Preencha as doses dos eletrólitos ativos ou desative os que não entram nesta solução.</p>';
        document.getElementById('hvInfusion').replaceChildren();
        document.getElementById('hvFinal').replaceChildren();
        document.getElementById('hvPrescription').replaceChildren();
        document.querySelectorAll('.hv-ion-result').forEach(node => { node.textContent = ''; });
        if (!silent) showToast(`Preencha a dose de ${ion.label} ou desative sua inclusão.`);
        return;
      }
    }
    let amount;
    if (ion.key === 'ca' && d.electrolyteMode === 'dose') {
      const caDose = Number(item.dose || 0) * caloricWeight;
      amount = item.unit === 'mgCa' ? caDose / 20 : item.unit === 'mgGluconate' ? caDose * 0.0045 : caDose;
    } else {
      const value = Number(d.electrolyteMode === 'dose' ? item.dose || 0 : item.concentration || 0);
      amount = d.electrolyteMode === 'dose' ? value * caloricWeight : value * totalL;
    }
    const presentation = item.presentation || (ion.key === 'na' ? 'nacl10' : ion.key === 'k' ? 'kcl10' : ion.key === 'ca' ? 'ca10' : 'mg10');
    const volume = amount / (stock[presentation] || 1);
    ions[ion.key] = { ...ion, amount, volume, concentration: amount / totalL, presentation, enabled: item.enabled };
  }
  const preparedIons = Object.values(ions).filter(ion => ion.enabled);
  const additiveMl = preparedIons.reduce((sum, ion) => sum + ion.volume, 0);
  let glucoseStockMl, waterMl, glucoseBaseParts;
  if (!d.glucoseEnabled) {
    const salineBaseMl = totalMl - additiveMl;
    if (salineBaseMl < -0.05) {
      document.getElementById('hvPreparation').innerHTML = '<p class="empty-state">O volume dos aditivos excede o volume total. Revise as doses e apresentações.</p>';
      document.getElementById('hvInfusion').replaceChildren(); document.getElementById('hvFinal').replaceChildren(); document.getElementById('hvPrescription').replaceChildren(); document.getElementById('hvAliquotResult').replaceChildren();
      if (!silent) showToast('O volume dos aditivos excede o volume final.');
      return;
    }
    glucoseStockMl = 0; waterMl = 0;
    glucoseBaseParts = [{ label: 'SF 0,9% (solução isotônica)', volume: Math.max(0, salineBaseMl) }];
  } else if (d.base === '5+50') {
    const availableBaseMl = totalMl - additiveMl;
    const sg50Ml = (glucoseG - availableBaseMl * 0.05) / 0.45;
    const sg5Ml = availableBaseMl - sg50Ml;
    if (sg5Ml < -0.05 || sg50Ml < -0.05) {
      document.getElementById('hvPreparation').innerHTML = '<p class="empty-state">A mistura SG5% + SG50% não consegue atingir a TIG neste volume. Revise a taxa hídrica, os aditivos ou selecione outra apresentação de glicose.</p>';
      document.getElementById('hvInfusion').replaceChildren();
      document.getElementById('hvFinal').replaceChildren();
      document.getElementById('hvPrescription').replaceChildren();
      document.querySelectorAll('.hv-ion-result').forEach(node => { node.textContent = ''; });
      if (!silent) showToast('A mistura de glicose selecionada não é compatível com o volume final.');
      return;
    }
    glucoseStockMl = availableBaseMl;
    waterMl = 0;
    glucoseBaseParts = [{ label: 'SG5%', volume: Math.max(0, sg5Ml) }, { label: 'SG50%', volume: Math.max(0, sg50Ml) }];
  } else {
    glucoseStockMl = glucoseG * 100 / Number(d.base);
    waterMl = totalMl - glucoseStockMl - additiveMl;
    glucoseBaseParts = [{ label: `SG${d.base}%`, volume: glucoseStockMl }, { label: 'AD', volume: Math.max(0, waterMl) }];
  }
  if (waterMl < -0.05) {
    document.getElementById('hvPreparation').innerHTML = '<p class="empty-state">Os estoques selecionados excedem o volume final. Troque a apresentação ou revise a taxa informada.</p>';
    document.getElementById('hvInfusion').replaceChildren();
    document.getElementById('hvFinal').replaceChildren();
    document.getElementById('hvPrescription').replaceChildren();
    document.querySelectorAll('.hv-ion-result').forEach(node => { node.textContent = ''; });
    if (!silent) showToast('O volume dos estoques selecionados excede o volume final. Revise a taxa, o modo de preparo e as apresentações.');
    return;
  }
  const sodiumConc = ions.na.enabled ? ions.na.concentration : 0;
  const potassiumConc = ions.k.enabled ? ions.k.concentration : 0;
  const magnesiumConc = ions.mg.enabled ? ions.mg.concentration : 0;
  const calciumConc = ions.ca.enabled ? ions.ca.concentration : 0;
  const salineSodiumConc = !d.glucoseEnabled ? 154 * glucoseBaseParts[0].volume / totalMl : 0;
  const glucoseMosm = (glucoseG / totalL) / 180 * 1000;
  const osmolarity = Math.round((2 * (sodiumConc + salineSodiumConc + potassiumConc) + magnesiumConc + 1.5 * calciumConc + glucoseMosm) / 10) * 10;
  const nf = value => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value);
  document.getElementById('hvCaloricHint').textContent = `Peso calórico ${nf(caloricWeight)} kg · volume ${nf(totalMl)} mL/dia`;
  document.querySelectorAll('[data-hv-ped-option]').forEach(node => { node.querySelector('.hv-ped-volume').firstChild.textContent = `${nf(caloricWeight * Number(node.dataset.hvPedOption))} mL/dia`; });
  const referenceCaloricWeight = document.getElementById('hvReferenceCaloricWeight');
  if (referenceCaloricWeight) referenceCaloricWeight.textContent = `${nf(caloricWeight)} kg`;
  const glucoseHint = document.getElementById('hvGlucoseHint');
  if (glucoseHint) glucoseHint.textContent = d.glucoseMode === 'tig' ? `Sobre o peso real · ${nf(glucoseG)} g/dia` : `Sobre o peso calórico · ${nf(glucoseG)} g/dia`;
  for (const ion of Object.values(ions)) {
    const card = document.querySelector(`[data-hv-ion-result="${ion.key}"]`);
    if (card) card.textContent = `${nf(ion.amount)} mEq/dia · ${nf(ion.volume)} mL${ion.key === 'ca' ? ' · cálculo separado da bolsa' : ''}`;
  }
  const baseParts = glucoseBaseParts.map(part => `<div><span>${part.label}</span><strong>${nf(part.volume)} mL</strong></div>`);
  for (const ion of preparedIons) baseParts.push(`<div><span>${escapeHtml(document.querySelector(`[data-hv-ion-input="${ion.key}"][data-field="presentation"]`).selectedOptions[0].textContent)} <small>${nf(ion.amount)} mEq</small></span><strong>${nf(ion.volume)} mL</strong></div>`);
  baseParts.push(`<div class="hv-total"><span>Total</span><strong>${nf(totalMl)} mL</strong></div>`);
  document.getElementById('hvPreparation').innerHTML = baseParts.join('');
  document.getElementById('hvInfusion').innerHTML = `<strong>${nf(totalMl / 24)} <small>mL/h</small></strong><span>${Math.round(totalMl / 24 * 20 / 60)} gts/min · ${nf(totalMl / 24)} micro/min</span>`;
  document.getElementById('hvFinal').innerHTML = `<div><span>OSMOLARIDADE</span><strong>${nf(osmolarity)} mOsm/L</strong></div><div><span>CONC. DE GLICOSE</span><strong>${d.glucoseEnabled ? `${nf(glucosePercent)}%` : 'Não incluída'}</strong></div><div><span>CONC. DE SÓDIO ADICIONADO</span><strong>${Math.round(sodiumConc)} mEq/L</strong></div><div><span>CONC. DE POTÁSSIO</span><strong>${Math.round(potassiumConc)} mEq/L</strong></div><div><span>CONC. DE MAGNÉSIO</span><strong>${Math.round(magnesiumConc)} mEq/L</strong></div>${ions.ca.enabled ? `<div><span>CONC. DE CÁLCIO</span><strong>${Math.round(calciumConc)} mEq/L</strong></div>` : ''}`;
  const doseSummary = ionMeta.filter(ion => ions[ion.key].enabled).map(ion => {
    if (d.electrolyteMode === 'concentration') return `${ion.symbol}:${nf(d[ion.key].concentration)} mEq/L`;
    return `${ion.symbol}:${nf(d[ion.key].dose)}${ion.key === 'ca' ? ` ${d.ca.unit === 'meq' ? 'mEq/kg/dia' : d.ca.unit === 'mgCa' ? 'mg Ca/kg/dia' : 'mg gluconato/kg/dia'}` : ' mEq/kg/dia'}`;
  }).join(' ');
  const glucoseSummary = d.glucoseEnabled ? (d.glucoseMode === 'tig' ? `TIG ${nf(glucose)} mg/kg/min` : `Glicose ${nf(glucose)} g/Kcal`) : 'sem glicose · SF 0,9% isotônico';
  const glucosePreparationSummary = glucoseBaseParts.map(part => `${part.label}: ${nf(part.volume)} mL`).join(' + ');
  const aliquotHours = Number(d.aliquotHours), aliquots = d.distributionEnabled ? 24 / aliquotHours : 0, aliquotMl = d.distributionEnabled ? totalMl / aliquots : 0, aliquotRate = d.distributionEnabled ? aliquotMl / aliquotHours : 0;
  const aliquotParts = [...glucoseBaseParts.map(part => `${part.label}: ${nf(part.volume / (aliquots || 1))} mL`), ...preparedIons.map(ion => `${ion.label}: ${nf(ion.volume / (aliquots || 1))} mL`)].join(' + ');
  document.getElementById('hvAliquotResult').innerHTML = d.distributionEnabled ? `<div class="hv-aliquot-card"><b>${aliquots} alíquotas de ${nf(aliquotHours)} h</b><span>${nf(aliquotMl)} mL por alíquota · ${nf(aliquotRate)} mL/h · ${Math.round(aliquotRate * 20 / 60)} gts/min · ${nf(aliquotRate)} micro/min</span><small>${aliquotParts} · completar cada alíquota conforme técnica e protocolo local.</small></div>` : '';
  const prepAliquot = d.distributionEnabled ? `<div class="hv-aliquot-card"><b>Preparo de cada alíquota (${nf(aliquotHours)} h)</b><span>Volume final ${nf(aliquotMl)} mL · correr a ${nf(aliquotRate)} mL/h</span><small>${aliquotParts}</small></div>` : '';
  document.getElementById('hvPreparation').innerHTML = `${baseParts.join('')}${prepAliquot}`;
  const aliquotCopy = d.distributionEnabled ? `<div class="hv-copy-block"><small>PREPARO POR ALÍQUOTA · ${aliquots} × ${nf(aliquotHours)} h</small><b>${aliquotParts} · Volume final ${nf(aliquotMl)} mL · ${nf(aliquotRate)} mL/h (${Math.round(aliquotRate * 20 / 60)} gts/min)</b></div>` : '';
  document.getElementById('hvPrescription').innerHTML = `<div class="hv-copy-block"><small>RESUMO</small><b>HV TH ${nf(rate)} mL/kg/dia · ${glucoseSummary} · ${doseSummary || 'sem eletrólitos adicionados'} · IV a ${nf(totalMl / 24)} mL/h${d.distributionEnabled ? ` · ${aliquots} alíquotas de ${nf(aliquotHours)} h` : ''}</b></div>${aliquotCopy}`;
}
function renderClinicalCalculatorResult(result, guide) {
  const memory = Array.isArray(result.memory) ? result.memory : [result.memory];
  const scale = result.scale ? (() => {
    const { value, min, max, low, high } = result.scale;
    const pct = Math.max(0, Math.min(100, (value - min) / (max - min) * 100));
    const lowPct = (low - min) / (max - min) * 100;
    const highPct = (high - min) / (max - min) * 100;
    return `<div class="clinical-scale"><div class="clinical-scale-bar"><span class="clinical-scale-low" style="width:${lowPct}%"></span><span class="clinical-scale-normal" style="left:${lowPct}%;width:${highPct - lowPct}%"></span><span class="clinical-scale-high" style="left:${highPct}%;width:${100 - highPct}%"></span><i style="left:${pct}%"></i></div><div><span>&lt; ${low} Hipo</span><strong>${low}–${high} Normal</strong><span>&gt; ${high} Hiper</span></div></div>`;
  })() : '';
  const metrics = result.metrics?.length ? `<div class="clinical-metrics">${result.metrics.map(metric => `<div><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong></div>`).join('')}</div>` : '';
  const alerts = result.alerts?.length ? `<div class="clinical-alerts"><strong>Atenção · ${result.alerts.length} aviso${result.alerts.length === 1 ? '' : 's'}</strong><ul>${result.alerts.map(alert => `<li>${escapeHtml(alert)}</li>`).join('')}</ul></div>` : '';
  const guideHtml = `<details class="clinical-guide"><summary><span><small>SOBRE O MÉTODO</small><strong>Guia clínico completo</strong></span><i aria-hidden="true"></i></summary><div class="clinical-guide-content">${guide.sections.map(section => `<section><h4>${escapeHtml(section.title)}</h4>${(section.paragraphs || []).map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('')}${section.bullets?.length ? `<ul>${section.bullets.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</section>`).join('')}<section><h4>Referências</h4><ul>${guide.references.map(reference => `<li><a href="${escapeHtml(reference.url)}" target="_blank" rel="noopener">${escapeHtml(reference.label)} ↗</a></li>`).join('')}</ul></section></div></details>`;
  return `<div class="clinical-result-top"><div><small>${escapeHtml(result.label)}</small><div><strong>${escapeHtml(result.value)}</strong><span>${escapeHtml(result.unit)}</span></div></div><div class="clinical-status clinical-status-${escapeHtml(result.tone)}">${escapeHtml(result.status)}</div></div><div class="clinical-reference"><span>Referência pediátrica: ${escapeHtml(result.reference)}</span></div>${scale}${metrics}${alerts}<div class="clinical-formula"><strong>Fórmula</strong><span>${escapeHtml(result.formula)}</span><small>Memória de cálculo</small>${memory.map(line => `<p>${escapeHtml(line)}</p>`).join('')}</div>${guideHtml}<p class="clinical-result-caution">${escapeHtml(result.caution || 'Estimativa de apoio clínico. Interprete com quadro clínico, método do laboratório e protocolo pediátrico local.')}</p>`;
}
function calculateActiveCalculator() {
  if (!activeCalculator) return;
  if (activeCalculator.title === 'Hidratação Venosa') return calculateHydration(false);
  if (activeCalculator.title === 'Hipocalemia — Reposição de KCl') return calculateHypokalemia(false);
  try {
    const values = {};
    for (const field of activeCalculator.fields) {
      const raw = document.querySelector(`[data-calculator-input="${field.id}"]`).value;
      if (raw === '' && field.optional) { values[field.id] = null; continue; }
      const value = field.type === 'date' ? raw : Number(raw);
      if (raw === '') throw new Error(`Preencha ${field.label.toLowerCase()}.`);
      if (field.type !== 'date' && (!Number.isFinite(value) || (value < 0 && !field.allowNegative) || (value === 0 && !field.allowZero))) throw new Error(`Preencha ${field.label.toLowerCase()} com um valor válido${field.allowNegative ? ' entre os valores listados' : field.allowZero ? ' igual ou maior que zero' : ' maior que zero'}.`);
      values[field.id] = value;
    }
    const result = activeCalculator.calculate(values);
    const box = document.getElementById('dynamicCalculatorResult');
    if (result.clinical && activeCalculator.clinicalGuide) {
      box.innerHTML = renderClinicalCalculatorResult(result.clinical, activeCalculator.clinicalGuide);
      box.classList.add('clinical-result');
    } else {
      box.classList.remove('clinical-result');
      box.innerHTML = `<strong>Resultado</strong><ul>${result.lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>${result.warning ? `<small class="result-warning">${escapeHtml(result.warning)}</small>` : ''}`;
    }
    box.classList.remove('hidden');
  } catch (error) {
    showToast(error.message || 'Confira os valores informados.');
  }
}
function openShift(date = selectedDate) {
  document.getElementById('shiftForm').reset();
  document.getElementById('shiftId').value = '';
  document.getElementById('shiftDate').value = date;
  document.getElementById('shiftStart').value = '07:00';
  document.getElementById('shiftEnd').value = '19:00';
  document.getElementById('shiftValue').value = '';
  document.getElementById('shiftDialogTitle').textContent = 'Novo plantão';
  document.getElementById('shiftDialog').showModal();
}
function deleteShift(id) {
  if (!confirm('Excluir este plantão?')) return;
  state.shifts = state.shifts.filter(shift => shift.id !== id);
  saveState(); showToast('Plantão excluído.');
}
function showPage(page) {
  document.querySelectorAll('.page').forEach(section => section.classList.toggle('active', section.id === `page-${page}`));
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  if (page === 'plantoes') renderShifts();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function showCalculation(elementId, markup) {
  const result = document.getElementById(elementId);
  result.innerHTML = markup;
  result.classList.remove('hidden');
}
function positive(...values) { return values.every(value => Number.isFinite(value) && value > 0); }

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.go)));
document.getElementById('todayLabel').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());
document.getElementById('addShift').addEventListener('click', () => openShift());
document.getElementById('addShiftDay').addEventListener('click', () => openShift());
document.getElementById('prevMonth').addEventListener('click', () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); selectedDate = dateKey(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)); renderShifts(); });
document.getElementById('nextMonth').addEventListener('click', () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); selectedDate = dateKey(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)); renderShifts(); });
document.getElementById('shiftForm').addEventListener('submit', event => {
  event.preventDefault();
  const date = document.getElementById('shiftDate').value;
  const start = document.getElementById('shiftStart').value;
  const end = document.getElementById('shiftEnd').value;
  const value = Number(document.getElementById('shiftValue').value);
  if (!date || !start || !end || !Number.isFinite(value) || value < 0) { showToast('Confira os campos do plantão.'); return; }
  if (start === end) { showToast('Início e fim não podem ser iguais.'); return; }
  state.shifts.push({ id: crypto.randomUUID(), date, start, end, value });
  selectedDate = date;
  const parsed = parseDateKey(date);
  viewMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
  saveState();
  document.getElementById('shiftDialog').close();
  showToast('Plantão registrado.');
});

document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
document.getElementById('addMedication').addEventListener('click', () => { document.getElementById('medicationForm').reset(); document.getElementById('medicationDialog').showModal(); });
document.getElementById('medicationForm').addEventListener('submit', event => {
  event.preventDefault();
  const optionalNumber = id => document.getElementById(id).value === '' ? '' : Number(document.getElementById(id).value);
  state.medications.push({ id: crypto.randomUUID(), name: document.getElementById('medName').value.trim(), presentation: document.getElementById('medPresentation').value.trim(), dosePerKg: optionalNumber('medDosePerKg'), concentration: optionalNumber('medConcentration'), maxDose: optionalNumber('medMaxDose'), interval: document.getElementById('medInterval').value.trim(), contraindications: document.getElementById('medContraindications').value.trim(), interactions: document.getElementById('medInteractions').value.trim(), url: cleanUrl(document.getElementById('medUrl').value.trim()), reviewed: document.getElementById('medReviewed').value });
  saveState(); document.getElementById('medicationDialog').close(); showToast('Referência salva neste dispositivo.');
});
document.getElementById('addProtocol').addEventListener('click', () => { document.getElementById('protocolForm').reset(); document.getElementById('protocolDialog').showModal(); });
document.getElementById('protocolForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = document.getElementById('protocolFiles');
  const files = [...(input.files || [])];
  const validFiles = files.every(file => SUPPORTED_ATTACHMENT_TYPES.has(file.type) && file.size > 0 && file.size <= MAX_ATTACHMENT_BYTES);
  if (!validFiles) { showToast('Anexe PDF ou imagem de até 20 MB cada.'); return; }
  try {
    const attachments = await Promise.all(files.map(saveAttachment));
    state.protocols.push({ id: crypto.randomUUID(), title: document.getElementById('protocolTitle').value.trim(), source: document.getElementById('protocolSource').value.trim(), url: cleanUrl(document.getElementById('protocolUrl').value.trim()), reviewed: document.getElementById('protocolReviewed').value, attachments });
    saveState(); document.getElementById('protocolDialog').close(); showToast('Protocolo e anexos salvos neste dispositivo.');
  } catch (error) { showToast(error.message || 'Não foi possível salvar os anexos.'); }
});

document.querySelectorAll('.calc-tab').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.calc-tab').forEach(tab => tab.classList.toggle('active', tab === button));
  document.querySelectorAll('.calc-panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== `calc-${button.dataset.calc}`));
}));
document.getElementById('calculatorSearch').addEventListener('input', event => {
  calculatorSearch = event.target.value;
  renderCalculatorCatalog();
});
document.getElementById('calculateDynamicCalculator').addEventListener('click', calculateActiveCalculator);
const authClient = window.MEU_PLANTAO_SUPABASE_CLIENT;
const authGate = document.getElementById('authGate');
const appShell = document.getElementById('appShell');
const authMessage = document.getElementById('authMessage');
let passwordRecoveryMode = false;
function showAuthMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.classList.toggle('error', isError);
}
function applyAuthSession(session) {
  const signedIn = Boolean(session?.user);
  const changingPassword = signedIn && passwordRecoveryMode;
  if (!signedIn) {
    activeCloudUser = null;
    cloudPhase = 'signed-out';
    const importDialog = document.getElementById('localImportDialog');
    if (importDialog.open) importDialog.close();
    pendingLocalImport = null;
    pendingRemoteState = null;
    setSyncStatus('Entre para sincronizar', 'ready');
  } else {
    beginCloudBootstrap(session.user);
  }
  const loadingCloud = signedIn && cloudPhase === 'loading' && !changingPassword;
  // Open the app as soon as authentication succeeds. The local snapshot is
  // already available; cloud reconciliation can finish in the background.
  authGate.hidden = signedIn && !changingPassword;
  appShell.hidden = !signedIn || changingPassword;
  document.getElementById('authForm').hidden = changingPassword;
  document.getElementById('authPasswordRecoveryForm').hidden = !changingPassword;
  document.getElementById('authLoading').hidden = true;
  document.getElementById('authSignOut').hidden = !signedIn;
  if (signedIn && !changingPassword && !loadingCloud) showAuthMessage('');
  updateCloudButtons();
}
document.getElementById('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!authClient) {
    showAuthMessage('Não foi possível iniciar a autenticação. Confira a conexão e a configuração do Supabase.', true);
    return;
  }
  const button = document.getElementById('authSubmit');
  button.disabled = true;
  showAuthMessage('Verificando acesso…');
  try {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const { error } = await authClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
  } catch (error) {
    const message = error.message || '';
    if (message.toLowerCase().includes('invalid login credentials')) showAuthMessage('E-mail ou senha não conferem. Se ainda não definiu uma senha, use “Esqueci ou preciso definir minha senha”.', true);
    else showAuthMessage(message || 'Não foi possível entrar. Confira a conexão e tente novamente.', true);
  } finally {
    button.disabled = false;
  }
});
document.getElementById('authRecovery').addEventListener('click', async () => {
  if (!authClient) {
    showAuthMessage('Não foi possível iniciar a recuperação. Confira a conexão e a configuração do Supabase.', true);
    return;
  }
  const email = document.getElementById('authEmail').value.trim();
  if (!email) {
    document.getElementById('authEmail').focus();
    showAuthMessage('Informe seu e-mail para receber o link de redefinição.', true);
    return;
  }
  const button = document.getElementById('authRecovery');
  button.disabled = true;
  showAuthMessage('Solicitando link de redefinição…');
  try {
    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await authClient.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    showAuthMessage('Se este e-mail estiver cadastrado, você receberá um link para definir uma senha. Confira também o spam.');
  } catch (error) {
    const message = (error.message || '').toLowerCase();
    const code = (error.code || '').toLowerCase();
    if (code === 'over_email_send_rate_limit' || message.includes('email rate limit exceeded')) {
      showAuthMessage('O limite de envio de e-mails do Supabase foi atingido. Aguarde cerca de uma hora desde o último envio antes de pedir outro link. Convites e redefinições compartilham esse limite.', true);
    } else if (code === 'email_address_not_authorized') {
      showAuthMessage('O envio padrão do Supabase só atende endereços autorizados da equipe. É necessário configurar um provedor SMTP próprio.', true);
    } else {
      showAuthMessage(error.message || 'Não foi possível solicitar a redefinição de senha.', true);
    }
  } finally {
    button.disabled = false;
  }
});
document.getElementById('authPasswordRecoveryForm').addEventListener('submit', async event => {
  event.preventDefault();
  const password = document.getElementById('newPassword').value;
  const confirmation = document.getElementById('confirmPassword').value;
  if (password.length < 8) { showAuthMessage('A senha precisa ter pelo menos 8 caracteres.', true); return; }
  if (password !== confirmation) { showAuthMessage('As senhas não conferem.', true); return; }
  const button = document.getElementById('savePassword');
  button.disabled = true;
  try {
    const { error } = await authClient.auth.updateUser({ password });
    if (error) throw error;
    passwordRecoveryMode = false;
    const { data } = await authClient.auth.getSession();
    applyAuthSession(data?.session || null);
    showToast('Senha atualizada.');
  } catch (error) {
    showAuthMessage(error.message || 'Não foi possível atualizar a senha. Solicite um novo link de redefinição.', true);
  } finally {
    button.disabled = false;
  }
});
document.getElementById('authSignOut').addEventListener('click', async () => {
  if (!authClient) return;
  const { error } = await authClient.auth.signOut();
  if (error) showToast('Não foi possível sair da conta.');
});
if (authClient) {
  authClient.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') passwordRecoveryMode = true;
    applyAuthSession(session);
  });
  authClient.auth.getSession().then(({ data, error }) => {
    if (error) showAuthMessage('Não foi possível verificar a sessão. Atualize a página e tente novamente.', true);
    applyAuthSession(data?.session || null);
    if (!data?.session) {
      const callbackParams = new URLSearchParams(location.hash.replace(/^#/, ''));
      if (callbackParams.get('error_code') === 'otp_expired' && !callbackParams.has('access_token')) {
        history.replaceState(null, document.title, `${location.pathname}${location.search}`);
        showAuthMessage('Este link expirou ou já foi usado. Solicite um novo link; se o limite de envio aparecer, aguarde antes de tentar novamente.', true);
      }
    }
  }).catch(() => {
    showAuthMessage('Não foi possível verificar a sessão. Atualize a página e tente novamente.', true);
    applyAuthSession(null);
  });
} else {
  applyAuthSession(null);
  showAuthMessage('A configuração do Supabase não carregou. Atualize a página ou verifique a conexão.', true);
}

renderAll();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

