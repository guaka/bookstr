# Bookstr design system

Bookstr is the single public-facing brand for the reader and its supporting
library experience. The identity combines a calm, literary reading environment
with a small charge of energy: **quiet pages, electric discovery**.

## Name and voice

- Write **Bookstr** in prose, documentation, store listings, and accessibility
  labels.
- Use the lowercase **bookstr** treatment only in the visual wordmark.
- Prefer calm, direct language. Avoid storefront language, hype, and visual
  noise around the reading experience.

## Logo

The mark combines a lightning-bolt silhouette with an open-book crown. Its
outer edges remain sharp and energetic; its curved upper fold and central spine
make it bookish without turning it into a generic book icon.

Assets:

- [`brand/bookstr-mark.svg`](brand/bookstr-mark.svg) — standalone mark for app
  icons, favicons, social avatars, compact headers, and stickers
- [`brand/bookstr-logo.svg`](brand/bookstr-logo.svg) — horizontal mark and
  lowercase wordmark for wider placements

Keep the mark upright and preserve its colors and proportions. Do not add
shadows, outlines, gradients, or extra details. At very small sizes, use the
standalone mark; do not attempt to fit the wordmark into a favicon or app icon.

The standard full-color mark uses a deep-sage field, a warm-white bolt/book,
and a restrained terracotta page fold. The logo does not use highlight gold;
gold remains a meaningful reading and bookmark color.

## Color palette

| Role | Name | Value | Use |
| --- | --- | --- | --- |
| Primary | Deep sage | `#2F5D50` | Brand field, headers, progress, active controls, focus states |
| Accent | Terracotta | `#C74B32` | Selected details, calls to attention, page-fold detail |
| Reading highlight | Highlight gold | `#E7C766` | Highlighted words and bookmark-related details |
| Soft highlight | Pale gold | `#F3E2A6` | Larger or lower-emphasis highlight areas |
| Page | Paper | `#F7F3EA` | Default reading background |
| Surface | Warm white | `#FFFAF2` | Cards, reversed logo shape, light surfaces |
| Text | Ink | `#1C1916` | Primary text and text over gold highlights |
| Secondary text | Muted stone | `#6B635A` | Metadata, captions, secondary controls |
| Dark-mode primary | Light sage | `#7FB8A7` | Progress and active controls on dark surfaces |
| Dark-mode highlight | Aged gold | `#B58D32` | Highlighted words in dark reading mode |

### Color hierarchy

Deep sage does the structural work. It replaces the unrelated blue and bright
green treatments previously used for APK headers, progress bars, active tabs,
links, focus states, and primary controls.

Terracotta is the spark, not a second primary. Use it for small selected states,
important accents, and the logo's page detail. Avoid large interfaces that are
half sage and half terracotta.

Gold is functional. Readers already understand yellow as a highlight, so keep
it attached to highlighted words, annotations, and occasional bookmark cues.
Do not use gold for ordinary buttons or navigation.

## Reading themes

### Paper theme

- Page: `#F7F3EA`
- Surface: `#FFFAF2`
- Text: `#1C1916`
- Secondary text: `#6B635A`
- Primary/action/progress: `#2F5D50`
- Highlight: `#E7C766`
- Highlight text: `#1C1916`

### White theme

Use white only for the reading page when the user explicitly selects it. Keep
warm white for surrounding surfaces, deep sage for actions and progress, and
ink for text so the product still belongs to the same visual family.

### Night theme

- Page: `#121212`
- Surface: `#1B1A18`
- Text: `#E8E4DC`
- Secondary text: `#AAA39A`
- Primary/action/progress: `#7FB8A7`
- Highlight: `#B58D32`
- Highlight text: `#1C1916`

Highlighted text should retain dark ink even in night mode; the filled gold
shape supplies enough separation from the dark page.

## Typography

- Brand and editorial display: a warm old-style serif. Prefer **Iowan Old
  Style** where available, followed by Palatino, Book Antiqua, and Georgia.
- Interface and controls: the native system sans-serif stack for clarity and
  platform familiarity.
- Long-form book content: respect the publication's typography by default and
  offer the existing reader font choices.

Use the serif for the wordmark, book titles, and occasional section headings.
Do not use it for dense settings, metadata, or small controls. The wordmark is
lowercase and confidently weighted; ordinary product text remains **Bookstr**.

## Interface application

- Headers and active navigation: deep sage, or paper/warm-white surfaces with
  deep-sage active states.
- Reading progress: deep sage in light themes and light sage in night mode.
- Links and keyboard focus: deep sage, with clear non-color indicators where
  needed.
- Primary buttons: deep sage with warm-white text.
- Destructive actions: retain a dedicated accessible red; do not reuse
  terracotta when an action means deletion or irreversible loss.
- Selected editorial details: terracotta.
- Highlighted vocabulary: highlight gold with ink text.
- Backgrounds: prefer paper and warm white over cold gray or blue-white.

Color must not be the only indication of state. Preserve labels, icons,
underlines, focus rings, or shape changes, and verify text/control contrast when
introducing new combinations.

## Platform consistency

The same mark and color roles apply across the web app, Android, iOS, LibVault
surfaces presented as part of Bookstr, GitHub/social profiles, and print. Each
platform may retain its native layout and controls; consistency comes from the
mark, palette, typography roles, and calm visual hierarchy rather than forcing
identical screens.
