---
id: photography-portfolio
name: Photo Portfolio
description: The work speaks: near-black gallery walls, edge-to-edge images and tiny, quiet type.
tags: [dark, minimal, grid]
best_for: [photographers, videographers, visual artists, studios]
fonts: [Manrope:400,500,700]
---
# Photo Portfolio

The work speaks: near-black gallery walls, edge-to-edge images and tiny, quiet type. Mood: Quiet, confident, cinematic.

## Principles
- Images get 90% of the screen; UI almost disappears.
- Consistent gutters and a masonry or justified grid.
- Contact and booking are one click from any project.

## Layout
Minimal header, a justified image grid on the home page, project pages with full-width images and a short caption, about with portrait, contact page with a simple form.

## Typography
Manrope small and quiet: headings 24–40px weight 500, body 15px/1.7, captions 13px muted.

## Color
Near-black walls, off-white text and primary (inverted buttons), a warm gold accent only for hover states.

## Components
- **Buttons:** Square, off-white fill with black text, or text links with an arrow.
- **Cards:** No cards: images with a caption on hover.
- **Navigation:** Name left, Work / About / Contact right, tiny.
- **Forms:** Minimal underlined inputs.

## Imagery & icons
Full-bleed photographs, never cropped badly; no icons except arrows.

## Motion
Lightbox fades 250ms; lazy-loaded images fade in.

## Do
- Justified grids
- Lightbox viewing
- Captions with place and year

## Don't
- Coloured backgrounds
- Big headlines over photos
- Watermarks everywhere

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Manrope:400,500,700.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
