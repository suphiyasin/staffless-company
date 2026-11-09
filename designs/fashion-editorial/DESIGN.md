---
id: fashion-editorial
name: Fashion Editorial
description: High-fashion lookbook: stark white, giant Bodoni headlines, overlapping images and a single hot accent.
tags: [bold, magazine, minimal]
best_for: [fashion brands, boutiques, lookbooks, model agencies]
fonts: [Bodoni Moda:400,700, Inter Tight:400,500]
---
# Fashion Editorial

High-fashion lookbook: stark white, giant Bodoni headlines, overlapping images and a single hot accent. Mood: Daring, chic, editorial.

## Principles
- Typography as image: oversized Bodoni that crops and overlaps photos.
- Asymmetry and editorial grids, like a printed lookbook.
- One hot accent colour per season, used for sale and new-in only.

## Layout
Huge headline overlapping a tall model photo, asymmetric product grid with mixed sizes, lookbook strip that scrolls horizontally, shop-the-look sections.

## Typography
Bodoni Moda headlines 64–160px, tight tracking. Inter Tight body 15px/1.6, uppercase navigation with 0.1em tracking.

## Color
White and black; hot magenta accent only for 'new in', sale prices and the active state.

## Components
- **Buttons:** Square black fill with white uppercase label, or underlined text.
- **Cards:** Product: tall 3:4 photo, name and price below in small type, no borders.
- **Navigation:** Minimal uppercase links, centred wordmark, bag count.
- **Forms:** Underlined inputs, uppercase labels.

## Imagery & icons
Studio and street fashion photography, tall crops; no icons except bag and search.

## Motion
Image swap on hover (second look), 300ms.

## Do
- Oversized type
- Mixed-size grids
- Shop the look

## Don't
- Rounded corners
- Many colours
- Small hero images

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Bodoni Moda:400,700, Inter Tight:400,500.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
