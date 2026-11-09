---
id: real-estate
name: Real Estate
description: Polished property listings: stone and navy, serif headlines, a search bar first and big photos.
tags: [professional, elegant, light]
best_for: [real estate agencies, property developers, architects' listings, rentals]
fonts: [DM Serif Display:400, DM Sans:400,500,700]
---
# Real Estate

Polished property listings: stone and navy, serif headlines, a search bar first and big photos. Mood: Aspirational, trustworthy, polished.

## Principles
- Search is the hero: location, type, price range, one button.
- Photos sell: large, consistent ratio, never stretched.
- Key facts at a glance: price, beds, baths, m².

## Layout
Full-width property photo hero with a white search panel overlapping its bottom edge. Featured listings in a 3-column grid, neighbourhood guides, agent cards, valuation CTA band.

## Typography
DM Serif Display headlines 40–68px. DM Sans body 16px/1.6; prices in DM Sans 700.

## Color
White and warm stone surfaces, navy primary, brass accent for 'new' and 'reduced' badges.

## Components
- **Buttons:** 6px radius, navy fill; secondary navy outline.
- **Cards:** Listing card: 4:3 photo, price, address, beds/baths/m² icon row, badge.
- **Navigation:** White bar, Buy / Rent / Sell / Agents, Valuation button.
- **Forms:** Search panel with selects in one row, stacked on mobile.

## Imagery & icons
Bright architectural and interior photography; thin line icons for facts.

## Motion
Image hover zoom 300ms; smooth gallery slides.

## Do
- Search panel first
- Fact icon rows
- Map view link

## Don't
- Low-quality photos
- Cluttered listing cards
- Neon colours

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: DM Serif Display:400, DM Sans:400,500,700.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
