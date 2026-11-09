---
id: ecommerce-clean
name: E-commerce Clean
description: A tidy modern shop: white, soft grey product backdrops, a confident ink-blue CTA and clear prices.
tags: [light, minimal, professional]
best_for: [online shops, D2C brands, product catalogues, subscription boxes]
fonts: [Plus Jakarta Sans:400,600,700]
---
# E-commerce Clean

A tidy modern shop: white, soft grey product backdrops, a confident ink-blue CTA and clear prices. Mood: Clean, efficient, trustworthy.

## Principles
- Products on consistent light-grey backdrops; one image ratio site-wide.
- Price, rating and Add to cart are visible without hovering.
- Trust signals near the buy button: delivery, returns, secure payment.

## Layout
Hero with one hero product and a short promise, category tiles, best-sellers grid (4 columns desktop, 2 mobile), USP strip (free delivery, returns), reviews, newsletter.

## Typography
Plus Jakarta Sans. Headlines 36–56px weight 700. Body 16px/1.6. Prices 18px weight 700.

## Color
White base, grey product backdrops, ink-blue primary for Add to cart, green accent for 'in stock' and savings.

## Components
- **Buttons:** 10px radius, ink-blue fill; full width on product pages and mobile.
- **Cards:** Product: grey square image, name, rating stars, price (old price struck through), quick add.
- **Navigation:** Search bar centred, account and cart icons, category menu below.
- **Forms:** Clean labelled inputs, inline validation.

## Imagery & icons
Studio product shots on grey; simple line icons for USPs.

## Motion
Quick 150ms; cart drawer slides in from the right.

## Do
- USP strip
- Visible prices
- Reviews near the buy button

## Don't
- Hidden prices
- Auto-playing carousels
- Mixed image ratios

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Plus Jakarta Sans:400,600,700.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
