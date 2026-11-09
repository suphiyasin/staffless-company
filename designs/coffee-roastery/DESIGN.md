---
id: coffee-roastery
name: Coffee Roastery
description: Craft roastery: kraft-paper browns, espresso text and stamp-like labels for origins and roast levels.
tags: [warm, food, organic]
best_for: [coffee shops, roasters, tea houses, breakfast spots]
fonts: [Bitter:500,700, Karla:400,500,700]
---
# Coffee Roastery

Craft roastery: kraft-paper browns, espresso text and stamp-like labels for origins and roast levels. Mood: Crafty, grounded, cosy.

## Principles
- Origin and process are the story: country, farm, roast level on every product.
- Materials feel tactile: kraft tones, stamped labels, slight paper texture.
- Two paths everywhere: visit the café or buy beans.

## Layout
Split hero (photo of pour-over left, headline and two buttons right), a row of bean cards with roast-level scales, a 'from farm to cup' three-step strip, café locations with hours.

## Typography
Bitter slab headlines 36–64px. Karla body 17px/1.6. Labels in uppercase 12px with 0.12em tracking, like a stamp.

## Color
Kraft cream base, espresso brown primary, caramel accent for roast-level dots and badges.

## Components
- **Buttons:** 6px radius, espresso fill; secondary has a 1.5px brown outline.
- **Cards:** Bean bag cards: origin stamp label, tasting notes as three chips, 1–5 roast dots, price.
- **Navigation:** Left logo, Shop / Cafés / Story links, cart icon.
- **Forms:** Boxed inputs with 1.5px brown borders.

## Imagery & icons
Warm photos of beans, hands and brewing; simple stamp-style line icons.

## Motion
Subtle 200ms lifts on product cards.

## Do
- Tasting-note chips
- Roast-level scale
- Café hours visible

## Don't
- Cold blues and greys
- Glossy gradients
- Generic stock coffee cups

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Bitter:500,700, Karla:400,500,700.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
