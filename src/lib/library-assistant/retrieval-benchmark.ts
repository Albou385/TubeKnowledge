export type RetrievalBenchmarkCategory = "notion-précise" | "synonyme" | "multi-source" | "cross-domain" | "comparaison" | "notion-multi-vidéos";

export interface RetrievalBenchmarkCase {
  id: string;
  category: RetrievalBenchmarkCategory;
  question: string;
  expectedPath: string;
  expectedAnchor: string;
  requireMultipleSources?: boolean;
  rejectIndexAsTop?: boolean;
}

export interface SyntheticBenchmarkDocument {
  relativePath: string;
  content: string;
}

// Corpus fictif autonome : il ne dépend d'aucun vault configuré ni de son contenu.
export const SYNTHETIC_BENCHMARK_DOCUMENTS: SyntheticBenchmarkDocument[] = [
  { relativePath: "01_BIBLIOTHEQUE/Astronomie/Observation/choisir-un-telescope.md", content: "# Choisir un télescope\n\n## Ouverture et cratères\nUne grande ouverture collecte davantage de lumière et rend les cratères lunaires plus lisibles.\n\n## Comparer jumelles et longue-vue\nLes jumelles sont légères pour balayer le ciel; une longue-vue privilégie le détail stable.\n\n## Prototype de montage\nUne maquette prototype permet d'essayer un montage avant d'installer l'instrument dehors.\n" },
  { relativePath: "01_BIBLIOTHEQUE/Astronomie/Observation/pollution-lumineuse.md", content: "# Réduire la pollution lumineuse\n\n## Halo urbain\nLa lumière urbaine forme un halo qui efface les étoiles faibles.\n\n## Observer de nuit\nAdapter les yeux à la nuit et protéger la lampe aide une observation régulière.\n" },
  { relativePath: "01_BIBLIOTHEQUE/Astronomie/Observation/carnet-du-ciel.md", content: "# Tenir un carnet du ciel\n\n## Carte et orientation\nUne carte du ciel indique les constellations et facilite l'orientation.\n\n## Journal météo\nNoter la météo, la transparence et l'heure rend les observations comparables.\n" },
  { relativePath: "01_BIBLIOTHEQUE/Cuisine/Fermentation/pain-au-levain.md", content: "# Pain au levain\n\n## Démarrer un levain\nUne culture de farine et d'eau devient active avec des rafraîchis réguliers.\n\n## Fermentation lente\nUne fermentation lente développe les arômes et améliore la structure de la mie.\n\n## Journal de cuisson\nUn journal de cuisson relie température, durée et résultat du pain.\n" },
  { relativePath: "01_BIBLIOTHEQUE/Cuisine/Fermentation/kimchi-maison.md", content: "# Kimchi maison\n\n## Saumure et sel\nLa saumure salée protège les légumes pendant le départ de la fermentation.\n\n## Fermenter les légumes\nLe chou et les légumes fermentés restent croquants lorsque le bocal est propre.\n" },
  { relativePath: "01_BIBLIOTHEQUE/Jardinage/Sol-et-compost/compostage-domestique.md", content: "# Compostage domestique\n\n## Épluchures et matières brunes\nAlterner épluchures humides et matières brunes garde le compost aéré.\n\n## Humus prêt\nUn compost mûr devient un humus sombre qui nourrit les plantations.\n\n## Carnet de suivi\nUn carnet de suivi aide à observer l'évolution du tas de compost.\n" },
  { relativePath: "01_BIBLIOTHEQUE/Jardinage/Sol-et-compost/ameliorer-la-terre.md", content: "# Améliorer la terre\n\n## Paillage et humidité\nLe paillage limite l'évaporation et conserve l'humidité du sol.\n\n## Terre friable\nUne terre friable laisse passer l'air et les racines sans se tasser.\n" },
];

