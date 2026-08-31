import { normalizeRightsV2 } from '../rights/rights.mjs';

// Source descriptors are policy metadata, not network adapters. Adapters may
// be implemented by each client, while this registry keeps discovery,
// language, delivery, and seeding rules consistent across platforms.
const SOURCES = [
  {
    id: 'propagate', displayName: 'Propagate', languages: ['multi'], delivery: 'native-torrent',
    rightsPolicy: 'source-asserted-pd', homepage: 'https://propagate.info', enabledInV1: true,
  },
  {
    id: 'internet-archive', displayName: 'Internet Archive', languages: ['multi'], delivery: 'native-torrent',
    rightsPolicy: 'item-evidence-required', homepage: 'https://archive.org', enabledInV1: true,
  },
  {
    id: 'ebooks-gratuits', displayName: 'Ebooks libres et gratuits', languages: ['fr'], delivery: 'native-torrent',
    rightsPolicy: 'source-asserted-pd', homepage: 'https://www.ebooksgratuits.com/torrent.php', enabledInV1: true,
  },
  {
    id: 'gutenberg', displayName: 'Project Gutenberg', languages: ['multi', 'ru', 'zh'], delivery: 'https',
    rightsPolicy: 'source-asserted-pd', homepage: 'https://www.gutenberg.org', enabledInV1: true,
  },
  {
    id: 'wikisource', displayName: 'Wikisource', languages: ['multi', 'ru', 'zh'], delivery: 'https',
    rightsPolicy: 'item-evidence-required', homepage: 'https://wikisource.org', enabledInV1: true,
  },
  {
    id: 'oapen', displayName: 'OAPEN', languages: ['multi'], delivery: 'https',
    rightsPolicy: 'item-evidence-required', homepage: 'https://www.oapen.org', enabledInV1: true,
  },
  {
    id: 'doab', displayName: 'DOAB', languages: ['multi'], delivery: 'metadata',
    rightsPolicy: 'item-evidence-required', homepage: 'https://www.doabooks.org', enabledInV1: true,
  },
  {
    id: 'open-textbook-library', displayName: 'Open Textbook Library', languages: ['en'], delivery: 'https',
    rightsPolicy: 'item-evidence-required', homepage: 'https://open.umn.edu/opentextbooks', enabledInV1: true,
  },
  {
    id: 'unglueit', displayName: 'Unglue.it', languages: ['multi'], delivery: 'https',
    rightsPolicy: 'item-evidence-required', homepage: 'https://unglue.it', enabledInV1: true,
  },
  {
    id: 'global-digital-library', displayName: 'Global Digital Library', languages: ['multi'], delivery: 'https',
    rightsPolicy: 'item-evidence-required', homepage: 'https://www.digitallibrary.io', enabledInV1: true,
  },
  {
    id: 'litres-public-domain', displayName: 'LitRes public-domain feed', languages: ['ru'], delivery: 'https',
    rightsPolicy: 'item-evidence-required', homepage: 'https://www.litres.ru', enabledInV1: false,
  },
  {
    id: 'custom-opds', displayName: 'Custom OPDS', languages: ['multi'], delivery: 'metadata',
    rightsPolicy: 'item-evidence-required', homepage: '', enabledInV1: true,
  },
  {
    id: 'all-books-party', displayName: 'All Books Party', languages: ['multi'], delivery: 'metadata',
    rightsPolicy: 'item-evidence-required', homepage: 'https://all.books.party', enabledInV1: true,
  },
];

export function listSourceDescriptors() {
  return SOURCES.map(source => ({ ...source, languages: [...source.languages] }));
}
export function sourceDescriptor(id) {
  const source = SOURCES.find(candidate => candidate.id === String(id || '').trim().toLowerCase());
  return source ? { ...source, languages: [...source.languages] } : null;
}

export function publicSeedEligible(record) {
  const source = sourceDescriptor(record?.source || record?.provider);
  const rights = normalizeRightsV2(record?.rights || record || {});
  // A source assertion can make a record discoverable, but it cannot override
  // explicit per-item noncommercial/forbidden evidence.
  if (rights.redistribution !== 'allowed') return false;
  if (source?.rightsPolicy === 'source-asserted-pd') {
    return rights.rights_status === 'public_domain' || rights.rights_status === 'open_license';
  }
  return rights.public_seed_allowed;
}
