---
id: editorial-serif
name: Editorial Serif
description: A modern print magazine: big serif headlines, cream paper, narrow reading columns.
tags: [serif, light, magazine]
best_for: [blogs, magazines, writers, publishers]
fonts: [Playfair Display:600,800, Source Serif 4:400,600]
---
# Editorial Serif

A modern print magazine: big serif headlines, cream paper, narrow reading columns. Mood: Literate, thoughtful, warm.

## Principles
- Reading comes first: 65–75 characters per line.
- Headlines are the art; images support them.
- Use rules, drop caps and pull quotes like a print layout.

## Layout
Centred column of 680px for text, wider breakouts for images and pull quotes. Article lists in a two-column grid with thin dividers.

## Typography
Serif everywhere. Headlines 40–72px. Body 19px/1.7. Small caps bylines. A drop cap on the first paragraph.

## Color
Ink on cream. Oxblood red for links, kicker labels and the primary button.

## Components
- **Buttons:** Small, square-ish, oxblood fill or underlined text link.
- **Cards:** Image on top, kicker label, serif headline, two-line excerpt; no shadow.
- **Navigation:** Centred masthead logo, section links below in small caps.
- **Forms:** Simple boxed inputs with serif labels.

## Imagery & icons
Documentary photography with captions in italic.

## Motion
Subtle; links underline on hover.

## Do
- Pull quotes
- Captions
- Generous line height

## Don't
- Sans-serif headlines
- Bright saturated colours
- Dense UI chrome

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Playfair Display:600,800, Source Serif 4:400,600.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