export const RETRIEVAL_BENCHMARK_CASES: RetrievalBenchmarkCase[] = [
  { id: "telescope-ouverture", category: "notion-précise", question: "Quelle ouverture aide à voir les cratères lunaires ?", expectedPath: "01_BIBLIOTHEQUE/Astronomie/Observation/choisir-un-telescope.md", expectedAnchor: "ouverture-et-crateres", rejectIndexAsTop: true },
  { id: "jumelles-comparaison", category: "comparaison", question: "Quelle différence entre jumelles, longue-vue et télescope pour observer le ciel ?", expectedPath: "01_BIBLIOTHEQUE/Astronomie/Observation/choisir-un-telescope.md", expectedAnchor: "comparer-jumelles-et-longue-vue", rejectIndexAsTop: true },
  { id: "maquette-ephemere", category: "synonyme", question: "Pourquoi tester une maquette éphémère avant le montage ?", expectedPath: "01_BIBLIOTHEQUE/Astronomie/Observation/choisir-un-telescope.md", expectedAnchor: "prototype-de-montage", rejectIndexAsTop: true },
  { id: "halo-urbain", category: "notion-précise", question: "Comment le halo urbain masque-t-il les étoiles ?", expectedPath: "01_BIBLIOTHEQUE/Astronomie/Observation/pollution-lumineuse.md", expectedAnchor: "halo-urbain", rejectIndexAsTop: true },
  { id: "observer-la-nuit", category: "synonyme", question: "Comment préserver ses yeux pendant une observation nocturne ?", expectedPath: "01_BIBLIOTHEQUE/Astronomie/Observation/pollution-lumineuse.md", expectedAnchor: "observer-de-nuit", rejectIndexAsTop: true },
  { id: "carte-du-ciel", category: "notion-précise", question: "Comment une carte du ciel aide-t-elle à repérer les constellations ?", expectedPath: "01_BIBLIOTHEQUE/Astronomie/Observation/carnet-du-ciel.md", expectedAnchor: "carte-et-orientation", rejectIndexAsTop: true },
  { id: "journal-meteo", category: "notion-précise", question: "Pourquoi noter la météo et la transparence dans un carnet ?", expectedPath: "01_BIBLIOTHEQUE/Astronomie/Observation/carnet-du-ciel.md", expectedAnchor: "journal-meteo", rejectIndexAsTop: true },
  { id: "levain-actif", category: "notion-précise", question: "Comment garder une culture de levain active ?", expectedPath: "01_BIBLIOTHEQUE/Cuisine/Fermentation/pain-au-levain.md", expectedAnchor: "demarrer-un-levain", rejectIndexAsTop: true },
  { id: "fermentation-lente", category: "comparaison", question: "Quel effet une fermentation lente a-t-elle sur la mie du pain ?", expectedPath: "01_BIBLIOTHEQUE/Cuisine/Fermentation/pain-au-levain.md", expectedAnchor: "fermentation-lente", rejectIndexAsTop: true },
  { id: "journal-cuisson", category: "notion-multi-vidéos", question: "Pourquoi relier température et durée dans un journal de cuisson ?", expectedPath: "01_BIBLIOTHEQUE/Cuisine/Fermentation/pain-au-levain.md", expectedAnchor: "journal-de-cuisson", rejectIndexAsTop: true },
  { id: "saumure-legumes", category: "notion-précise", question: "À quoi sert la saumure salée pour les légumes ?", expectedPath: "01_BIBLIOTHEQUE/Cuisine/Fermentation/kimchi-maison.md", expectedAnchor: "saumure-et-sel", rejectIndexAsTop: true },
  { id: "chou-fermente", category: "synonyme", question: "Comment garder croquant un chou fermenté en bocal ?", expectedPath: "01_BIBLIOTHEQUE/Cuisine/Fermentation/kimchi-maison.md", expectedAnchor: "fermenter-les-legumes", rejectIndexAsTop: true },
  { id: "epluchures-compost", category: "notion-précise", question: "Comment alterner les épluchures et les matières brunes ?", expectedPath: "01_BIBLIOTHEQUE/Jardinage/Sol-et-compost/compostage-domestique.md", expectedAnchor: "epluchures-et-matieres-brunes", rejectIndexAsTop: true },
  { id: "humus-compost", category: "notion-précise", question: "Quand le compost devient-il un humus sombre ?", expectedPath: "01_BIBLIOTHEQUE/Jardinage/Sol-et-compost/compostage-domestique.md", expectedAnchor: "humus-pret", rejectIndexAsTop: true },
  { id: "carnet-compost", category: "notion-multi-vidéos", question: "Que permet d'observer un carnet de suivi du compost ?", expectedPath: "01_BIBLIOTHEQUE/Jardinage/Sol-et-compost/compostage-domestique.md", expectedAnchor: "carnet-de-suivi", rejectIndexAsTop: true },
  { id: "paillage-humidite", category: "notion-précise", question: "Comment le paillage conserve-t-il l'humidité du sol ?", expectedPath: "01_BIBLIOTHEQUE/Jardinage/Sol-et-compost/ameliorer-la-terre.md", expectedAnchor: "paillage-et-humidite", rejectIndexAsTop: true },
  { id: "terre-friable", category: "notion-précise", question: "Pourquoi une terre friable aide-t-elle les racines ?", expectedPath: "01_BIBLIOTHEQUE/Jardinage/Sol-et-compost/ameliorer-la-terre.md", expectedAnchor: "terre-friable", rejectIndexAsTop: true },
  { id: "sol-observation", category: "cross-domain", question: "Comment noter l'humidité du sol avant une observation de nuit ?", expectedPath: "01_BIBLIOTHEQUE/Astronomie/Observation/pollution-lumineuse.md", expectedAnchor: "observer-de-nuit", requireMultipleSources: true, rejectIndexAsTop: true },
  { id: "journaux-croises", category: "multi-source", question: "Pourquoi comparer un journal d'observation météo et un journal de cuisson ?", expectedPath: "01_BIBLIOTHEQUE/Astronomie/Observation/carnet-du-ciel.md", expectedAnchor: "journal-meteo", requireMultipleSources: true, rejectIndexAsTop: true },
  { id: "fermentation-legumes", category: "comparaison", question: "Quelle différence entre une saumure de légumes et une fermentation du pain ?", expectedPath: "01_BIBLIOTHEQUE/Cuisine/Fermentation/pain-au-levain.md", expectedAnchor: "fermentation-lente", requireMultipleSources: true, rejectIndexAsTop: true },
  { id: "air-du-compost", category: "synonyme", question: "Pourquoi garder le tas de compost aéré ?", expectedPath: "01_BIBLIOTHEQUE/Jardinage/Sol-et-compost/compostage-domestique.md", expectedAnchor: "epluchures-et-matieres-brunes", rejectIndexAsTop: true },
];
