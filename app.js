const STORAGE_KEY = 'meu-plantao:v1';
const FILE_DB_NAME = 'meu-plantao-files-v1';
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const SYNC_META_KEY = 'meu-plantao:sync:v1';
const LOCAL_BACKUP_KEY = 'meu-plantao:pre-sync-backup:v1';
const STORAGE_BUCKET = 'protocol-attachments';
const SUPPORTED_ATTACHMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const CALCULATOR_CATALOG = {
  'Hidroeletrolítico': 'Hidratação Venosa|Ânion Gap|Osmolaridade Plasmática|Potássio Corrigido pelo pH|Sódio Corrigido — Hiperglicemia|Cálcio Corrigido — Albumina|Hipernatremia|Hiponatremia|Hipocalemia|SRO|Holliday-Segar|Reposição de Bicarbonato',
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
    fields: [{ id: 'na', label: 'Sódio', unit: 'mEq/L' }, { id: 'cl', label: 'Cloreto', unit: 'mEq/L' }, { id: 'hco3', label: 'Bicarbonato', unit: 'mEq/L' }],
    formula: 'Ânion gap = Na − (Cl + HCO₃). Não inclui potássio.',
    source: { label: 'ISPAD — cetoacidose diabética pediátrica', url: 'https://www.ispad.org/static/6dd62eae-c8cb-4b4a-84e1efc768505746/Ch11PediatricDiabetes.pdf' },
    calculate: v => ({ lines: [`Ânion gap calculado: ${number.format(v.na - v.cl - v.hco3)} mEq/L.`], warning: 'A interpretação depende do método laboratorial, albumina e contexto clínico; não classifica a causa isoladamente.' }),
  },
  'osmolaridade-plasmatica': {
    title: 'Osmolaridade Plasmática', category: 'Hidroeletrolítico',
    fields: [{ id: 'na', label: 'Sódio', unit: 'mEq/L' }, { id: 'glucose', label: 'Glicose', unit: 'mg/dL' }, { id: 'bun', label: 'Nitrogênio ureico (BUN)', unit: 'mg/dL', optional: true }],
    formula: 'Estimativa: 2 × Na + glicose/18 + BUN/2,8. Se deixar BUN vazio, o resultado é a osmolaridade efetiva estimada.',
    source: { label: 'ISPAD — cetoacidose diabética pediátrica', url: 'https://www.ispad.org/static/6dd62eae-c8cb-4b4a-84e1efc768505746/Ch11PediatricDiabetes.pdf' },
    calculate: v => ({ lines: [`Osmolaridade calculada: ${number.format(2 * v.na + v.glucose / 18 + (v.bun || 0) / 2.8)} mOsm/kg.`], warning: 'É uma estimativa calculada, não substitui osmolaridade medida. A fórmula exige glicose e BUN em mg/dL.' }),
  },
  'potassio-corrigido-pelo-ph': {
    title: 'Potássio Corrigido pelo pH', category: 'Hidroeletrolítico',
    fields: [{ id: 'potassium', label: 'Potássio medido', unit: 'mEq/L' }, { id: 'pH', label: 'pH medido', unit: 'pH' }, { id: 'targetPH', label: 'pH de referência definido pelo profissional', unit: 'pH' }, { id: 'coefficient', label: 'Coeficiente assinado da fórmula adotada localmente', unit: 'mEq/L por unidade de pH', allowNegative: true }],
    formula: 'A relação entre pH e potássio varia com o método e o contexto; por isso, o app não fixa um coeficiente. Informe o coeficiente com o sinal indicado pela fórmula aprovada pelo seu serviço.',
    calculate: v => ({ lines: [`Potássio estimado pela relação informada: ${number.format(v.potassium + v.coefficient * (v.targetPH - v.pH))} mEq/L.`], warning: 'Estimativa dependente do coeficiente inserido. Não use para substituir nova dosagem laboratorial.' }),
  },
  'sodio-corrigido-hiperglicemia': {
    title: 'Sódio Corrigido — Hiperglicemia', category: 'Hidroeletrolítico',
    fields: [{ id: 'na', label: 'Sódio medido', unit: 'mEq/L' }, { id: 'glucose', label: 'Glicose', unit: 'mg/dL' }],
    formula: 'Estimativa exibida: Na medido + 0,016 × (glicose − 100), com glicose em mg/dL.',
    source: { label: 'ISPAD — cetoacidose diabética pediátrica', url: 'https://www.ispad.org/static/6dd62eae-c8cb-4b4a-84e1efc768505746/Ch11PediatricDiabetes.pdf' },
    calculate: v => ({ lines: [`Sódio corrigido estimado: ${number.format(v.na + 0.016 * (v.glucose - 100))} mEq/L.`], warning: 'A fórmula de correção varia entre referências. Avalie tendência seriada e protocolo vigente; este valor isolado não orienta reposição.' }),
  },
  'calcio-corrigido-albumina': {
    title: 'Cálcio Corrigido — Albumina', category: 'Hidroeletrolítico',
    fields: [{ id: 'calcium', label: 'Cálcio total', unit: 'mg/dL' }, { id: 'albumin', label: 'Albumina', unit: 'g/dL' }],
    formula: 'Estimativa: cálcio total + 0,8 × (4 − albumina). Unidades exigidas: mg/dL e g/dL.',
    source: { label: 'Endotext — abordagem do cálcio', url: 'https://www.ncbi.nlm.nih.gov/books/NBK279129/' },
    calculate: v => ({ lines: [`Cálcio corrigido estimado: ${number.format(v.calcium + 0.8 * (4 - v.albumin))} mg/dL.`], warning: 'A correção por albumina pode ser imprecisa, especialmente em pacientes críticos. Considere cálcio ionizado conforme o contexto.' }),
  },
  'hipernatremia': {
    title: 'Hipernatremia — Déficit de Água Livre', category: 'Hidroeletrolítico',
    fields: [{ id: 'weight', label: 'Peso atual', unit: 'kg' }, { id: 'na', label: 'Sódio medido', unit: 'mEq/L' }, { id: 'targetNa', label: 'Sódio-alvo definido pelo profissional', unit: 'mEq/L' }, { id: 'tbw', label: 'Fração de água corporal total (0–1)', unit: 'L/kg' }],
    formula: 'Déficit estimado = peso × fração de água corporal × (Na medido/Na-alvo − 1). A fração precisa ser selecionada conforme idade e condição clínica.',
    source: { label: 'Arkansas Children’s — distúrbios do sódio pediátricos', url: 'https://www.archildrens.org/-/media/Files/for-healthcare-professionals/pediatric-guidelines/Pediatric_Sodium_Disorders.pdf' },
    calculate: v => {
      if (v.na <= v.targetNa) throw new Error('Para estimar déficit de água livre, o sódio medido precisa ser maior que o alvo informado.');
      return { lines: [`Déficit de água livre estimado: ${number.format(v.weight * v.tbw * (v.na / v.targetNa - 1) * 1000)} mL.`], warning: 'Estimativa teórica; não inclui manutenção nem perdas em curso. A velocidade de correção requer plano clínico e monitorização seriada.' };
    },
  },
  'hiponatremia': {
    title: 'Hiponatremia — Déficit de Sódio', category: 'Hidroeletrolítico',
    fields: [{ id: 'weight', label: 'Peso', unit: 'kg' }, { id: 'na', label: 'Sódio medido', unit: 'mEq/L' }, { id: 'targetNa', label: 'Sódio-alvo definido pelo profissional', unit: 'mEq/L' }, { id: 'tbw', label: 'Fração de água corporal total (0–1)', unit: 'L/kg' }],
    formula: 'Estimativa matemática: (Na-alvo − Na medido) × peso × fração de água corporal. O alvo e a fração devem vir do plano clínico.',
    source: { label: 'Arkansas Children’s — distúrbios do sódio pediátricos', url: 'https://www.archildrens.org/-/media/Files/for-healthcare-professionals/pediatric-guidelines/Pediatric_Sodium_Disorders.pdf' },
    calculate: v => {
      if (v.targetNa <= v.na) throw new Error('O sódio-alvo informado deve ser maior que o sódio medido.');
      return { lines: [`Diferença matemática estimada: ${number.format((v.targetNa - v.na) * v.weight * v.tbw)} mEq de sódio.`], warning: 'Não converte automaticamente em volume de solução e não define correção segura. Considere sintomas, cronicidade, perdas e protocolo institucional.' };
    },
  },
  'hipocalemia': {
    title: 'Hipocalemia — Reposição de KCl', category: 'Hidroeletrolítico',
    fields: [{ id: 'weight', label: 'Peso', unit: 'kg' }, { id: 'dose', label: 'Dose prescrita', unit: 'mEq/kg' }, { id: 'concentration', label: 'Concentração da apresentação', unit: 'mEq/mL' }],
    formula: 'Converte apenas a dose prescrita: mEq totais = dose × peso; volume = mEq totais/concentração. Não sugere dose, diluição ou velocidade.',
    calculate: v => ({ lines: [`Quantidade prescrita: ${number.format(v.weight * v.dose)} mEq.`, `Volume correspondente à concentração informada: ${number.format(v.weight * v.dose / v.concentration)} mL.`], warning: 'Confirme concentração, via, diluição, velocidade, função renal e monitorização no protocolo institucional. Nunca administrar KCl concentrado sem diluição apropriada.' }),
  },
  'sro': {
    title: 'SRO — Volume prescrito por peso', category: 'Hidroeletrolítico',
    fields: [{ id: 'weight', label: 'Peso', unit: 'kg' }, { id: 'volumeKg', label: 'Volume prescrito no plano selecionado', unit: 'mL/kg' }],
    formula: 'Volume calculado = peso × volume em mL/kg definido pelo profissional conforme plano de reidratação.',
    source: { label: 'Ministério da Saúde — doenças diarreicas agudas', url: 'https://www.gov.br/saude/pt-br/assuntos/saude-de-a-a-z/d/dda/' },
    calculate: v => ({ lines: [`Volume correspondente à prescrição informada: ${number.format(v.weight * v.volumeKg)} mL.`], warning: 'A calculadora não classifica desidratação nem escolhe plano. Reavalie a criança e siga o protocolo local.' }),
  },
  'holliday-segar': {
    title: 'Holliday-Segar — Manutenção', category: 'Hidroeletrolítico',
    fields: [{ id: 'weight', label: 'Peso', unit: 'kg' }],
    formula: 'Estimativa diária: 100 mL/kg para os primeiros 10 kg + 50 mL/kg para os próximos 10 kg + 20 mL/kg para cada kg acima de 20.',
    source: { label: 'NICE — fluidoterapia IV em crianças', url: 'https://www.nice.org.uk/guidance/ng29/chapter/recommendations' },
    calculate: v => {
      const daily = Math.min(v.weight, 10) * 100 + Math.max(0, Math.min(v.weight - 10, 10)) * 50 + Math.max(0, v.weight - 20) * 20;
      return { lines: [`Volume de manutenção estimado: ${number.format(daily)} mL/dia.`, `Média horária aritmética: ${number.format(daily / 24)} mL/h.`], warning: 'Necessidade de manutenção não equivale à prescrição final. Considere idade, doença, perdas, balanço, tonicidade e restrições.' };
    },
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
  weight: '', rate: '', glucoseMode: 'tig', glucose: '', glucoseValues: { tig: '', grams: '' }, electrolyteMode: 'dose', base: '5',
  na: { dose: '3', presentation: 'nacl10', enabled: true },
  k: { dose: '1.5', presentation: 'kcl10', enabled: true },
  ca: { dose: '0.5', unit: 'meq', presentation: 'ca10', enabled: false },
  mg: { dose: '0.3', presentation: 'mg10', enabled: true },
};

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
    document.getElementById('dynamicCalculatorFields').classList.add('hydration-calculator-fields');
    document.getElementById('calculateDynamicCalculator').hidden = true;
    document.getElementById('dynamicCalculatorResult').classList.add('hidden');
    document.getElementById('dynamicCalculatorSource').hidden = true;
    renderHydrationCalculator();
    document.getElementById('calculatorDialog').showModal();
    return;
  }
  document.getElementById('dynamicCalculatorFormula').hidden = false;
  document.getElementById('dynamicCalculatorFields').classList.remove('hydration-calculator-fields');
  document.getElementById('calculateDynamicCalculator').hidden = false;
  document.getElementById('calculateDynamicCalculator').textContent = 'Calcular';
  document.getElementById('dynamicCalculatorFormula').textContent = calculator.formula;
  document.getElementById('dynamicCalculatorFields').innerHTML = calculator.fields.map(field => {
    const input = field.options
      ? `<select data-calculator-input="${escapeHtml(field.id)}"><option value="">Selecione</option>${field.options.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('')}</select>`
      : `<input type="${field.type || 'number'}" ${field.type === 'date' ? '' : 'step="any"'} data-calculator-input="${escapeHtml(field.id)}" ${field.optional ? '' : 'required'}>`;
    return `<label>${escapeHtml(field.label)}${field.optional ? ' <span class="unit">opcional</span>' : ''}<span class="unit">${escapeHtml(field.unit)}</span>${input}</label>`;
  }).join('');
  const source = document.getElementById('dynamicCalculatorSource');
  if (calculator.source) {
    source.href = calculator.source.url;
    source.textContent = `Fonte: ${calculator.source.label} ↗`;
    source.hidden = false;
  } else { source.hidden = true; }
  document.getElementById('dynamicCalculatorResult').classList.add('hidden');
  document.getElementById('dynamicCalculatorResult').replaceChildren();
  document.getElementById('calculatorDialog').showModal();
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
      <section class="hv-section"><div class="hv-section-title">1 · BASE HÍDRICA</div><div class="hv-fields two"><label>PESO<input type="number" min="0" step="any" data-hv-input="weight" value="${escapeHtml(hydrationDraft.weight)}" placeholder="Ex: 12,5"><span class="unit">kg</span></label><label>TAXA HÍDRICA PRESCRITA<input type="number" min="0" step="any" data-hv-input="rate" value="${escapeHtml(hydrationDraft.rate)}" placeholder="Ex: 100"><span class="unit">mL/kg/dia</span></label></div><p class="hv-hint" id="hvCaloricHint">Informe peso e taxa hídrica.</p></section>
      <section class="hv-section"><div class="hv-section-title">2 · GLICOSE ${modeButtons('glucose', hydrationDraft.glucoseMode, [['tig', 'TIG · mg/kg/min'], ['grams', 'Gramas · g/Kcal']])}</div><label class="hv-main-input"><span data-hv-glucose-label>${hydrationDraft.glucoseMode === 'tig' ? 'TIG' : 'GRAMAS POR CALORIA'}</span><input type="number" min="0" step="any" data-hv-input="glucose" value="${escapeHtml(hydrationDraft.glucose)}" placeholder="${hydrationDraft.glucoseMode === 'tig' ? 'Ex: 5' : 'Ex: 1,5'}"><span class="unit">${hydrationDraft.glucoseMode === 'tig' ? 'mg/kg/min' : 'g/Kcal'}</span></label><p class="hv-hint" id="hvGlucoseHint">${hydrationDraft.glucoseMode === 'tig' ? 'Sobre o peso real' : 'Sobre o peso calórico'}</p></section>
      <section class="hv-section"><div class="hv-section-title">3 · ELETRÓLITOS ${modeButtons('electrolyte', hydrationDraft.electrolyteMode, [['dose', 'Por dose · mEq/kg/dia'], ['concentration', 'Por concentração · mEq/L']])}</div><div class="hv-ions">${Object.entries(ionConfig).map(([key, config]) => ionCard(key, config)).join('')}</div></section>
      <section class="hv-section"><div class="hv-section-title">PREPARO DA BOLSA</div>${modeButtons('base', hydrationDraft.base, [['5', 'SG5% + AD'], ['10', 'SG10% + AD'], ['25', 'SG25% + AD'], ['50', 'SG50% + AD']])}<div class="hv-preparation" id="hvPreparation"><p class="empty-state">Preencha peso, taxa hídrica e glicose para visualizar o preparo.</p></div></section>
      <section class="hv-section hv-final"><div class="hv-section-title">VELOCIDADE DE INFUSÃO</div><div id="hvInfusion" class="hv-infusion"></div><div class="hv-section-title">SOLUÇÃO FINAL</div><div id="hvFinal" class="hv-final-grid"></div><div class="hv-section-title">PRESCRIÇÃO PRONTA PARA COPIAR</div><div id="hvPrescription"></div><button type="button" class="button secondary small" id="hvCopy">Copiar tudo</button></section>
      <details class="hv-references"><summary>Referências</summary><a href="https://proped.app/calculadoras/hidratacao-venosa-direta" target="_blank" rel="noopener">Calculadora de Hidratação Venosa do Proped ↗</a></details>
      <p class="form-hint">Ferramenta de apoio. Confira os valores, as unidades, a compatibilidade dos aditivos e o protocolo do seu serviço antes de prescrever.</p>
    </div>`;
  container.querySelectorAll('[data-hv-input]').forEach(input => input.addEventListener('input', () => {
    hydrationDraft[input.dataset.hvInput] = input.value;
    if (input.dataset.hvInput === 'glucose') hydrationDraft.glucoseValues[hydrationDraft.glucoseMode] = input.value;
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
    }
    else if (button.dataset.hvMode === 'electrolyte') hydrationDraft.electrolyteMode = button.dataset.mode;
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
function calculateHydration(silent = false) {
  const d = hydrationDraft;
  const weight = Number(d.weight), rate = Number(d.rate), glucose = Number(d.glucose);
  if (!(weight > 0 && rate > 0 && glucose > 0)) {
    document.getElementById('hvPreparation').innerHTML = '<p class="empty-state">Preencha peso, taxa hídrica e glicose para visualizar o preparo.</p>';
    document.getElementById('hvInfusion').replaceChildren();
    document.getElementById('hvFinal').replaceChildren();
    document.getElementById('hvPrescription').replaceChildren();
    document.querySelectorAll('.hv-ion-result').forEach(node => { node.textContent = ''; });
    if (!silent) showToast('Preencha peso, taxa hídrica e glicose para calcular.');
    return;
  }
  const energy = Math.min(weight, 10) * 100 + Math.min(Math.max(weight - 10, 0), 10) * 50 + Math.max(weight - 20, 0) * 20;
  const caloricWeight = energy / 100;
  const totalMl = caloricWeight * rate;
  const totalL = totalMl / 1000;
  const glucoseG = d.glucoseMode === 'tig' ? glucose * weight * 1.44 : glucose * caloricWeight;
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
  const glucoseStockMl = glucoseG * 100 / Number(d.base);
  const additiveMl = preparedIons.reduce((sum, ion) => sum + ion.volume, 0);
  const waterMl = totalMl - glucoseStockMl - additiveMl;
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
  const glucoseMosm = (glucoseG / totalL) / 180 * 1000;
  const osmolarity = Math.round((2 * (sodiumConc + potassiumConc) + magnesiumConc + 1.5 * calciumConc + glucoseMosm) / 10) * 10;
  const nf = value => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value);
  document.getElementById('hvCaloricHint').textContent = `Peso calórico ${nf(caloricWeight)} kg · volume ${nf(totalMl)} mL/dia`;
  document.getElementById('hvGlucoseHint').textContent = d.glucoseMode === 'tig' ? `Sobre o peso real · ${nf(glucoseG)} g/dia` : `Sobre o peso calórico · ${nf(glucoseG)} g/dia`;
  for (const ion of Object.values(ions)) {
    const card = document.querySelector(`[data-hv-ion-result="${ion.key}"]`);
    if (card) card.textContent = `${nf(ion.amount)} mEq/dia · ${nf(ion.volume)} mL${ion.key === 'ca' ? ' · cálculo separado da bolsa' : ''}`;
  }
  const baseParts = [`<div><span>SG${d.base}%</span><strong>${nf(glucoseStockMl)} mL</strong></div>`, `<div><span>AD</span><strong>${nf(Math.max(0, waterMl))} mL</strong></div>`];
  for (const ion of preparedIons) baseParts.push(`<div><span>${escapeHtml(document.querySelector(`[data-hv-ion-input="${ion.key}"][data-field="presentation"]`).selectedOptions[0].textContent)} <small>${nf(ion.amount)} mEq</small></span><strong>${nf(ion.volume)} mL</strong></div>`);
  baseParts.push(`<div class="hv-total"><span>Total</span><strong>${nf(totalMl)} mL</strong></div>`);
  document.getElementById('hvPreparation').innerHTML = baseParts.join('');
  document.getElementById('hvInfusion').innerHTML = `<strong>${nf(totalMl / 24)} <small>mL/h</small></strong><span>${Math.round(totalMl / 24 * 20 / 60)} gts/min · ${nf(totalMl / 24)} micro/min</span>`;
  document.getElementById('hvFinal').innerHTML = `<div><span>OSMOLARIDADE</span><strong>${nf(osmolarity)} mOsm/L</strong></div><div><span>CONC. DE GLICOSE</span><strong>${nf(glucosePercent)}%</strong></div><div><span>CONC. DE SÓDIO</span><strong>${Math.round(sodiumConc)} mEq/L</strong></div><div><span>CONC. DE POTÁSSIO</span><strong>${Math.round(potassiumConc)} mEq/L</strong></div><div><span>CONC. DE MAGNÉSIO</span><strong>${Math.round(magnesiumConc)} mEq/L</strong></div>${ions.ca.enabled ? `<div><span>CONC. DE CÁLCIO</span><strong>${Math.round(calciumConc)} mEq/L</strong></div>` : ''}`;
  const doseSummary = ionMeta.filter(ion => ions[ion.key].enabled).map(ion => `${ion.symbol}:${nf(d[ion.key].dose)}${ion.key === 'ca' ? ` ${d.ca.unit === 'meq' ? 'mEq' : d.ca.unit === 'mgCa' ? 'mg Ca' : 'mg glucon.'}` : ''}`).join(' ');
  document.getElementById('hvPrescription').innerHTML = `<div class="hv-copy-block"><small>RESUMO</small><b>HV TH ${nf(rate)} mL/kg/dia · ${doseSummary} · IV a ${nf(totalMl / 24)} mL/h</b></div><div class="hv-copy-block"><small>MODO DE PREPARO</small><b>SG${d.base}%: ${nf(glucoseStockMl)} mL + AD: ${nf(Math.max(0, waterMl))} mL + ${preparedIons.map(ion => `${ion.label} ${nf(ion.volume)} mL`).join(' + ')} · Volume total: ${nf(totalMl)} mL</b></div>`;
}
function calculateActiveCalculator() {
  if (!activeCalculator) return;
  if (activeCalculator.title === 'Hidratação Venosa') return calculateHydration(false);
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
    box.innerHTML = `<strong>Resultado</strong><ul>${result.lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>${result.warning ? `<small class="result-warning">${escapeHtml(result.warning)}</small>` : ''}`;
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
document.getElementById('calculateDose').addEventListener('click', () => {
  const weight = Number(document.getElementById('doseWeight').value);
  const dosePerKg = Number(document.getElementById('dosePerKg').value);
  const concentration = Number(document.getElementById('doseConcentration').value);
  const maxRaw = document.getElementById('doseMaximum').value;
  const maximum = maxRaw === '' ? null : Number(maxRaw);
  if (!positive(weight, dosePerKg, concentration) || (maximum !== null && (!Number.isFinite(maximum) || maximum <= 0))) { showCalculation('doseResult', '<b>Preencha valores positivos e confira as unidades.</b>'); return; }
  const dose = weight * dosePerKg;
  const volume = dose / concentration;
  const exceeded = maximum !== null && dose > maximum;
  showCalculation('doseResult', `<small>Resultado matemático a partir dos valores informados</small><strong>${number.format(dose)} mg por dose</strong><small>Volume calculado: <b>${number.format(volume)} mL</b> · ${number.format(weight)} kg × ${number.format(dosePerKg)} mg/kg ÷ ${number.format(concentration)} mg/mL</small>${exceeded ? '<small class="result-warning"><b>Atenção:</b> o resultado ultrapassa o limite máximo que você informou. Verifique a prescrição e a fonte profissional.</small>' : '<small>Confirme dose, limite e apresentação na bula profissional ou protocolo vigente.</small>'}`);
});
document.getElementById('doseMedication').addEventListener('change', event => {
  const item = state.medications.find(medication => medication.id === event.target.value);
  document.getElementById('dosePerKg').value = item?.dosePerKg || '';
  document.getElementById('doseConcentration').value = item?.concentration || '';
  document.getElementById('doseMaximum').value = item?.maxDose || '';
});
document.getElementById('calculateVolume').addEventListener('click', () => {
  const mg = Number(document.getElementById('amountMg').value);
  const concentration = Number(document.getElementById('amountConcentration').value);
  if (!positive(mg, concentration)) { showCalculation('volumeResult', '<b>Preencha valores positivos e confira as unidades.</b>'); return; }
  showCalculation('volumeResult', `<small>Resultado matemático a partir dos valores informados</small><strong>${number.format(mg / concentration)} mL</strong><small>${number.format(mg)} mg ÷ ${number.format(concentration)} mg/mL. Confira a concentração da apresentação.</small>`);
});
document.getElementById('calculateInfusion').addEventListener('click', () => {
  const volume = Number(document.getElementById('infusionVolume').value);
  const duration = Number(document.getElementById('infusionHours').value);
  if (!positive(volume, duration)) { showCalculation('infusionResult', '<b>Preencha valores positivos e confira as unidades.</b>'); return; }
  showCalculation('infusionResult', `<small>Resultado matemático a partir dos valores informados</small><strong>${number.format(volume / duration)} mL/h</strong><small>${number.format(volume)} mL ÷ ${number.format(duration)} horas. Confirme parâmetros e equipamento conforme protocolo local.</small>`);
});

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

