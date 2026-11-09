---
id: dark-saas
name: Dark SaaS
description: A polished dark product site: deep navy, violet-to-cyan glow, crisp cards and a product screenshot hero.
tags: [dark, tech, gradient]
best_for: [software products, startups, apps, dashboards]
fonts: [Inter:400,500,600,700]
---
# Dark SaaS

A polished dark product site: deep navy, violet-to-cyan glow, crisp cards and a product screenshot hero. Mood: Modern, capable, premium.

## Principles
- Show the product: a framed screenshot or mock in the hero.
- Glow, not noise: one soft violet→cyan gradient per section at most.
- Every section answers one question (what, how, proof, price).

## Layout
Centred hero with headline, subline, two buttons and a product frame. Feature grid of 3, logo strip, pricing cards, FAQ accordion.

## Typography
Headlines 44–64px, weight 700, tight tracking; gradient text allowed on one hero word. Body 16px/1.6 in muted grey.

## Color
Navy background, slightly lighter surfaces, violet primary, cyan accents for highlights and charts.

## Components
- **Buttons:** Pill-ish 10px radius; primary violet with glow shadow, secondary outlined.
- **Cards:** Surface colour, 1px border, 18px radius, icon in a tinted square.
- **Navigation:** Sticky, translucent with blur, CTA button on the right.
- **Forms:** Dark inputs, violet focus ring.

## Imagery & icons
UI screenshots, abstract gradients, line icons.

## Motion
Fade-up on scroll, 200ms hover lifts.

## Do
- Product screenshots
- Clear pricing
- Social proof strip

## Don't
- Pure black backgrounds
- Rainbow gradients
- Stock photos of people pointing at laptops

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Inter:400,500,600,700.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
