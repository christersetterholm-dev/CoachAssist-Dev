import { FormationTemplate } from '../types';

// Outfield positions should be 10 players, sorted generally from back to front, left to right.
// The GK position is usually fixed at (50, 90).

export const FORMATION_TEMPLATES: FormationTemplate[] = [
  {
    id: '4-2-3-1',
    name: '4-2-3-1',
    category: 'Kontrollerande',
    variants: [
      {
        id: '4-2-3-1-wide',
        name: '4-2-3-1 Wide',
        description: 'Traditionella yttrar som håller sig brett för att dra isär motståndarförsvaret.',
        positions: [
          // Backlinje (4) - LB, LCB, RCB, RB
          { x: 14, y: 73 }, { x: 38, y: 78 }, { x: 62, y: 78 }, { x: 86, y: 73 },
          // Defensivt mittfält (2) - LDM, RDM
          { x: 35, y: 58 }, { x: 65, y: 58 },
          // Offensivt mittfält (3) - LW, CAM, RW
          { x: 12, y: 38 }, { x: 50, y: 38 }, { x: 88, y: 38 },
          // Anfallare (1)
          { x: 50, y: 24 }
        ]
      },
      {
        id: '4-2-3-1-narrow',
        name: '4-2-3-1 Narrow',
        description: 'De offensiva tre spelarna drar sig inåt i banan, vilket ger plats åt ytterbackarna att fylla på längs kanterna.',
        positions: [
          // Backlinje (4) - LB, LCB, RCB, RB
          { x: 14, y: 73 }, { x: 38, y: 78 }, { x: 62, y: 78 }, { x: 86, y: 73 },
          // Defensivt mittfält (2) - LDM, RDM
          { x: 35, y: 58 }, { x: 65, y: 58 },
          // Offensivt mittfält (3) - LCAM, CAM, RCAM
          { x: 30, y: 38 }, { x: 50, y: 38 }, { x: 70, y: 38 },
          // Anfallare (1)
          { x: 50, y: 24 }
        ]
      },
      {
        id: '4-2-3-1-asymmetric',
        name: '4-2-3-1 Asymmetric',
        description: 'En yttermittfältare håller kanten medan den andra drar sig inåt som en "inverted" spelare.',
        positions: [
          // Backlinje (4) - LB, LCB, RCB, RB
          { x: 14, y: 73 }, { x: 38, y: 78 }, { x: 62, y: 78 }, { x: 86, y: 73 },
          // Defensivt mittfält (2) - LDM, RDM
          { x: 35, y: 58 }, { x: 65, y: 58 },
          // Offensivt mittfält (3) - LW (wide), CAM, RAM (narrow)
          { x: 12, y: 38 }, { x: 50, y: 38 }, { x: 75, y: 42 },
          // Anfallare (1)
          { x: 50, y: 24 }
        ]
      }
    ]
  },
  {
    id: '4-4-2',
    name: '4-4-2',
    category: 'Balanserad',
    variants: [
      {
        id: '4-4-2-flat',
        name: '4-4-2 Rak',
        description: 'Traditionell formation med en rak fyrbackslinje och ett rakt mittfält.',
        positions: [
          // Backlinje (4)
          { x: 14, y: 75 }, { x: 38, y: 75 }, { x: 62, y: 75 }, { x: 86, y: 75 },
          // Mittfält (4)
          { x: 15, y: 55 }, { x: 38, y: 55 }, { x: 62, y: 55 }, { x: 85, y: 55 },
          // Anfallare (2)
          { x: 35, y: 35 }, { x: 65, y: 35 }
        ]
      },
      {
        id: '4-4-2-diamond',
        name: '4-4-2 Diamant',
        description: 'Mittfältet formas som en diamant, smalt men kontrollerar mitten av planen effektivt.',
        positions: [
          // Backlinje (4)
          { x: 14, y: 75 }, { x: 38, y: 75 }, { x: 62, y: 75 }, { x: 86, y: 75 },
          // Diamant (4) - CDM, LCM, RCM, CAM
          { x: 50, y: 65 }, { x: 30, y: 55 }, { x: 70, y: 55 }, { x: 50, y: 45 },
          // Anfallare (2)
          { x: 35, y: 35 }, { x: 65, y: 35 }
        ]
      },
      {
        id: '4-4-2-wide',
        name: '4-4-2 Bred',
        description: 'Yttermittfältare står högt och brett för att dra isär motståndarnas försvar.',
        positions: [
          // Backlinje (4)
          { x: 14, y: 75 }, { x: 38, y: 75 }, { x: 62, y: 75 }, { x: 86, y: 75 },
          // Mittfält (4)
          { x: 10, y: 52 }, { x: 38, y: 55 }, { x: 62, y: 55 }, { x: 90, y: 52 },
          // Anfallare (2)
          { x: 35, y: 35 }, { x: 65, y: 35 }
        ]
      },
      {
        id: '4-4-2-defensive',
        name: '4-4-2 Defensiv',
        description: 'Kompakt formation med lågt block för att satsa på kontringar.',
        positions: [
          // Backlinje (4)
          { x: 14, y: 80 }, { x: 38, y: 80 }, { x: 62, y: 80 }, { x: 86, y: 80 },
          // Mittfält (4) - Mycket lågt
          { x: 15, y: 65 }, { x: 38, y: 65 }, { x: 62, y: 65 }, { x: 85, y: 65 },
          // Anfallare (2)
          { x: 40, y: 50 }, { x: 60, y: 50 }
        ]
      }
    ]
  },
  {
    id: '4-3-3',
    name: '4-3-3',
    category: 'Offensiv',
    variants: [
      {
        id: '4-3-3-holding',
        name: '4-3-3 Defensiv',
        description: 'En defensiv mittfältare (single pivot) balanserar laget mellan backlinje och anfall.',
        positions: [
          // Backlinje (4)
          { x: 14, y: 75 }, { x: 38, y: 75 }, { x: 62, y: 75 }, { x: 86, y: 75 },
          // Mittfält (3) - CDM, 2 CMs
          { x: 50, y: 55 }, { x: 30, y: 42 }, { x: 70, y: 42 },
          // Anfall (3)
          { x: 15, y: 22 }, { x: 50, y: 18 }, { x: 85, y: 22 }
        ]
      },
      {
        id: '4-3-3-flat',
        name: '4-3-3 Rak',
        description: 'Tre centrala mittfältare på en rak linje ger en balanserad och stabil kontroll över mitten av planen.',
        positions: [
          // Backlinje (4)
          { x: 14, y: 75 }, { x: 38, y: 75 }, { x: 62, y: 75 }, { x: 86, y: 75 },
          // Mittfält (3) - 3 CMs
          { x: 25, y: 48 }, { x: 50, y: 48 }, { x: 75, y: 48 },
          // Anfall (3)
          { x: 15, y: 22 }, { x: 50, y: 18 }, { x: 85, y: 22 }
        ]
      },
      {
        id: '4-3-3-false9',
        name: '4-3-3 Falsk 9:a',
        description: 'Anfallaren droppar djupt för att delta i speluppbyggnaden medan yttrarna söker sig inåt för genombrott.',
        positions: [
          // Backlinje (4)
          { x: 14, y: 75 }, { x: 38, y: 75 }, { x: 62, y: 75 }, { x: 86, y: 75 },
          // Mittfält (3)
          { x: 30, y: 50 }, { x: 70, y: 50 }, { x: 50, y: 35 }, // False 9 drops to 35
          // Anfall (3) - Yttrar tuck in
          { x: 25, y: 18 }, { x: 75, y: 18 }, { x: 50, y: 18 } // ST usually at front but False 9 logic varies
        ]
      },
      {
        id: '4-3-3-asymmetric',
        name: '4-3-3 Asymmetrisk',
        description: 'En ytter drar sig inåt som en extra speldirigent medan den andra håller sig brett för att dra isär försvaret.',
        positions: [
          // Backlinje (4)
          { x: 14, y: 75 }, { x: 38, y: 75 }, { x: 62, y: 75 }, { x: 86, y: 75 },
          // Mittfält (3)
          { x: 30, y: 48 }, { x: 50, y: 52 }, { x: 70, y: 48 },
          // Anfall (3) - LW wide, ST center, RW tucked in
          { x: 10, y: 22 }, { x: 50, y: 18 }, { x: 68, y: 28 }
        ]
      }
    ]
  },
  {
    id: '3-5-2',
    name: '3-5-2',
    category: 'Balanserad',
    variants: [
      {
        id: '3-5-2-holding',
        name: '3-5-2 med Defensiv mittfältare',
        description: 'Använder tre mittbackar, två wingbackar, en defensiv mittfältare och två anfallare för stabilitet.',
        positions: [
          // Backlinje (3) - LCB, CB, RCB
          { x: 25, y: 75 }, { x: 50, y: 75 }, { x: 75, y: 75 },
          // Wingbacks (2) - LWB, RWB
          { x: 10, y: 55 }, { x: 90, y: 55 },
          // Mittfält (3) - CDM, 2 CMs
          { x: 50, y: 62 }, { x: 35, y: 48 }, { x: 65, y: 48 },
          // Anfallare (2)
          { x: 35, y: 18 }, { x: 65, y: 18 }
        ]
      },
      {
        id: '3-5-2-playmaker',
        name: '3-5-2 med Spelfördelare',
        description: 'En kreativ spelfördelare opererar mellan två mer defensiva mittfältare för att styra spelet offensivt.',
        positions: [
          // Backlinje (3)
          { x: 25, y: 75 }, { x: 50, y: 75 }, { x: 75, y: 75 },
          // Wingbacks (2)
          { x: 10, y: 55 }, { x: 90, y: 55 },
          // Mittfält (3) - 2 CDMs, 1 CAM (playmaker)
          { x: 35, y: 60 }, { x: 65, y: 60 }, { x: 50, y: 40 },
          // Anfallare (2)
          { x: 35, y: 18 }, { x: 65, y: 18 }
        ]
      },
      {
        id: '5-3-2-defensive',
        name: '5-3-2 Defensiv',
        description: 'Wingbackarna droppar ner för att bilda en låg fembackslinje, vilket skapar en mycket kompakt försvarsmur.',
        positions: [
          // Backlinje (5) - LB, LCB, CB, RCB, RB
          { x: 12, y: 78 }, { x: 31, y: 78 }, { x: 50, y: 78 }, { x: 69, y: 78 }, { x: 88, y: 78 },
          // Mittfält (3)
          { x: 30, y: 55 }, { x: 50, y: 55 }, { x: 70, y: 55 },
          // Anfallare (2)
          { x: 35, y: 25 }, { x: 65, y: 25 }
        ]
      }
    ]
  },
  {
    id: '4-5-1',
    name: '4-5-1',
    category: 'Defensiv',
    variants: [
      {
        id: '4-5-1-flat',
        name: '4-5-1 Rak',
        description: 'Fem mittfältare på en rak linje skapar en ultra-kompakt mur som är extremt svår att tränga igenom.',
        positions: [
          // Backlinje (4)
          { x: 14, y: 75 }, { x: 38, y: 75 }, { x: 62, y: 75 }, { x: 86, y: 75 },
          // Mittfält (5)
          { x: 10, y: 48 }, { x: 30, y: 48 }, { x: 50, y: 48 }, { x: 70, y: 48 }, { x: 90, y: 48 },
          // Anfallare (1)
          { x: 50, y: 18 }
        ]
      },
      {
        id: '4-5-1-defensive',
        name: '4-3-2-1 Julgran',
        description: 'Tre sittande mittfältare skyddar backlinjen medan två offensiva mittfältare stöttar den ensamma anfallaren.',
        positions: [
          // Backlinje (4)
          { x: 14, y: 75 }, { x: 38, y: 75 }, { x: 62, y: 75 }, { x: 86, y: 75 },
          // Mittfält (3 centrala)
          { x: 30, y: 55 }, { x: 50, y: 55 }, { x: 70, y: 55 },
          // Offensiva mittfältare (2)
          { x: 35, y: 35 }, { x: 65, y: 35 },
          // Anfallare (1)
          { x: 50, y: 15 }
        ]
      },
      {
        id: '4-5-1-counter',
        name: '4-5-1 Kontring',
        description: 'En mittfältare kliver upp och ger understöd till anfallaren vid kontringar, medan resten av mittfältet ligger djupt.',
        positions: [
          // Backlinje (4)
          { x: 14, y: 78 }, { x: 38, y: 78 }, { x: 62, y: 78 }, { x: 86, y: 78 },
          // Mittfält (4 djupa)
          { x: 15, y: 60 }, { x: 38, y: 60 }, { x: 62, y: 60 }, { x: 85, y: 60 },
          // Offensiv mittfältare (1 filling up)
          { x: 50, y: 38 },
          // Anfallare (1)
          { x: 50, y: 18 }
        ]
      }
    ]
  },
  {
    id: '3-4-3',
    name: '3-4-3',
    category: 'Offensiv',
    variants: [
      {
        id: '3-4-3-flat',
        name: '3-4-3 Rak',
        description: 'Offensiv kraft med tre anfallare och ett brett fyr-manna mittfält.',
        positions: [
          // Backlinje (3)
          { x: 20, y: 75 }, { x: 50, y: 75 }, { x: 80, y: 75 },
          // Mittfält (4)
          { x: 10, y: 48 }, { x: 38, y: 48 }, { x: 62, y: 48 }, { x: 90, y: 48 },
          // Anfall (3)
          { x: 20, y: 18 }, { x: 50, y: 18 }, { x: 80, y: 18 }
        ]
      }
    ]
  }
];
