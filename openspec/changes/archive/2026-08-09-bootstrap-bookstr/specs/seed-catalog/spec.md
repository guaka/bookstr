## Purpose

Provide a seed set of openly licensed / public-domain EPUBs with honest license metadata.

## ADDED Requirements

### Requirement: Seed books with license metadata
The seed catalog SHALL include at least Little Brother (Doctorow), O Banqueiro Anarquista (Pessoa, PT), and Da Terra à Lua (Verne, PT), each with `license`, `licenseUrl` when applicable, and `sourceUrl`.

#### Scenario: Doctorow license honesty
- **GIVEN** Little Brother is in the catalog
- **WHEN** a client displays license metadata
- **THEN** it shows CC BY-NC-SA (not BY-SA alone)

### Requirement: Files stored by hash
Seed EPUBs SHALL be stored as `catalog/books/{sha256}.epub` matching catalog `id`.

#### Scenario: Hash script
- **GIVEN** raw EPUB files in a staging area
- **WHEN** the hash script runs
- **THEN** files are renamed/copied to `{sha256}.epub` and catalog ids updated
