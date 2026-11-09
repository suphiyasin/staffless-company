---
id: marketplace-bright
name: Marketplace Bright
description: A lively marketplace: sunny orange, friendly rounded cards, category icons and a big search.
tags: [bright, friendly, rounded]
best_for: [marketplaces, classifieds, delivery apps, community platforms]
fonts: [Poppins:400,600,700]
---
# Marketplace Bright

A lively marketplace: sunny orange, friendly rounded cards, category icons and a big search. Mood: Energetic, helpful, busy in a good way.

## Principles
- Search and categories first; browsing is the main activity.
- Dense but organised: consistent card sizes, clear labels.
- Trust is visible: ratings, verified badges, number of reviews.

## Layout
Hero with a big search bar and popular searches, a row of round category icons, listing grids by section, 'how it works' in three steps, seller CTA band.

## Typography
Poppins. Headlines 32–52px weight 700. Body 16px/1.6; prices weight 600.

## Color
Warm off-white base, orange primary for search and CTAs, teal accent for verified badges and 'new' labels.

## Components
- **Buttons:** 12px radius, orange fill; secondary white with border.
- **Cards:** Listing: photo, title (2 lines max), price, location and time, seller rating.
- **Navigation:** Logo, search, Post an ad button, avatar.
- **Forms:** Large search with category select; rounded inputs.

## Imagery & icons
Real user photos of items; colourful filled category icons.

## Motion
Fast 150ms hovers; skeleton loaders while results load.

## Do
- Category icon row
- Verified badges
- Skeleton loading states

## Don't
- Huge hero images
- Hidden search
- Inconsistent card sizes

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Poppins:400,600,700.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
